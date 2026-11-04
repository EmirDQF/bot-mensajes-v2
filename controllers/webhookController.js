import geminiService from '../services/geminiService.js';
import leadService from '../services/leadService.js';
import notificationService from '../services/notificationService.js';
import whatsappService, { sendTypingIndicator } from '../services/whatsappService.js';
import { getGeminiClient, getGeminiFallbackClients } from '../src/geminiClient.js';
import { getSupabase } from '../services/supabaseClient.js';
import activeClinic, { findTreatment, mediaUrl } from '../config/clinic.config.js';
import appointmentService, {
  OutsideHoursError, SlotTakenError, isWithinWorkingHours, localParts, parseRequestedDay, slotLabel,
} from '../services/appointmentService.js';
import handoffService, { detectHandoff, patientHandoffReply } from '../services/handoffService.js';
import conversationMetrics from '../services/conversationMetrics.js';
import messageDedup from '../services/messageDedup.js';
import { now as clockNow } from '../services/clock.js';
import inboxService from '../services/inboxService.js';
import liveEvents from '../services/liveEvents.js';
import { fetchMetaMedia } from '../services/metaMedia.js';
import clinicSettings from '../services/clinicSettings.js';
import leadInsights, { enforceNoDiagnosis, matchRecommendation } from '../services/recommendationService.js';
import { extractPhotoTags, inferPhotoKeyFromMessage } from '../services/mediaTags.js';
import {
  claimMediaSend,
  completeMediaSend,
  hasMediaBeenSent,
  markMediaAsSent,
} from '../services/mediaTrackingService.js';
import { createSerialQueue } from '../services/serialQueue.js';
import { createExpiringMap } from '../services/expiringMap.js';
import { describeError } from '../services/safeLog.js';
import { aiFallbackReply, createNoAiAlert, createReceptionQuestionAlert, formatSlotList } from '../services/aiFallback.js';
import { adWelcomeCaption } from '../services/adContext.js';
import { sendClinicLocation, wantsLocation } from '../services/clinicLocation.js';
import { quickAnswer } from '../services/quickAnswers.js';

export { aiFallbackReply, formatSlotList };

// Cachés por paciente con vencimiento: sin tope crecerían con cada número nuevo mientras el proceso viva.
const DAY_MS = 24 * 60 * 60 * 1000;
const HISTORY_CACHE_TTL_MS = 30 * 60 * 1000;
// Pausa entre fotos seguidas para que WhatsApp las entregue en orden.
const PHOTO_GAP_MS = 300;

// Origen del anuncio de Meta (click-to-WhatsApp). Solo llega en el primer mensaje: se guarda en memoria
// y en leads.ad_referral para asociarlo después a la cita.
const REFERRAL_FIELDS = ['source_type', 'source_id', 'source_url', 'headline', 'body', 'media_type', 'ctwa_clid'];
const adReferrals = createExpiringMap({ ttlMs: DAY_MS });

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

// Notas "para el bot" que recepción escribe en la ficha (se sanean al armar el prompt).
async function getBotNotes(phone) {
  try {
    return (await leadService.getByPhone(phone))?.bot_notes || null;
  } catch (error) {
    console.warn('[Leads] No se pudieron leer las notas para el bot:', describeError(error));
    return null;
  }
}

async function getAdReferral(phone) {
  if (adReferrals.has(phone)) return adReferrals.get(phone);
  try {
    return (await leadService.getByPhone(phone))?.ad_referral || null;
  } catch (error) {
    return null;
  }
}

const chatSessionHistoryCache = createExpiringMap({ ttlMs: HISTORY_CACHE_TTL_MS });
const welcomeSentRecipients = createExpiringMap({ ttlMs: DAY_MS });
async function getSupabaseClient() {
  return getSupabase();
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
        if (result.status === 'rejected') console.warn(`[Privacidad] No se pudo borrar en ${result.reason?.table}:`, describeError(result.reason));
      }
    }
    console.log(`[Privacidad] Datos del paciente eliminados (***${rawDigits.slice(-4)})`);
    return true;
  } catch (err) {
    console.error('Error en hardResetUserSession:', describeError(err));
    return false;
  }
}

// Guarda el mensaje en la bandeja (conversations + messages) y lo publica en vivo al panel.
// Nunca lanza: si Supabase falla, la conversación con el paciente sigue.
async function recordInbox(entry) {
  try {
    return await inboxService.recordMessage(entry);
  } catch (error) {
    console.error('[Bandeja] No se pudo guardar el mensaje:', describeError(error));
    return null;
  }
}

