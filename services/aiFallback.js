import activeClinic, { getReceptionPhone } from '../config/clinic.config.js';
import whatsappService from './whatsappService.js';
import { recommendationSentence } from './recommendationService.js';
import { createExpiringMap } from './expiringMap.js';
import { describeError } from './safeLog.js';

// Respaldo cuando Gemini falla (cuota agotada, caída o clave inválida): el paciente no se queda sin
// respuesta (recibe los horarios ofrecidos o un aviso) y recepción recibe una alerta.

const NUMBER_EMOJI = ['1️⃣', '2️⃣', '3️⃣'];
export function formatSlotList(slots) {
  if (!slots?.length) return '';
  const lines = slots.map((slot, i) => `${NUMBER_EMOJI[i] || `${i + 1})`} ${slot.label}`);
  return `\n\n📅 Horarios disponibles:\n${lines.join('\n')}\n\nResponde 1, 2 o 3 👆`;
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

export function createNoAiAlert({
  whatsapp = whatsappService, getPhone = getReceptionPhone, clinic = activeClinic, now = () => Date.now(),
} = {}) {
  const alertedAt = createExpiringMap({ ttlMs: FALLBACK_ALERT_MS, now });

  // Devuelve true si se envió la alerta. Nunca lanza.
  return async function alertReceptionNoAI(from, messageText) {
    const to = getPhone();
    if (!to || alertedAt.has(from)) return false;
    alertedAt.set(from, now());
    const text = [
      `⚠️ El asistente no pudo responder con IA (${clinic.name})`,
      `📱 +${from} (wa.me/${from})`,
      `💬 "${String(messageText || '').slice(0, MAX_QUOTED_CHARS)}"`,
      '',
      'Escríbele al paciente. Si se repite, revisa GEMINI_API_KEY y la cuota de Gemini (npm run preflight).',
    ].join('\n');
    try {
      await whatsapp.sendTextMessage(to, text);
      return true;
    } catch (error) {
      console.error('[Gemini] No se pudo avisar a recepción de la falla:', describeError(error));
      return false;
    }
  };
}
