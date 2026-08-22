import fs from 'fs/promises';
import path from 'path';
import config from '../config/env.js';

const DEFAULT_TIMEOUT_MS = Number(process.env.WHATSAPP_TIMEOUT_MS || 8000);
const DEFAULT_MAX_RETRIES = Number(process.env.WHATSAPP_MAX_RETRIES || 2);
const BACKOFF_MS = [500, 1500]; // exponential/backoff sequence for retries

const PUBLIC_IMAGE_BASE_URL = (process.env.PUBLIC_IMAGE_BASE_URL || 'https://bot-mensajes-dental.onrender.com/public').replace(/\/$/, '');

const IMAGE_MAP = {
  'promo_consulta': 'LUMINZU/promo_consulta.jpeg',
  'promo': 'LUMINZU/promo_consulta.jpeg',
  'doctora': 'LUMINZU/promo_consulta.jpeg',
  'zuny': 'LUMINZU/promo_consulta.jpeg',
  'kit_preventivo': 'LUMINZU/kit_preventivo.jpeg',
  'limpieza': 'LUMINZU/kit_preventivo.jpeg',
  'sarro': 'LUMINZU/kit_preventivo.jpeg',
  'carillas': 'LUMINZU/carillas.jpeg',
  'carilla': 'LUMINZU/carillas.jpeg',
  'estetica': 'LUMINZU/carillas.jpeg',
  'diseno': 'LUMINZU/carillas.jpeg',
  'implantes': 'LUMINZU/implantes.jpeg',
  'implante': 'LUMINZU/implantes.jpeg',
  'protesis': 'LUMINZU/protesis.jpeg',
  'endodoncia': 'LUMINZU/endodoncia.jpeg',
  'conducto': 'LUMINZU/endodoncia.jpeg',
  'odontopediatria': 'LUMINZU/odontopediatria.jpeg',
  'ninos': 'LUMINZU/odontopediatria.jpeg',
  'kids': 'LUMINZU/odontopediatria.jpeg',
  'resinas_kids': 'LUMINZU/odontopediatria.jpeg',
  'ubicacion': `${PUBLIC_IMAGE_BASE_URL}/ubicacion.jpg`,
  'ubicacion.jpg': `${PUBLIC_IMAGE_BASE_URL}/ubicacion.jpg`,
  'mapa': `${PUBLIC_IMAGE_BASE_URL}/ubicacion.jpg`,
  'croquis': `${PUBLIC_IMAGE_BASE_URL}/ubicacion.jpg`,
  'fachada': `${PUBLIC_IMAGE_BASE_URL}/ubicacion.jpg`,
  'local': `${PUBLIC_IMAGE_BASE_URL}/ubicacion.jpg`,
  'antes_despues_ortodoncia': `${PUBLIC_IMAGE_BASE_URL}/antes_despues_ortodoncia.jpg`,
  'antes_despues_ortodoncia.jpg': `${PUBLIC_IMAGE_BASE_URL}/antes_despues_ortodoncia.jpg`,
  'ortodoncia_general': `${PUBLIC_IMAGE_BASE_URL}/antes_despues_ortodoncia.jpg`,
  'ortodoncia_kids': `${PUBLIC_IMAGE_BASE_URL}/antes_despues_ortodoncia.jpg`,
  'antes_despues_implantes': `${PUBLIC_IMAGE_BASE_URL}/antes_despues_implantes.jpg`,
  'antes_despues_implantes.jpg': `${PUBLIC_IMAGE_BASE_URL}/antes_despues_implantes.jpg`,
  'antes_despues_carillas': `${PUBLIC_IMAGE_BASE_URL}/antes_despues_carillas.jpg`,
  'antes_despues_carillas.jpg': `${PUBLIC_IMAGE_BASE_URL}/antes_despues_carillas.jpg`,
  'promociones': `${PUBLIC_IMAGE_BASE_URL}/promociones.jpg`,
  'promociones.jpg': `${PUBLIC_IMAGE_BASE_URL}/promociones.jpg`,
  'antes_despues_blanqueamiento': `${PUBLIC_IMAGE_BASE_URL}/antes_despues_blanqueamiento.jpg`,
  'antes_despues_blanqueamiento.jpg': `${PUBLIC_IMAGE_BASE_URL}/antes_despues_blanqueamiento.jpg`,
  // Legacy clinic assets
  'ortodoncia_antes_despues': `${PUBLIC_IMAGE_BASE_URL}/antes_despues_ortodoncia.jpg`,
  'carillas_antes_despues': `${PUBLIC_IMAGE_BASE_URL}/antes_despues_carillas.jpg`
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

  const match = text.match(/\[(?:SEND_IMAGE|ENVIAR_IMAGEN)\s*:\s*([a-z0-9_\.\-]+)\]/i)
    || text.match(/\[(?:SEND_IMAGE|ENVIAR_IMAGEN)\s*=\s*([a-z0-9_\.\-]+)\]/i);

  if (!match || !match[1]) return null;
  const normalizedKey = resolveImageAssetKey(match[1]);
  return normalizedKey;
}

