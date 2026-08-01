import config from '../config/env.js';

const DEFAULT_TIMEOUT_MS = Number(process.env.WHATSAPP_TIMEOUT_MS || 8000);
const DEFAULT_MAX_RETRIES = Number(process.env.WHATSAPP_MAX_RETRIES || 2);
const BACKOFF_MS = [500, 1500]; // exponential/backoff sequence for retries

function maskPhone(phone) {
  try {
    return config.helpers.maskPhone(phone);
  } catch (e) {
    return '****';
  }
}

async function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function sendWhatsAppMessage(toPhone, text, options = {}) {
  const fetchImpl = options.fetchImpl || (globalThis.fetch && globalThis.fetch.bind(globalThis));
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const maxRetries = (typeof options.maxRetries === 'number') ? options.maxRetries : DEFAULT_MAX_RETRIES;

  if (!fetchImpl) throw new Error('No fetch implementation provided');

  const url = `https://graph.facebook.com/${config.whatsapp?.apiVersion || process.env.WHATSAPP_API_VERSION || 'v17.0'}/${config.whatsapp?.phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const body = {
    messaging_product: 'whatsapp',
    to: toPhone,
    text: { body: text },
  };

  const masked = maskPhone(toPhone);
  let attempt = 0;
  let lastError = null;

  while (attempt <= maxRetries) {
    attempt += 1;
    const controller = new AbortController();
    const signal = controller.signal;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      console.log(`Sending WhatsApp message to ${masked} (attempt ${attempt})`);
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + (config.whatsapp?.token || process.env.WHATSAPP_TOKEN || ''),
        },
        body: JSON.stringify(body),
        signal,
      });

      clearTimeout(timeout);

      if (res && res.ok) {
        try { const json = await res.json(); return json; } catch (e) { return null; }
      }

      // Non-OK response
      const status = res && res.status ? res.status : null;
      const txt = (res && typeof res.text === 'function') ? await res.text() : null;

      // Do not retry on 4xx
      if (status && status >= 400 && status < 500) {
        const err = new Error(`WhatsApp API returned status ${status}`);
        err.status = status;
        lastError = err;
        console.error(`WhatsApp send failed to ${masked}: ${status} ${txt}`);
        throw err;
      }

      // For 5xx, treat as retriable
      lastError = new Error(`WhatsApp API error ${status || 'unknown'}: ${txt}`);
      console.warn(`WhatsApp send attempt ${attempt} failed for ${masked}: ${lastError.message}`);
      if (attempt <= maxRetries) {
        const backoff = BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)];
        await delay(backoff);
        continue;
      }

      throw lastError;
    } catch (e) {
      clearTimeout(timeout);
      // If aborted due to timeout, treat as network error (retriable)
      const isAbort = e && (e.name === 'AbortError' || (e.code && e.code === 'ABORT_ERR'));
      if (isAbort) {
        lastError = Object.assign(new Error('Request timed out'), { cause: e });
        console.warn(`WhatsApp send attempt ${attempt} timed out for ${masked}`);
        if (attempt <= maxRetries) {
          const backoff = BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)];
          await delay(backoff);
          continue;
        }
        throw lastError;
      }

      // Network or other error: decide if retriable
      const isNetwork = /network|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN/i.test(String(e && (e.message || e.code || '')));
      if (isNetwork) {
        lastError = e;
        console.warn(`WhatsApp send network error on attempt ${attempt} for ${masked}:`, e && e.message ? e.message : e);
        if (attempt <= maxRetries) {
          const backoff = BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)];
          await delay(backoff);
          continue;
        }
        throw lastError;
      }

      // non-retriable error
      lastError = e;
      throw e;
    }
  }

  // If we exit loop, throw last error
  throw lastError || new Error('Failed to send message');
}

export default { sendWhatsAppMessage };
