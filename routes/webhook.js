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
  const expected = config.whatsapp?.webhookVerifyToken || process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  if (mode === 'subscribe' && token === expected) {
    console.log('✅ Webhook verified');
    return res.status(200).send(challenge);
  }
  return res.status(403).send('Forbidden');
});

// POST /webhook: Respond 200 immediately to Meta, then process asynchronously.
router.post('/webhook', express.raw({ type: 'application/json' }), rateLimiter(), async (req, res, next) => {
  // Send immediate ACK to Meta to avoid retries/timeouts
  try {
    return res.sendStatus(200);
  } catch (e) {
    console.error('webhook route: failed to send immediate 200:', e && e.message ? e.message : e);
  }

  // Continue processing in background without blocking the response.
  // Use a safe mock response object so background processing cannot send headers after ACK.
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
      // Pass safeRes so the controller's attempts to write headers are no-ops.
      await webhookController(req, safeRes, next);
    } catch (err) {
      console.error('webhook route: background processing error', err && err.message ? err.message : err);
    }
  })();
});

export default router;
