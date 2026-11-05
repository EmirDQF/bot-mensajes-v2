import { getSupabase as getDefaultClient } from './supabaseClient.js';
import activeClinic, {
  activePromotions, findTreatment, followUpSettings, getOwnerPhone, getReceptionPhone,
} from '../config/clinic.config.js';
import TEMPLATES from '../config/whatsappTemplates.js';
import whatsappService from './whatsappService.js';
import appointmentService, { formatDateEs, localParts } from './appointmentService.js';
import handoffService from './handoffService.js';
import contactPreferences, { detectMinor } from './contactPreferences.js';
import { now as clockNow } from './clock.js';
import { isTestPhone } from './testContext.js';
import { fetchAllRows } from './supabasePaging.js';
import { isMissingColumn } from './appointmentService.js';
import { adTreatment } from './adContext.js';
import { formatSlotList } from './aiFallback.js';
import { sendWithSlotPicker } from './slotButtons.js';
import { evaluationPackView } from './catalog.js';
import { describeError } from './safeLog.js';

// Seguimiento ético cuando el paciente no responde (POST /jobs/follow-ups, cada hora):
//   seq1 · a las 3 h (texto libre): retoma donde quedó, con 2 horarios libres reales en botones.
//   seq2 · a las ~22 h (texto libre, aún dentro de la ventana): resuelve la objeción más probable con datos reales.
//   seq3 · al día 3 (fuera de la ventana): UNA plantilla de marketing, solo con opt-in de marketing guardado.
// Máximo 3 seguimientos por conversación (30 días) y 1 mensaje por etapa. Para de inmediato si el paciente agenda,
// dice "no"/"stop", lo bloquea, está pasado a humano o en urgencia, o es menor de edad.
// Persuasión solo con datos reales: cupos que de verdad quedan, fecha de fin real de la promoción, calificación de
// Google si está en la configuración, financiamiento configurado y "solo trae tu DNI". Nunca escasez falsa,
// urgencias inventadas, testimonios, miedo por la salud ni culpa.

const HOUR_MS = 60 * 60 * 1000;
const WINDOW_HOURS = 23.5;
const LOOKBACK_DAYS = 30;
// "Quedan pocos horarios" solo si de verdad quedan esta cantidad o menos en los próximos 7 días.
export const REAL_SCARCITY_MAX = 6;
// Meta no pudo entregarle (bloqueo o número sin WhatsApp) o el paciente dejó de aceptar marketing de la empresa.
const UNDELIVERABLE_CODES = new Set([131026, 131050]);
const SEQUENCE_STAGES = ['seq1', 'seq2', 'seq3'];
const LEGACY_STAGES = ['first', 'final'];

const digits = (phone) => String(phone || '').replace(/\D/g, '');
const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';

export const OBJECTIONS = {
  precio: /\b(?:caro|cara|precio|presupuesto|plata|dinero|no\s+me\s+alcanza|costoso|cu[aá]nto\s+(?:cuesta|sale|es))\b/i,
  miedo: /\b(?:miedo|nervios|nerviosa|nervioso|me\s+da\s+cosa|asusta|ansiedad|p[aá]nico|duele\s+mucho\s+el\s+tratamiento)\b/i,
  tiempo: /\b(?:no\s+tengo\s+tiempo|poco\s+tiempo|ocupad[oa]|trabajo\s+todo|no\s+puedo\s+ir|salgo\s+tarde)\b/i,
};

// Objeción más reciente que mencionó el paciente (sus mensajes, del más nuevo al más viejo).
export function detectObjection(texts) {
  for (const text of [...texts].reverse()) {
    for (const [kind, pattern] of Object.entries(OBJECTIONS)) if (pattern.test(String(text || ''))) return kind;
  }
  return null;
}

export function stageFor(hoursSince, settings) {
  if (hoursSince >= settings.firstHours && hoursSince < settings.secondHours) return 'seq1';
  if (hoursSince >= settings.secondHours && hoursSince < WINDOW_HOURS) return 'seq2';
  const day3 = settings.thirdDays * 24;
  if (hoursSince >= day3 && hoursSince < day3 + 24) return 'seq3';
  return null;
}

// Primera regla de parada que se cumple (o null si se puede enviar). Pura: los tests la recorren una por una.
export function stopReason(c) {
  if (!c.settings.enabled) return 'desactivado';
  if (c.internal) return 'interno';
  if (c.testPhone) return 'prueba';
  if (c.prefs?.followups_opt_out_at || c.tags?.includes('no_contactar')) return 'opt_out';
  if (c.booked) return 'agendó';
  if (c.paused) return 'pasado_a_humano';
  if (c.urgent) return 'urgencia';
  if (c.minor || c.prefs?.minor_at) return 'menor_de_edad';
  if (c.sentCount >= c.settings.max) return 'tope';
  if (c.stageAlreadySent) return 'etapa_ya_enviada';
  if (c.stage === 'seq3' && !(c.prefs?.marketing_opt_in_at && !c.prefs?.marketing_opt_out_at)) return 'sin_opt_in';
  return null;
}

