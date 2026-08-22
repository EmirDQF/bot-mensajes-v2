import express from 'express';
import rateLimiter from '../middleware/rateLimiter.js';
import config from '../config/env.js';
import { obtenerRespuestaIA } from '../src/gemini.js';
import whatsappService from '../services/whatsappService.js';

const router = express.Router();

const IMAGE_TAG_RE = /\[(?:ENVIAR_IMAGEN|SEND_IMAGE)\s*:\s*([^\]]+)\]/i;

function extractImageTag(text) {
  if (!text || typeof text !== 'string') return null;
  const match = text.match(IMAGE_TAG_RE);
  return match && match[1] ? match[1].trim() : null;
}

function stripImageTag(text) {
  if (!text || typeof text !== 'string') return '';
  return text.replace(IMAGE_TAG_RE, '').replace(/\s{2,}/g, ' ').trim();
}

function buildImageUrl(filename) {
  const baseUrl = (process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_BASE_URL || 'https://bot-mensajes-dental.onrender.com').replace(/\/$/, '');
  return `${baseUrl}/images/${encodeURIComponent(filename)}`;
}

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

    console.log('[WEBHOOK MESSAGE] from=', from, 'phone_number_id=', phoneNumberId, 'id=', msgId, 'text=', text);

    if (!from || !text || !phoneNumberId) {
      console.warn('Missing required webhook fields: from, text, or phone_number_id.');
      return res.sendStatus(200);
    }

    res.sendStatus(200);

    const remoteJid = `${from}@s.whatsapp.net`;
    const { texto } = await obtenerRespuestaIA(remoteJid, text);
    const replyText = texto || 'Gracias por tu mensaje.';
    const imageName = extractImageTag(replyText);
    const cleanedText = stripImageTag(replyText);

    try {
      const payload = imageName
        ? {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: from,
            type: 'image',
            image: {
              link: buildImageUrl(imageName),
              caption: cleanedText || 'Aquí tienes la imagen que pediste.',
            },
          }
        : {
            messaging_product: 'whatsapp',
            to: from,
            type: 'text',
            text: { body: cleanedText || replyText },
          };

      const apiRes = await fetch(`https://graph.facebook.com/v20.0/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN || config.whatsapp?.token || ''}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const responseText = await apiRes.text();
      console.log('[META OUTBOUND RESPONSE]', apiRes.status, responseText);

      if (!apiRes.ok) {
        console.error('[META OUTBOUND ERROR]', {
          status: apiRes.status,
          phone_number_id: phoneNumberId,
          to: from,
          body: responseText,
          payload,
        });
      }
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
