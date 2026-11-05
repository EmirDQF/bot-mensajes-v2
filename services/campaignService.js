import { getSupabase as getDefaultClient } from './supabaseClient.js';
import activeClinic, {
  activePromotions, findTreatments, getOwnerPhone, getReceptionPhone, isWithinMarketingHours,
} from '../config/clinic.config.js';
import TEMPLATES from '../config/whatsappTemplates.js';
import whatsappService from './whatsappService.js';
import contactPreferences from './contactPreferences.js';
import inboxService from './inboxService.js';
import { formatDateEs, localParts, addDays } from './appointmentService.js';
import { now as clockNow } from './clock.js';
import { isTestPhone } from './testContext.js';
import { fetchAllRows } from './supabasePaging.js';
import { describeError } from './safeLog.js';

// Promociones a pacientes anteriores (pestaña Campañas, solo el dueño).
// Reglas: solo con opt-in de marketing vigente; nunca a menores ni a quien pidió no recibir mensajes; máximo una
// promoción cada 14 días por paciente; plantilla de marketing aprobada; el dueño ve destinatarios, costo estimado y
// el mensaje, y confirma por escrito. El envío va por lotes (POST /jobs/campaigns) y se detiene solo si Meta
// devuelve errores de calidad o de límite. El reporte usa solo números medidos.

const DAY_MS = 24 * 60 * 60 * 1000;
export const PROMO_INTERVAL_DAYS = 14;
export const BATCH_SIZE = Math.max(1, Number(process.env.CAMPAIGN_BATCH_SIZE || 40));
export const CONFIRM_WORD = 'ENVIAR';
// Calidad, límites de envío, cuenta restringida, token vencido o sin permiso y plantilla con problemas (no existe,
// parámetros, pausada o desactivada): fallaría con todos, así que se pausa la campaña entera.
export const STOP_CODES = new Set([
  4, 80007, 130429, 131048, 131056, 368, 131031,
  190, 10, 200,
  132000, 132001, 132005, 132007, 132012, 132015, 132016,
]);
// Fallas seguidas sin código conocido (Meta caído, red): también se pausa en vez de seguir intentando.
export const MAX_CONSECUTIVE_FAILURES = 3;
// Meta ya no le entrega promociones a ese paciente (o lo bloqueó): opt-out y se sigue con los demás.
const OPT_OUT_CODES = new Set([131026, 131050]);
// Meta limitó el marketing a ese usuario por hoy: se omite.
const SKIP_CODES = new Set([131049]);

const digits = (phone) => String(phone || '').replace(/\D/g, '');
const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';
const httpError = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });

export const SEGMENT_TYPES = {
  pregunto_no_agendo: 'Preguntó por un tratamiento y no agendó',
  asistio_hace: 'Asistió hace más de N meses y no volvió',
  cancelo: 'Canceló su cita',
};

export function validateSegment(segment, clinic = activeClinic) {
  const errors = [];
  if (!segment || !SEGMENT_TYPES[segment.type]) return ['Elige un segmento válido'];
  if (segment.type === 'pregunto_no_agendo') {
    if (!clinic.treatments.some((t) => t.key === segment.treatmentKey)) errors.push('Elige el tratamiento por el que preguntaron');
    if (!(Number.isInteger(segment.days) && segment.days >= 1 && segment.days <= 180)) errors.push('Los días deben ser de 1 a 180');
  }
  if (segment.type === 'asistio_hace' && !(Number.isInteger(segment.months) && segment.months >= 1 && segment.months <= 36)) errors.push('Los meses deben ser de 1 a 36');
  if (segment.type === 'cancelo' && !(Number.isInteger(segment.days) && segment.days >= 1 && segment.days <= 365)) errors.push('Los días deben ser de 1 a 365');
  return errors;
}

// Texto de la promoción para la plantilla (sin saltos de línea; solo datos de la configuración).
export function promotionText(promotion, { withDates = true } = {}) {
  const base = `${promotion.title}${promotion.description ? `: ${promotion.description}` : ''}`.replace(/\s+/g, ' ').trim();
  const until = withDates && promotion.validUntil ? ` Válida hasta el ${formatDateEs(promotion.validUntil)}.` : '';
  return `${/[.!?]$/.test(base) ? base : `${base}.`}${until}`;
}

