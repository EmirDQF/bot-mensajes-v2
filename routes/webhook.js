import express from 'express';
import rateLimiter from '../middleware/rateLimiter.js';
import makeVerifySignature from '../middleware/verifySignature.js';
import webhookController from '../controllers/webhookController.js';
import config from '../config/env.js';

const router = express.Router();

// GET /webhook for challenge verification
router.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const expected = config.whatsapp?.webhookVerifyToken || process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || process.env.WEBHOOK_VERIFY_TOKEN;
  if (mode === 'subscribe' && token === expected) {
    console.log('✅ Webhook verified');
    return res.status(200).send(String(challenge || ''));
  }
  return res.status(403).send('Forbidden');
});

// POST /webhook: respond 200 immediately, then process asynchronously.
router.post('/webhook', express.raw({ type: 'application/json' }), makeVerifySignature(), rateLimiter(), async (req, res, next) => {
  try {
    const value = req.parsedBody?.entry?.[0]?.changes?.[0]?.value;
    const messages = Array.isArray(value?.messages) ? value.messages : [];
    if (!messages.length) {
      return res.sendStatus(200);
    }
    const message = messages[0];
    if (!message || message.from === 'status@broadcast' || message.type === 'system') {
      return res.sendStatus(200);
    }
    res.sendStatus(200);
  } catch (e) {
    console.error('webhook route: failed to send immediate 200:', e && e.message ? e.message : e);
  }

  const safeRes = {
    headersSent: true,
    status() { return this; },
    json() { return this; },
    send() { return this; },
    setHeader() {},
    getHeader() { return undefined; },
    end() { return this; }
  };

  (async () => {
    try {
      await webhookController(req, safeRes, next);
    } catch (err) {
      console.error('webhook route: background processing error', err && err.message ? err.message : err);
    }
  })();
});

export default router;
