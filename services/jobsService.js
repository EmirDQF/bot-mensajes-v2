import { getSupabase as getDefaultClient } from './supabaseClient.js';
import activeClinic, { getOwnerPhone, getReceptionPhone } from '../config/clinic.config.js';
import TEMPLATES from '../config/whatsappTemplates.js';
import whatsappService from './whatsappService.js';
import appointmentService, {
  ACTIVE_STATUSES, addDays, formatDateEs, formatTimeEs, isWithinWorkingHours, localParts, toInstant,
} from './appointmentService.js';
import { now as clockNow } from './clock.js';
import handoffService from './handoffService.js';
import messageDedup from './messageDedup.js';
import { fetchAllRows } from './supabasePaging.js';

// Tareas programadas. Las dispara un cron externo (Render Cron Job) vía POST /jobs/* con CRON_SECRET;
// no hay temporizadores internos porque Render duerme el servicio.

const HOUR_MS = 60 * 60 * 1000;
const WINDOW_MS = 23.5 * HOUR_MS; // margen de seguridad sobre la ventana de 24 h de WhatsApp
const FOLLOW_UP_AFTER_HOURS = Number(process.env.FOLLOW_UP_AFTER_HOURS || 20);

const digits = (phone) => String(phone || '').replace(/\D/g, '');
const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';

// Vive en appointmentService (lo usa también la conversación); se reexporta por compatibilidad.
export { isWithinWorkingHours };

