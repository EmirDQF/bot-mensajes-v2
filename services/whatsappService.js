import fs from 'fs/promises';
import path from 'path';
import config from '../config/env.js';

const DEFAULT_TIMEOUT_MS = Number(process.env.WHATSAPP_TIMEOUT_MS || 8000);
const DEFAULT_MAX_RETRIES = Number(process.env.WHATSAPP_MAX_RETRIES || 2);
const BACKOFF_MS = [500, 1500]; // exponential/backoff sequence for retries

const IMAGE_MAP = {
  logo: 'LUMINZU/logo.jpeg',
  fachada: 'LUMINZU/fachada.jpeg',
  local: 'LUMINZU/fachada.jpeg',
  ubicacion: 'LUMINZU/ubicacion.jpeg',
  mapa: 'LUMINZU/ubicacion.jpeg',
  croquis: 'LUMINZU/ubicacion.jpeg',
  promo_consulta: 'LUMINZU/promo_consulta.jpeg',
  promo: 'LUMINZU/promo_consulta.jpeg',
  doctora: 'LUMINZU/promo_consulta.jpeg',
  zuny: 'LUMINZU/promo_consulta.jpeg',
  kit_preventivo: 'LUMINZU/kit_preventivo.jpeg',
  limpieza: 'LUMINZU/kit_preventivo.jpeg',
  carillas: 'LUMINZU/carillas.jpeg',
  carilla: 'LUMINZU/carillas.jpeg',
  estetica: 'LUMINZU/carillas.jpeg',
  implantes: 'LUMINZU/implantes.jpeg',
  implante: 'LUMINZU/implantes.jpeg',
  protesis: 'LUMINZU/protesis.jpeg',
  endodoncia: 'LUMINZU/endodoncia.jpeg',
  odontopediatria: 'LUMINZU/odontopediatria.jpeg',
  ninos: 'LUMINZU/odontopediatria.jpeg',
  kids: 'LUMINZU/odontopediatria.jpeg',
};

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

export function resolveImageAssetKey(key) {
  if (!key || typeof key !== 'string') return null;
  const normalized = key.trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(IMAGE_MAP, normalized) ? normalized : null;
}

export function resolveImageAssetPath(key) {
  const resolvedKey = resolveImageAssetKey(key);
  if (!resolvedKey) return null;
  const relativePath = IMAGE_MAP[resolvedKey];
  if (!relativePath) return null;
  return path.resolve(process.cwd(), relativePath);
}

export function parseSendImageTag(text) {
  if (!text || typeof text !== 'string') return null;
  // allow spaces/newlines between token and key
  const match = text.match(/\[SEND_IMAGE:\s*([a-z0-9_\-]+)\]/i);
  if (!match || !match[1]) return null;
  const normalizedKey = resolveImageAssetKey(match[1]);
  return normalizedKey;
}

export function stripSendImageTag(text) {
  if (!text || typeof text !== 'string') return text;
  return text.replace(/\s*\[\s*SEND_IMAGE\s*:\s*[a-z0-9_\-]+\s*\]\s*/gis, ' ').replace(/\s{2,}/g, ' ').trim();
}

// Parse and strip BOOK_APPOINTMENT tag (flexible spaces/newlines)
export function parseBookAppointmentTag(text) {
  if (!text || typeof text !== 'string') return null;
  const match = text.match(/\[BOOK_APPOINTMENT:\s*({[\s\S]*?})\]/i);
  if (!match || !match[1]) return null;
  try {
    return JSON.parse(match[1]);
  } catch (e) {
    try {
      // attempt to clean common trailing commas or single quotes
      const cleaned = match[1].replace(/\n/g, ' ').replace(/\s+/g, ' ').replace(/'/g, '"').replace(/,\s*}/g, '}');
      return JSON.parse(cleaned);
    } catch (err) {
      return null;
    }
  }
}

export function stripBookAppointmentTag(text) {
  if (!text || typeof text !== 'string') return text;
  return text.replace(/\[BOOK_APPOINTMENT:\s*({[\s\S]*?})\]/gi, ' ').replace(/\s{2,}/g, ' ').trim();
}

async function uploadWhatsAppImage(filePath, options = {}) {
  const fetchImpl = options.fetchImpl || (globalThis.fetch && globalThis.fetch.bind(globalThis));
  if (!fetchImpl) throw new Error('No fetch implementation provided');

  const url = `https://graph.facebook.com/${config.whatsapp?.apiVersion || process.env.WHATSAPP_API_VERSION || 'v17.0'}/${config.whatsapp?.phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID}/media`;
  const absolutePath = path.resolve(filePath);
  const fileBuffer = await fs.readFile(absolutePath);
  const ext = path.extname(absolutePath).toLowerCase();
  const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';

  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', mimeType);
  form.append('file', new Blob([fileBuffer], { type: mimeType }), path.basename(absolutePath));

  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + (config.whatsapp?.token || process.env.WHATSAPP_TOKEN || ''),
    },
    body: form,
  });

  if (!res || !res.ok) {
    const status = res && res.status ? res.status : 'unknown';
    const text = res && typeof res.text === 'function' ? await res.text() : '';
    throw new Error(`WhatsApp media upload failed (${status}): ${text}`);
  }

  const json = await res.json();
  if (!json || !json.id) {
    throw new Error('WhatsApp media upload did not return a media id');
  }

  return json.id;
}

