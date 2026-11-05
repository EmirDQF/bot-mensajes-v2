import activeClinic, { getReceptionPhone } from '../config/clinic.config.js';
import whatsappService from './whatsappService.js';
import { recommendationSentence } from './recommendationService.js';
import { createExpiringMap } from './expiringMap.js';
import { describeError } from './safeLog.js';

// Respaldo cuando Gemini falla (cuota agotada, caída o clave inválida): el paciente no se queda sin
// respuesta (recibe los horarios ofrecidos o un aviso) y recepción recibe una alerta.

const NUMBER_EMOJI = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'];
const numberChoices = (n) => (n <= 1 ? '1' : `${Array.from({ length: n - 1 }, (_, i) => i + 1).join(', ')} o ${n}`);

// Los horarios van escritos (para quien no ve botones) y además como botones o lista (services/slotButtons.js).
export function formatSlotList(slots) {
  if (!slots?.length) return '';
  const lines = slots.map((slot, i) => `${NUMBER_EMOJI[i] || `${i + 1})`} ${slot.label}`);
  return `\n\n📅 Horarios disponibles:\n${lines.join('\n')}\n\nToca el horario que prefieras 👇 o responde ${numberChoices(slots.length)}.`;
}

export function aiFallbackReply(offeredSlots, recommendation = null) {
  if (recommendation) return `${recommendationSentence(recommendation)}${formatSlotList(offeredSlots) || ' Recepción te escribirá para coordinar tu evaluación.'}`;
  return offeredSlots?.length
    ? `¡Gracias por escribirnos! 😊 Te comparto los horarios más cercanos para tu evaluación:${formatSlotList(offeredSlots)}`
    : '¡Gracias por escribirnos! 🙏 Tuve un inconveniente para responderte en este momento; ya avisé al equipo de la clínica para que te escriba por aquí.';
}

// Máximo una alerta por paciente por hora (si Gemini sigue caído, recepción no recibe una por mensaje).
export const FALLBACK_ALERT_MS = 60 * 60 * 1000;
const MAX_QUOTED_CHARS = 300;

// Alerta a recepción por paciente, como máximo una por hora (si se repite, recepción no recibe una por mensaje).
function createReceptionAlert({
  title, hint, logTag, whatsapp = whatsappService, getPhone = getReceptionPhone, clinic = activeClinic, now = () => Date.now(),
}) {
  const alertedAt = createExpiringMap({ ttlMs: FALLBACK_ALERT_MS, now });

  // Devuelve true si se envió la alerta. Nunca lanza.
  return async function alertReception(from, messageText) {
    const to = getPhone();
    if (!to || alertedAt.has(from)) return false;
    alertedAt.set(from, now());
    const text = [
      `⚠️ ${title} (${clinic.name})`,
      `📱 +${from} (wa.me/${from})`,
      `💬 "${String(messageText || '').slice(0, MAX_QUOTED_CHARS)}"`,
      '',
      hint,
    ].join('\n');
    try {
      await whatsapp.sendTextMessage(to, text);
      return true;
    } catch (error) {
      console.error(`${logTag} No se pudo avisar a recepción:`, describeError(error));
      return false;
    }
  };
}

export function createNoAiAlert(options = {}) {
  return createReceptionAlert({
    title: 'El asistente no pudo responder con IA',
    hint: 'Escríbele al paciente. Si se repite, revisa GEMINI_API_KEY y la cuota de Gemini (npm run preflight).',
    logTag: '[Gemini]',
    ...options,
  });
}

// La asistente no tenía el dato (no inventa): recepción responde la pregunta del paciente.
export function createReceptionQuestionAlert(options = {}) {
  return createReceptionAlert({
    title: 'Pregunta que la asistente no pudo responder',
    hint: 'Respóndele al paciente por este chat. Si es una pregunta frecuente, agrégala a las preguntas frecuentes en el panel.',
    logTag: '[Recepción]',
    ...options,
  });
}
