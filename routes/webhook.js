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
  if (req.headers && req.headers['x-hub-signature-256']) {
    console.warn('Skipping strict X-Hub-Signature-256 validation for webhook debugging.');
  }

  let parsedBody = null;
  try {
    if (Buffer.isBuffer(req.body)) {
      parsedBody = JSON.parse(req.body.toString('utf8'));
    } else if (req.body) {
      parsedBody = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    }
  } catch (e) {
    parsedBody = req.body;
  }

  console.log('[MENSAJE ENTRANTE RECIBIDO]:', JSON.stringify(parsedBody ?? req.body ?? {}, null, 2));
  res.status(200).send('EVENT_RECEIVED');

  try {
    const message = parsedBody?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!message) {
      console.warn('No WhatsApp message payload found in webhook body.');
      return;
    }

    const from = String(message.from || '').replace(/\D/g, '');
    const text = message.text?.body || message.button?.text || message.interactive?.button_reply?.title || '';
    if (!from || !text) {
      console.warn('Incoming WhatsApp message missing sender or text body.');
      return;
    }

    const remoteJid = `${from}@s.whatsapp.net`;
    const { texto } = await obtenerRespuestaIA(remoteJid, text);
    await whatsappService.sendWhatsAppMessage(from, texto || 'Gracias por tu mensaje.');
    console.log(`Respuesta enviada a ${from}: ${texto}`);
  } catch (error) {
    console.error('webhook route: background processing error', error && error.message ? error.message : error);
  }
});

export default router;
