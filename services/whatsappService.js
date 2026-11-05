import config from '../config/env.js';
import { testMode } from './testContext.js';
import { isDemoMode } from './demo/demoFlag.js';
import systemAlerts, { isTokenError } from './systemAlerts.js';
import { describeError } from './safeLog.js';
import { renderTemplateBody } from '../config/whatsappTemplates.js';

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
  const media = options.media || null;
  const mediaType = options.type || (media && (media.link || media.id) ? 'image' : null);
  const caption = options.caption || text || '';

  if (!fetchImpl) throw new Error('No fetch implementation provided');

  // Probador del panel: WhatsApp falso. Nada sale a Meta; el envío se entrega al Probador.
  const test = testMode();
  if (test && !options.fetchImpl) {
    const id = `wamid.prueba.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
    // Plantilla: el Probador muestra el texto tal como lo recibirá el destinatario.
    const templateText = options.template ? renderTemplateBody(options.template.name, options.template.bodyParams) : null;
    test.onSend?.(String(toPhone), {
      text: templateText || text, template: options.template?.name || null, media: media?.link || null, location: options.location || null,
      buttons: options.buttons?.map((b) => b.title) || options.list?.rows.map((r) => r.title) || null,
      buttonsKind: options.list ? 'list' : options.buttons ? 'buttons' : null, id,
    });
    return { messages: [{ id }], test: true };
  }
  // Modo demo (npm run demo): los pacientes son inventados; nada sale a Meta.
  if (isDemoMode() && !options.fetchImpl) {
    const kind = options.template ? `plantilla ${options.template.name}` : media ? 'foto' : options.location ? 'ubicación' : 'texto';
    console.log(`[Demo] WhatsApp simulado → …${String(toPhone).slice(-4)} (${kind})`);
    return { messages: [{ id: `wamid.demo.${Date.now()}.${Math.random().toString(36).slice(2, 8)}` }], demo: true };
  }

  const url = `https://graph.facebook.com/${config.whatsapp?.apiVersion || process.env.WHATSAPP_API_VERSION || 'v17.0'}/${config.whatsapp?.phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const template = options.template || null;
  const body = options.location
    ? { messaging_product: 'whatsapp', to: toPhone, type: 'location', location: options.location }
    : options.list
    ? {
        messaging_product: 'whatsapp',
        to: toPhone,
        type: 'interactive',
        interactive: {
          type: 'list',
          body: { text: text || '' },
          action: { button: options.list.button, sections: [{ title: options.list.sectionTitle, rows: options.list.rows }] },
        },
      }
    : options.buttons
    ? {
        messaging_product: 'whatsapp',
        to: toPhone,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: text || '' },
          action: { buttons: options.buttons.map(({ id, title }) => ({ type: 'reply', reply: { id, title } })) },
        },
      }
    : template
    ? {
        messaging_product: 'whatsapp',
        to: toPhone,
        type: 'template',
        template: {
          name: template.name,
          language: { code: template.language || 'es' },
          components: template.bodyParams?.length
            ? [{ type: 'body', parameters: template.bodyParams.map((value) => ({ type: 'text', text: String(value) })) }]
            : [],
        },
      }
    : mediaType === 'image' && media && (media.link || media.id)
    ? {
        messaging_product: 'whatsapp',
        to: toPhone,
        type: 'image',
        // Por id: imagen subida a Meta (p. ej. el pase de cita), sin URL pública.
        image: media.id ? { id: media.id, caption } : { link: media.link, caption },
      }
    : {
        messaging_product: 'whatsapp',
        to: toPhone,
        text: { body: text || '' },
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
        systemAlerts.whatsappOk();
        try { const json = await res.json(); return json; } catch (e) { return null; }
      }

      // Non-OK response
      const status = res && res.status ? res.status : null;
      const txt = (res && typeof res.text === 'function') ? await res.text() : null;

      // Do not retry on 4xx
      if (status && status >= 400 && status < 500) {
        const err = new Error(`WhatsApp API returned status ${status}`);
        err.status = status;
        // Detalle de Meta (código y motivo) para mostrarlo en el panel; nunca incluye el token.
        try { err.meta = JSON.parse(txt || '{}')?.error || null; } catch { err.meta = null; }
        // Token vencido o revocado: log "TOKEN DE WHATSAPP VENCIDO" + banner en el panel con los pasos.
        if (isTokenError(err.meta)) systemAlerts.tokenExpired(err.meta);
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

// Límite real de Meta para el cuerpo de un mensaje de texto.
export const WHATSAPP_TEXT_LIMIT = 4096;

// Corta por párrafos (luego por líneas y, si hace falta, a la fuerza) sin perder ni recortar texto.
export function splitForWhatsApp(text, limit = WHATSAPP_TEXT_LIMIT) {
  const value = String(text ?? '');
  if (value.length <= limit) return [value];
  const chunks = [];
  let current = '';
  const flush = () => { if (current) chunks.push(current); current = ''; };
  for (const paragraph of value.split('\n\n')) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length <= limit) { current = candidate; continue; }
    flush();
    if (paragraph.length <= limit) { current = paragraph; continue; }
    for (let i = 0; i < paragraph.length; i += limit) chunks.push(paragraph.slice(i, i + limit));
  }
  flush();
  return chunks;
}