export async function sendWhatsAppImageMessage(toPhone, imageKey, text = '', options = {}) {
  const fetchImpl = options.fetchImpl || (globalThis.fetch && globalThis.fetch.bind(globalThis));
  if (!fetchImpl) throw new Error('No fetch implementation provided');

  const resolvedKey = resolveImageAssetKey(imageKey);
  if (!resolvedKey) {
    throw new Error(`Unsupported WhatsApp image key: ${imageKey}`);
  }

  const assetPath = resolveImageAssetPath(resolvedKey);
  try {
    await fs.access(assetPath);
  } catch (e) {
    console.warn(`WhatsApp image asset not found for key ${resolvedKey}: ${assetPath}`);
    return null;
  }

  const mediaId = await uploadWhatsAppImage(assetPath, { ...options, fetchImpl });
  const sendUrl = `https://graph.facebook.com/${config.whatsapp?.apiVersion || process.env.WHATSAPP_API_VERSION || 'v17.0'}/${config.whatsapp?.phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product: 'whatsapp',
    to: toPhone,
    type: 'image',
    image: { id: mediaId },
  };

  const res = await fetchImpl(sendUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + (config.whatsapp?.token || process.env.WHATSAPP_TOKEN || ''),
    },
    body: JSON.stringify(payload),
  });

  if (!res || !res.ok) {
    const status = res && res.status ? res.status : 'unknown';
    const bodyText = res && typeof res.text === 'function' ? await res.text() : '';
    throw new Error(`WhatsApp image send failed (${status}): ${bodyText}`);
  }

  if (text && text.trim().length > 0) {
    return await sendWhatsAppMessage(toPhone, text, { ...options, fetchImpl });
  }

  try { return await res.json(); } catch (e) { return null; }
}

export async function sendWhatsAppReplyWithOptionalImage(toPhone, text, options = {}) {
  const cleanText = typeof text === 'string' ? text : '';
  const imageKey = parseSendImageTag(cleanText);
  if (!imageKey) {
    if (cleanText.trim().length > 0) {
      return await sendWhatsAppMessage(toPhone, cleanText, options);
    }
    return null;
  }

  const session = options && options.session ? options.session : null;
  const sentImages = session && session.sentImages instanceof Set ? session.sentImages : null;
  if (sentImages && sentImages.has(imageKey)) {
    const strippedText = stripSendImageTag(cleanText);
    if (strippedText.trim().length > 0) {
      return await sendWhatsAppMessage(toPhone, strippedText, options);
    }
    return null;
  }

  const strippedText = stripSendImageTag(cleanText);
  if (sentImages) {
    sentImages.add(imageKey);
  }
  await sendWhatsAppImageMessage(toPhone, imageKey, strippedText, options);
  return null;
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

      const status = res && res.status ? res.status : null;
      const txt = (res && typeof res.text === 'function') ? await res.text() : null;

      if (status && status >= 400 && status < 500) {
        const err = new Error(`WhatsApp API returned status ${status}`);
        err.status = status;
        lastError = err;
        console.error(`WhatsApp send failed to ${masked}: ${status} ${txt}`);
        throw err;
      }

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

      lastError = e;
      throw e;
    }
  }

  throw lastError || new Error('Failed to send message');
}

export default { sendWhatsAppMessage, sendWhatsAppReplyWithOptionalImage, sendWhatsAppImageMessage, parseSendImageTag, stripSendImageTag, resolveImageAssetPath };
