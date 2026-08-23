import fs from 'fs/promises';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import config from '../config/env.js';

function readJsonIfExists(p) {
  return fs.readFile(p, 'utf8').then(JSON.parse).catch(() => null);
}

function getSupabaseClient() {
  const rawUrl = config.supabase?.url || process.env.SUPABASE_URL;
  const key = config.supabase?.serviceRoleKey || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE;
  if (!rawUrl || !key) return null;
  return createClient(rawUrl, key);
}

export async function sendMessage(req, res) {
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
    const url = `https://graph.facebook.com/v17.0/${phoneId}/messages`;
    const body = imageUrl
      ? { messaging_product: 'whatsapp', to: phone, type: 'image', image: { link: imageUrl, caption: text || '' } }
      : { messaging_product: 'whatsapp', to: phone, type: 'text', text: { body: text } };

    const resp = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const j = await resp.json();
    if (!resp.ok) {
      console.error('WhatsApp API error', j);
      return res.status(502).json({ error: 'Error from WhatsApp API', details: j });
    }

    // Persist locally for panel fallback
    try {
      const dataPath = path.join(process.cwd(), 'data', 'messages.json');
      const existing = (await readJsonIfExists(dataPath)) || [];
      existing.push({ phone, from: 'panel', text: text || null, image: imageUrl || null, timestamp: Math.floor(Date.now() / 1000) });
      await fs.mkdir(path.dirname(dataPath), { recursive: true });
      await fs.writeFile(dataPath, JSON.stringify(existing, null, 2), 'utf8');
    } catch (e) {
      console.warn('Could not persist sent message locally', e && e.message ? e.message : e);
    }

    // Also persist to chat_sessions in Supabase when available
    const client = getSupabaseClient();
    if (client) {
      try {
        const sessionId = String(phone).replace(/\D/g, '') || String(phone);
        let { data: existing, error: exErr } = await client.from('chat_sessions').select('id, history').eq('id', sessionId).maybeSingle();
        if (exErr) { existing = null; }
        let history = [];
        if (existing && existing.history) history = Array.isArray(existing.history) ? existing.history : JSON.parse(existing.history);
        const entry = { from: 'panel', text: text || null, image: imageUrl ? String(imageUrl).split(/[\\/]/).pop() : null, timestamp: new Date().toISOString(), phone };
        history.push(entry);
        await client.from('chat_sessions').upsert([{ id: sessionId, history, updated_at: new Date().toISOString() }], { onConflict: 'id' });
      } catch (e) {
        console.warn('Could not persist sent message to chat_sessions:', e && e.message ? e.message : e);
      }
    }

    res.json({ ok: true, result: j });
  } catch (e) {
    console.error('sendMessage error', e && e.message ? e.message : e);
    res.status(500).json({ error: 'Failed to send message' });
  }
}
