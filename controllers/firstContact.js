import activeClinic, { mediaUrl } from '../config/clinic.config.js';
import whatsappService from '../services/whatsappService.js';
import { getSupabase } from '../services/supabaseClient.js';
import { isWithinWorkingHours } from '../services/appointmentService.js';
import { detectHandoff } from '../services/handoffService.js';
import conversationMetrics from '../services/conversationMetrics.js';
import { adWelcomeCaption } from '../services/adContext.js';
import { now as clockNow } from '../services/clock.js';
import { createExpiringMap } from '../services/expiringMap.js';
import { describeError } from '../services/safeLog.js';
import { looksLikeRealName } from '../services/leadFields.js';
import {
  adReferrals, chatSessionHistoryCache, digitsOf, persistToChatSessions, recordInbox,
} from './conversationStore.js';

// Primer contacto: bienvenida + aviso de privacidad (Ley 29733) y, de noche, el aviso de clínica cerrada.

const DAY_MS = 24 * 60 * 60 * 1000;
const welcomeSentRecipients = createExpiringMap({ ttlMs: DAY_MS });

export function forgetWelcome(phone) {
  const rawDigits = digitsOf(phone);
  welcomeSentRecipients.delete(rawDigits);
  welcomeSentRecipients.delete(rawDigits.length >= 9 ? rawDigits.slice(-9) : rawDigits);
}

// Solo un saludo: basta la bienvenida. Cualquier otra cosa en el primer mensaje se responde de inmediato.
export const GREETING_ONLY = /^[\s¡!¿?.,]*(?:(?:hola+|holi|ola|buenas|buen[oa]s?\s+(?:noches|tardes|d[ií]as)|buen\s+d[ií]a|hi|hello|info|informaci[oó]n)[\s!?.,😊👋🙂]*)+$/iu;

export const UNSUPPORTED_REPLIES = {
  audio: 'Disculpa 🙏 todavía no puedo escuchar audios. ¿Me lo escribes en un mensaje? Así te ayudo al toque con precios, fotos u horarios.',
  video: 'Gracias por el video 🙏 por ahora no puedo verlo. ¿Me cuentas por escrito qué necesitas?',
  document: 'Gracias 🙏 por aquí no puedo abrir archivos. ¿Me cuentas por escrito qué necesitas? Si es para tu evaluación, tráelo el día de tu cita.',
  sticker: '😊 ¿En qué te ayudo? Puedo contarte precios, enviarte fotos de tratamientos o proponerte horarios para tu evaluación.',
};

// Audio de más de 2 minutos (con la transcripción activada): se pide que lo escriba.
export const AUDIO_TOO_LONG_REPLY = 'Tu audio es un poquito largo para mí 🙏 (más de 2 minutos). ¿Me escribes en un mensaje lo que necesitas? Así te ayudo al toque.';

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
// Con un nombre de perfil de WhatsApp que parece real, "¡Hola!" pasa a "¡Hola, Carlos!" (como en el video).
export function personalize(welcome, profileName) {
  const first = looksLikeRealName(profileName) ? String(profileName).trim().split(/\s+/)[0] : '';
  return first ? String(welcome).replace(/^¡Hola!/, `¡Hola, ${first}!`) : welcome;
}

export function buildWelcomeCaption({ afterHours = false, adReferral = null, profileName = null } = {}) {
  const welcome = personalize(adWelcomeCaption(activeClinic, adReferral) || activeClinic.welcomeCaption, profileName);
  return [welcome, afterHours ? afterHoursNotice() : null, activeClinic.privacyNotice].filter(Boolean).join('\n\n');
}

export async function hasPreviousConversation(senderPhone) {
  const sessionId = digitsOf(senderPhone);
  if (!sessionId) return true;
  if (welcomeSentRecipients.has(sessionId)) return true;
  const cached = chatSessionHistoryCache.get(sessionId);
  if (Array.isArray(cached) && cached.length > 0) return true;

  const client = await getSupabase();
  if (!client) return true;
  try {
    const { data: session, error: sessionError } = await client
      .from('chat_sessions').select('id, history').eq('id', sessionId).maybeSingle();
    if (sessionError) throw sessionError;
    if (Array.isArray(session?.history) && session.history.length > 0) return true;

    const { data: message, error: messageError } = await client
      .from('messages').select('id').eq('phone', sessionId).limit(1).maybeSingle();
    if (messageError) throw messageError;
    return Boolean(message);
  } catch (error) {
    console.error('[Supabase] No se pudo comprobar el primer contacto; se omite bienvenida:', describeError(error));
    return true;
  }
}

async function sendFirstContactWelcome(senderPhone, messageText, { persistPatient = true, profileName = null } = {}) {
  const imageUrl = mediaUrl('logo');
  const caption = buildWelcomeCaption({ afterHours: takeAfterHoursNotice(senderPhone), adReferral: adReferrals.get(senderPhone) || null, profileName });
  const result = await whatsappService.sendImageMessage(senderPhone, imageUrl, caption);
  welcomeSentRecipients.set(digitsOf(senderPhone), true);
  const timestamp = new Date().toISOString();
  // El mensaje del paciente ya quedó en la bandeja al llegar; aquí solo se guarda la bienvenida.
  await recordInbox({
    phone: senderPhone, sender: 'bot', text: caption, type: 'image', mediaUrl: imageUrl,
    wamid: result?.messages?.[0]?.id || null,
  });
  if (persistPatient) {
    await persistToChatSessions(senderPhone, { from: 'patient', text: messageText || '[Imagen]', phone: senderPhone, timestamp });
  }
  await persistToChatSessions(senderPhone, { from: 'bot', text: caption, phone: senderPhone, timestamp });
}

// Bienvenida + aviso de privacidad en el primer contacto. Devuelve false si el mensaje ya quedó atendido.
export async function greetFirstContact(from, message, text, context) {
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
    await sendFirstContactWelcome(from, unsupported ? `[${message.type}]` : text, { persistPatient: !continues, profileName: context?.profileName ?? null });
    void conversationMetrics.recordFirstContact({ phone: from, firstMessageAt: context.sentAt, respondedAt: clockNow() });
  } catch (error) {
    console.error('[WhatsApp] Error al enviar bienvenida inicial:', describeError(error));
  }
  if (!continues && !unsupported) return false;
  context.welcomed = true;
  return true;
}
