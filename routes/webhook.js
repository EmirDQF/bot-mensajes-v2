import express from 'express';
import rateLimiter from '../middleware/rateLimiter.js';
import config from '../config/env.js';
import { obtenerRespuestaIA } from '../src/gemini.js';
import { sendWhatsAppMessageOrImage } from '../services/whatsappService.js';
import { appendChatAuditEntry } from '../src/chatAudit.js';

const IMAGE_TAG_RE = /\[(?:ENVIAR_IMAGEN|SEND_IMAGE)\s*:\s*([^\]]+)\]/gi;
function extractImageTags(text) {
  if (!text || typeof text !== 'string') return [];
  const matches = [...text.matchAll(IMAGE_TAG_RE)];
  return matches
    .map((match) => String(match[1] || '').trim())
    .filter(Boolean)
    .filter((value, index, arr) => arr.indexOf(value) === index);
}
function stripImageTags(text) {
  if (!text || typeof text !== 'string') return '';
  return text.replace(IMAGE_TAG_RE, '').replace(/\s{2,}/g, ' ').trim();
}

const router = express.Router();

router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const expected = config.whatsapp?.webhookVerifyToken || process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || process.env.VERIFY_TOKEN;

  if (mode === 'subscribe' && token === expected) {
    console.log('✅ Webhook verified');
    return res.status(200).send(challenge);
  }

  return res.status(403).send('Forbidden');
});

router.post('/', rateLimiter(), async (req, res) => {
  console.log('>>> [WEBHOOK ENTRANTE RECIBIDO] <<<', JSON.stringify(req.body || {}, null, 2));

  if (req.headers && req.headers['x-hub-signature-256']) {
    console.warn('Skipping strict X-Hub-Signature-256 validation for webhook debugging.');
  }

  try {
    const body = req.body || {};
    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const message = value?.messages?.[0];

    if (!message || value?.statuses) {
      console.log('Ignoring status notification or empty message payload.');
      return res.sendStatus(200);
    }

    const from = String(message?.from || '').replace(/\D/g, '');
    const phoneNumberId = String(value?.metadata?.phone_number_id || process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.PHONE_NUMBER_ID || '').trim();
    const msgId = message?.id || 'unknown';
    const text = message?.text?.body || message?.button?.text || message?.interactive?.button_reply?.title || '';
    const contactName = value?.contacts?.[0]?.profile?.name || value?.contacts?.[0]?.name || 'Paciente';
    const imageAttachment = message?.type === 'image'
      ? (message?.image?.filename || message?.image?.name || message?.image?.caption || null)
      : null;

    console.log('[WEBHOOK MESSAGE] from=', from, 'phone_number_id=', phoneNumberId, 'id=', msgId, 'text=', text);

    if (!from || !text || !phoneNumberId) {
      console.warn('Missing required webhook fields: from, text, or phone_number_id.');
      return res.sendStatus(200);
    }

    res.sendStatus(200);

    const remoteJid = `${from}@s.whatsapp.net`;
    const { texto } = await obtenerRespuestaIA(remoteJid, text);
    const replyText = texto || 'Gracias por tu mensaje.';
    const imageNames = extractImageTags(replyText);
    const cleanedText = stripImageTags(replyText);

    try {
      appendChatAuditEntry({
        name: contactName || 'Paciente',
        phone: from,
        userMessage: text,
        botReply: cleanedText || replyText,
        timestamp: new Intl.DateTimeFormat('es-PE', { hour: '2-digit', minute: '2-digit' }).format(new Date()),
        imageAttachment: imageNames.length ? imageNames.join(', ') : (imageAttachment || null),
      });
    } catch (auditErr) {
      console.warn('[AUDIT LOG] Falló la auditoría del webhook:', auditErr?.message || auditErr);
    }

    try {
      // Delegate to unified sender which handles images or text based on the AI reply content
      await sendWhatsAppMessageOrImage(phoneNumberId, from, replyText);
    } catch (sendErr) {
      console.error('[META OUTBOUND EXCEPTION]', {
        message: sendErr?.message || String(sendErr),
        stack: sendErr?.stack,
        to: from,
        phone_number_id: phoneNumberId,
      });
    }
  } catch (err) {
    console.error('[ERROR_PROCESAMIENTO_WEBHOOK]:', err);
    try {
      return res.sendStatus(200);
    } catch (e) {
      // no-op: response may already be committed
    }
  }
});

export default router;