export function stripSendImageTag(text) {
  if (!text || typeof text !== 'string') return text;
  return text
    .replace(/\s*\[\s*(?:SEND_IMAGE|ENVIAR_IMAGEN)\s*:\s*[a-z0-9_\.\-]+\s*\]\s*/gis, ' ')
    .replace(/\s*\[\s*(?:SEND_IMAGE|ENVIAR_IMAGEN)\s*=\s*[a-z0-9_\.\-]+\s*\]\s*/gis, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function resolvePublicImageUrl(imageKey) {
  if (!imageKey || typeof imageKey !== 'string') return null;
  const trimmed = imageKey.trim();
  if (!trimmed) return null;

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  const normalizedKey = trimmed.toLowerCase();
  const mappedValue = IMAGE_MAP[normalizedKey] || IMAGE_MAP[normalizedKey.replace(/\.(jpg|jpeg|png|gif|webp)$/i, '')];
  if (!mappedValue) return null;

  if (/^https?:\/\//i.test(mappedValue)) return mappedValue;
  return `${PUBLIC_IMAGE_BASE_URL}/${mappedValue.replace(/^\/?public\//i, '').replace(/^\/?/, '')}`;
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

  const directUrl = /^https?:\/\//i.test(String(imageKey || '')) ? String(imageKey) : resolvePublicImageUrl(String(imageKey || ''));
  const resolvedKey = resolveImageAssetKey(imageKey);
  const phoneNumberId = config.whatsapp?.phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.PHONE_NUMBER_ID || '';
  const token = config.whatsapp?.token || process.env.WHATSAPP_TOKEN || '';
  const sendUrl = `https://graph.facebook.com/${config.whatsapp?.apiVersion || process.env.WHATSAPP_API_VERSION || 'v17.0'}/${phoneNumberId}/messages`;

  if (directUrl) {
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: toPhone,
      type: 'image',
      image: {
        link: directUrl,
        ...(text && text.trim() ? { caption: text.trim() } : {}),
      },
    };

    try {
      const res = await fetchImpl(sendUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + token,
        },
        body: JSON.stringify(payload),
      });

      const responseBody = res && typeof res.text === 'function' ? await res.text() : '';
      let json = null;
      try { json = responseBody ? JSON.parse(responseBody) : null; } catch (e) { json = null; }

      if (!res || !res.ok) {
        const status = res && res.status ? res.status : 'unknown';
        const message = json && json.error ? JSON.stringify(json.error) : responseBody || 'unknown error';
        console.error('Meta WhatsApp image send error:', { status, url: sendUrl, to: toPhone, payload, body: json || responseBody, message });
        throw new Error(`WhatsApp image send failed (${status}): ${message}`);
      }

      if (text && text.trim().length > 0) {
        return json || { ok: true };
      }
      return json || { ok: true };
    } catch (error) {
      console.error('Meta WhatsApp direct image send exception:', error && error.message ? error.message : error);
      throw error;
    }
  }

  if (!resolvedKey) {
    throw new Error(`Unsupported WhatsApp image key: ${imageKey}`);
  }

  const assetPath = resolveImageAssetPath(resolvedKey);
  try {
    await fs.access(assetPath);
  } catch (e) {
    console.warn(`WhatsApp image asset not found for key ${resolvedKey}: ${assetPath}; falling back to public URL mapping`);
    const directFallback = resolvePublicImageUrl(resolvedKey);
    if (directFallback) {
      return await sendWhatsAppImageMessage(toPhone, directFallback, text, options);
    }
    return null;
  }

  const mediaId = await uploadWhatsAppImage(assetPath, { ...options, fetchImpl });
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
      Authorization: 'Bearer ' + token,
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
        console.error('Meta WhatsApp send error:', { to: masked, status, response: txt, url });
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