export function createJobs({
  getClient = getDefaultClient,
  whatsapp = whatsappService,
  appointments = appointmentService,
  handoff = handoffService,
  dedup = messageDedup,
  clinic = activeClinic,
  now = clockNow,
} = {}) {
  async function db() {
    const client = await getClient();
    if (!client) throw new Error('Supabase no configurado (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY)');
    return client;
  }

  async function query(builder) {
    const { data, error } = await builder;
    if (error) throw error;
    return data || [];
  }

  const internalPhones = () => new Set([getReceptionPhone(), getOwnerPhone()].filter(Boolean));

  async function lastInboundAt(phone) {
    const client = await db();
    const { data, error } = await client.from('messages').select('created_at')
      .eq('phone', digits(phone)).eq('role', 'user')
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    return data?.created_at ? new Date(data.created_at) : null;
  }

  // Dentro de la ventana de 24 h se envía texto libre; fuera de ella, la plantilla aprobada.
  // sent (opcional) recibe la respuesta de Meta en sent.result (el panel guarda el id para los ✓✓).
  async function sendWithWindow(to, { text, template, params }, sent = {}) {
    let inWindow = false;
    try {
      const last = await lastInboundAt(to);
      inWindow = Boolean(last) && now() - last < WINDOW_MS;
    } catch (error) {
      console.warn('[Jobs] No se pudo leer el último mensaje del paciente; se usará la plantilla:', error?.message || error);
    }
    if (inWindow) {
      sent.result = await whatsapp.sendTextMessage(to, text);
      return 'text';
    }
    sent.result = await whatsapp.sendTemplateMessage(to, template.name, params, { language: template.language });
    return 'template';
  }

  // ---------- Recordatorios 24 h y 2 h ----------
  async function runReminders() {
    const current = now();
    const today = localParts(clinic.timezone, current).date;
    const rows = await query((await db()).from('appointments').select('*')
      .eq('clinic_id', clinic.id)
      .in('status', ACTIVE_STATUSES)
      .gte('appointment_date', today)
      .lte('appointment_date', addDays(today, 2)));

    const result = { checked: rows.length, sent24h: 0, sent2h: 0, failed: 0 };
    for (const apt of rows) {
      const minutesLeft = (toInstant(apt.appointment_date, apt.appointment_time, clinic.timezone) - current) / 60000;
      const kind = minutesLeft > 0 && minutesLeft <= 120 && !apt.reminder_2h_sent_at ? '2h'
        : minutesLeft > 120 && minutesLeft <= 24 * 60 && !apt.reminder_24h_sent_at ? '24h'
          : null;
      if (!kind) continue;

      const data = {
        patient: firstName(apt.patient_name) || 'paciente',
        clinicName: clinic.name,
        treatment: apt.treatment || 'tu evaluación',
        day: formatDateEs(apt.appointment_date),
        time: formatTimeEs(apt.appointment_time),
        address: clinic.address,
      };
      const hello = firstName(apt.patient_name) ? `Hola ${firstName(apt.patient_name)}` : 'Hola';
      const text = kind === '24h'
        ? `${hello} 👋 Te recordamos tu cita en ${clinic.name} para ${data.treatment} el ${data.day} a las ${data.time}.\n📍 ${clinic.address}\n\nResponde:\n1️⃣ Confirmo\n2️⃣ Reprogramar`
        : `${hello} 👋 Tu cita en ${clinic.name} es hoy a las ${data.time}.\n📍 ${clinic.address}\n\nSi no podrás llegar, responde 2️⃣ para reprogramar.`;
      const template = kind === '24h' ? TEMPLATES.reminder24h : TEMPLATES.reminder2h;
      try {
        await sendWithWindow(apt.sender_phone, { text, template, params: template.params(data) });
        const column = kind === '24h' ? 'reminder_24h_sent_at' : 'reminder_2h_sent_at';
        await appointments.updateStatus(apt.id, apt.status, { [column]: current.toISOString() });
        result[kind === '24h' ? 'sent24h' : 'sent2h'] += 1;
      } catch (error) {
        result.failed += 1;
        console.error(`[Jobs] Recordatorio ${kind} falló para la cita ${apt.id}:`, error?.message || error);
      }
    }
    return result;
  }

  // ---------- Resumen diario para el dueño ----------
  async function buildDailySummary() {
    const current = now();
    const today = localParts(clinic.timezone, current).date;
    const yesterday = addDays(today, -1);
    const from = toInstant(yesterday, '00:00', clinic.timezone).toISOString();
    const to = toInstant(today, '00:00', clinic.timezone).toISOString();
    const weekAgo = toInstant(addDays(today, -7), '00:00', clinic.timezone).toISOString();
    const client = await db();
    const internal = internalPhones();

    const inbound = (await fetchAllRows(() => client.from('messages').select('phone, created_at')
      .eq('role', 'user').gte('created_at', from).lt('created_at', to).order('created_at', { ascending: true })))
      .filter((m) => m.phone && !internal.has(digits(m.phone)));
    const contacted = new Set(inbound.map((m) => digits(m.phone)));
    const afterHours = new Set(inbound.filter((m) => !isWithinWorkingHours(clinic, new Date(m.created_at))).map((m) => digits(m.phone)));

    const created = await query(client.from('appointments').select('id, created_at')
      .eq('clinic_id', clinic.id).gte('created_at', from).lt('created_at', to));
    const todays = await query(client.from('appointments').select('id')
      .eq('clinic_id', clinic.id).eq('appointment_date', today).in('status', ACTIVE_STATUSES));
    const week = await query(client.from('appointments').select('sender_phone, ad_referral')
      .eq('clinic_id', clinic.id).gte('created_at', weekAgo));

    const booked = new Set(week.map((a) => digits(a.sender_phone)));
    if (contacted.size) {
      const withAppointment = await query(client.from('appointments').select('sender_phone')
        .eq('clinic_id', clinic.id).in('sender_phone', [...contacted]));
      withAppointment.forEach((a) => booked.add(digits(a.sender_phone)));
    }
    const unbooked = [...contacted].filter((phone) => !booked.has(phone)).length;

    const byAd = new Map();
    for (const a of week) {
      const ad = a.ad_referral?.headline || a.ad_referral?.source_id;
      if (ad) byAd.set(ad, (byAd.get(ad) || 0) + 1);
    }
    const [topName, topCount] = [...byAd.entries()].sort((x, y) => y[1] - x[1])[0] || [];
    const topAd = topName ? `${topName} (${topCount} ${topCount === 1 ? 'cita' : 'citas'})` : 'Sin datos de anuncios aún';

    return {
      date: formatDateEs(yesterday),
      afterHours: afterHours.size,
      created: created.length,
      // Solicitudes hechas con la clínica cerrada (hora de creación en la zona horaria de la clínica).
      afterHoursAppointments: created.filter((a) => a.created_at && !isWithinWorkingHours(clinic, new Date(a.created_at))).length,
      today: todays.length,
      unbooked,
      topAd,
    };
  }

  async function runDailySummary() {
    // Mantenimiento diario: los ids de mensajes de más de 7 días ya no se necesitan para deduplicar.
    try {
      await dedup.prune(7);
    } catch (error) {
      console.warn('[Jobs] No se pudo limpiar webhook_events:', error?.message || error);
    }
    const summary = await buildDailySummary();
    const text = [
      `📊 Resumen de ${clinic.name} — ${summary.date}`,
      '',
      `🌙 Consultas fuera de horario: ${summary.afterHours}`,
      `📅 Citas creadas: ${summary.created}`,
      `🌙 Citas solicitadas mientras la clínica estaba cerrada: ${summary.afterHoursAppointments}`,
      `🦷 Citas para hoy: ${summary.today}`,
      `⏳ Leads sin agendar: ${summary.unbooked}`,
      `📣 Anuncio con más citas (7 días): ${summary.topAd}`,
    ].join('\n');
    const owner = getOwnerPhone();
    if (!owner) {
      console.warn('[Jobs] OWNER_ALERT_PHONE no está definida; el resumen diario no se envió.');
      return { sent: false, summary, text };
    }
    const channel = await sendWithWindow(owner, { text, template: TEMPLATES.dailySummary, params: TEMPLATES.dailySummary.params(summary) });
    return { sent: true, channel, summary, text };
  }

  // ---------- Seguimiento único a leads que no agendaron ----------
  async function runFollowUps() {
    const current = now();
    const client = await db();
    const internal = internalPhones();
    const since = new Date(current - 24 * HOUR_MS).toISOString();
    const inbound = await fetchAllRows(() => client.from('messages').select('phone, created_at')
      .eq('role', 'user').gte('created_at', since).order('created_at', { ascending: true }));

    const lastByPhone = new Map();
    for (const m of inbound) {
      const phone = digits(m.phone);
      if (!phone || internal.has(phone)) continue;
      const at = new Date(m.created_at);
      if (!lastByPhone.has(phone) || lastByPhone.get(phone) < at) lastByPhone.set(phone, at);
    }
    // Solo quien lleva entre 20 h y 23,5 h sin escribir: sigue dentro de la ventana gratuita.
    const candidates = [...lastByPhone.entries()]
      .filter(([, at]) => {
        const hours = (current - at) / HOUR_MS;
        return hours >= FOLLOW_UP_AFTER_HOURS && hours < WINDOW_MS / HOUR_MS;
      })
      .map(([phone]) => phone);
    const result = { candidates: candidates.length, sent: 0, skipped: 0, failed: 0 };
    if (!candidates.length) return result;

    const monthAgo = new Date(current - 30 * 24 * HOUR_MS).toISOString();
    const withAppointment = new Set((await query(client.from('appointments').select('sender_phone')
      .eq('clinic_id', clinic.id).in('sender_phone', candidates).gte('created_at', monthAgo))).map((a) => digits(a.sender_phone)));
    const alreadyFollowed = new Set((await query(client.from('follow_ups').select('phone')
      .eq('clinic_id', clinic.id).in('phone', candidates))).map((f) => digits(f.phone)));
    // Etiqueta "no contactar" de la ficha (migrations/20260930_lead_profile.sql). leads.telefono va sin el 51.
    let doNotContact = new Set();
    try {
      const local = candidates.map((p) => p.slice(-9));
      doNotContact = new Set((await query(client.from('leads').select('telefono, tags').in('telefono', [...candidates, ...local])))
        .filter((l) => Array.isArray(l.tags) && l.tags.includes('no_contactar')).map((l) => digits(l.telefono).slice(-9)));
    } catch (error) {
      console.warn('[Jobs] No se pudieron leer las etiquetas de los leads:', error?.message || error);
    }

    const campaign = [clinic.campaign?.evaluation, clinic.campaign?.initialFee].filter(Boolean).join(' y ');
    const text = `¡Hola! Soy ${clinic.botName} de ${clinic.name} 😊 ¿Pudiste pensarlo? Seguimos con ${campaign || 'nuestra campaña'}. `
      + 'Si quieres, te propongo 3 horarios para tu evaluación: solo responde "quiero una cita".';

    for (const phone of candidates) {
      if (withAppointment.has(phone) || alreadyFollowed.has(phone) || doNotContact.has(phone.slice(-9)) || await handoff.isPaused(phone)) {
        result.skipped += 1;
        continue;
      }
      // Se registra antes de enviar: el índice único evita un segundo mensaje aunque el cron se repita.
      const { error: claimError } = await client.from('follow_ups').insert([{ clinic_id: clinic.id, phone, sent_at: current.toISOString() }]);
      if (claimError) {
        result.skipped += 1;
        if (claimError.code !== '23505') console.error('[Jobs] No se pudo registrar el seguimiento:', claimError.message || claimError);
        continue;
      }
      try {
        await sendWithWindow(phone, {
          text, template: TEMPLATES.reactivation, params: TEMPLATES.reactivation.params({ clinicName: clinic.name, campaign }),
        });
        result.sent += 1;
      } catch (error) {
        result.failed += 1;
        console.error('[Jobs] Seguimiento falló:', error?.message || error);
      }
    }
    return result;
  }

  return { runReminders, runDailySummary, buildDailySummary, runFollowUps, sendWithWindow, lastInboundAt };
}

const jobs = createJobs();
export default jobs;
