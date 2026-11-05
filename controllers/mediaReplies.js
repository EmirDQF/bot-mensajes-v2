import activeClinic from '../config/clinic.config.js';
import whatsappService from '../services/whatsappService.js';
import { claimMediaSend, completeMediaSend, hasMediaBeenSent, markMediaAsSent } from '../services/mediaTrackingService.js';
import { evaluationPackText } from '../services/catalog.js';
import { packCardUrl } from '../services/cards/packCard.js';
import { describeError } from '../services/safeLog.js';
import { createExpiringMap } from '../services/expiringMap.js';
import { recordInbox, recordBotReply } from './conversationStore.js';

// Imágenes que envía la asistente: catálogo por tratamiento, fotos pedidas y tarjeta del pack de evaluación.
// Cada imagen se envía una sola vez por paciente (whatsapp_media_sends) y en secuencia, para que lleguen en orden.

const PHOTO_GAP_MS = 300;
const PACK_KEY = 'evaluation-pack';
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Respaldo en memoria (7 días): si la tabla whatsapp_media_sends falla o no existe, igual no se repiten imágenes.
const sentInMemory = createExpiringMap({ ttlMs: 7 * 24 * 60 * 60 * 1000 });
const sentKeys = (from) => sentInMemory.get(from) || new Set();
const rememberSent = (from, imageKey) => sentInMemory.set(from, new Set([...sentKeys(from), imageKey]));

// "borrar mis datos" / reset: también se olvida lo enviado en memoria.
export function forgetSentMedia(phone) {
  sentInMemory.delete(String(phone || '').replace(/\D/g, ''));
}

// Reserva el envío; si la consulta falla se envía igual (mejor repetir una foto que no mandarla).
async function claim(from, imageKey) {
  if (sentKeys(from).has(imageKey)) return { claimed: false, id: null };
  try {
    if (await hasMediaBeenSent(from, imageKey)) return { claimed: false, id: null };
    return await claimMediaSend({ recipient: from, imageKey });
  } catch (error) {
    console.error('[Media] Error al consultar deduplicación; se enviará la imagen:', describeError(error));
    return { claimed: true, id: null };
  }
}

async function finish(from, imageKey, claimId, failure = null) {
  if (!failure) rememberSent(from, imageKey);
  try {
    if (claimId) await completeMediaSend(claimId, failure ? 'failed' : 'sent', failure ? failure?.message || String(failure) : null);
    if (!failure) await markMediaAsSent(from, imageKey);
  } catch (error) {
    console.error('[Media] Error al registrar el envío:', describeError(error));
  }
}

// items: [{ url, caption, key? }]. Nunca lanza: si una imagen falla, no se insiste con las siguientes.
// Devuelve cuántas se enviaron.
export async function sendImages(from, items) {
  let sent = 0;
  for (const item of items) {
    const imageKey = item.key || item.url;
    const reservation = await claim(from, imageKey);
    if (!reservation.claimed) continue;
    try {
      const caption = item.caption || `${activeClinic.name} 🦷`;
      const result = await whatsappService.sendImageMessage(from, item.url, caption);
      void recordInbox({ phone: from, sender: 'bot', type: 'image', text: caption, mediaUrl: item.url, wamid: result?.messages?.[0]?.id || null });
    } catch (error) {
      console.error('webhookController: failed sending photo to user', describeError(error));
      await finish(from, imageKey, reservation.id, error);
      return sent;
    }
    await finish(from, imageKey, reservation.id);
    sent += 1;
    await wait(PHOTO_GAP_MS);
  }
  return sent;
}

// Tarjeta del pack de evaluación: imagen generada + texto con los datos de la configuración, una vez por
// paciente. Sin pack configurado no envía nada. Devuelve true si se envió.
// caption: pie corto cuando el detalle del pack va en el mensaje siguiente (firstVisitReply).
export async function sendEvaluationPack(from, messageText, today, { caption = null } = {}) {
  const fullText = evaluationPackText(activeClinic, today);
  if (!fullText) return false;
  const text = caption || fullText;
  const reservation = await claim(from, PACK_KEY);
  if (!reservation.claimed) return false;
  try {
    const url = packCardUrl(activeClinic, today);
    const result = url
      ? await whatsappService.sendImageMessage(from, url, text)
      : await whatsappService.sendTextMessage(from, text);
    if (url) void recordInbox({ phone: from, sender: 'bot', type: 'image', text, mediaUrl: url, wamid: result?.messages?.[0]?.id || null });
    else await recordBotReply(from, messageText, text, result);
  } catch (error) {
    console.error('[Media] No se pudo enviar la tarjeta del pack:', describeError(error));
    await finish(from, PACK_KEY, reservation.id, error);
    return false;
  }
  await finish(from, PACK_KEY, reservation.id);
  await wait(PHOTO_GAP_MS);
  return true;
}

export default { sendImages, sendEvaluationPack };
