import config from '../config/env.js';
import { sendPanelMessage } from './panelMessaging.js';

export async function sendMessage(req, res) {
  const { phone, text, imageUrl } = req.body || {};
  if (!phone || (!text && !imageUrl)) {
    return res.status(400).json({ error: 'Se requiere phone y text o imageUrl' });
  }

  const token = process.env.WHATSAPP_TOKEN || config.whatsapp?.token;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.PHONE_NUMBER_ID || config.whatsapp?.phoneNumberId;
  if (!token || !phoneNumberId) {
    return res.status(501).json({ error: 'WHATSAPP_TOKEN o PHONE_NUMBER_ID no configurados' });
  }

  const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;
  const body = imageUrl
    ? { messaging_product: 'whatsapp', to: phone, type: 'image', image: { link: imageUrl, caption: text || '' } }
    : { messaging_product: 'whatsapp', to: phone, type: 'text', text: { body: text || '' } };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const result = await response.json().catch(() => null);
    if (!response.ok) {
      console.error('WhatsApp Graph API error:', { status: response.status, body: result });
      return res.status(502).json({ error: 'Error from WhatsApp API', details: result });
    }

    return res.json({ ok: true, result });
  } catch (error) {
    console.error('sendMessage error:', error && error.message ? error.message : error);
    return res.status(500).json({ error: 'Failed to send message' });
  }
}

export default { sendMessage };