// Un texto largo sale en varios mensajes, en orden. Devuelve los ids de todos (el primero manda en la bandeja).
export async function sendTextMessage(toPhone, text, options = {}) {
  const chunks = splitForWhatsApp(text);
  if (chunks.length === 1) return sendWhatsAppMessage(toPhone, text, options);
  const messages = [];
  for (const chunk of chunks) {
    const result = await sendWhatsAppMessage(toPhone, chunk, options);
    messages.push(...(result?.messages || []));
  }
  return { messages };
}

export function sendImageMessage(toPhone, imageUrl, caption = '', options = {}) {
  return sendWhatsAppMessage(toPhone, caption, {
    ...options,
    type: 'image',
    media: { link: imageUrl },
    caption,
  });
}

// Sube una imagen a Meta (POST /{phone-number-id}/media) y devuelve su id. Para imágenes con datos del
// paciente (pase de cita): se envían por id y nunca quedan en una URL pública. Meta la borra a los 30 días.
export async function uploadMedia(buffer, mimeType, { fetchImpl = globalThis.fetch?.bind(globalThis), timeoutMs = 15000 } = {}) {
  const url = `https://graph.facebook.com/${config.whatsapp?.apiVersion || process.env.WHATSAPP_API_VERSION || 'v17.0'}/${config.whatsapp?.phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID}/media`;
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', mimeType);
  form.append('file', new Blob([buffer], { type: mimeType }), mimeType === 'image/png' ? 'imagen.png' : 'imagen.jpg');
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + (config.whatsapp?.token || process.env.WHATSAPP_TOKEN || '') },
    body: form,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json?.id) {
    const err = new Error(`WhatsApp media upload returned status ${res.status}`);
    err.status = res.status;
    err.meta = json?.error || null;
    if (isTokenError(err.meta)) systemAlerts.tokenExpired(err.meta);
    throw err;
  }
  return json.id;
}

// Imagen generada en el servidor (Buffer). En el Probador y en el demo no se sube a Meta: se muestra desde
// previewUrl (una ruta del panel con sesión). En producción se sube y se envía por id.
export async function sendImageBuffer(toPhone, buffer, { mimeType = 'image/png', caption = '', previewUrl = null, ...options } = {}) {
  if ((testMode() || isDemoMode()) && !options.fetchImpl) {
    return sendWhatsAppMessage(toPhone, caption, { ...options, type: 'image', media: { link: previewUrl }, caption });
  }
  const id = await uploadMedia(buffer, mimeType, options);
  return sendWhatsAppMessage(toPhone, caption, { ...options, type: 'image', media: { id }, caption });
}

// Mensaje de ubicación (se abre en la app de mapas del paciente). Cuenta como mensaje de sesión (ventana de 24 h).
export function sendLocationMessage(toPhone, { latitude, longitude, name, address }, options = {}) {
  return sendWhatsAppMessage(toPhone, `[ubicación] ${name || ''}`.trim(), {
    ...options, location: { latitude, longitude, name, address },
  });
}

// Mensaje con botones de respuesta (máximo 3, título de hasta 20 caracteres). Solo dentro de la ventana de
// 24 h; al tocarlo, el webhook recibe interactive.button_reply con el título.
export function sendButtonsMessage(toPhone, text, buttons, options = {}) {
  const clean = buttons.slice(0, 3).map((b) => ({ id: String(b.id).slice(0, 256), title: String(b.title).slice(0, 20) }));
  return sendWhatsAppMessage(toPhone, String(text || '').slice(0, 1024), { ...options, buttons: clean });
}

