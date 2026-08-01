// In-memory rate limiter (mono-instancia).
// Limit is applied per-phone (normalized digits) when available, falling back to IP address.
// This implementation is intended for single-process deployments. For multi-instance/clustered
// deployments use a centralized store (Redis) to share counters.

const DEFAULT_MAX = Number(process.env.RATE_LIMIT_MAX || 20);
const DEFAULT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000); // 1 minute
const DEFAULT_CLEANUP_MS = Number(process.env.RATE_LIMIT_CLEANUP_MS || 60_000);

// Map<string, number[]> -> key (phone or ip) -> array of timestamps (ms)
const buckets = new Map();

function nowMs() {
  return Date.now();
}

function extractPhoneFromRawBody(rawBody) {
  if (!rawBody) return null;
  try {
    const txt = rawBody instanceof Buffer ? rawBody.toString('utf8') : (typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody));
    const parsed = JSON.parse(txt);
    // Follow Meta Cloud API shape: entry[0].changes[0].value.messages[0].from
    const msgFrom = parsed?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from
      || parsed?.entry?.[0]?.changes?.[0]?.value?.contacts?.[0]?.wa_id
      || parsed?.messages?.[0]?.from
      || parsed?.from
      || null;
    if (!msgFrom) return null;
    const digits = String(msgFrom).replace(/\D/g, '');
    if (!digits) return null;
    return digits;
  } catch (e) {
    // not JSON or unexpected shape
    return null;
  }
}

function cleanupBuckets(windowMs = DEFAULT_WINDOW_MS) {
  const cutoff = nowMs() - windowMs;
  for (const [key, timestamps] of buckets) {
    const recent = timestamps.filter((t) => t > cutoff);
    if (recent.length === 0) buckets.delete(key);
    else buckets.set(key, recent);
  }
}

// start periodic cleanup
const cleanupInterval = setInterval(() => cleanupBuckets(DEFAULT_WINDOW_MS), DEFAULT_CLEANUP_MS);
cleanupInterval.unref && cleanupInterval.unref();

export default function rateLimiter(options = {}) {
  const max = Number(options.max || DEFAULT_MAX);
  const windowMs = Number(options.windowMs || DEFAULT_WINDOW_MS);

  return (req, res, next) => {
    try {
      let key = null;

      // Prefer phone number extracted from raw body (when express.raw used upstream)
      key = extractPhoneFromRawBody(req.body);

      // Fallback to IP
      if (!key) {
        key = req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
      }

      const now = nowMs();
      const cutoff = now - windowMs;
      const existing = buckets.get(key) || [];
      const recent = existing.filter((t) => t > cutoff);

      if (recent.length >= max) {
        // compute Retry-After in seconds: when the oldest timestamp in the window will expire
        const oldest = Math.min(...recent);
        const retryAfterSec = Math.ceil((oldest + windowMs - now) / 1000) || 1;
        res.setHeader('Retry-After', String(retryAfterSec));
        res.status(429).json({ error: 'Too Many Requests', retryAfter: retryAfterSec });
        return;
      }

      recent.push(now);
      buckets.set(key, recent);
      next();
    } catch (e) {
      // On unexpected error, don't block the request; fail-open
      console.warn('rateLimiter: unexpected error, allowing request', e && e.message ? e.message : e);
      next();
    }
  };
}