// Tipos de mensaje del paciente con archivo en Meta (se ven en el panel por el proxy autenticado).
const MEDIA_TYPES = ['image', 'audio', 'video', 'document', 'sticker'];

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
    .replace(/[ \t]{2,}/g, ' ')
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
    await appointmentService.notifyReception(appointment, { summary: context.summary || null });
    return { status: 'saved', appointment };
  } catch (error) {
    if (error instanceof SlotTakenError) {
      const outsideHours = error instanceof OutsideHoursError;
      let alternatives = [];
      try {
        // Fuera de horario (p. ej. "a las 11 p. m.") se ofrecen los más cercanos desde ahora.
        alternatives = await appointmentService.findNextSlots(payload.tratamiento || null, outsideHours ? {} : { fromDate: payload.fecha });
      } catch (slotError) {
        console.error('[Appointments] No se pudieron calcular horarios alternativos:', describeError(slotError));
      }
      return { status: 'slot_taken', reason: outsideHours ? 'outside_hours' : 'taken', alternatives };
    }
    console.error('[Appointments] No se pudo guardar la cita:', describeError(error));
    return { status: 'error' };
  }
}

// Si Gemini falla, el paciente recibe los horarios o un aviso y recepción una alerta (services/aiFallback.js).
const alertReceptionNoAI = createNoAiAlert();
// La asistente no tenía el dato ([CONSULTAR_RECEPCION]): recepción responde la pregunta.
const alertReceptionQuestion = createReceptionQuestionAlert();

const BOOKING_INTENT = /\b(citas?|agendar|agendo|agenda|reservar|reserva|separar|turnos?|horarios?|disponibilidad|atenderme|evaluaci[oó]n)\b/i;
const CANCEL_INTENT = /^\s*cancelar(?:\s+mi)?(?:\s+cita)?\s*[.!]*\s*$|\bcancel\w*\b[^.?!]*\bcita\b|\bcita\b[^.?!]*\bcancel\w*\b|\bya no (?:voy a )?(?:ir|asistir|podr[eé] ir)\b/i;
const RESCHEDULE_INTENT = /^\s*reprogramar(?:\s+mi)?(?:\s+cita)?\s*[.!]*\s*$|\b(?:cambiar|reprogramar|mover|postergar|cambio de)\b[^.?!]*\b(?:cita|hora|horario|d[ií]a)\b/i;
export const DATA_DELETION = /^\s*(?:por\s+favor\s+)?(?:borra|borrar|elimina|eliminar)\s+(?:todos\s+)?(?:mis|los)\s+datos(?:\s+personales)?\s*(?:por\s+favor)?\s*[.!]*\s*$/i;
const DATA_DELETION_REPLY = 'Listo ✅ Eliminamos tu conversación y tus datos de contacto de nuestro asistente. '
  + 'Si tienes una cita registrada, la clínica la conserva solo para atenderte; puedes cancelarla escribiendo "cancelar mi cita".';
const REMINDER_CONFIRM = /^\s*(?:1|1️⃣|confirmo|confirmar|confirmado|s[ií],?\s*confirmo)\s*[.!]*\s*$/i;
// "Reagendar" / "Reprogramar": botón del recordatorio (interactivo o de la plantilla) o respuesta escrita.
const REMINDER_RESCHEDULE = /^\s*(?:2|2️⃣|reprogramar|reagendar)\s*[.!]*\s*$/i;
const RESCHEDULE_TTL_MS = 30 * 60 * 1000;
// Cierra una frase sin duplicar el punto de "p. m.".
const sentence = (text) => (/[.!?]$/.test(text) ? text : `${text}.`);
// Consultas de precio o de un tratamiento: de noche se aprovechan para ofrecer horarios "en caliente".
const PRICE_INTENT = /\b(?:precio|precios|cu[aá]nto|cuesta|costo|cuotas?|inicial|promo(?:ci[oó]n)?|campa[nñ]a|descuento)\b/i;
// Solo un saludo: basta la bienvenida. Cualquier otra cosa en el primer mensaje se responde de inmediato.
export const GREETING_ONLY = /^[\s¡!¿?.,]*(?:(?:hola+|holi|ola|buenas|buen[oa]s?\s+(?:noches|tardes|d[ií]as)|buen\s+d[ií]a|hi|hello|info|informaci[oó]n)[\s!?.,😊👋🙂]*)+$/iu;
const UNSUPPORTED_REPLIES = {
  audio: 'Disculpa 🙏 todavía no puedo escuchar audios. ¿Me lo escribes en un mensaje? Así te ayudo al toque con precios, fotos u horarios.',
  video: 'Gracias por el video 🙏 por ahora no puedo verlo. ¿Me cuentas por escrito qué necesitas?',
  document: 'Gracias 🙏 por aquí no puedo abrir archivos. ¿Me cuentas por escrito qué necesitas? Si es para tu evaluación, tráelo el día de tu cita.',
  sticker: '😊 ¿En qué te ayudo? Puedo contarte precios, enviarte fotos de tratamientos o proponerte horarios para tu evaluación.',
};

