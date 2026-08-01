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

// POST /webhook: raw body -> rateLimiter -> verifySignature -> controller
router.post('/webhook', express.raw({ type: 'application/json' }),
  rateLimiter(),
  makeVerifySignature(),
  async (req, res, next) => {
    // webhookController expects (req,res,next) and returns a response
    try {
      await webhookController(req, res, next);
    } catch (e) {
      next(e);
    }
  }
);

export default router;
