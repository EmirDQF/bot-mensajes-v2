import fs from 'fs/promises';
import path from 'path';

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
    const url = `https://graph.facebook.com/v20.0/${phoneId}/messages`;
    const body = imageUrl
      ? { messaging_product: 'whatsapp', to: phone, type: 'image', image: { link: imageUrl, caption: text || '' } }
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
      return res.status(502).json({ error: 'Error from WhatsApp API', details: j });
    }

    await persistSentPanelMessage(phone, text, imageUrl);
    res.json({ ok: true, result: j });
  } catch (error) {
    console.error('sendMessage error', error && error.message ? error.message : error);
    res.status(500).json({ error: 'Failed to send message' });
  }
}

export default { sendPanelMessage, persistSentPanelMessage };