// Mensaje con lista (hasta 10 filas): botón de hasta 20 caracteres, título de fila hasta 24 y descripción
// hasta 72. Solo dentro de la ventana de 24 h; al elegir, el webhook recibe interactive.list_reply.
export function sendListMessage(toPhone, text, buttonText, rows, options = {}) {
  const clean = rows.slice(0, 10).map((r) => ({
    id: String(r.id).slice(0, 200), title: String(r.title).slice(0, 24),
    ...(r.description ? { description: String(r.description).slice(0, 72) } : {}),
  }));
  return sendWhatsAppMessage(toPhone, String(text || '').slice(0, 4096), {
    ...options, list: { button: String(buttonText || 'Ver opciones').slice(0, 20), sectionTitle: 'Horarios libres', rows: clean },
  });
}

// Plantilla aprobada por Meta (obligatoria para escribir fuera de la ventana de 24 h).
// Ver docs/whatsapp-templates.md. Los parámetros del cuerpo no pueden llevar saltos de línea.
export function sendTemplateMessage(toPhone, name, bodyParams = [], { language = 'es', ...options } = {}) {
  const params = bodyParams.map((value) => String(value ?? '').replace(/\s+/g, ' ').trim() || '-');
  return sendWhatsAppMessage(toPhone, `[plantilla ${name}]`, { ...options, template: { name, language, bodyParams: params } });
}

// "Leído" y "escribiendo…" (Cloud API: POST /messages con status "read" y typing_indicator, que además
// marca como leído). Nunca lanzan ni bloquean la respuesta al paciente: un fallo solo queda en el log con el
// motivo de Meta (código y mensaje), sin token y con los números enmascarados.
let typingSupported = true;
export function resetStatusSupport() { typingSupported = true; }

async function postStatus(messageId, { typing, phoneNumberId, token }) {
  const version = config.whatsapp?.apiVersion || process.env.WHATSAPP_API_VERSION || 'v21.0';
  const response = await fetch(`https://graph.facebook.com/${version}/${phoneNumberId}/messages`, {
    method: 'POST',
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId,
      ...(typing ? { typing_indicator: { type: 'text' } } : {}),
    }),
  });
  if (response.ok) return response.json().catch(() => ({ success: true }));
  const meta = await response.json().then((body) => body?.error || null).catch(() => null);
  const detail = meta ? ` (Meta ${meta.code ?? '?'}${meta.error_subcode ? `/${meta.error_subcode}` : ''}: ${meta.error_user_msg || meta.message || 'sin mensaje'})` : '';
  throw Object.assign(new Error(`WhatsApp status update failed: ${response.status}${detail}`), { status: response.status, meta });
}

async function sendStatus(messageId, { typing = false, ...credentials } = {}) {
  const phoneNumberId = credentials.phoneNumberId || config.whatsapp?.phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = credentials.token || config.whatsapp?.token || process.env.WHATSAPP_TOKEN || '';
  if (!phoneNumberId || !token || !messageId || testMode() || isDemoMode()) return null;
  const wantsTyping = typing && typingSupported;
  try {
    return await postStatus(messageId, { typing: wantsTyping, phoneNumberId, token });
  } catch (error) {
    console.error(`[WhatsApp] ${describeError(error)}`);
    // Meta rechazó "escribiendo" (p. ej. versión de la API): se deja de pedir y se marca solo como leído.
    if (wantsTyping && error.status === 400) {
      typingSupported = false;
      return postStatus(messageId, { typing: false, phoneNumberId, token })
        .catch((retryError) => { console.error(`[WhatsApp] ${describeError(retryError)}`); return null; });
    }
    return null;
  }
}

export function markMessageAsRead(messageId, credentials = {}) {
  return sendStatus(messageId, credentials);
}

// Una sola llamada: "escribiendo…" ya marca el mensaje como leído.
export function sendTypingIndicator(messageId, credentials = {}) {
  return sendStatus(messageId, { ...credentials, typing: true });
}

export default {
  sendWhatsAppMessage,
  sendTextMessage,
  sendImageMessage,
  sendTemplateMessage,
  sendLocationMessage,
  sendButtonsMessage,
  sendListMessage,
  sendImageBuffer,
  uploadMedia,
  markMessageAsRead,
  sendTypingIndicator,
};
