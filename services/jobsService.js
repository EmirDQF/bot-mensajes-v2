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
import { isMissingColumn } from './appointmentService.js';
import { reminderHours } from '../config/clinic.config.js';
import { createFollowUps } from './followUpService.js';
import { createContactPreferences } from './contactPreferences.js';

// Tareas programadas. Las dispara un cron externo (Render Cron Job) vía POST /jobs/* con CRON_SECRET;
// no hay temporizadores internos porque Render duerme el servicio.

const HOUR_MS = 60 * 60 * 1000;
const WINDOW_MS = 23.5 * HOUR_MS; // margen de seguridad sobre la ventana de 24 h de WhatsApp
// Reactivación de pacientes que vinieron hace ~6 meses.
const REACTIVATION_DAYS = Number(process.env.REACTIVATION_DAYS || 180);
const REACTIVATION_WINDOW_DAYS = 7;
// Botones del recordatorio dentro de la ventana de 24 h: los mismos de la plantilla (Confirmo / Reprogramar).
export const REMINDER_BUTTONS = [{ id: 'confirmar', title: 'Confirmo' }, { id: 'reagendar', title: 'Reprogramar' }];
// El recordatorio largo no sale si la cita se pidió hace menos de esto (acaba de recibir la confirmación).
const FRESH_BOOKING_HOURS = 12;

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
  async function sendWithWindow(to, { text, template, params, buttons = null }, sent = {}) {
    let inWindow = false;
    try {
      const last = await lastInboundAt(to);
      inWindow = Boolean(last) && now() - last < WINDOW_MS;
    } catch (error) {
      console.warn('[Jobs] No se pudo leer el último mensaje del paciente; se usará la plantilla:', error?.message || error);
    }
    if (inWindow && buttons && typeof whatsapp.sendButtonsMessage === 'function') {
      sent.result = await whatsapp.sendButtonsMessage(to, text, buttons);
      return 'buttons';
    }
    if (inWindow) {
      sent.result = await whatsapp.sendTextMessage(to, text);
      return 'text';
    }
    sent.result = await whatsapp.sendTemplateMessage(to, template.name, params, { language: template.language });
    return 'template';
  }

  // ---------- Recordatorios (por defecto 48 h y 2 h antes; clinic.reminders) ----------
  // El primero ("largo") se marca en reminder_24h_sent_at y el segundo ("corto") en reminder_2h_sent_at: las
  // columnas conservan su nombre histórico, pero las horas salen de la configuración.
  function reminderKind(apt, minutesLeft, current, { firstHours, secondHours }) {
    const shortMinutes = (secondHours || 0) * 60;
    if (secondHours && minutesLeft > 0 && minutesLeft <= shortMinutes && !apt.reminder_2h_sent_at) return '2h';
    const fresh = apt.created_at && current - new Date(apt.created_at) < FRESH_BOOKING_HOURS * HOUR_MS;
    if (firstHours && minutesLeft > shortMinutes && minutesLeft <= firstHours * 60 && !apt.reminder_24h_sent_at && !fresh) return '24h';
    return null;
  }

  async function runReminders() {
    const current = now();
    const today = localParts(clinic.timezone, current).date;
    const hours = reminderHours(clinic);
    const rows = await query((await db()).from('appointments').select('*')
      .eq('clinic_id', clinic.id)
      .in('status', ACTIVE_STATUSES)
      .gte('appointment_date', today)
      .lte('appointment_date', addDays(today, Math.ceil((hours.firstHours || 24) / 24) + 1)));

    const result = { checked: rows.length, sent24h: 0, sent2h: 0, failed: 0, hours };
    for (const apt of rows) {
      const minutesLeft = (toInstant(apt.appointment_date, apt.appointment_time, clinic.timezone) - current) / 60000;
      const kind = reminderKind(apt, minutesLeft, current, hours);
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
      // Con botones (si el cliente de WhatsApp los soporta) o con 1️⃣ / 2️⃣ escritos: el webhook entiende ambos.
      const text = kind === '24h'
        ? `${hello} 👋 Te recordamos tu cita en ${clinic.name} para ${data.treatment} el ${data.day} a las ${data.time}.\n📍 ${clinic.address}\n\nResponde:\n1️⃣ Confirmo\n2️⃣ Reprogramar`
        : `${hello} 👋 Tu cita en ${clinic.name} es hoy a las ${data.time}.\n📍 ${clinic.address}\n\nSi no podrás llegar, responde 2️⃣ para reprogramar.`;
      const buttonText = kind === '24h'
        ? `${hello} 👋 Te recordamos tu cita en ${clinic.name} para ${data.treatment} el ${data.day} a las ${data.time}.\n📍 ${clinic.address}\n\n¿Nos confirmas tu asistencia?`
        : `${hello} 👋 Tu cita en ${clinic.name} es hoy a las ${data.time}.\n📍 ${clinic.address}\n\nSi no podrás llegar, toca Reagendar.`;
      const template = kind === '24h' ? TEMPLATES.reminder24h : TEMPLATES.reminder2h;
      try {
        const sendsButtons = typeof whatsapp.sendButtonsMessage === 'function';
        await sendWithWindow(apt.sender_phone, {
          text: sendsButtons ? buttonText : text, template, params: template.params(data), buttons: sendsButtons ? REMINDER_BUTTONS : null,
        });
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
    const todays = await query(client.from('appointments').select('id, appointment_time, patient_name, treatment, status')
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
      agenda: [...todays].sort((a, b) => String(a.appointment_time).localeCompare(String(b.appointment_time)))
        .map((a) => `${a.appointment_time ? formatTimeEs(a.appointment_time) : 'Hora por confirmar'} — ${firstName(a.patient_name) || 'Paciente'} · ${a.treatment || 'Evaluación'}${a.status === 'confirmada' ? ' ✅' : ''}`),
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
      '',
      `🗓️ Agenda de hoy (${summary.agenda.length}):`,
      ...(summary.agenda.length ? summary.agenda : ['Sin citas registradas para hoy.']),
    ].join('\n');
    // Briefing de las 7:30 a. m.: al dueño y a recepción (si es otro número). Fuera de la ventana de 24 h va la
    // plantilla resumen_diario (solo cifras); la agenda completa queda en el panel.
    const recipients = [...new Set([getOwnerPhone(), getReceptionPhone()].filter(Boolean))];
    if (!recipients.length) {
      console.warn('[Jobs] OWNER_ALERT_PHONE ni RECEPTION_ALERT_PHONE están definidas; el resumen diario no se envió.');
      return { sent: false, summary, text };
    }
    const params = TEMPLATES.dailySummary.params(summary);
    const channels = [];
    for (const to of recipients) channels.push(await sendWithWindow(to, { text, template: TEMPLATES.dailySummary, params }));
    return { sent: true, channel: channels[0], channels, summary, text };
  }

  // ---------- Seguimiento ético (services/followUpService.js) y reactivación (~6 meses) ----------
  // follow_ups guarda una fila por paciente y etapa: el índice único evita repetir aunque el cron corra varias veces.
  const followUps = createFollowUps({
    getClient, whatsapp, appointments, handoff, clinic, now,
    preferences: createContactPreferences({ getClient, clinic, now }),
  });
  const runFollowUps = () => followUps.runFollowUps();

  async function sentStages(client, phones) {
    try {
      const rows = await query(client.from('follow_ups').select('phone, stage').eq('clinic_id', clinic.id).in('phone', phones));
      return { supported: true, done: new Set(rows.map((f) => `${digits(f.phone)}:${f.stage || 'final'}`)) };
    } catch (error) {
      if (!isMissingColumn(error, 'stage')) throw error;
      console.warn('[Jobs] Falta follow_ups.stage; ejecuta migrations/20261104_follow_up_stages.sql (la reactivación no corre hasta entonces)');
      const rows = await query(client.from('follow_ups').select('phone').eq('clinic_id', clinic.id).in('phone', phones));
      return { supported: false, done: new Set(rows.map((f) => `${digits(f.phone)}:final`)) };
    }
  }

  // Ficha del lead: "no contactar" y anuncio de origen. leads.telefono va sin el 51.
  async function leadProfiles(client, phones) {
    try {
      const local = phones.map((p) => p.slice(-9));
      const rows = await query(client.from('leads').select('telefono, tags, ad_referral').in('telefono', [...new Set([...phones, ...local])]));
      return new Map(rows.map((l) => [digits(l.telefono).slice(-9), l]));
    } catch (error) {
      console.warn('[Jobs] No se pudieron leer las fichas de los leads:', error?.message || error);
      return new Map();
    }
  }

  const doNotContact = (profile) => Array.isArray(profile?.tags) && profile.tags.includes('no_contactar');

  // Se registra antes de enviar (claim): si otra ejecución ya lo hizo, el índice único lo rechaza.
  async function claimFollowUp(client, phone, stage, supported, at) {
    const row = supported ? { clinic_id: clinic.id, phone, stage, sent_at: at } : { clinic_id: clinic.id, phone, sent_at: at };
    const { error } = await client.from('follow_ups').insert([row]);
    if (!error) return true;
    if (error.code !== '23505') console.error('[Jobs] No se pudo registrar el seguimiento:', error.message || error);
    return false;
  }

  // Pacientes cuya última cita (no cancelada) fue hace ~6 meses y no volvieron: plantilla de reactivación
  // (fuera de la ventana de 24 h solo se puede escribir con plantillas aprobadas). Una vez por paciente.
  async function runReactivation() {
    const current = now();
    const client = await db();
    const today = localParts(clinic.timezone, current).date;
    const from = addDays(today, -(REACTIVATION_DAYS + REACTIVATION_WINDOW_DAYS));
    const to = addDays(today, -REACTIVATION_DAYS);
    const old = await query(client.from('appointments').select('sender_phone, appointment_date, status')
      .eq('clinic_id', clinic.id).gte('appointment_date', from).lte('appointment_date', to));
    const internal = internalPhones();
    const phones = [...new Set(old.filter((a) => a.status !== 'cancelada').map((a) => digits(a.sender_phone)))]
      .filter((phone) => phone && !internal.has(phone));
    const result = { candidates: phones.length, sent: 0, skipped: 0, failed: 0 };
    if (!phones.length) return result;

    const returned = new Set((await query(client.from('appointments').select('sender_phone, appointment_date, status')
      .eq('clinic_id', clinic.id).in('sender_phone', phones).gt('appointment_date', to)))
      .filter((a) => a.status !== 'cancelada').map((a) => digits(a.sender_phone)));
    const { supported, done } = await sentStages(client, phones);
    if (!supported) {
      result.skipped = phones.length;
      return result;
    }
    const profiles = await leadProfiles(client, phones);
    const campaign = [clinic.campaign?.evaluation, clinic.campaign?.initialFee].filter(Boolean).join(' y ');
    for (const phone of phones) {
      const skip = returned.has(phone) || done.has(`${phone}:reactivation`) || doNotContact(profiles.get(phone.slice(-9)))
        || await handoff.isPaused(phone);
      if (skip || !(await claimFollowUp(client, phone, 'reactivation', true, current.toISOString()))) {
        result.skipped += 1;
        continue;
      }
      try {
        await sendWithWindow(phone, {
          text: `¡Hola! Te escribimos de ${clinic.name} 😊 Ya pasaron unos meses desde tu última visita. ¿Te propongo 3 horarios para tu control? Solo responde "quiero una cita".`,
          template: TEMPLATES.reactivation,
          params: TEMPLATES.reactivation.params({ clinicName: clinic.name, campaign: campaign || 'evaluación de control' }),
        });
        result.sent += 1;
      } catch (error) {
        result.failed += 1;
        console.error('[Jobs] Reactivación falló:', error?.message || error);
      }
    }
    return result;
  }

  return { runReminders, runDailySummary, buildDailySummary, runFollowUps, runReactivation, sendWithWindow, lastInboundAt };
}

const jobs = createJobs();
export default jobs;
