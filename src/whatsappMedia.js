import fs from 'fs';
import path from 'path';

const GRAPH_VERSION = 'v20.0';

export async function subirImagenYObtenerId(nombreArchivo) {
  const token = process.env.WHATSAPP_TOKEN;
  if (!token) {
    console.error('❌ WHATSAPP_TOKEN no está configurado.');
    return null;
  }

  const IMAGENES_DIR = path.resolve(process.cwd(), 'imagenes');
  const filePath = path.join(IMAGENES_DIR, nombreArchivo);

  if (!fs.existsSync(filePath)) {
    console.error(`❌ No existe el archivo esperado: ${filePath}`);
    return null;
  }

  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('file', new Blob([fs.readFileSync(filePath)], { type: 'image/jpeg' }), nombreArchivo);

  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/media`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: form,
  });

  const data = await res.json();

  if (!data?.id) {
    console.error('❌ Error subiendo imagen a WhatsApp:', JSON.stringify(data));
    return null;
  }

  return data.id;
}

export async function enviarImagenWhatsapp(numeroDestino, nombreArchivo) {
  const token = process.env.WHATSAPP_TOKEN;
  if (!token) {
    console.error('❌ WHATSAPP_TOKEN no está configurado.');
    return false;
  }

  const mediaId = await subirImagenYObtenerId(nombreArchivo);
  if (!mediaId) return false;

  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
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

  const data = await res.json();

  if (data?.error) {
    console.error('❌ Error enviando imagen a WhatsApp:', JSON.stringify(data));
    return false;
  }

  return true;
}