// Modo nocturno: la asistente dice con naturalidad que la clínica está cerrada (una vez por noche)
// y deja la solicitud de cita lista para que recepción la confirme al abrir.
// El texto es editable en el panel (afterHoursNotice); se lee en cada uso.
export const DEFAULT_AFTER_HOURS_NOTICE = '🌙 Ahora la clínica está cerrada, pero yo te ayudo ya mismo y te dejo la solicitud de cita lista; recepción te la confirma a primera hora.';
export const afterHoursNotice = () => activeClinic.afterHoursNotice || DEFAULT_AFTER_HOURS_NOTICE;
const AFTER_HOURS_RENOTICE_MS = 10 * 60 * 60 * 1000;
const afterHoursNoticeAt = createExpiringMap({ ttlMs: AFTER_HOURS_RENOTICE_MS });

// true si toca avisar ahora que la clínica está cerrada (fuera de horario y sin aviso en las últimas 10 h).
export function takeAfterHoursNotice(phone, instant = clockNow()) {
  if (isWithinWorkingHours(activeClinic, instant)) return false;
  const last = afterHoursNoticeAt.get(phone);
  if (last && instant - last < AFTER_HOURS_RENOTICE_MS) return false;
  afterHoursNoticeAt.set(phone, instant);
  return true;
}

// Si llegó de un anuncio de un tratamiento, la bienvenida responde al anuncio (precio configurado) en vez de
// preguntarle qué tratamiento busca.
export function buildWelcomeCaption({ afterHours = false, adReferral = null } = {}) {
  const welcome = adWelcomeCaption(activeClinic, adReferral) || activeClinic.welcomeCaption;
  return [welcome, afterHours ? afterHoursNotice() : null, activeClinic.privacyNotice].filter(Boolean).join('\n\n');
}
const pendingReschedules = createExpiringMap({ ttlMs: RESCHEDULE_TTL_MS });

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
    console.error('[Appointments] Error al cancelar o reprogramar:', describeError(error));
    return null;
  }
}

const messageBuffers = new Map();
const BUFFER_WAIT_MS = 2000;
// Dos colas por paciente: la de entrada (cada mensaje en orden de llegada, antes del debounce) y la de
// respuesta (un lote a la vez, sin llamadas a Gemini superpuestas). Un fallo no detiene lo que sigue.
const intakeQueue = createSerialQueue({
  onError: (error) => console.error('webhookController: background processing error', describeError(error)),
});
const userProcessingQueue = createSerialQueue({
  onError: (error) => console.error('webhookController: batch failed', describeError(error)),
});
async function downloadIncomingImage(mediaId) {
  const { contentType, buffer } = await fetchMetaMedia(mediaId);
  return { mimeType: contentType, base64Data: buffer.toString('base64') };
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
    console.error('[Supabase] No se pudo comprobar el primer contacto; se omite bienvenida:', describeError(error));
    return true;
  }
}

