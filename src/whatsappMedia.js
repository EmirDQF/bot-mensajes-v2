import fs from 'fs';
import path from 'path';
import { claimMediaSend, completeMediaSend } from '../services/mediaTrackingService.js';

const GRAPH_VERSION = 'v20.0';
const mediaIdCache = new Map();

function resolveLocalImagesDir() {
  return path.resolve(process.cwd(), 'media');
}

export async function subirImagenYObtenerId(nombreArchivo) {
  const cacheKey = String(nombreArchivo || '');
  if (!cacheKey) return null;
  if (mediaIdCache.has(cacheKey)) return mediaIdCache.get(cacheKey);

  try {
    const token = process.env.WHATSAPP_TOKEN;
    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    if (!token || !phoneId) {
      console.error('❌ Falta WHATSAPP_TOKEN o WHATSAPP_PHONE_NUMBER_ID en las variables de entorno.');
      return null;
    }

    const imagesDir = resolveLocalImagesDir();
    const filePath = path.join(imagesDir, cacheKey);
    if (!fs.existsSync(filePath)) {
      console.error(`❌ Archivo no encontrado en disco: ${filePath}`);
      return null;
    }

    const fileBuffer = fs.readFileSync(filePath);
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('file', new Blob([fileBuffer], { type: 'image/jpeg' }), cacheKey);

    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${phoneId}/media`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });

    const data = await res.json();
    if (!res.ok || !data || !data.id) {
      console.error('❌ Error API WhatsApp Media Upload:', res.status, JSON.stringify(data));
      return null;
    }

    mediaIdCache.set(cacheKey, data.id);
    console.log(`✅ Imagen subida con éxito (${cacheKey}) - Media ID: ${data.id}`);
    return data.id;
  } catch (err) {
    console.error(`❌ Excepción en subirImagenYObtenerId (${cacheKey}):`, err && (err.message || err));
    return null;
  }
}

export async function enviarImagenWhatsapp(numeroDestino, nombreArchivo) {
  let tracking = null;
  try {
    const token = process.env.WHATSAPP_TOKEN;
    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    if (!token || !phoneId) {
      console.error('❌ Falta WHATSAPP_TOKEN o WHATSAPP_PHONE_NUMBER_ID en las variables de entorno.');
      return false;
    }
    tracking = await claimMediaSend({ recipient: numeroDestino, imageKey: nombreArchivo });
    if (!tracking.claimed) return false;

    const mediaId = await subirImagenYObtenerId(nombreArchivo);
    if (!mediaId) {
      console.warn(`⚠️ No se obtuvo mediaId para ${nombreArchivo}; omitiendo envío de imagen.`);
      await completeMediaSend(tracking.id, 'failed', 'media upload failed');
      return false;
    }

    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${phoneId}/messages`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: numeroDestino,
        type: 'image',
        image: { id: mediaId },
      }),
    });

    const data = await res.json();
    if (!res.ok || (data && data.error)) {
      console.error('❌ Error API WhatsApp Message Image:', res.status, JSON.stringify(data));
      return false;
    }

    console.log(`✅ Imagen enviada a ${numeroDestino} (${nombreArchivo}) - message response: ${JSON.stringify(data).slice(0, 200)}`);
    await completeMediaSend(tracking.id, 'sent');
    return true;
  } catch (err) {
    await completeMediaSend(tracking?.id, 'failed', err?.message || err);
    console.error('❌ Excepción en enviarImagenWhatsapp:', err && (err.message || err));
    return false;
  }
}