export function renderPromotionMessage({ patient, clinicName, promotion }) {
  const params = TEMPLATES.promotion.params({ patient, clinicName, promotion });
  return TEMPLATES.promotion.body.replace(/\{\{(\d)\}\}/g, (_, n) => params[Number(n) - 1]);
}

export function estimateCost(count, price) {
  if (!price?.amount && price?.amount !== 0) return { count, cost: null, currency: null, price: null };
  return { count, cost: Math.round(count * price.amount * 100) / 100, currency: price.currency || 'USD', price: price.amount };
}

// Primera regla que excluye a un paciente (o null si puede recibir la promoción).
export function exclusionReason({ phone, prefs, internal, lastPromoAt, now }) {
  if (internal) return 'interno';
  if (isTestPhone(phone)) return 'prueba';
  if (prefs?.minor_at) return 'menor_de_edad';
  if (prefs?.followups_opt_out_at || prefs?.marketing_opt_out_at) return 'opt_out';
  if (!prefs?.marketing_opt_in_at) return 'sin_opt_in';
  if (lastPromoAt && now - new Date(lastPromoAt) < PROMO_INTERVAL_DAYS * DAY_MS) return 'promocion_reciente';
  return null;
}

export function createCampaigns({
  getClient = getDefaultClient, whatsapp = whatsappService, preferences = contactPreferences, inbox = inboxService,
  clinic = activeClinic, now = clockNow,
} = {}) {
  async function db() {
    const client = await getClient();
    if (!client) throw httpError(503, 'Supabase no está configurado.');
    return client;
  }
  const rows = async (builder) => {
    const { data, error } = await builder;
    if (error) throw (/campaign/.test(String(error.message || '')) ? httpError(503, 'Falta la tabla de campañas: ejecuta migrations/20261109_campaigns.sql') : error);
    return data || [];
  };
  const today = () => localParts(clinic.timezone, now()).date;
  // Todas las filas (PostgREST corta en 1000): audiencia y reporte exactos aunque la clínica tenga mucho historial.
  const all = (makeQuery) => fetchAllRows(makeQuery).catch((error) => {
    throw (/campaign/.test(String(error?.message || '')) ? httpError(503, 'Falta la tabla de campañas: ejecuta migrations/20261109_campaigns.sql') : error);
  });

  // Teléfonos del segmento (antes de aplicar las reglas de permiso).
  async function segmentPhones(client, segment) {
    const current = now();
    if (segment.type === 'pregunto_no_agendo') {
      const since = new Date(current - segment.days * DAY_MS).toISOString();
      const inbound = await fetchAllRows(() => client.from('messages').select('phone, content, created_at')
        .eq('role', 'user').gte('created_at', since).order('created_at', { ascending: true }));
      const asked = new Set(inbound.filter((m) => findTreatments(m.content || '').some((t) => t.key === segment.treatmentKey)).map((m) => digits(m.phone)));
      const booked = new Set((await all(() => client.from('appointments').select('sender_phone').eq('clinic_id', clinic.id).gte('created_at', since).order('created_at')))
        .map((a) => digits(a.sender_phone)));
      return [...asked].filter((p) => p && !booked.has(p));
    }
    const appts = await all(() => client.from('appointments').select('sender_phone, status, appointment_date, created_at').eq('clinic_id', clinic.id).order('created_at'));
    if (segment.type === 'asistio_hace') {
      const cutoff = addDays(today(), -segment.months * 30);
      const attended = new Set(appts.filter((a) => a.status === 'asistio' && a.appointment_date <= cutoff).map((a) => digits(a.sender_phone)));
      const returned = new Set(appts.filter((a) => a.status !== 'cancelada' && a.appointment_date > cutoff).map((a) => digits(a.sender_phone)));
      return [...attended].filter((p) => !returned.has(p));
    }
    const since = new Date(current - segment.days * DAY_MS).toISOString();
    const cancelled = new Set(appts.filter((a) => a.status === 'cancelada' && a.created_at >= since).map((a) => digits(a.sender_phone)));
    const active = new Set(appts.filter((a) => ['pendiente', 'confirmada', 'reprogramada'].includes(a.status) && a.appointment_date >= today())
      .map((a) => digits(a.sender_phone)));
    return [...cancelled].filter((p) => !active.has(p));
  }

  async function lastPromotions(client, phones) {
    if (!phones.length) return new Map();
    const since = new Date(now() - PROMO_INTERVAL_DAYS * DAY_MS).toISOString();
    const sent = await all(() => client.from('campaign_recipients').select('phone, sent_at, status')
      .eq('clinic_id', clinic.id).in('phone', phones).gte('sent_at', since).order('sent_at'));
    const map = new Map();
    for (const r of sent.filter((s) => s.status === 'enviado')) {
      if (!map.has(digits(r.phone)) || map.get(digits(r.phone)) < r.sent_at) map.set(digits(r.phone), r.sent_at);
    }
    return map;
  }

  // { eligible: [phone], excluded: { motivo: n } }
  async function audience(segment) {
    const errors = validateSegment(segment, clinic);
    if (errors.length) throw httpError(400, 'Revisa el segmento.', { errors });
    const client = await db();
    const phones = await segmentPhones(client, segment);
    const [prefs, recent] = await Promise.all([preferences.getMany(phones), lastPromotions(client, phones)]);
    const internal = new Set([getReceptionPhone(), getOwnerPhone()].filter(Boolean));
    const excluded = {};
    const eligible = [];
    for (const phone of phones) {
      const reason = exclusionReason({ phone, prefs: prefs.get(phone), internal: internal.has(phone), lastPromoAt: recent.get(phone), now: now() });
      if (reason) excluded[reason] = (excluded[reason] || 0) + 1;
      else eligible.push(phone);
    }
    return { eligible, excluded, segmentSize: phones.length };
  }

  function promotionAt(index, date) {
    const promotion = (clinic.promotions || [])[index];
    if (!promotion) throw httpError(400, 'Elige una promoción de Mi clínica → Promociones.');
    if (!activePromotions(date, clinic).includes(promotion)) throw httpError(400, 'Esa promoción no está vigente en la fecha de envío (revisa su inicio y su fin).');
    return promotion;
  }

  async function preview({ segment, promotionIndex, scheduledDate = today() }) {
    const promotion = promotionAt(Number(promotionIndex), scheduledDate);
    const { eligible, excluded, segmentSize } = await audience(segment);
    return {
      segmentSize, recipients: eligible.length, excluded,
      estimate: estimateCost(eligible.length, clinic.marketingPrice),
      template: TEMPLATES.promotion.name,
      message: renderPromotionMessage({ patient: 'Ana', clinicName: clinic.name, promotion: promotionText(promotion) }),
    };
  }

  async function create({ name, segment, promotionIndex, scheduledAt, confirmation, by }) {
    if (String(confirmation || '').trim().toUpperCase() !== CONFIRM_WORD) throw httpError(400, `Para enviar escribe ${CONFIRM_WORD} en la confirmación.`);
    if (!String(name || '').trim()) throw httpError(400, 'Ponle un nombre a la campaña.');
    const when = new Date(scheduledAt || now());
    if (Number.isNaN(when.getTime())) throw httpError(400, 'Fecha de envío inválida.');
    if (!clinic.marketingPrice?.amount && clinic.marketingPrice?.amount !== 0) throw httpError(400, 'Configura la tarifa de Meta por mensaje de marketing para ver el costo antes de enviar.');
    const date = localParts(clinic.timezone, when).date;
    const promotion = promotionAt(Number(promotionIndex), date);
    const { eligible } = await audience(segment);
    if (!eligible.length) throw httpError(400, 'No hay destinatarios con permiso de promociones en ese segmento.');
    const estimate = estimateCost(eligible.length, clinic.marketingPrice);
    const client = await db();
    const [row] = await rows(client.from('campaigns').insert([{
      clinic_id: clinic.id, name: String(name).trim().slice(0, 80), promotion_text: promotionText(promotion), segment,
      scheduled_at: when.toISOString(), status: 'programada', estimated_recipients: eligible.length,
      estimated_cost: estimate.cost, price_per_message: estimate.price, currency: estimate.currency,
      confirmed_by: by || 'dueño', confirmed_at: new Date(now()).toISOString(),
    }]).select());
    return row;
  }

  async function list() {
    return rows((await db()).from('campaigns').select('*').eq('clinic_id', clinic.id).order('created_at', { ascending: false }));
  }

  async function cancel(id) {
    const client = await db();
    const [row] = await rows(client.from('campaigns').update({ status: 'cancelada', status_reason: 'Cancelada por el dueño' })
      .eq('id', id).eq('clinic_id', clinic.id).in('status', ['programada', 'enviando', 'pausada']).select());
    if (!row) throw httpError(404, 'La campaña ya terminó o no existe.');
    return row;
  }

  async function setStatus(client, id, changes) {
    await rows(client.from('campaigns').update(changes).eq('id', id).eq('clinic_id', clinic.id).select());
  }

  async function sendOne(client, campaign, phone, name) {
    const { error } = await client.from('campaign_recipients').insert([{ campaign_id: campaign.id, clinic_id: clinic.id, phone, status: 'enviando', sent_at: new Date(now()).toISOString() }]);
    if (error) {
      if (error.code !== '23505') console.error('[Campañas] No se pudo registrar el envío:', describeError(error));
      return error.code === '23505' ? 'duplicado' : 'fallido';
    }
    const params = TEMPLATES.promotion.params({ patient: firstName(name) || 'de nuevo', clinicName: clinic.name, promotion: campaign.promotion_text });
    const update = (changes) => client.from('campaign_recipients').update(changes).eq('campaign_id', campaign.id).eq('phone', phone);
    try {
      const result = await whatsapp.sendTemplateMessage(phone, TEMPLATES.promotion.name, params, { language: TEMPLATES.promotion.language });
      const wamid = result?.messages?.[0]?.id || null;
      await update({ status: 'enviado', wamid });
      // A la bandeja (así sus estados de entrega y lectura quedan medidos para el reporte).
      void inbox.recordMessage({ phone, sender: 'bot', type: 'template', text: renderPromotionMessage({ patient: params[0], clinicName: clinic.name, promotion: campaign.promotion_text }), wamid })
        .catch((e) => console.warn('[Campañas] No se pudo guardar en la bandeja:', describeError(e)));
      return 'enviado';
    } catch (error) {
      const code = Number(error?.meta?.code);
      await update({ status: SKIP_CODES.has(code) ? 'omitido' : 'fallido', error: String(code || error?.status || 'error') });
      if (OPT_OUT_CODES.has(code)) await preferences.optOut(phone, 'bloqueo');
      if (STOP_CODES.has(code)) return { stop: `Meta devolvió el error ${code} (calidad o límite de envío): se pausó la campaña` };
      return 'fallido';
    }
  }

  // POST /jobs/campaigns: un lote por campaña vencida, solo de 9:00 a 20:00 (hora de la clínica).
  async function runCampaigns() {
    const result = { campaigns: 0, sent: 0, failed: 0, paused: 0, finished: 0 };
    if (!isWithinMarketingHours(clinic, now())) return { ...result, skipped: 'fuera del horario de envío (9:00 a 20:00)' };
    const client = await db();
    const due = (await rows(client.from('campaigns').select('*').eq('clinic_id', clinic.id).in('status', ['programada', 'enviando'])))
      .filter((c) => new Date(c.scheduled_at) <= now());
    for (const campaign of due) {
      result.campaigns += 1;
      if (campaign.status === 'programada') await setStatus(client, campaign.id, { status: 'enviando' });
      const done = new Set((await all(() => client.from('campaign_recipients').select('phone, sent_at').eq('campaign_id', campaign.id).order('sent_at'))).map((r) => digits(r.phone)));
      const { eligible } = await audience(campaign.segment);
      const pending = eligible.filter((p) => !done.has(p));
      const names = new Map((await rows(client.from('leads').select('telefono, nombre').in('telefono', [...pending, ...pending.map((p) => p.slice(-9))])))
        .map((l) => [digits(l.telefono).slice(-9), l.nombre]));
      let stopped = null;
      let consecutive = 0;
      for (const phone of pending.slice(0, BATCH_SIZE)) {
        const outcome = await sendOne(client, campaign, phone, names.get(phone.slice(-9)));
        consecutive = outcome === 'fallido' || outcome?.stop ? consecutive + 1 : 0;
        if (outcome === 'enviado') result.sent += 1;
        else if (outcome?.stop) { stopped = outcome.stop; result.failed += 1; break; } else if (outcome === 'fallido') result.failed += 1;
        if (consecutive >= MAX_CONSECUTIVE_FAILURES) {
          stopped = `${MAX_CONSECUTIVE_FAILURES} envíos seguidos fallaron: se pausó la campaña (revisa la plantilla y el token en npm run meta:check)`;
          break;
        }
      }
      if (stopped) {
        await setStatus(client, campaign.id, { status: 'pausada', status_reason: stopped });
        result.paused += 1;
      } else if (pending.length <= BATCH_SIZE) {
        await setStatus(client, campaign.id, { status: 'terminada', finished_at: new Date(now()).toISOString() });
        result.finished += 1;
      }
    }
    return result;
  }

  // Solo números medidos: enviados, entregados, leídos (estados de Meta), respuestas y citas posteriores.
  async function report(id) {
    const client = await db();
    const [campaign] = await rows(client.from('campaigns').select('*').eq('id', id).eq('clinic_id', clinic.id));
    if (!campaign) throw httpError(404, 'Campaña no encontrada.');
    const recipients = await all(() => client.from('campaign_recipients').select('*').eq('campaign_id', id).order('sent_at'));
    const sent = recipients.filter((r) => r.status === 'enviado');
    const wamids = sent.map((r) => r.wamid).filter(Boolean);
    const statuses = wamids.length ? await rows(client.from('messages').select('whatsapp_message_id, status').in('whatsapp_message_id', wamids)) : [];
    const delivered = statuses.filter((m) => ['delivered', 'read'].includes(m.status)).length;
    const read = statuses.filter((m) => m.status === 'read').length;
    const phones = sent.map((r) => digits(r.phone));
    const firstSent = sent.reduce((min, r) => (!min || r.sent_at < min ? r.sent_at : min), null);
    let replies = 0;
    let appointments = 0;
    if (phones.length && firstSent) {
      const sentAt = new Map(sent.map((r) => [digits(r.phone), r.sent_at]));
      const inbound = await rows(client.from('messages').select('phone, created_at').eq('role', 'user').in('phone', phones).gte('created_at', firstSent));
      replies = new Set(inbound.filter((m) => m.created_at > sentAt.get(digits(m.phone))
        && new Date(m.created_at) - new Date(sentAt.get(digits(m.phone))) < 7 * DAY_MS).map((m) => digits(m.phone))).size;
      const appts = await all(() => client.from('appointments').select('sender_phone, created_at, status').eq('clinic_id', clinic.id).in('sender_phone', phones).gte('created_at', firstSent).order('created_at'));
      appointments = appts.filter((a) => a.status !== 'cancelada' && a.created_at > sentAt.get(digits(a.sender_phone))
        && new Date(a.created_at) - new Date(sentAt.get(digits(a.sender_phone))) < 14 * DAY_MS).length;
    }
    return {
      campaign, sent: sent.length, failed: recipients.filter((r) => r.status === 'fallido').length,
      skipped: recipients.filter((r) => r.status === 'omitido').length, delivered, read, replies, appointments,
    };
  }

  return { audience, preview, create, list, cancel, runCampaigns, report };
}

const campaigns = createCampaigns();
export default campaigns;
