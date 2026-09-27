import config from '../config/env.js';
import geminiService from '../services/geminiService.js';
import leadService from '../services/leadService.js';
import notificationService from '../services/notificationService.js';
import whatsappService, { markMessageAsRead, sendTypingIndicator } from '../services/whatsappService.js';
import forwardToDashboard from '../src/dashboardForwarder.js';
import { getGeminiClient } from '../src/geminiClient.js';
import { createClient } from '@supabase/supabase-js';
import activeClinic, { findTreatment, getReceptionPhone, mediaUrl } from '../config/clinic.config.js';
import appointmentService, {
  OutsideHoursError, SlotTakenError, isWithinWorkingHours, localParts, parseRequestedDay, slotLabel,
} from '../services/appointmentService.js';
import handoffService, { detectHandoff, patientHandoffReply } from '../services/handoffService.js';
import conversationMetrics from '../services/conversationMetrics.js';
import messageDedup from '../services/messageDedup.js';
import { now as clockNow } from '../services/clock.js';

// Origen del anuncio de Meta (click-to-WhatsApp). Solo llega en el primer mensaje: se guarda en memoria
// y en leads.ad_referral para asociarlo después a la cita.
const REFERRAL_FIELDS = ['source_type', 'source_id', 'source_url', 'headline', 'body', 'media_type', 'ctwa_clid'];
const adReferrals = new Map();

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

async function getAdReferral(phone) {
  if (adReferrals.has(phone)) return adReferrals.get(phone);
  try {
    return (await leadService.getByPhone(phone))?.ad_referral || null;
  } catch (error) {
    return null;
  }
}
import { extractPhotoTags, inferPhotoKeyFromMessage } from '../services/mediaTags.js';
import {
  claimMediaSend,
  completeMediaSend,
  hasMediaBeenSent,
  markMediaAsSent,
} from '../services/mediaTrackingService.js';

// Helper: upsert a message into chat_sessions.history
let supabaseClient = null;
const chatSessionHistoryCache = new Map();
const welcomeSentRecipients = new Set();
// Perfil de la clínica activa (config/clinics/<ACTIVE_CLINIC>.js). Una fila de la tabla
// `clinics` de Supabase con el mismo waba_phone_number_id puede sobrescribir estos campos.
export const DEFAULT_CLINIC = {
  name: activeClinic.name,
  city: activeClinic.city,
  address: activeClinic.address,
  schedule: activeClinic.workingHoursText,
};

async function getSupabaseClient() {
  if (supabaseClient) return supabaseClient;
  const rawUrl = config.supabase?.url || process.env.SUPABASE_URL;
  const key = config.supabase?.serviceRoleKey || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE;
  if (!rawUrl || !key) return null;
  supabaseClient = createClient(rawUrl, key);
  return supabaseClient;
}