async function sendFirstContactWelcome(senderPhone, context, messageText, { persistPatient = true } = {}) {
  const imageUrl = mediaUrl('logo');
  const caption = buildWelcomeCaption({ afterHours: takeAfterHoursNotice(senderPhone), adReferral: adReferrals.get(senderPhone) || null });
  const result = await whatsappService.sendImageMessage(senderPhone, imageUrl, caption);
  welcomeSentRecipients.set(String(senderPhone).replace(/\D/g, ''), true);
  const timestamp = new Date().toISOString();
  // El mensaje del paciente ya quedó en la bandeja al llegar; aquí solo se guarda la bienvenida.
  await recordInbox({
    phone: senderPhone, sender: 'bot', text: caption, type: 'image', mediaUrl: imageUrl,
    wamid: result?.messages?.[0]?.id || null,
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

// Registra una respuesta ya enviada: tabla conversations/messages y chat_sessions.
async function recordBotReply(from, messageText, text, mediaUrlSent, sendResult) {
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

// Envía un texto al paciente y lo registra en la bandeja. Nunca lanza: devuelve true si se envió.
async function sendReply(from, messageText, reply, failureLog = 'webhookController: failed sending message to user') {
  try {
    const sendResult = await whatsappService.sendTextMessage(from, reply);
    await recordBotReply(from, messageText, reply, null, sendResult);
    return true;
  } catch (error) {
    console.error(failureLog, describeError(error));
    return false;
  }
}

// "Leído" + "escribiendo…" al instante (una sola llamada a Meta), sin hacer esperar la respuesta.
// sendTypingIndicator nunca lanza: un fallo queda en el log con el motivo de Meta.
function showTyping(messageId) {
  if (!messageId) return;
  void sendTypingIndicator(messageId);
}

// Urgencia clínica o pedido de hablar con una persona: se responde, se pausa el bot y se avisa a recepción.
async function replyHandoff(from, messageText, handoffReason, context = {}) {
  const firstContactUrgent = Boolean(context.firstContactUrgent);
  // Sangrado de encías sin señales de alarma: además de pasar a una persona, se recomienda la evaluación.
  const handoffText = patientHandoffReply(handoffReason, { text: messageText, recommendation: matchRecommendation(messageText) });
  const reply = firstContactUrgent ? `${handoffText}\n\n${activeClinic.privacyNotice}` : handoffText;
  const sent = await sendReply(from, messageText, reply);
  if (sent && firstContactUrgent) {
    // La fila de conversations ya existe: el mensaje entrante se guardó en la bandeja al llegar.
    void conversationMetrics.recordFirstContact({ phone: from, firstMessageAt: context.sentAt, respondedAt: clockNow() });
  }
  await handoffService.handoff({ phone: from, reason: handoffReason, message: messageText, contactName: context.contactName });
}

// Si pide cita, se le ofrecen 3 horarios libres concretos en vez de preguntarle "¿qué día?".
// Fuera de horario también ante una consulta de precio o tratamiento: la cita se asegura en caliente.
async function planSlotOffer(messageText, jid, current, afterHours) {
  const alreadyChoosing = geminiService.pickOfferedSlot(messageText, geminiService.getOfferedSlots(jid));
  const hotLead = afterHours && !geminiService.getOfferedSlots(jid)
    && Boolean(findTreatment(messageText) || PRICE_INTENT.test(messageText));
  // Lo que cuenta el paciente ("tengo los dientes chuecos") → evaluación recomendada + precio "desde" + 3 horarios.
  const recommendation = alreadyChoosing ? null : matchRecommendation(messageText);
  let offeredSlots = null;
  if ((BOOKING_INTENT.test(messageText) || hotLead || recommendation) && !alreadyChoosing && !geminiService.isSessionBooked(jid)) {
    try {
      const fromDate = parseRequestedDay(messageText, localParts(activeClinic.timezone, current).date);
      const treatmentKey = findTreatment(messageText)?.key || recommendation?.treatment?.key || null;
      offeredSlots = await appointmentService.findNextSlots(treatmentKey, fromDate ? { fromDate } : {});
    } catch (error) {
      console.error('[Appointments] No se pudieron calcular horarios libres:', describeError(error));
    }
  }
  return { offeredSlots, alreadyChoosing, recommendation };
}

// Gemini sin respuesta utilizable. Primero, una respuesta sin IA con los datos de la clínica (precio, ubicación,
// horario, campaña o pagos); si la pregunta no es de esas, horarios o aviso al paciente y alerta a recepción.
async function replyWithoutAI(from, messageText, offeredSlots, recommendation, current) {
  const today = localParts(activeClinic.timezone, current).date;
  const quick = recommendation ? null : quickAnswer(messageText, { clinic: activeClinic, today });
  console.error(`[Gemini] Sin respuesta utilizable; se envía ${quick ? `la respuesta sin IA (${quick.kinds.join(', ')})` : 'la respuesta de respaldo'}`);
  let fallback = quick ? `${quick.text}${formatSlotList(offeredSlots)}` : aiFallbackReply(offeredSlots, recommendation);
  if (takeAfterHoursNotice(from, current)) fallback = `${afterHoursNotice()}\n\n${fallback}`;
  await sendReply(from, messageText, fallback);
  if (!quick) await alertReceptionNoAI(from, messageText);
}

async function saveLeadFromReply(from, messageText, geminiResult) {
  if (!geminiResult.leadData || geminiResult.skipLeadPersistence) return null;
  try {
    return await leadService.saveLead({
      telefono: from, nombre: geminiResult.leadData.nombre, distrito: geminiResult.leadData.distrito,
      fechaHoraISO: geminiResult.leadData.fechaHoraISO, fechaHoraTexto: geminiResult.leadData.fechaHora,
      confirmed: geminiService.isExplicitConfirmation(messageText), clinicId: activeClinic.id, clinic: activeClinic,
    });
  } catch (error) {
    console.error('[Supabase] Error al persistir conversación:', describeError(error));
    return null;
  }
}

// Fase B: nombre + tratamiento + horario → se guarda la cita y se avisa a recepción. Si el horario ya no
// sirve, el texto cambia por las alternativas. Devuelve { text, appointmentOutcome }.
async function applyAppointmentRequest(from, jid, geminiResult, text, offeredSlots) {
  if (!geminiResult.appointmentRequest) {
    return { text: offeredSlots?.length ? `${text}${formatSlotList(offeredSlots)}`.trim() : text, appointmentOutcome: null };
  }
  const appointmentOutcome = await persistAgendaPayload(geminiResult.appointmentRequest, {
    phone: from, adReferral: await getAdReferral(from), summary: geminiService.conversationSummary(jid),
  });
  if (appointmentOutcome.status !== 'slot_taken') return { text, appointmentOutcome };
  geminiService.releaseBooking(jid);
  geminiService.setOfferedSlots(jid, appointmentOutcome.alternatives);
  const why = appointmentOutcome.reason === 'outside_hours'
    ? `Ese horario está fuera de nuestra atención (${activeClinic.workingHoursText}).`
    : '¡Uy! Ese horario se acaba de ocupar 😅.';
  const alternativesText = appointmentOutcome.alternatives.length
    ? `${why} Te propongo estos:${formatSlotList(appointmentOutcome.alternatives)}`
    : `${why} Recepción te escribirá para coordinar otro.`;
  return { text: alternativesText, appointmentOutcome };
}

// Fotos pedidas, en secuencia y sin repetir las ya enviadas. Nunca lanza: si una foto falla, el texto
// ya enviado queda registrado y no se insiste con las siguientes.
async function sendRequestedPhotos(from, urlsToSend) {
  for (const imageUrl of urlsToSend) {
    const imageKey = imageUrl;
    let claim = { claimed: true, id: null };
    try {
      const alreadySent = await hasMediaBeenSent(from, imageKey);
      claim = alreadySent ? { claimed: false, id: null } : await claimMediaSend({ recipient: from, imageKey });
    } catch (error) {
      console.error('[Media] Error al consultar deduplicación; se enviará la imagen:', describeError(error));
    }
    if (!claim.claimed) continue;
    try {
      const imageResult = await whatsappService.sendImageMessage(from, imageUrl, `${activeClinic.name} 🦷`);
      void recordInbox({ phone: from, sender: 'bot', type: 'image', mediaUrl: imageUrl, wamid: imageResult?.messages?.[0]?.id || null });
    } catch (error) {
      console.error('webhookController: failed sending photo to user', describeError(error));
      if (claim.id) {
        try { await completeMediaSend(claim.id, 'failed', error?.message || error); }
        catch (trackingError) { console.error('[Media] Error al registrar fallo de envío:', describeError(trackingError)); }
      }
      return;
    }
    if (claim.id) {
      try {
        await completeMediaSend(claim.id, 'sent');
      } catch (error) {
        console.error('[Media] Error al registrar envío exitoso:', describeError(error));
      }
    }
    try {
      await markMediaAsSent(from, imageKey);
    } catch (error) {
      console.error('[Media] Error al marcar imagen enviada:', describeError(error));
    }
    await new Promise((resolve) => setTimeout(resolve, PHOTO_GAP_MS));
  }
}

// Texto final de Gemini: sin etiquetas, sin diagnóstico, con las fotos pedidas o deducidas del mensaje.
function buildBotReply(geminiResult, messageText, recommendation) {
  // Las etiquetas de foto se leen del texto crudo: sanitizeModelTextOutput borra los "_" y [ENVIAR_IMAGEN].
  const { keys: requestedMediaKeys } = extractPhotoTags(geminiResult.rawTexto || geminiResult.texto);
  const botReplyText = geminiService.sanitizeModelTextOutput(extractPlainText(extractPhotoTags(geminiResult.texto).cleaned));
  // Freno final: si el modelo diagnostica o receta, se envía la recomendación segura de la clínica.
  const safeReply = enforceNoDiagnosis(stripInstructionTags(botReplyText), recommendation);
  if (safeReply.replaced) console.warn('[Gemini] Respuesta con diagnóstico reemplazada por la recomendación de evaluación');
  const inferredKey = inferPhotoKeyFromMessage(messageText);
  const mediaKeys = inferredKey && !requestedMediaKeys.includes(inferredKey) ? [...requestedMediaKeys, inferredKey] : requestedMediaKeys;
  return { text: safeReply.text, urlsToSend: mediaKeys.map((key) => mediaUrl(key)).filter(Boolean) };
}

async function processBatch(from, buffer) {
  // Configuración del panel al día (sin consultas si se revisó hace menos de 5 min).
  await clinicSettings.ensureFresh();
  const messageText = buffer.parts.filter((part) => part.type === 'text').map((part) => part.content).join('\n');
  const jid = `${from}@s.whatsapp.net`;
  showTyping(buffer.context?.messageId);
  // Pase a humano activo: el mensaje ya quedó guardado (al llegar), pero el bot no responde.
  if (await handoffService.isPaused(from)) return;

  const handoffReason = detectHandoff(messageText);
  if (handoffReason) return replyHandoff(from, messageText, handoffReason, buffer.context);

  // Cancelar / reprogramar / responder un recordatorio se resuelve sin Gemini.
  const commandReply = await handleAppointmentCommands(from, messageText);
  if (commandReply) {
    await sendReply(from, messageText, commandReply);
    return;
  }

  const current = clockNow();
  const afterHours = !isWithinWorkingHours(activeClinic, current);
  const { offeredSlots, alreadyChoosing, recommendation } = await planSlotOffer(messageText, jid, current, afterHours);

  let geminiResult;
  try {
    geminiResult = await geminiService.obtenerRespuestaIA(jid, messageText, {
      client: getGeminiClient(), fallbackClients: getGeminiFallbackClients(), maxRetries: 1, messageParts: buffer.parts,
      profileName: buffer.context?.profileName ?? null,
      availableSlots: offeredSlots, afterHours, welcomed: Boolean(buffer.context?.welcomed),
      recommendation, botNotes: await getBotNotes(from), adReferral: await getAdReferral(from),
    });
  } catch (error) {
    console.error('[Gemini] Error al generar respuesta:', describeError(error));
    geminiResult = null;
  }
  if (!geminiResult || geminiResult.skipResponse || !geminiResult.texto) {
    await replyWithoutAI(from, messageText, offeredSlots, recommendation, current);
    return;
  }

  const { text: replyText, urlsToSend } = buildBotReply(geminiResult, messageText, recommendation);
  const leadResult = await saveLeadFromReply(from, messageText, geminiResult);
  const { text: appointmentText, appointmentOutcome } = await applyAppointmentRequest(from, jid, geminiResult, replyText, offeredSlots);
  let textoParaWhatsApp = appointmentText;
  if (textoParaWhatsApp && takeAfterHoursNotice(from, current)) {
    textoParaWhatsApp = `${afterHoursNotice()}\n\n${textoParaWhatsApp}`;
  }

  let sendResult;
  try {
    if (textoParaWhatsApp) sendResult = await whatsappService.sendTextMessage(from, textoParaWhatsApp);
  } catch (error) {
    console.error('webhookController: failed sending message to user', describeError(error));
    return;
  }
  // Primero se registra el texto ya enviado: si después falla una foto, la bandeja igual lo muestra.
  await recordBotReply(from, messageText, textoParaWhatsApp, urlsToSend[0] || null, sendResult);
  await sendRequestedPhotos(from, urlsToSend);
  // "¿Dónde quedan?" o solicitud registrada: mensaje de ubicación (si la clínica tiene coordenadas).
  if (wantsLocation(messageText) || appointmentOutcome?.status === 'saved') await sendClinicLocation(from);
  if (geminiResult.askReception) await alertReceptionQuestion(from, messageText);
  // Lead score de la bandeja (nunca lanza).
  void leadInsights.observe(from, {
    text: messageText, treatment: findTreatment(messageText)?.name || recommendation?.treatment?.name || null,
    recommendation: recommendation?.rule?.id || null, requested: appointmentOutcome?.status === 'saved', choseSlot: Boolean(alreadyChoosing),
  });
  // Si ya se avisó a recepción por la cita, no se duplica la alerta de lead.
  if (leadResult?.readyToNotify && leadResult.lead && appointmentOutcome?.status !== 'saved') {
    try { await notificationService.notifyAdminNewLead(leadResult.lead, { whatsappService, leadService }); }
    catch (error) { console.error('webhookController: error in admin notify flow', describeError(error)); }
  }
}

async function addMessageToBuffer(from, part, context) {
  const current = messageBuffers.get(from) || { parts: [], timer: null, lastActivity: 0, context };
  current.parts.push(part);
  current.lastActivity = Date.now();
  current.context = context;
  if (current.timer) clearTimeout(current.timer);
  // "Bot escribiendo…" en la bandeja mientras corre el debounce y se genera la respuesta.
  if (!context.botPaused) liveEvents.publish('typing', { phone: from, typing: true });
  current.timer = setTimeout(() => {
    messageBuffers.delete(from);
    current.timer = null;
    userProcessingQueue.enqueue(from, () => processBatch(from, current))
      .finally(() => liveEvents.publish('typing', { phone: from, typing: false }));
  }, BUFFER_WAIT_MS);
  messageBuffers.set(from, current);
}

// Espera a que termine todo lo pendiente de un paciente (recepción, debounce y respuesta).
// Lo usan scripts/simulate-conversations.js y los tests; el flujo normal no lo necesita.
export async function waitForIdle(from) {
  const id = String(from || '').replace(/\D/g, '');
  for (;;) {
    const pending = intakeQueue.pending(id) || (messageBuffers.has(id) ? new Promise((r) => setTimeout(r, 50)) : null)
      || userProcessingQueue.pending(id);
    if (!pending) return;
    await pending.catch(() => {});
  }
}

// Texto, respuesta a botón de plantilla ("Confirmo" / "Reprogramar") o pie de foto.
function incomingText(message) {
  if (message.type === 'text') return message.text?.body?.trim();
  if (message.type === 'button') return message.button?.text?.trim();
  if (message.type === 'interactive') return (message.interactive?.button_reply?.title || message.interactive?.list_reply?.title)?.trim();
  return message.image?.caption?.trim();
}

// "reset" (pruebas) o "borrar mis datos" (derecho de supresión, Ley 29733). true si se atendió.
async function handleResetCommand(from, message, text) {
  const wantsDataDeletion = DATA_DELETION.test(text || '');
  if (message.type !== 'text' || !(/^\/?(reset|reiniciar|borrar|clear)$/i.test(text || '') || wantsDataDeletion)) return false;
  const pending = messageBuffers.get(from);
  if (pending?.timer) clearTimeout(pending.timer);
  messageBuffers.delete(from);
  await hardResetUserSession(from);
  // Derecho de supresión (Ley 29733) anunciado en el aviso de privacidad de la bienvenida.
  if (wantsDataDeletion) {
    try {
      await whatsappService.sendTextMessage(from, DATA_DELETION_REPLY);
    } catch (error) {
      console.error('[WhatsApp] No se pudo confirmar la eliminación de datos:', describeError(error));
    }
  }
  return true;
}

// Bienvenida + aviso de privacidad en el primer contacto. Devuelve false si el mensaje ya quedó atendido.
async function greetFirstContact(from, message, text, context) {
  const unsupported = Boolean(UNSUPPORTED_REPLIES[message.type]);
  if (detectHandoff(text) === 'urgencia') {
    // Con dolor o sangrado no se manda la promo: la derivación sale primero, con el aviso de privacidad.
    context.firstContactUrgent = true;
    welcomeSentRecipients.set(from, true);
    return true;
  }
  // Un simple "hola" se queda con la bienvenida. Una pregunta ("¿cuánto cuestan los brackets?")
  // se responde de inmediato, sin obligar al paciente a repetirla.
  const onlyGreeting = !text || GREETING_ONLY.test(text);
  const continues = !onlyGreeting && !unsupported;
  try {
    await sendFirstContactWelcome(from, context, unsupported ? `[${message.type}]` : text, { persistPatient: !continues });
    void conversationMetrics.recordFirstContact({ phone: from, firstMessageAt: context.sentAt, respondedAt: clockNow() });
  } catch (error) {
    console.error('[WhatsApp] Error al enviar bienvenida inicial:', describeError(error));
  }
  if (!continues && !unsupported) return false;
  context.welcomed = true;
  return true;
}

// Cola de entrada del paciente: bandeja, primer contacto y debounce, en orden de llegada.
async function intakeMessage(from, message, value, context) {
  const text = incomingText(message);
  if (await handleResetCommand(from, message, text)) return;
  const firstContact = !(await hasPreviousConversation(from));
  // A la bandeja apenas llega (antes del debounce), con su foto, audio o documento si trae uno.
  const mediaType = MEDIA_TYPES.includes(message.type) ? message.type : null;
  await recordInbox({
    phone: from, sender: 'patient', text: text || null, type: mediaType || 'text',
    mediaId: mediaType ? message[mediaType]?.id || null : null, wamid: message.id || null,
    contactName: value?.contacts?.[0]?.profile?.name || null, at: context.sentAt,
  });
  context.botPaused = await handoffService.isPaused(from);
  if (firstContact && !(await greetFirstContact(from, message, text, context))) return;
  if (UNSUPPORTED_REPLIES[message.type]) {
    if (context.botPaused) return;
    await sendReply(from, `[${message.type}]`, UNSUPPORTED_REPLIES[message.type], '[WhatsApp] No se pudo responder a un mensaje no soportado:');
    return;
  }
  if (message.type === 'image') {
    try {
      const media = await downloadIncomingImage(message.image?.id);
      await addMessageToBuffer(from, { type: 'image', ...media, caption: message.image?.caption ?? null }, context);
    } catch (error) {
      console.error('webhookController: image download failed', describeError(error));
    }
  } else if (text) {
    await addMessageToBuffer(from, { type: 'text', content: text }, context);
  }
}

// Un mensaje del webhook: deduplicación, anuncio de origen y a la cola de entrada del paciente.
async function receiveMessage(message, value) {
  // Meta reintenta si el 200 llega tarde (Render despertando): cada message.id se procesa una sola vez.
  if (await messageDedup.seen(message?.id)) return;
  if (!message || message.from === 'status@broadcast' || message.type === 'system') return;
  const from = String(message.from || '').replace(/\D/g, '');
  if (!from) return;
  const referral = sanitizeReferral(message.referral);
  if (referral) {
    adReferrals.set(from, referral);
    void leadService.saveLeadAdReferral(from, referral)
      .catch((error) => console.error('[Leads] No se pudo guardar el anuncio de origen:', describeError(error)));
  }
  const receivedAt = clockNow();
  const sentAt = Number(message.timestamp) > 0 ? new Date(Number(message.timestamp) * 1000) : receivedAt;
  const context = {
    contactName: value?.contacts?.[0]?.profile?.name || from,
    // Nombre del perfil tal cual; geminiService lo usa solo si parece un nombre real.
    profileName: value?.contacts?.[0]?.profile?.name || null,
    phoneNumberId: value?.metadata?.phone_number_id || process.env.WHATSAPP_PHONE_NUMBER_ID || null,
    messageId: message.id || null,
    // Meta puede entregar tarde si Render estaba dormido: se mide desde la hora real del mensaje.
    sentAt: sentAt > receivedAt ? receivedAt : sentAt,
  };
  intakeQueue.enqueue(from, () => intakeMessage(from, message, value, context));
}

// Meta puede agrupar varios eventos en un mismo POST (varias entradas, cambios o mensajes):
// se devuelven todos, cada mensaje con su `value` (contactos y metadata del mismo cambio).
export function extractIncomingEvents(payload) {
  const messages = [];
  const statuses = [];
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  for (const entry of entries) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      const value = change?.value;
      if (Array.isArray(value?.statuses)) statuses.push(...value.statuses);
      if (Array.isArray(value?.messages)) messages.push(...value.messages.map((message) => ({ message, value })));
    }
  }
  return { messages, statuses };
}

// Buffering combines rapid text/image messages while the per-user queue prevents overlapping Gemini calls.
export default async function webhookController(req, res, next) {
  res.status(200).send('EVENT_RECEIVED');
  try {
    let payload = req.parsedBody || req.body;
    if (Buffer.isBuffer(payload)) payload = JSON.parse(payload.toString('utf8'));
    const { messages, statuses } = extractIncomingEvents(payload);
    // Estados de entrega (enviado, entregado, leído, fallido): se guardan y se ven en la bandeja.
    if (statuses.length > 0) {
      await inboxService.applyStatuses(statuses)
        .catch((error) => console.error('[Bandeja] No se pudo guardar el estado de entrega:', describeError(error)));
    }
    for (const { message, value } of messages) {
      try {
        await receiveMessage(message, value);
      } catch (error) {
        console.error('webhookController: background processing error', describeError(error));
      }
    }
  } catch (error) {
    console.error('webhookController: background processing error', describeError(error));
  }
}
