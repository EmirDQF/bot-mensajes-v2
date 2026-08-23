import fs from 'fs';
import path from 'path';

const GRAPH_VERSION = 'v20.0';

export async function subirImagenYObtenerId(nombreArchivo) {
  try {
    const token = process.env.WHATSAPP_TOKEN;
    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    if (!token || !phoneId) {
      console.error('❌ Falta WHATSAPP_TOKEN o WHATSAPP_PHONE_NUMBER_ID en las variables de entorno.');
      return null;
    }

    const IMAGENES_DIR = fs.existsSync(path.resolve(process.cwd(), 'LUMINZU'))
      ? path.resolve(process.cwd(), 'LUMINZU')
      : path.resolve(process.cwd(), 'imagenes');
    const filePath = path.join(IMAGENES_DIR, nombreArchivo);

    if (!fs.existsSync(filePath)) {
      console.error(`❌ Archivo no encontrado en disco: ${filePath}`);
      return null;
    }

    console.debug(`📁 usando imagen desde: ${filePath}`);

    const fileBuffer = fs.readFileSync(filePath);
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('file', new Blob([fileBuffer], { type: 'image/jpeg' }), nombreArchivo);

    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${phoneId}/media`;
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: form,
      });
    } catch (networkErr) {
      console.error('❌ Network error al subir media a WhatsApp:', networkErr && (networkErr.message || networkErr));
      return null;
    }

    let data;
    try {
      data = await res.json();
    } catch (err) {
      console.error('❌ No se pudo parsear JSON de respuesta de WhatsApp Media:', err && err.message ? err.message : err);
      return null;
    }

    if (!res.ok || !data || !data.id) {
      console.error('❌ Error API WhatsApp Media Upload:', res.status, JSON.stringify(data));
      return null;
    }

    console.log(`✅ Imagen subida con éxito (${nombreArchivo}) - Media ID: ${data.id}`);
    return data.id;
  } catch (err) {
    console.error(`❌ Excepción en subirImagenYObtenerId (${nombreArchivo}):`, err && (err.message || err));
    return null;
  }
}

export async function enviarImagenWhatsapp(numeroDestino, nombreArchivo) {
  try {
    const token = process.env.WHATSAPP_TOKEN;
    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    if (!token || !phoneId) {
      console.error('❌ Falta WHATSAPP_TOKEN o WHATSAPP_PHONE_NUMBER_ID en las variables de entorno.');
      return false;
    }

    const mediaId = await subirImagenYObtenerId(nombreArchivo);
    if (!mediaId) {
      console.warn(`⚠️ No se obtuvo mediaId para ${nombreArchivo}; omitiendo envío de imagen.`);
      return false;
    }

    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${phoneId}/messages`;
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: numeroDestino,
          type: 'image',
          image: { id: mediaId },
        }),
      });
    } catch (networkErr) {
      console.error('❌ Network error al enviar mensaje de imagen a WhatsApp:', networkErr && (networkErr.message || networkErr));
      return false;
    }

    let data;
    try {
      data = await res.json();
    } catch (err) {
      console.error('❌ No se pudo parsear JSON de respuesta de WhatsApp Message:', err && err.message ? err.message : err);
      return false;
    }

    if (!res.ok || (data && data.error)) {
      console.error('❌ Error API WhatsApp Message Image:', res.status, JSON.stringify(data));
      return false;
    }

    console.log(`✅ Imagen enviada a ${numeroDestino} (${nombreArchivo}) - message response: ${JSON.stringify(data).slice(0,200)}`);
    return true;
  } catch (err) {
    console.error('❌ Excepción en enviarImagenWhatsapp:', err && (err.message || err));
    return false;
  }
}