// ---------- Textos (solo datos de la configuración o de la agenda) ----------

function topicOf(treatment) {
  return treatment ? treatment.name : null;
}

function financingFact(clinic, treatment) {
  return treatment?.financing || clinic.financingText || (clinic.paymentMethods?.length ? `aceptamos ${clinic.paymentMethods.join(', ')}` : null);
}

function packFact(clinic, today) {
  const pack = evaluationPackView(clinic, today);
  if (!pack) return null;
  if (pack.promoText) return `la evaluación está en ${pack.promoPriceText || pack.priceText} (${pack.promoText}${pack.untilText ? `, hasta el ${pack.untilText}` : ''})`;
  return pack.priceText ? `la evaluación cuesta ${pack.priceText}` : null;
}

// Un dato real para el mensaje de las 22 h sin objeción clara: cupos reales, fin real de una promoción o la
// calificación de Google configurada. null si no hay ninguno (entonces solo empatía y una pregunta).
export function realPersuasionFact({ clinic, today, freeSlotsThisWeek }) {
  if (Number.isInteger(freeSlotsThisWeek) && freeSlotsThisWeek > 0 && freeSlotsThisWeek <= REAL_SCARCITY_MAX) {
    return `Esta semana quedan ${freeSlotsThisWeek} horarios libres para evaluación.`;
  }
  const ending = activePromotions(today, clinic).find((p) => p.validUntil);
  if (ending) return `La promoción "${ending.title}" es válida hasta el ${formatDateEs(ending.validUntil)}.`;
  const rating = clinic.googleRating;
  if (rating?.value && rating?.count) return `Tenemos ${String(rating.value).replace('.', ',')} ⭐ en Google con ${rating.count} reseñas.`;
  return null;
}

// { text, slots } para seq1/seq2; { template, params } para seq3.
export function buildFollowUp(stage, ctx) {
  const { clinic, name, treatment, objection, slots = [], today, freeSlotsThisWeek, lastBotOfferedSlots } = ctx;
  const hello = `Hola${name ? ` ${name}` : ''}`;
  const topic = topicOf(treatment);
  if (stage === 'seq1') {
    const retake = lastBotOfferedSlots
      ? '¿Te acomoda alguno de estos horarios para tu evaluación?'
      : `¿Te ayudo a separar tu evaluación${topic ? ` de ${topic}` : ''}?`;
    const shown = slots.slice(0, 2);
    return { text: `${hello} 😊 Soy ${clinic.botName} de ${clinic.name}. ${retake}${formatSlotList(shown)}`, slots: shown };
  }
  if (stage === 'seq2') {
    if (objection === 'precio') {
      const facts = [financingFact(clinic, treatment), packFact(clinic, today)].filter(Boolean);
      return {
        text: `${hello} 😊 Sobre el costo${topic ? ` de ${topic}` : ''}: ${facts.length ? `${facts.join('; ')}.` : 'el precio exacto lo define el doctor en la evaluación.'} ¿Quieres que te separe un horario para que el doctor te dé el precio exacto?`,
        slots: [],
      };
    }
    if (objection === 'miedo') {
      const bring = clinic.evaluationPack?.bring ? ` ${clinic.evaluationPack.bring}` : '';
      return {
        text: `${hello} 💙 Te entiendo, es normal sentir nervios. La evaluación no te compromete a nada: el doctor te explica tus opciones y tú decides con calma.${bring} ¿Te separo un horario?`,
        slots: [],
      };
    }
    if (objection === 'tiempo' && slots[0]) {
      return { text: `${hello} 😊 Sé que el tiempo es corto: el horario libre más cercano es el ${slots[0].label}. ¿Te lo separo?${formatSlotList([slots[0]])}`, slots: [slots[0]] };
    }
    const fact = realPersuasionFact({ clinic, today, freeSlotsThisWeek });
    return { text: `${hello} 😊 ¿Te quedó alguna duda sobre ${topic || 'la evaluación'}?${fact ? ` ${fact}` : ''} Cuéntame y te ayudo.`, slots: [] };
  }
  const template = TEMPLATES.followUpDay3;
  return { template, params: template.params({ clinicName: clinic.name, topic: topic || 'tu evaluación' }) };
}

