import config from '../config/env.js';

// Descarga la media que envía el paciente (foto, audio, video, documento, sticker) desde Meta.
// El token solo viaja del servidor a graph.facebook.com: el navegador recibe los bytes por el
// proxy autenticado del panel (GET /api/panel/media/:id) y nunca ve la URL firmada ni el token.

export const MAX_MEDIA_BYTES = 25 * 1024 * 1024;
const MEDIA_ID = /^\d{5,30}$/;

// Tipos que el navegador puede mostrar en línea; el resto se descarga como archivo (evita que un
// documento HTML o SVG enviado por un paciente se ejecute dentro del panel).
const INLINE_TYPES = /^(?:image\/(?:jpeg|png|webp)|audio\/(?:ogg|mpeg|mp4|aac|amr)|video\/(?:mp4|3gpp))(?:;|$)/i;

export function isInlineType(contentType) {
  return INLINE_TYPES.test(String(contentType || ''));
}

export async function fetchMetaMedia(mediaId, {
  fetchImpl = fetch, token = config.whatsapp.token, version = config.whatsapp.apiVersion, maxBytes = MAX_MEDIA_BYTES,
} = {}) {
  if (!MEDIA_ID.test(String(mediaId || ''))) throw Object.assign(new Error('media id inválido'), { status: 400 });
  if (!token) throw Object.assign(new Error('WHATSAPP_TOKEN no está configurado'), { status: 503 });
  const auth = { Authorization: `Bearer ${token}` };
  const meta = await fetchImpl(`https://graph.facebook.com/${version}/${mediaId}`, { headers: auth });
  if (!meta.ok) throw Object.assign(new Error(`Meta no entregó los datos del archivo (HTTP ${meta.status})`), { status: meta.status === 404 ? 404 : 502 });
  const info = await meta.json();
  if (Number(info.file_size) > maxBytes) throw Object.assign(new Error('El archivo es demasiado grande para el panel'), { status: 413 });
  const binary = await fetchImpl(info.url, { headers: auth });
  if (!binary.ok) throw Object.assign(new Error(`No se pudo descargar el archivo de Meta (HTTP ${binary.status})`), { status: 502 });
  const buffer = Buffer.from(await binary.arrayBuffer());
  if (buffer.length > maxBytes) throw Object.assign(new Error('El archivo es demasiado grande para el panel'), { status: 413 });
  return {
    contentType: info.mime_type || binary.headers?.get?.('content-type') || 'application/octet-stream',
    buffer,
  };
}

export default fetchMetaMedia;
