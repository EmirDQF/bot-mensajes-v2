import crypto from 'crypto';
import config from '../config/env.js';

export default function verifySignature(options = {}) {
  const appSecret = config.whatsapp?.appSecret || process.env.WHATSAPP_APP_SECRET || null;
  const enforce = String(process.env.ENFORCE_WHATSAPP_SIGNATURE || 'false').toLowerCase() === 'true';

  return async (req, res, next) => {
    try {
      const rawBody = req.body instanceof Buffer ? req.body : (typeof req.body === 'string' ? Buffer.from(req.body, 'utf8') : Buffer.from(JSON.stringify(req.body || {})));

      // If enforcement is disabled, accept and attach parsedBody without rejecting
      if (!enforce) {
        try { req.parsedBody = JSON.parse(rawBody.toString('utf8')); } catch (e) { req.parsedBody = null; }
        if (!appSecret) console.warn('verifySignature: skipping signature enforcement (ENFORCE_WHATSAPP_SIGNATURE not set)');
        return next();
      }

      // From here, enforcement is required
      // Extract and normalize header value
      const header = (req.headers && (req.headers['x-hub-signature-256'] || req.headers['x-hub-signature'])) || req.get && (req.get('x-hub-signature-256') || req.get('x-hub-signature')) || null;
      const headerVal = header ? String(header).trim() : null;

      if (!appSecret) {
        console.error('verifySignature: WHATSAPP_APP_SECRET not set but signature enforcement is enabled');
        return res.status(500).json({ error: 'Server misconfiguration' });
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

      // Cuerpo firmado y válido: se parsea una sola vez para el controlador.
      let parsed = null;
      try {
        parsed = JSON.parse(rawBody.toString('utf8'));
      } catch (e) {
        // invalid JSON
        console.warn('verifySignature: invalid JSON payload');
        return res.sendStatus(400);
      }

      // La deduplicación por message.id la hace services/messageDedup.js (memoria + tabla webhook_events).
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
