import express from 'express';
import rateLimiter from '../middleware/rateLimiter.js';
import config from '../config/env.js';
import { obtenerRespuestaIA } from '../src/gemini.js';
import whatsappService from '../services/whatsappService.js';

const router = express.Router();

router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const expected = config.whatsapp?.webhookVerifyToken || process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;

  if (mode === 'subscribe' && token === expected) {
    console.log('✅ Webhook verified');
    return res.status(200).send(challenge);
  }

  return res.status(403).send('Forbidden');
});

router.post('/', express.raw({ type: 'application/json' }), rateLimiter(), async (req, res) => {
  console.log('>>> [WEBHOOK ENTRANTE RECIBIDO RAW] <<<', JSON.stringify(req.body));

  if (req.headers && req.headers['x-hub-signature-256']) {
    console.warn('Skipping strict X-Hub-Signature-256 validation for webhook debugging.');
  }

  res.status(200).send('EVENT_RECEIVED');

  try {
    const parsedBody = (() => {
      if (!req.body) return {};
      if (Buffer.isBuffer(req.body)) {
        try {
          return JSON.parse(req.body.toString('utf8'));
        } catch (e) {
          return {};
        }
      }
      return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    })();

    console.log('[MENSAJE ENTRANTE RECIBIDO]:', JSON.stringify(parsedBody, null, 2));

    const entry = req.body?.entry?.[0] || parsedBody?.entry?.[0];
    const changes = entry?.changes?.[0];
    const message = changes?.value?.messages?.[0];

    if (!message || changes?.value?.statuses) {
      console.log('Ignoring status notification or empty message payload.');
      return;
    }

    const from = String(message?.from || '').replace(/\D/g, '');
    const text = message?.text?.body || message?.button?.text || message?.interactive?.button_reply?.title || '';

    if (!from || !text) {
      console.warn('Missing required message.from or message.text.body in incoming webhook.');
      return;
    }

    const remoteJid = `${from}@s.whatsapp.net`;
    const { texto } = await obtenerRespuestaIA(remoteJid, text);
    await whatsappService.sendWhatsAppMessage(from, texto || 'Gracias por tu mensaje.');
  } catch (err) {
    console.error('[ERROR_PROCESAMIENTO_WEBHOOK]:', err);
  }
});

export default router;
