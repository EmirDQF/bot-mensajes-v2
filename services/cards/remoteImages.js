import { detectImageType } from '../imageType.js';

// Logo subido desde el panel (Supabase Storage, bucket clinic-media) para dibujarlo en la tarjeta del pack, el pase de
// cita y el catálogo: resvg dibuja sin red, así que la imagen se descarga antes y se guarda en memoria.
// Solo se descargan URLs del propio bucket (nunca una URL cualquiera: evita pedidos a otros servidores), con
// tope de tamaño y tiempo, y verificando por sus bytes que sea JPG, PNG o WebP.

export const MAX_REMOTE_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 5000;
const cache = new Map();

export function isClinicMediaUrl(url, env = process.env) {
  try {
    const target = new URL(String(url || ''));
    const base = new URL(String(env.SUPABASE_URL || '').trim());
    return target.protocol === 'https:' && target.host === base.host
      && target.pathname.startsWith('/storage/v1/object/public/clinic-media/') && !target.pathname.includes('..');
  } catch {
    return false;
  }
}

export const cachedImageDataUri = (url) => cache.get(String(url || '')) || null;

// Nunca lanza: si falla, las tarjetas se dibujan sin logo. Devuelve true si la imagen quedó en memoria.
export async function prefetchImage(url, { fetchImpl = fetch, env = process.env } = {}) {
  if (!url || cache.has(url)) return cache.has(url);
  if (!isClinicMediaUrl(url, env)) return false;
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error' });
    if (!res.ok) return false;
    if (Number(res.headers?.get?.('content-length') || 0) > MAX_REMOTE_BYTES) return false;
    const buffer = Buffer.from(await res.arrayBuffer());
    const type = buffer.length <= MAX_REMOTE_BYTES ? detectImageType(buffer) : null;
    if (!type) return false;
    if (cache.size >= 20) cache.delete(cache.keys().next().value);
    cache.set(url, `data:${type};base64,${buffer.toString('base64')}`);
    return true;
  } catch (error) {
    console.warn('[Tarjetas] No se pudo descargar el logo del panel; las tarjetas salen sin logo:', error?.name || 'error');
    return false;
  }
}

export default { prefetchImage, cachedImageDataUri, isClinicMediaUrl };