// ¿El mensaje actual responde a un seguimiento? (el último seguimiento es de los últimos 5 días y llegó después
// del mensaje anterior del paciente). Así un "no" a la plantilla del día 3 se confirma como baja.
export async function answersFollowUp(phone, { getClient = getDefaultClient, clinic = activeClinic, now = clockNow } = {}) {
  try {
    const client = await getClient();
    if (!client) return false;
    const id = digits(phone);
    const { data: last } = await client.from('follow_ups').select('sent_at').eq('clinic_id', clinic.id).eq('phone', id)
      .order('sent_at', { ascending: false }).limit(1).maybeSingle();
    if (!last?.sent_at || now() - new Date(last.sent_at) > 5 * 24 * HOUR_MS) return false;
    // El mensaje actual ya quedó en la bandeja al llegar: el anterior es el segundo más reciente.
    const { data: inbound } = await client.from('messages').select('created_at').eq('phone', id).eq('role', 'user')
      .order('created_at', { ascending: false }).limit(2);
    const sorted = [...(inbound || [])].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    const previous = sorted[1]?.created_at;
    return !previous || new Date(previous) < new Date(last.sent_at);
  } catch (error) {
    console.warn('[Seguimiento] No se pudo revisar el último seguimiento:', describeError(error));
    return false;
  }
}

// ---------- Ejecución ----------