// Filtros del derecho de supresión (Ley 29733): todo lo que el bot guarda de un paciente, por teléfono.
// Las citas se conservan (la clínica las necesita para atenderlo; el paciente puede cancelarlas).
export function dataDeletionFilters(phone) {
  const rawDigits = String(phone || '').replace(/\D/g, '');
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

async function hardResetUserSession(phone) {
  try {
    const rawDigits = String(phone || '').replace(/\D/g, '');
    const shortPhone = rawDigits.length >= 9 ? rawDigits.slice(-9) : rawDigits;
    const client = await getSupabaseClient();

    const jid = `${rawDigits}@s.whatsapp.net`;
    if (geminiService.resetSession) {
      geminiService.resetSession(jid);
      geminiService.resetSession(`${shortPhone}@s.whatsapp.net`);
    }
    chatSessionHistoryCache.delete(rawDigits);
    chatSessionHistoryCache.delete(shortPhone);
    welcomeSentRecipients.delete(rawDigits);
    welcomeSentRecipients.delete(shortPhone);

    if (client) {
      const results = await Promise.allSettled(Object.entries(dataDeletionFilters(rawDigits))
        .map(async ([table, filter]) => {
          const { error } = await client.from(table).delete().or(filter);
          if (error) throw Object.assign(error, { table });
        }));
      for (const result of results) {
        if (result.status === 'rejected') console.warn(`[Privacidad] No se pudo borrar en ${result.reason?.table}:`, result.reason?.message || result.reason);
      }
    }
    console.log(`[RESET TOTAL] Lead y sesiones eliminadas para: ${shortPhone} (${rawDigits})`);
    return true;
  } catch (err) {
    console.error('Error en hardResetUserSession:', err?.message || err);
    return false;
  }
}

async function persistToSupabaseConversation({
  conversationId,
  contactNumber,
  sender,
  text,
  mediaUrl,
  timestamp,
  whatsappMessageId = null,
}) {
  let supabase;
  try {
    supabase = await getSupabaseClient();
  } catch (error) {
    console.error('[Supabase] Error al persistir conversación:', error);
    return null;
  }
  if (!supabase || !conversationId) return null;

  const normalizedId = String(conversationId).trim();
  const cleanPhone = String(contactNumber || normalizedId).replace(/\D/g, '');
  const ts = timestamp || new Date().toISOString();
  try {
    try {
      const { error } = await supabase.from('conversations').upsert({
        conversation_id: cleanPhone,
        contact_number: cleanPhone,
        phone: cleanPhone,
        last_message: text ? String(text).trim() : (mediaUrl ? '[Imagen]' : 'Mensaje'),
        last_message_at: ts,
        created_at: ts,
        updated_at: ts,
        // status no se envía: 'human' (bot en pausa) lo gestiona handoffService y no debe pisarse.
      }, { onConflict: 'conversation_id' });
      if (error) console.error('[Supabase] Error al persistir conversación:', error);
    } catch (error) {
      console.error('[Supabase] Error al persistir conversación:', error);
    }

    try {
      const { error } = await supabase.from('messages').insert({
        phone: cleanPhone,
        from_phone: cleanPhone,
        role: sender === 'bot' ? 'assistant' : 'user',
        content: text || (mediaUrl ? '[Imagen]' : null),
        whatsapp_message_id: whatsappMessageId,
        created_at: ts
      });
      if (error) console.error('[Supabase] Error al persistir mensaje:', error);
    } catch (error) {
      console.error('[Supabase] Error al persistir mensaje:', error);
    }
  } catch (e) {
    console.error('[Supabase] Error al persistir conversación:', e);
    return null;
  }
}

async function persistToChatSessions(sessionIdentifier, entry) {
  try {
    const client = await getSupabaseClient();
    if (!client) return null;

    const sessionId = String(sessionIdentifier || '').replace(/\D/g, '') || String(sessionIdentifier || '');
    const cached = chatSessionHistoryCache.get(sessionId);
    let history = Array.isArray(cached) ? [...cached] : [];

    if (!cached) {
      let { data: existing, error: exErr } = await client.from('chat_sessions').select('id, history').eq('id', sessionId).maybeSingle();
      if (exErr) {
        console.error('[Supabase] Error al persistir conversación:', exErr);
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
      console.error('[Supabase] Error al persistir conversación:', upErr);
      return null;
    }
    return true;
  } catch (e) {
    console.error('[Supabase] Error al persistir conversación:', e);
    return null;
  }
}

async function notifyMonitorPanel({ conversation_id, contact_name, sender, type, content, media_url, timestamp }) {
  const panelBaseUrl = (process.env.PANEL_BACKEND_URL || '').replace(/\/+$/, '');
  const username = process.env.PANEL_USER || process.env.PANEL_USERNAME;
  const password = process.env.PANEL_PASSWORD || process.env.PANEL_PASS;
  if (!panelBaseUrl || !username || !password) return;

  try {
    const authHeader = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
    const body = {
      conversation_id: String(conversation_id || '').trim(),
      contact_name: contact_name || null,
      sender,
      type: type || 'text',
      content: content || null,
      media_url: media_url || null,
      timestamp: timestamp || new Date().toISOString(),
    };

    const res = await fetch(`${panelBaseUrl}/api/hook`, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res || !res.ok) {
      const text = res && typeof res.text === 'function' ? await res.text() : '';
      console.warn('Panel hook failed:', res && res.status ? res.status : 'unknown', text || '');
    }
  } catch (e) {
    console.warn('notifyMonitorPanel failed (non-blocking):', e && e.message ? e.message : e);
  }
}

async function notifyDashboardReply(phone, text, mediaUrl = null, wamid = null) {
  const dashboardUrl = (process.env.PANEL_BACKEND_URL || '').replace(/\/+$/, '');
  if (!dashboardUrl) return;
  try {
    const response = await fetch(`${dashboardUrl}/api/bot-reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: String(phone).replace(/\D/g, ''),
        text: text || '',
        type: mediaUrl ? 'image' : 'text',
        mediaUrl: mediaUrl || null,
        wamid: wamid || `bot_${Date.now()}`,
      }),
    });

    if (!response.ok) {
      const responseText = typeof response.text === 'function' ? await response.text() : '';
      console.warn('Dashboard bot reply sync failed:', response.status, responseText);
    }
  } catch (err) {
    console.error('Error sincronizando respuesta con el dashboard:', err?.message || err);
  }
}

function notifyDashboardIncoming(payload) {
  const dashboardUrl = (process.env.PANEL_BACKEND_URL || '').replace(/\/+$/, '');
  if (!dashboardUrl) return;
  fetch(`${dashboardUrl}/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch((err) => {
    console.warn('Error sincronizando mensaje entrante con el dashboard:', err?.message || err);
  });
}

function extractPlainText(input) {
  let cleaned = typeof input === 'string' ? input : JSON.stringify(input);
  cleaned = cleaned.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();

  if ((cleaned.startsWith('{') && cleaned.endsWith('}')) || (cleaned.startsWith('[') && cleaned.endsWith(']'))) {
    try {
      const parsed = JSON.parse(cleaned);
      if (parsed) {
        const possibleKeys = ['content', 'respuesta', 'response', 'texto', 'text', 'message'];
        for (const key of possibleKeys) {
          if (parsed[key] !== undefined && parsed[key] !== null) {
            if (typeof parsed[key] === 'string' && parsed[key].trim().length > 0) {
              return parsed[key].trim();
            }
            if (typeof parsed[key] === 'object') {
              const nested = extractPlainText(parsed[key]);
              if (nested && nested.trim().length > 0) {
                return nested.trim();
              }
            }
          }
        }

        if (Array.isArray(parsed)) {
          const arrayText = parsed.map((item) => extractPlainText(item)).filter(Boolean).join(' ');
          if (arrayText) return arrayText;
        }

        if (typeof parsed === 'object') {
          const traversed = Object.values(parsed)
            .map((value) => extractPlainText(value))
            .filter(Boolean)
            .join(' ')
            .trim();
          if (traversed) return traversed;
        }
      }
    } catch (e) {
      const malformedPrefixMatch = cleaned.match(/^\s*\{\s*"(?:content|respuesta|response|texto|text|message)"\s*:\s*"?(.*)$/i);
      if (malformedPrefixMatch && malformedPrefixMatch[1]) {
        return malformedPrefixMatch[1].replace(/\}?\s*$/,'').replace(/^"/, '').trim();
      }
      const match = cleaned.match(/"(?:content|respuesta|response|texto|text|message)"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/i);
      if (match && match[1]) return match[1].trim();
    }
  }

  return cleaned;
}

function stripInstructionTags(text) {
  return String(text || '')
    .replace(/\[\s*(?:ENVIAR[_ ]?(?:FOTO|IMAGEN)|FOTO|IMAGEN)\s*:[^\]]+\]/gi, '')
    .replace(/\[AGENDAR_CITA:\{.*?\}\]/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// Guarda la solicitud de cita de la Fase B en `appointments` y avisa a recepción. Nunca lanza:
// el paciente siempre recibe su respuesta y los fallos quedan en el log con [Appointments].
// Devuelve { status: 'saved', appointment } | { status: 'slot_taken', alternatives } | { status: 'error' }.
async function persistAgendaPayload(payload, context = {}) {
  if (!payload || typeof payload !== 'object') return { status: 'error' };
  try {
    const appointment = await appointmentService.saveAppointment({
      senderPhone: context.phone,
      patientName: payload.nombre || null,
      treatment: payload.tratamiento || payload.motivo || null,
      appointmentDate: payload.fecha,
      appointmentTime: payload.hora,
      source: context.source || 'whatsapp',
      adReferral: context.adReferral || null,
    });
    await appointmentService.notifyReception(appointment);
    return { status: 'saved', appointment };
  } catch (error) {
    if (error instanceof SlotTakenError) {
      const outsideHours = error instanceof OutsideHoursError;
      let alternatives = [];
      try {
        // Fuera de horario (p. ej. "a las 11 p. m.") se ofrecen los más cercanos desde ahora.
        alternatives = await appointmentService.findNextSlots(payload.tratamiento || null, outsideHours ? {} : { fromDate: payload.fecha });
      } catch (slotError) {
        console.error('[Appointments] No se pudieron calcular horarios alternativos:', slotError?.message || slotError);
      }
      return { status: 'slot_taken', reason: outsideHours ? 'outside_hours' : 'taken', alternatives };
    }
    console.error('[Appointments] No se pudo guardar la cita:', error?.message || error);
    return { status: 'error' };
  }
}

const NUMBER_EMOJI = ['1️⃣', '2️⃣', '3️⃣'];
export function formatSlotList(slots) {
  if (!slots?.length) return '';
  const lines = slots.map((slot, i) => `${NUMBER_EMOJI[i] || `${i + 1})`} ${slot.label}`);
  return `\n\n📅 Horarios disponibles:\n${lines.join('\n')}\n\nResponde 1, 2 o 3 👆`;
}

// Si Gemini falla (cuota agotada, caída o clave inválida) el paciente no se queda sin respuesta:
// recibe los horarios ofrecidos o un aviso, y recepción recibe una alerta (máximo una por paciente por hora).
export function aiFallbackReply(offeredSlots) {
  return offeredSlots?.length
    ? `¡Gracias por escribirnos! 😊 Te comparto los horarios más cercanos para tu evaluación:${formatSlotList(offeredSlots)}`
    : '¡Gracias por escribirnos! 🙏 Tuve un inconveniente para responderte en este momento; ya avisé al equipo de la clínica para que te escriba por aquí.';
}
const FALLBACK_ALERT_MS = 60 * 60 * 1000;
const fallbackAlertAt = new Map();

async function alertReceptionNoAI(from, messageText) {
  const to = getReceptionPhone();
  const last = fallbackAlertAt.get(from);
  if (!to || (last && Date.now() - last < FALLBACK_ALERT_MS)) return;
  fallbackAlertAt.set(from, Date.now());
  const text = [
    `⚠️ El asistente no pudo responder con IA (${activeClinic.name})`,
    `📱 +${from} (wa.me/${from})`,
    `💬 "${String(messageText || '').slice(0, 300)}"`,
    '',
    'Escríbele al paciente. Si se repite, revisa GEMINI_API_KEY y la cuota de Gemini (npm run preflight).',
  ].join('\n');
  try {
    await whatsappService.sendTextMessage(to, text);
  } catch (error) {
    console.error('[Gemini] No se pudo avisar a recepción de la falla:', error?.message || error);
  }
}

const BOOKING_INTENT = /\b(citas?|agendar|agendo|agenda|reservar|reserva|separar|turnos?|horarios?|disponibilidad|atenderme|evaluaci[oó]n)\b/i;
const CANCEL_INTENT = /^\s*cancelar(?:\s+mi)?(?:\s+cita)?\s*[.!]*\s*$|\bcancel\w*\b[^.?!]*\bcita\b|\bcita\b[^.?!]*\bcancel\w*\b|\bya no (?:voy a )?(?:ir|asistir|podr[eé] ir)\b/i;
const RESCHEDULE_INTENT = /^\s*reprogramar(?:\s+mi)?(?:\s+cita)?\s*[.!]*\s*$|\b(?:cambiar|reprogramar|mover|postergar|cambio de)\b[^.?!]*\b(?:cita|hora|horario|d[ií]a)\b/i;
export const DATA_DELETION = /^\s*(?:por\s+favor\s+)?(?:borra|borrar|elimina|eliminar)\s+(?:todos\s+)?(?:mis|los)\s+datos(?:\s+personales)?\s*(?:por\s+favor)?\s*[.!]*\s*$/i;
const DATA_DELETION_REPLY = 'Listo ✅ Eliminamos tu conversación y tus datos de contacto de nuestro asistente. '
  + 'Si tienes una cita registrada, la clínica la conserva solo para atenderte; puedes cancelarla escribiendo "cancelar mi cita".';
const REMINDER_CONFIRM = /^\s*(?:1|1️⃣|confirmo|confirmar|confirmado|s[ií],?\s*confirmo)\s*[.!]*\s*$/i;
const REMINDER_RESCHEDULE = /^\s*(?:2|2️⃣|reprogramar)\s*[.!]*\s*$/i;
const RESCHEDULE_TTL_MS = 30 * 60 * 1000;
// Cierra una frase sin duplicar el punto de "p. m.".
const sentence = (text) => (/[.!?]$/.test(text) ? text : `${text}.`);
// Consultas de precio o de un tratamiento: de noche se aprovechan para ofrecer horarios "en caliente".
const PRICE_INTENT = /\b(?:precio|precios|cu[aá]nto|cuesta|costo|cuotas?|inicial|promo(?:ci[oó]n)?|campa[nñ]a|descuento)\b/i;
// Solo un saludo: basta la bienvenida. Cualquier otra cosa en el primer mensaje se responde de inmediato.
const GREETING_ONLY = /^[\s¡!¿?.,]*(?:hola+|holi|ola|buenas|buen[oa]s?\s+(?:noches|tardes|d[ií]as)|buen\s+d[ií]a|hi|hello|info|informaci[oó]n)[\s!?.,😊👋🙂]*$/iu;
const UNSUPPORTED_REPLIES = {
  audio: 'Disculpa 🙏 todavía no puedo escuchar audios. ¿Me lo escribes en un mensaje? Así te ayudo al toque con precios, fotos u horarios.',
  video: 'Gracias por el video 🙏 por ahora no puedo verlo. ¿Me cuentas por escrito qué necesitas?',
  document: 'Gracias 🙏 por aquí no puedo abrir archivos. ¿Me cuentas por escrito qué necesitas? Si es para tu evaluación, tráelo el día de tu cita.',
  sticker: '😊 ¿En qué te ayudo? Puedo contarte precios, enviarte fotos de tratamientos o proponerte horarios para tu evaluación.',
};

// Modo nocturno: la asistente dice con naturalidad que la clínica está cerrada (una vez por noche)
// y deja la solicitud de cita lista para que recepción la confirme al abrir.
export const AFTER_HOURS_NOTICE = activeClinic.afterHoursNotice
  || '🌙 Ahora la clínica está cerrada, pero yo te ayudo ya mismo y te dejo la solicitud de cita lista; recepción te la confirma a primera hora.';
const AFTER_HOURS_RENOTICE_MS = 10 * 60 * 60 * 1000;
const afterHoursNoticeAt = new Map();

// true si toca avisar ahora que la clínica está cerrada (fuera de horario y sin aviso en las últimas 10 h).
export function takeAfterHoursNotice(phone, instant = clockNow()) {
  if (isWithinWorkingHours(activeClinic, instant)) return false;
  const last = afterHoursNoticeAt.get(phone);
  if (last && instant - last < AFTER_HOURS_RENOTICE_MS) return false;
  afterHoursNoticeAt.set(phone, instant);
  return true;
}

export function buildWelcomeCaption({ afterHours = false } = {}) {
  return [activeClinic.welcomeCaption, afterHours ? AFTER_HOURS_NOTICE : null, activeClinic.privacyNotice].filter(Boolean).join('\n\n');
}
const pendingReschedules = new Map();

// "cancelar" / "cambiar mi cita": encuentra la próxima cita, ofrece horarios y actualiza el estado.
// Devuelve el texto a responder, o null para que la conversación siga con Gemini.
export async function handleAppointmentCommands(from, messageText, { appointments = appointmentService, gemini = geminiService } = {}) {
  const pending = pendingReschedules.get(from);
  if (pending && Date.now() - pending.at > RESCHEDULE_TTL_MS) pendingReschedules.delete(from);
  try {
    const active = pendingReschedules.get(from);
    const chosen = active && gemini.pickOfferedSlot(messageText, active.slots);
    if (chosen) {
      pendingReschedules.delete(from);
      try {
        const updated = await appointments.reschedule(active.appointment.id, {
          appointmentDate: chosen.date, appointmentTime: chosen.time, durationMin: active.appointment.duration_min,
        });
        await appointments.notifyReception(updated, { event: 'reprogramada' });
        return `¡Listo! Tu solicitud de cambio quedó registrada para el ${chosen.label} en ${activeClinic.address}. Recepción te la confirmará.`;
      } catch (error) {
        if (!(error instanceof SlotTakenError)) throw error;
        const slots = await appointments.findNextSlots(active.appointment.treatment);
        pendingReschedules.set(from, { appointment: active.appointment, slots, at: Date.now() });
        return `¡Uy! Ese horario se acaba de ocupar 😅.${formatSlotList(slots)}`;
      }
    }

    // Respuesta a un recordatorio: "1" confirma, "2" reprograma (solo si no está eligiendo horarios nuevos).
    const reminderAnswer = gemini.getOfferedSlots(from) ? null
      : REMINDER_CONFIRM.test(messageText) ? 'confirm'
        : REMINDER_RESCHEDULE.test(messageText) ? 'reschedule' : null;
    const wantsCancel = CANCEL_INTENT.test(messageText);
    let wantsReschedule = !wantsCancel && RESCHEDULE_INTENT.test(messageText);
    if (!wantsCancel && !wantsReschedule && !reminderAnswer) return null;
    const appointment = await appointments.findUpcomingByPhone(from);
    if (!appointment) return null;
    const current = slotLabel({ date: appointment.appointment_date, time: appointment.appointment_time });

    if (reminderAnswer && !wantsCancel && !wantsReschedule) {
      if (!appointment.reminder_24h_sent_at && !appointment.reminder_2h_sent_at) return null;
      if (reminderAnswer === 'confirm') {
        if (appointment.status !== 'confirmada') {
          const confirmed = await appointments.confirm(appointment.id);
          await appointments.notifyReception(confirmed, { event: 'confirmada' });
        }
        return `¡Gracias! Tu cita del ${current} quedó confirmada ✅. Te esperamos en ${activeClinic.address}.`;
      }
      wantsReschedule = true;
    }

    if (wantsCancel) {
      await appointments.updateStatus(appointment.id, 'cancelada');
      await appointments.notifyReception(appointment, { event: 'cancelada' });
      return `Listo, cancelamos tu cita del ${sentence(current)} Cuando quieras volver a agendar, escríbeme "quiero una cita" 😊`;
    }

    const slots = await appointments.findNextSlots(appointment.treatment);
    if (!slots.length) {
      await appointments.notifyReception(appointment, { event: 'reprogramada' });
      return `Tu cita actual es el ${sentence(current)} No encuentro horarios libres en los próximos días; recepción te escribirá para coordinar.`;
    }
    pendingReschedules.set(from, { appointment, slots, at: Date.now() });
    return `Claro 😊 Tu cita actual es el ${sentence(current)} Elige el nuevo horario:${formatSlotList(slots)}`;
  } catch (error) {
    console.error('[Appointments] Error al cancelar o reprogramar:', error?.message || error);
    return null;
  }
}

const messageBuffers = new Map();
const userProcessingQueues = new Map();
const intakeQueues = new Map();
const BUFFER_WAIT_MS = 2000;
async function downloadIncomingImage(mediaId) {
  const token = config.whatsapp?.token || process.env.WHATSAPP_TOKEN;
  const version = config.whatsapp?.apiVersion || process.env.WHATSAPP_API_VERSION || 'v17.0';
  if (!token || !mediaId) throw new Error('Missing WhatsApp token or media id');
  const metadata = await fetch(`https://graph.facebook.com/${version}/${mediaId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!metadata.ok) throw new Error(`Media metadata request failed: ${metadata.status}`);
  const { url, mime_type: mimeType } = await metadata.json();
  const binary = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!binary.ok) throw new Error(`Media download failed: ${binary.status}`);
  return { mimeType: mimeType || binary.headers.get('content-type') || 'application/octet-stream', base64Data: Buffer.from(await binary.arrayBuffer()).toString('base64') };
}

function enqueueUserWork(from, work) {
  const previous = userProcessingQueues.get(from) || Promise.resolve();
  const next = previous.catch(() => {}).then(work);
  const tracked = next.finally(() => {
    if (userProcessingQueues.get(from) === tracked) userProcessingQueues.delete(from);
  });
  userProcessingQueues.set(from, tracked);
  return next;
}

// Bienvenida + aviso de privacidad (Ley 29733) en el primer contacto; de noche, también el aviso de clínica cerrada.

async function hasPreviousConversation(senderPhone) {
  const sessionId = String(senderPhone || '').replace(/\D/g, '');
  if (!sessionId) return true;
  if (welcomeSentRecipients.has(sessionId)) return true;
  const cached = chatSessionHistoryCache.get(sessionId);
  if (Array.isArray(cached) && cached.length > 0) return true;

  const client = await getSupabaseClient();
  if (!client) return true;
  try {
    const { data: session, error: sessionError } = await client
      .from('chat_sessions')
      .select('id, history')
      .eq('id', sessionId)
      .maybeSingle();
    if (sessionError) throw sessionError;
    if (Array.isArray(session?.history) && session.history.length > 0) return true;

    const { data: message, error: messageError } = await client
      .from('messages')
      .select('id')
      .eq('phone', sessionId)
      .limit(1)
      .maybeSingle();
    if (messageError) throw messageError;
    return Boolean(message);
  } catch (error) {
    console.error('[Supabase] No se pudo comprobar el primer contacto; se omite bienvenida:', error);
    return true;
  }
}

async function sendFirstContactWelcome(senderPhone, context, messageText, { persistPatient = true } = {}) {
  const imageUrl = mediaUrl('logo');
  const caption = buildWelcomeCaption({ afterHours: takeAfterHoursNotice(senderPhone) });
  const result = await whatsappService.sendImageMessage(senderPhone, imageUrl, caption);
  welcomeSentRecipients.add(String(senderPhone).replace(/\D/g, ''));
  const timestamp = new Date().toISOString();
  if (persistPatient) {
    await persistToSupabaseConversation({
      conversationId: senderPhone,
      contactNumber: senderPhone,
      sender: 'user',
      text: messageText || '[Imagen]',
      timestamp,
      whatsappMessageId: context.messageId || null,
    });
  }
  await persistToSupabaseConversation({
    conversationId: senderPhone,
    contactNumber: senderPhone,
    sender: 'bot',
    text: caption,
    mediaUrl: imageUrl,
    timestamp,
    whatsappMessageId: result?.messages?.[0]?.id || null,
  });
  if (persistPatient) {
    await persistToChatSessions(senderPhone, {
      from: 'patient',
      text: messageText || '[Imagen]',
      phone: senderPhone,
      timestamp,
    });
  }
  await persistToChatSessions(senderPhone, {
    from: 'bot',
    text: caption,
    phone: senderPhone,
    timestamp,
  });
}

// Registra una respuesta ya enviada: dashboards opcionales, tabla conversations/messages y chat_sessions.
async function recordBotReply(from, messageText, text, mediaUrlSent, sendResult) {
  const timestamp = new Date().toISOString();
  const wamid = sendResult?.messages?.[0]?.id || null;
  forwardToDashboard({ direction: 'outgoing', outgoing: { to: from, text, mediaUrl: mediaUrlSent } });
  await notifyDashboardReply(from, text, mediaUrlSent, wamid);
  await notifyMonitorPanel({ conversation_id: from, sender: 'bot', type: mediaUrlSent ? 'image' : 'text', content: text, media_url: mediaUrlSent, timestamp });
  void persistToSupabaseConversation({
    conversationId: from, contactNumber: from, sender: 'bot',
    text, mediaUrl: mediaUrlSent, timestamp, whatsappMessageId: wamid,
  }).catch((error) => console.error('[Supabase] Error al persistir conversación:', error));
  try {
    await persistToChatSessions(from, { from: 'patient', text: messageText, phone: from, timestamp });
    await persistToChatSessions(from, { from: 'bot', text, phone: from, timestamp });
  } catch (error) {
    console.error('[Supabase] Error al persistir conversación:', error);
  }
}

async function processBatch(from, buffer) {
  const messageText = buffer.parts.filter((part) => part.type === 'text').map((part) => part.content).join('\n');
  const jid = `${from}@s.whatsapp.net`;
  // Give immediate visual feedback without making Meta or Gemini wait for it.
  if (buffer.context?.messageId) {
    void Promise.allSettled([
      markMessageAsRead(buffer.context.messageId),
      sendTypingIndicator(buffer.context.messageId),
    ]).then((results) => {
      for (const result of results) {
        if (result.status === 'rejected') console.error('[WhatsApp] Status update failed:', result.reason);
      }
    });
  }
  const clinicPromise = (async () => {
    if (!buffer.context?.phoneNumberId) return DEFAULT_CLINIC;
    try {
      const client = await getSupabaseClient();
      if (!client) return DEFAULT_CLINIC;
      const { data, error } = await client.from('clinics').select('*')
        .eq('waba_phone_number_id', buffer.context.phoneNumberId).maybeSingle();
      if (error) throw error;
      return data ? { ...DEFAULT_CLINIC, ...data } : DEFAULT_CLINIC;
    } catch (error) {
      console.error('[Supabase] Error al consultar clínica:', error);
      return DEFAULT_CLINIC;
    }
  })();
  const persistencePromise = persistToSupabaseConversation({
    conversationId: from, contactNumber: from,
    sender: 'user', text: messageText || null, mediaUrl: null, timestamp: new Date().toISOString(),
    whatsappMessageId: buffer.context?.messageId || null,
  });
  const clinic = await Promise.race([
    clinicPromise,
    new Promise((resolve) => setTimeout(() => resolve(DEFAULT_CLINIC), 750)),
  ]);
  void persistencePromise.catch((error) => console.error('[Supabase] Error al persistir conversación:', error));

  // Pase a humano activo: el mensaje ya quedó guardado, pero el bot no responde.
  if (await handoffService.isPaused(from)) return;

  // Urgencia clínica o pedido de hablar con una persona: se pausa el bot y se avisa a recepción.
  const handoffReason = detectHandoff(messageText);
  if (handoffReason) {
    const firstContactUrgent = Boolean(buffer.context?.firstContactUrgent);
    const reply = firstContactUrgent
      ? `${patientHandoffReply(handoffReason)}\n\n${activeClinic.privacyNotice}`
      : patientHandoffReply(handoffReason);
    try {
      const sendResult = await whatsappService.sendTextMessage(from, reply);
      await recordBotReply(from, messageText, reply, null, sendResult);
      if (firstContactUrgent) {
        void conversationMetrics.recordFirstContact({ phone: from, firstMessageAt: buffer.context.sentAt, respondedAt: clockNow() });
      }
    } catch (error) {
      console.error('webhookController: failed sending message to user', error);
    }
    await handoffService.handoff({ phone: from, reason: handoffReason, message: messageText, contactName: buffer.context?.contactName });
    return;
  }

  // Cancelar / reprogramar / responder un recordatorio se resuelve sin Gemini.
  const commandReply = await handleAppointmentCommands(from, messageText);
  if (commandReply) {
    try {
      const sendResult = await whatsappService.sendTextMessage(from, commandReply);
      await recordBotReply(from, messageText, commandReply, null, sendResult);
    } catch (error) {
      console.error('webhookController: failed sending message to user', error);
    }
    return;
  }

  // Si pide cita, se le ofrecen 3 horarios libres concretos en vez de preguntarle "¿qué día?".
  // Fuera de horario también ante una consulta de precio o tratamiento: la cita se asegura en caliente.
  const current = clockNow();
  const afterHours = !isWithinWorkingHours(activeClinic, current);
  let offeredSlots = null;
  const alreadyChoosing = geminiService.pickOfferedSlot(messageText, geminiService.getOfferedSlots(jid));
  const hotLead = afterHours && !geminiService.getOfferedSlots(jid)
    && Boolean(findTreatment(messageText) || PRICE_INTENT.test(messageText));
  if ((BOOKING_INTENT.test(messageText) || hotLead) && !alreadyChoosing && !geminiService.isSessionBooked(jid)) {
    try {
      const fromDate = parseRequestedDay(messageText, localParts(activeClinic.timezone, current).date);
      offeredSlots = await appointmentService.findNextSlots(findTreatment(messageText)?.key || null, fromDate ? { fromDate } : {});
    } catch (error) {
      console.error('[Appointments] No se pudieron calcular horarios libres:', error?.message || error);
    }
  }

  let geminiResult;
  try {
    geminiResult = await geminiService.obtenerRespuestaIA(jid, messageText, {
      client: getGeminiClient(), maxRetries: 1, maxOutputTokens: 300, messageParts: buffer.parts, clinic,
      availableSlots: offeredSlots, afterHours, welcomed: Boolean(buffer.context?.welcomed),
    });
  } catch (error) {
    console.error('[Gemini] Error al generar respuesta:', error);
    geminiResult = null;
  }
  if (!geminiResult || geminiResult.skipResponse || !geminiResult.texto) {
    console.error('[Gemini] No se obtuvo una respuesta utilizable; se envía la respuesta de respaldo');
    let fallback = aiFallbackReply(offeredSlots);
    if (takeAfterHoursNotice(from, current)) fallback = `${AFTER_HOURS_NOTICE}\n\n${fallback}`;
    try {
      const sendResult = await whatsappService.sendTextMessage(from, fallback);
      await recordBotReply(from, messageText, fallback, null, sendResult);
    } catch (error) {
      console.error('webhookController: failed sending message to user', error);
    }
    await alertReceptionNoAI(from, messageText);
    return;
  }

  // Las etiquetas de foto se leen del texto crudo: sanitizeModelTextOutput borra los "_" y [ENVIAR_IMAGEN].
  const { keys: requestedMediaKeys } = extractPhotoTags(geminiResult.rawTexto || geminiResult.texto);
  const botReplyText = geminiService.sanitizeModelTextOutput(extractPlainText(extractPhotoTags(geminiResult.texto).cleaned));
  let textoParaWhatsApp = stripInstructionTags(botReplyText);
  const inferredKey = inferPhotoKeyFromMessage(messageText);
  if (inferredKey && !requestedMediaKeys.includes(inferredKey)) requestedMediaKeys.push(inferredKey);
  const urlsToSend = requestedMediaKeys.map((key) => mediaUrl(key)).filter(Boolean);
  const finalMediaUrl = urlsToSend[0] || null;
  let leadResult = null;
  if (geminiResult.leadData && !geminiResult.skipLeadPersistence) {
    try {
      leadResult = await leadService.saveLead({
        telefono: from, nombre: geminiResult.leadData.nombre, distrito: geminiResult.leadData.distrito,
        fechaHoraISO: geminiResult.leadData.fechaHoraISO, fechaHoraTexto: geminiResult.leadData.fechaHora,
        confirmed: geminiService.isExplicitConfirmation(messageText), clinicId: clinic?.id || null, clinic,
      });
    } catch (error) {
      console.error('[Supabase] Error al persistir conversación:', error);
    }

  }

  // Fase B: nombre + tratamiento + horario → se guarda la cita y se avisa a recepción.
  let appointmentOutcome = null;
  if (geminiResult.appointmentRequest) {
    appointmentOutcome = await persistAgendaPayload(geminiResult.appointmentRequest, {
      phone: from, adReferral: await getAdReferral(from),
    });
    if (appointmentOutcome.status === 'slot_taken') {
      geminiService.releaseBooking(jid);
      geminiService.setOfferedSlots(jid, appointmentOutcome.alternatives);
      const why = appointmentOutcome.reason === 'outside_hours'
        ? `Ese horario está fuera de nuestra atención (${activeClinic.workingHoursText}).`
        : '¡Uy! Ese horario se acaba de ocupar 😅.';
      textoParaWhatsApp = appointmentOutcome.alternatives.length
        ? `${why} Te propongo estos:${formatSlotList(appointmentOutcome.alternatives)}`
        : `${why} Recepción te escribirá para coordinar otro.`;
    }
  } else if (offeredSlots?.length) {
    textoParaWhatsApp = `${textoParaWhatsApp}${formatSlotList(offeredSlots)}`.trim();
  }

  if (textoParaWhatsApp && takeAfterHoursNotice(from, current)) {
    textoParaWhatsApp = `${AFTER_HOURS_NOTICE}\n\n${textoParaWhatsApp}`;
  }

  let sendResult;
  try {
    if (finalMediaUrl) {
      if (textoParaWhatsApp) {
        sendResult = await whatsappService.sendTextMessage(from, textoParaWhatsApp);
      }
      for (const imageUrl of urlsToSend) {
        const imageKey = imageUrl;
        let alreadySent = false;
        let claim = { claimed: true, id: null };
        try {
          alreadySent = await hasMediaBeenSent(from, imageKey);
          claim = alreadySent ? { claimed: false, id: null } : await claimMediaSend({ recipient: from, imageKey });
        } catch (error) {
          console.error('[Media] Error al consultar deduplicación; se enviará la imagen:', error);
        }
        if (!claim.claimed) continue;
        try {
          await whatsappService.sendImageMessage(from, imageUrl, `${activeClinic.name} 🦷`);
        } catch (error) {
          if (claim.id) {
            try { await completeMediaSend(claim.id, 'failed', error?.message || error); }
            catch (trackingError) { console.error('[Media] Error al registrar fallo de envío:', trackingError); }
          }
          throw error;
        }
        if (claim.id) {
          try {
            await completeMediaSend(claim.id, 'sent');
          } catch (error) {
            console.error('[Media] Error al registrar envío exitoso:', error);
          }
        }
        try {
          await markMediaAsSent(from, imageKey);
        } catch (error) {
          console.error('[Media] Error al marcar imagen enviada:', error);
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    } else {
      if (textoParaWhatsApp) {
        sendResult = await whatsappService.sendTextMessage(from, textoParaWhatsApp);
      }
    }
  } catch (error) {
    console.error('webhookController: failed sending message to user', error);
    return;
  }

  await recordBotReply(from, messageText, textoParaWhatsApp, finalMediaUrl, sendResult);
  // Si ya se avisó a recepción por la cita, no se duplica la alerta de lead.
  if (leadResult?.readyToNotify && leadResult.lead && appointmentOutcome?.status !== 'saved') {
    try { await notificationService.notifyAdminNewLead(leadResult.lead, { whatsappService, leadService, clinic }); }
    catch (error) { console.error('webhookController: error in admin notify flow', error); }
  }
}

async function addMessageToBuffer(from, part, context) {
  const current = messageBuffers.get(from) || { parts: [], timer: null, lastActivity: 0, context };
  current.parts.push(part);
  current.lastActivity = Date.now();
  current.context = context;
  if (current.timer) clearTimeout(current.timer);
  current.timer = setTimeout(() => {
    messageBuffers.delete(from);
    current.timer = null;
    enqueueUserWork(from, () => processBatch(from, current)).catch((error) => console.error('webhookController: batch failed', error));
  }, BUFFER_WAIT_MS);
  messageBuffers.set(from, current);
}

// Espera a que termine todo lo pendiente de un paciente (recepción, debounce y respuesta).
// Lo usan scripts/simulate-conversations.js y los tests; el flujo normal no lo necesita.
export async function waitForIdle(from) {
  const id = String(from || '').replace(/\D/g, '');
  for (;;) {
    const pending = intakeQueues.get(id) || (messageBuffers.has(id) ? new Promise((r) => setTimeout(r, 50)) : null)
      || userProcessingQueues.get(id);
    if (!pending) return;
    await pending.catch(() => {});
  }
}

// Buffering combines rapid text/image messages while the per-user queue prevents overlapping Gemini calls.
export default async function webhookController(req, res, next) {
  res.status(200).send('EVENT_RECEIVED');
  try {
    let payload = req.parsedBody || req.body;
    if (Buffer.isBuffer(payload)) payload = JSON.parse(payload.toString('utf8'));
    const value = payload?.entry?.[0]?.changes?.[0]?.value;
    if (Array.isArray(value?.statuses) && value.statuses.length > 0) return;
    const message = value?.messages?.[0];
    if (!message) return;
    if (payload) notifyDashboardIncoming(payload);
    // Meta reintenta si el 200 llega tarde (Render despertando): cada message.id se procesa una sola vez.
    if (await messageDedup.seen(message.id)) return;
    if (message.from === 'status@broadcast' || message.type === 'system') return;
    const from = String(message.from || '').replace(/\D/g, '');
    if (!from) return;
    // Texto, respuesta a botón de plantilla ("Confirmo" / "Reprogramar") o pie de foto.
    const text = message.type === 'text' ? message.text?.body?.trim()
      : message.type === 'button' ? message.button?.text?.trim()
        : message.type === 'interactive'
          ? (message.interactive?.button_reply?.title || message.interactive?.list_reply?.title)?.trim()
          : message.image?.caption?.trim();
    const referral = sanitizeReferral(message.referral);
    if (referral) {
      adReferrals.set(from, referral);
      void leadService.saveLeadAdReferral(from, referral)
        .catch((error) => console.error('[Leads] No se pudo guardar el anuncio de origen:', error?.message || error));
    }
    const receivedAt = clockNow();
    const sentAt = Number(message.timestamp) > 0 ? new Date(Number(message.timestamp) * 1000) : receivedAt;
    const context = {
      contactName: value?.contacts?.[0]?.profile?.name || from,
      phoneNumberId: value?.metadata?.phone_number_id || process.env.WHATSAPP_PHONE_NUMBER_ID || null,
      messageId: message.id || null,
      // Meta puede entregar tarde si Render estaba dormido: se mide desde la hora real del mensaje.
      sentAt: sentAt > receivedAt ? receivedAt : sentAt,
    };
    const intake = intakeQueues.get(from) || Promise.resolve();
    const next = intake.then(async () => {
        const wantsDataDeletion = DATA_DELETION.test(text || '');
        if (message.type === 'text' && (/^\/?(reset|reiniciar|borrar|clear)$/i.test(text || '') || wantsDataDeletion)) {
          const pending = messageBuffers.get(from);
          if (pending?.timer) clearTimeout(pending.timer);
          messageBuffers.delete(from);
          await hardResetUserSession(from);
          // Derecho de supresión (Ley 29733) anunciado en el aviso de privacidad de la bienvenida.
          if (wantsDataDeletion) {
            try {
              await whatsappService.sendTextMessage(from, DATA_DELETION_REPLY);
            } catch (error) {
              console.error('[WhatsApp] No se pudo confirmar la eliminación de datos:', error);
            }
          }
          return;
        }
        if (!(await hasPreviousConversation(from))) {
          const unsupported = Boolean(UNSUPPORTED_REPLIES[message.type]);
          if (detectHandoff(text) === 'urgencia') {
            // Con dolor o sangrado no se manda la promo: la derivación sale primero, con el aviso de privacidad.
            context.firstContactUrgent = true;
            welcomeSentRecipients.add(from);
          } else {
            // Un simple "hola" se queda con la bienvenida. Una pregunta ("¿cuánto cuestan los brackets?")
            // se responde de inmediato, sin obligar al paciente a repetirla.
            const onlyGreeting = !text || GREETING_ONLY.test(text);
            const continues = !onlyGreeting && !unsupported;
            try {
              await sendFirstContactWelcome(from, context, unsupported ? `[${message.type}]` : text, { persistPatient: !continues });
              void conversationMetrics.recordFirstContact({ phone: from, firstMessageAt: context.sentAt, respondedAt: clockNow() });
            } catch (error) {
              console.error('[WhatsApp] Error al enviar bienvenida inicial:', error);
            }
            if (!continues && !unsupported) return;
            context.welcomed = true;
          }
        }
        if (UNSUPPORTED_REPLIES[message.type]) {
          if (await handoffService.isPaused(from)) return;
          try {
            const reply = UNSUPPORTED_REPLIES[message.type];
            const sendResult = await whatsappService.sendTextMessage(from, reply);
            await recordBotReply(from, `[${message.type}]`, reply, null, sendResult);
          } catch (error) {
            console.error('[WhatsApp] No se pudo responder a un mensaje no soportado:', error);
          }
          return;
        }
        if (message.type === 'image') {
          try {
            const media = await downloadIncomingImage(message.image?.id);
            await addMessageToBuffer(from, { type: 'image', ...media, caption: message.image?.caption ?? null }, context);
          } catch (error) {
            console.error('webhookController: image download failed', error);
          }
        } else if (text) {
          await addMessageToBuffer(from, { type: 'text', content: text }, context);
        }
    });
    const tracked = next.finally(() => { if (intakeQueues.get(from) === tracked) intakeQueues.delete(from); });
    intakeQueues.set(from, tracked);
  } catch (error) {
    console.error('webhookController: background processing error', error);
    console.error('webhookController: request payload processing failed', error);
  }
}