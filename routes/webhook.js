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
  try {
    const rawBody = req.body && Buffer.isBuffer(req.body) ? req.body.toString('utf8') : (req.body || '');
    let parsedBody = null;
    if (rawBody) {
      try {
        parsedBody = JSON.parse(rawBody);
      } catch (err) {
        parsedBody = rawBody;
      }
    }
    console.log('[WEBHOOK BODY]:', JSON.stringify(parsedBody ?? rawBody ?? {}, null, 2));
  } catch (e) {
    console.error('webhook route: failed to log body:', e && e.message ? e.message : e);
  }

  // Send immediate ACK to Meta to avoid retries/timeouts.
  res.sendStatus(200);

  // Continue processing in background without blocking the response.
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
