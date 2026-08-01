import crypto from 'crypto';
import config from '../config/env.js';

// Map to track processed message IDs with expiry timestamp
const processedIds = new Map();
const DEFAULT_TTL_MS = Number(process.env.WHATSAPP_MESSAGE_DEDUP_TTL_MS || 5 * 60 * 1000); // 5 minutes
const CLEANUP_INTERVAL_MS = Number(process.env.WHATSAPP_DEDUP_CLEANUP_MS || 60 * 1000);

function cleanupProcessedIds() {
  const now = Date.now();
  for (const [id, exp] of processedIds) {
    if (exp <= now) processedIds.delete(id);
  }
}

const cleanupInterval = setInterval(cleanupProcessedIds, CLEANUP_INTERVAL_MS);
cleanupInterval.unref && cleanupInterval.unref();

export default function verifySignature(options = {}) {
  const appSecret = config.whatsapp?.appSecret || process.env.WHATSAPP_APP_SECRET || null;

  return async (req, res, next) => {
    try {
      const rawBody = req.body instanceof Buffer ? req.body : (typeof req.body === 'string' ? Buffer.from(req.body, 'utf8') : Buffer.from(JSON.stringify(req.body || {})));

      // Extract and normalize header value
      const header = (req.headers && (req.headers['x-hub-signature-256'] || req.headers['x-hub-signature'])) || req.get && (req.get('x-hub-signature-256') || req.get('x-hub-signature')) || null;
      const headerVal = header ? String(header).trim() : null;

          if (!appSecret) {
            const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
            const msg = 'verifySignature: WHATSAPP_APP_SECRET not set';
            if (isProd) {
              console.error(msg + ' and running in production — rejecting request');
              return res.status(500).json({ error: 'Server misconfiguration' });
            }
            console.warn(msg + '; webhook will accept requests without signature verification (dev mode).');
            // Still attach parsed body for downstream handlers
            try { req.parsedBody = JSON.parse(rawBody.toString('utf8')); } catch (e) { req.parsedBody = null; }
            return next();
          }

      if (!headerVal) {
        console.warn('verifySignature: missing x-hub-signature-256 header');
        return res.status(403).json({ error: 'Forbidden' });
      }

      // Header might be 'sha256=hex' or just hex, may contain spaces — extract the hex portion
      const hex = headerVal.includes('=') ? headerVal.split('=')[1] : headerVal;
      const sigHex = String(hex).trim().replace(/[^0-9a-fA-F]/g, '');
      if (!sigHex || sigHex.length % 2 !== 0) {
        console.warn('verifySignature: invalid signature header format');
        return res.status(403).json({ error: 'Forbidden' });
      }

      const sigBuf = Buffer.from(sigHex, 'hex');
      const expected = crypto.createHmac('sha256', appSecret).update(rawBody).digest();

      // Protect against timing attacks with timingSafeEqual — lengths must match
      let valid = false;
      if (sigBuf.length === expected.length) {
        try {
          valid = crypto.timingSafeEqual(sigBuf, expected);
        } catch (e) {
          valid = false;
        }
      }

      if (!valid) {
        console.warn('verifySignature: signature mismatch');
        return res.status(403).json({ error: 'Forbidden' });
      }

      // Parse body and deduplicate by message.id
      let parsed = null;
      try {
        parsed = JSON.parse(rawBody.toString('utf8'));
      } catch (e) {
        // invalid JSON
        console.warn('verifySignature: invalid JSON payload');
        return res.sendStatus(400);
      }

      // Extract message.id from known Cloud API shapes
      const messageId = parsed?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.id
        || parsed?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.message?.id
        || parsed?.messages?.[0]?.id
        || parsed?.id
        || null;

      if (messageId) {
        const existing = processedIds.get(messageId);
        if (existing && existing > Date.now()) {
          // Already processed recently -> respond 200 and do not call next (idempotent)
          console.log('verifySignature: duplicate message ignored', messageId);
          return res.sendStatus(200);
        }

        // register id with expiry
        processedIds.set(messageId, Date.now() + DEFAULT_TTL_MS);
      }

      // attach parsed body for downstream consumers to avoid reparsing
      req.parsedBody = parsed;
      return next();
    } catch (e) {
      console.error('verifySignature: unexpected error', e && e.message ? e.message : e);
      // Fail closed for security
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  };
}
