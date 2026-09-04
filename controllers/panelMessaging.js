import fs from 'fs/promises';
import path from 'path';
import { claimMediaSend, completeMediaSend, hasMediaBeenSent, markMediaAsSent } from '../services/mediaTrackingService.js';

async function uploadLocalImage(filename, token, phoneId) {
  const safeFilename = path.basename(String(filename));
  const filePath = path.resolve(process.cwd(), 'media', safeFilename);
  const fileBuffer = await fs.readFile(filePath);
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', 'image/jpeg');
  form.append('file', new Blob([fileBuffer], { type: 'image/jpeg' }), safeFilename);

  const response = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/media`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.id) {
    console.error('WhatsApp media upload failed:', { status: response.status, body: result });
    throw new Error('No se pudo subir la imagen local a WhatsApp');
  }
  return result.id;
}

async function readJsonIfExists(p) {
  try {
    const raw = await fs.readFile(p, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function persistSentPanelMessage(phone, text, imageUrl) {
  const dataPath = path.join(process.cwd(), 'data', 'messages.json');
  try {
    const existing = (await readJsonIfExists(dataPath)) || [];
    existing.push({
      phone,
      from: 'panel',
      text: text || null,
      image: imageUrl || null,
      timestamp: Math.floor(Date.now() / 1000),
    });
    await fs.mkdir(path.dirname(dataPath), { recursive: true });
    await fs.writeFile(dataPath, JSON.stringify(existing, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.warn('Could not persist sent message locally', error && error.message ? error.message : error);
    return false;
  }
}

export async function sendPanelMessage(req, res) {
  const { phone, text, imageUrl } = req.body || {};
  if (!phone || (!text && !imageUrl)) {
    return res.status(400).json({ error: 'Se requiere phone y text o imageUrl' });
  }

  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneId) {
    return res.status(501).json({ error: 'WHATSAPP_TOKEN o WHATSAPP_PHONE_NUMBER_ID no configurados en el entorno' });
  }

  try {
    const url = `https://graph.facebook.com/v21.0/${phoneId}/messages`;
    const isPublicUrl = /^https?:\/\//i.test(String(imageUrl || ''));
    const imageKey = imageUrl ? path.basename(String(imageUrl).split('?')[0]) : null;
    const alreadySent = imageKey ? await hasMediaBeenSent(phone, imageKey) : false;
    const claim = imageKey && !alreadySent
      ? await claimMediaSend({ recipient: phone, imageKey })
      : { claimed: false };
    const image = imageUrl && claim.claimed
      ? isPublicUrl
        ? { link: imageUrl, caption: text || '' }
        : { id: await uploadLocalImage(imageUrl, token, phoneId), caption: text || '' }
      : null;
    const body = image
      ? { messaging_product: 'whatsapp', to: phone, type: 'image', image }
      : { messaging_product: 'whatsapp', to: phone, type: 'text', text: { body: text || '' } };

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const j = await resp.json();
    if (!resp.ok) {
      console.error('WhatsApp API error', j);
      if (claim.id) await completeMediaSend(claim.id, 'failed', j?.error?.message || 'WhatsApp API error');
      return res.status(502).json({ error: 'Error from WhatsApp API', details: j });
    }

    if (claim.id) {
      await completeMediaSend(claim.id, 'sent');
      await markMediaAsSent(phone, imageKey);
    }
    await persistSentPanelMessage(phone, text, imageUrl);
    res.json({ ok: true, result: j });
  } catch (error) {
    console.error('sendMessage error', error && error.message ? error.message : error);
    res.status(500).json({ error: 'Failed to send message' });
  }
}

export default { sendPanelMessage, persistSentPanelMessage };