export function createFollowUps({
  getClient = getDefaultClient,
  whatsapp = whatsappService,
  appointments = appointmentService,
  handoff = handoffService,
  preferences = contactPreferences,
  clinic = activeClinic,
  now = clockNow,
} = {}) {
  async function db() {
    const client = await getClient();
    if (!client) throw new Error('Supabase no configurado (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY)');
    return client;
  }
  const rows = async (builder) => { const { data, error } = await builder; if (error) throw error; return data || []; };
  const internalPhones = () => new Set([getReceptionPhone(), getOwnerPhone()].filter(Boolean));

  async function loadContext(client, phones, since30) {
    const [messages, appts, followUps, handoffs, prefs, leads] = await Promise.all([
      fetchAllRows(() => client.from('messages').select('phone, role, content, created_at')
        .in('phone', phones).gte('created_at', since30).order('created_at', { ascending: true })),
      rows(client.from('appointments').select('sender_phone, status, created_at').eq('clinic_id', clinic.id).in('sender_phone', phones).gte('created_at', since30)),
      rows(client.from('follow_ups').select('*').eq('clinic_id', clinic.id).in('phone', phones)),
      rows(client.from('handoffs').select('phone, reason, created_at').eq('clinic_id', clinic.id).in('phone', phones).gte('created_at', since30)).catch(() => []),
      preferences.getMany(phones).catch((error) => { console.warn('[Seguimiento] Sin preferencias de contacto:', describeError(error)); return new Map(); }),
      rows(client.from('leads').select('telefono, nombre, tags, ad_referral').in('telefono', [...new Set([...phones, ...phones.map((p) => p.slice(-9))])])).catch(() => []),
    ]);
    const by = (list, key) => list.reduce((map, row) => {
      const k = digits(row[key]);
      map.set(k, [...(map.get(k) || []), row]);
      return map;
    }, new Map());
    return {
      messages: by(messages, 'phone'),
      appts: by(appts.filter((a) => a.status !== 'cancelada'), 'sender_phone'),
      followUps: by(followUps, 'phone'),
      urgent: new Set(handoffs.filter((h) => h.reason === 'urgencia').map((h) => digits(h.phone))),
      prefs,
      leads: new Map(leads.map((l) => [digits(l.telefono).slice(-9), l])),
    };
  }

  // Se registra antes de enviar: si otra ejecución ya lo hizo, el índice único lo rechaza (nunca se duplica).
  async function claim(client, phone, stage, anchorAt, at) {
    const row = { clinic_id: clinic.id, phone, stage, sent_at: at, anchor_at: anchorAt };
    let { error } = await client.from('follow_ups').insert([row]);
    if (error && isMissingColumn(error, 'anchor_at')) {
      const { anchor_at: _a, ...legacy } = row;
      ({ error } = await client.from('follow_ups').insert([legacy]));
    }
    if (!error) return true;
    if (error.code !== '23505') console.error('[Seguimiento] No se pudo registrar:', describeError(error));
    return false;
  }

  async function freeSlotsThisWeek(today) {
    try {
      return (await appointments.findNextSlots(null, { count: REAL_SCARCITY_MAX + 1, fromDate: today, maxDays: 7, minGapMinutes: clinic.slotMinutes })).length;
    } catch {
      return null;
    }
  }

  async function send(phone, message) {
    if (message.template) return whatsapp.sendTemplateMessage(phone, message.template.name, message.params, { language: message.template.language });
    return sendWithSlotPicker(phone, message.text, message.slots, { whatsapp });
  }

  async function runFollowUps() {
    const settings = followUpSettings(clinic);
    const current = now();
    const result = { candidates: 0, sent: 0, skipped: 0, failed: 0, stages: {}, stopped: {} };
    if (!settings.enabled) return { ...result, disabled: true };
    const client = await db();
    const internal = internalPhones();
    const lookbackHours = settings.thirdDays * 24 + 24;
    const inbound = await fetchAllRows(() => client.from('messages').select('phone, created_at')
      .eq('role', 'user').gte('created_at', new Date(current - lookbackHours * HOUR_MS).toISOString()).order('created_at', { ascending: true }));
    const lastByPhone = new Map();
    for (const m of inbound) {
      const phone = digits(m.phone);
      const at = new Date(m.created_at);
      if (phone && (!lastByPhone.has(phone) || lastByPhone.get(phone) < at)) lastByPhone.set(phone, at);
    }
    const candidates = [...lastByPhone].map(([phone, at]) => ({ phone, anchor: at, stage: stageFor((current - at) / HOUR_MS, settings) }))
      .filter((c) => c.stage);
    result.candidates = candidates.length;
    if (!candidates.length) return result;

    const since30 = new Date(current - LOOKBACK_DAYS * 24 * HOUR_MS).toISOString();
    const ctx = await loadContext(client, candidates.map((c) => c.phone), since30);
    const today = localParts(clinic.timezone, current).date;
    const weekFree = await freeSlotsThisWeek(today);

    for (const { phone, anchor, stage } of candidates) {
      const messages = ctx.messages.get(phone) || [];
      const patientTexts = messages.filter((m) => m.role === 'user').map((m) => m.content || '');
      const sentRows = (ctx.followUps.get(phone) || []).filter((f) => [...SEQUENCE_STAGES, ...LEGACY_STAGES].includes(f.stage || 'final'));
      const recentSent = sentRows.filter((f) => !f.sent_at || f.sent_at >= since30);
      const lead = ctx.leads.get(phone.slice(-9));
      const reason = stopReason({
        settings, stage, internal: internal.has(phone), testPhone: isTestPhone(phone),
        prefs: ctx.prefs.get(phone), tags: Array.isArray(lead?.tags) ? lead.tags : [],
        booked: (ctx.appts.get(phone) || []).length > 0, paused: await handoff.isPaused(phone), urgent: ctx.urgent.has(phone),
        minor: patientTexts.some(detectMinor), sentCount: recentSent.length,
        stageAlreadySent: sentRows.some((f) => f.stage === stage && (!f.anchor_at || new Date(f.anchor_at).getTime() === anchor.getTime())),
      });
      if (reason) {
        result.skipped += 1;
        result.stopped[reason] = (result.stopped[reason] || 0) + 1;
        continue;
      }
      const treatment = [...patientTexts].reverse().map((t) => findTreatment(t)).find(Boolean) || adTreatment(lead?.ad_referral) || null;
      const lastBot = [...messages].reverse().find((m) => m.role !== 'user');
      let slots = [];
      if (stage !== 'seq3') {
        try { slots = await appointments.findNextSlots(treatment?.key || null, { count: 2 }); } catch { slots = []; }
      }
      const message = buildFollowUp(stage, {
        clinic, today, slots, treatment, freeSlotsThisWeek: weekFree,
        name: firstName(lead?.nombre), objection: detectObjection(patientTexts),
        lastBotOfferedSlots: /Horarios disponibles/.test(lastBot?.content || ''),
      });
      if (!(await claim(client, phone, stage, anchor.toISOString(), current.toISOString()))) {
        result.skipped += 1;
        result.stopped.etapa_ya_enviada = (result.stopped.etapa_ya_enviada || 0) + 1;
        continue;
      }
      try {
        await send(phone, message);
        result.sent += 1;
        result.stages[stage] = (result.stages[stage] || 0) + 1;
      } catch (error) {
        result.failed += 1;
        console.error(`[Seguimiento] ${stage} falló:`, describeError(error));
        // Bloqueado o ya no acepta marketing de la clínica: no se le vuelve a escribir.
        if (UNDELIVERABLE_CODES.has(Number(error?.meta?.code))) await preferences.optOut(phone, 'bloqueo');
      }
    }
    return result;
  }

  return { runFollowUps };
}

const followUps = createFollowUps();
export default followUps;
