import leadService from '../services/leadService.js';
import whatsappService from '../services/whatsappService.js';
import inboxService from '../services/inboxService.js';
import { getSupabase } from '../services/supabaseClient.js';
import { createExpiringMap } from '../services/expiringMap.js';
import { describeError } from '../services/safeLog.js';
import { sendWithSlotPicker } from '../services/slotButtons.js';

// Lo que el webhook guarda de cada conversación: bandeja (conversations + messages), historial
// (chat_sessions), anuncio de origen y notas para el bot. Ninguna función lanza: si Supabase falla,
// la conversación con el paciente sigue.

const DAY_MS = 24 * 60 * 60 * 1000;
const HISTORY_CACHE_TTL_MS = 30 * 60 * 1000;

// Cachés por paciente con vencimiento: sin tope crecerían con cada número nuevo mientras el proceso viva.
export const chatSessionHistoryCache = createExpiringMap({ ttlMs: HISTORY_CACHE_TTL_MS });

export const digitsOf = (phone) => String(phone || '').replace(/\D/g, '');

// Origen del anuncio de Meta (click-to-WhatsApp). Solo llega en el primer mensaje: se guarda en memoria
// y en leads.ad_referral para asociarlo después a la cita.
const REFERRAL_FIELDS = ['source_type', 'source_id', 'source_url', 'headline', 'body', 'media_type', 'ctwa_clid'];
export const adReferrals = createExpiringMap({ ttlMs: DAY_MS });

export function sanitizeReferral(referral) {
  if (!referral || typeof referral !== 'object') return null;
  const clean = {};
  for (const field of REFERRAL_FIELDS) {
    if (typeof referral[field] === 'string' && referral[field].trim()) clean[field] = referral[field].trim().slice(0, 300);
  }
  if (!Object.keys(clean).length) return null;
  clean.received_at = new Date().toISOString();
  return clean;
}

export async function getAdReferral(phone) {
  if (adReferrals.has(phone)) return adReferrals.get(phone);
  try {
    return (await leadService.getByPhone(phone))?.ad_referral || null;
  } catch (error) {
    return null;
  }
}

// Notas "para el bot" que recepción escribe en la ficha (se sanean al armar el prompt).
export async function getBotNotes(phone) {
  try {
    return (await leadService.getByPhone(phone))?.bot_notes || null;
  } catch (error) {
    console.warn('[Leads] No se pudieron leer las notas para el bot:', describeError(error));
    return null;
  }
}

// Guarda el mensaje en la bandeja (conversations + messages) y lo publica en vivo al panel.
export async function recordInbox(entry) {
  try {
    return await inboxService.recordMessage(entry);
  } catch (error) {
    console.error('[Bandeja] No se pudo guardar el mensaje:', describeError(error));
    return null;
  }
}

export async function persistToChatSessions(sessionIdentifier, entry) {
  try {
    const client = await getSupabase();
    if (!client) return null;

    const sessionId = digitsOf(sessionIdentifier) || String(sessionIdentifier || '');
    const cached = chatSessionHistoryCache.get(sessionId);
    let history = Array.isArray(cached) ? [...cached] : [];

    if (!cached) {
      const { data: existing, error: exErr } = await client.from('chat_sessions').select('id, history').eq('id', sessionId).maybeSingle();
      if (exErr) {
        console.error('[Supabase] Error al persistir conversación:', describeError(exErr));
        return null;
      }
      if (existing && existing.history) {
        history = Array.isArray(existing.history) ? existing.history : JSON.parse(existing.history || '[]');
      }
      chatSessionHistoryCache.set(sessionId, history);
    }

    history.push(entry);
    chatSessionHistoryCache.set(sessionId, history);

    const upsertPayload = { id: sessionId, history, updated_at: new Date().toISOString() };
    const { error: upErr } = await client.from('chat_sessions').upsert([upsertPayload], { onConflict: 'id' });
    if (upErr) {
      console.error('[Supabase] Error al persistir conversación:', describeError(upErr));
      return null;
    }
    return true;
  } catch (e) {
    console.error('[Supabase] Error al persistir conversación:', describeError(e));
    return null;
  }
}

// Registra una respuesta ya enviada: tabla conversations/messages y chat_sessions.
export async function recordBotReply(from, messageText, text, sendResult) {
  const timestamp = new Date().toISOString();
  const wamid = sendResult?.messages?.[0]?.id || null;
  if (text) void recordInbox({ phone: from, sender: 'bot', text, wamid });
  try {
    await persistToChatSessions(from, { from: 'patient', text: messageText, phone: from, timestamp });
    await persistToChatSessions(from, { from: 'bot', text, phone: from, timestamp });
  } catch (error) {
    console.error('[Supabase] Error al persistir conversación:', describeError(error));
  }
}

// Envía un texto al paciente (con los horarios como botones si trae `slots`) y lo registra en la bandeja.
// Nunca lanza: devuelve true si se envió.
export async function sendReply(from, messageText, reply, failureLog = 'webhookController: failed sending message to user', { slots = null } = {}) {
  try {
    const sendResult = await sendWithSlotPicker(from, reply, slots, { whatsapp: whatsappService });
    await recordBotReply(from, messageText, reply, sendResult);
    return true;
  } catch (error) {
    console.error(failureLog, describeError(error));
    return false;
  }
}

// Filtros del derecho de supresión (Ley 29733): todo lo que el bot guarda de un paciente, por teléfono.
// Las citas se conservan (la clínica las necesita para atenderlo; el paciente puede cancelarlas).
export function dataDeletionFilters(phone) {
  const rawDigits = digitsOf(phone);
  const shortPhone = rawDigits.length >= 9 ? rawDigits.slice(-9) : rawDigits;
  const ids = [...new Set([rawDigits, shortPhone].filter(Boolean))];
  const any = (...columns) => columns.flatMap((column) => ids.map((id) => `${column}.eq.${id}`)).join(',');
  return {
    leads: any('telefono'),
    chat_sessions: any('id'),
    conversations: any('conversation_id', 'phone'),
    messages: any('phone', 'from_phone'),
    follow_ups: any('phone'),
    handoffs: any('phone'),
    whatsapp_media_sends: any('recipient'),
  };
}

// Borra en Supabase todo lo del paciente (Ley 29733). Devuelve las tablas que fallaron.
export async function deletePatientRows(phone) {
  const client = await getSupabase();
  if (!client) return [];
  const results = await Promise.allSettled(Object.entries(dataDeletionFilters(phone))
    .map(async ([table, filter]) => {
      const { error } = await client.from(table).delete().or(filter);
      if (error) throw Object.assign(error, { table });
    }));
  const failed = results.filter((r) => r.status === 'rejected');
  for (const result of failed) console.warn(`[Privacidad] No se pudo borrar en ${result.reason?.table}:`, describeError(result.reason));
  return failed.map((r) => r.reason?.table);
}
