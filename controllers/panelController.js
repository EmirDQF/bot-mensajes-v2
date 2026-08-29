import fs from 'fs/promises';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import config from '../config/env.js';
import { sendPanelMessage } from './panelMessaging.js';

// Flexible timestamp formatter: accepts seconds, milliseconds, or ISO strings
function formatTime(value) {
  try {
    if (!value) return null;
    let dt;
    if (typeof value === 'number' || /^[0-9]+$/.test(String(value))) {
      // If looks like seconds (10 digits) or milliseconds (13 digits)
      const v = Number(value);
      dt = v > 1e12 ? new Date(v) : new Date(v * 1000);
    } else {
      dt = new Date(value);
    }
    if (Number.isNaN(dt.getTime())) return null;
    return new Intl.DateTimeFormat('es-PE', { hour: '2-digit', minute: '2-digit', hour12: true }).format(dt);
  } catch (e) {
    return null;
  }
}

async function readJsonIfExists(p) {
  try {
    const raw = await fs.readFile(p, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

let supabaseClient = null;
function getSupabaseClient() {
  if (supabaseClient) return supabaseClient;
  const rawUrl = config.supabase?.url || process.env.SUPABASE_URL;
  const key = config.supabase?.serviceRoleKey || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE;
  if (!rawUrl || !key) return null;
  supabaseClient = createClient(rawUrl, key);
  return supabaseClient;
}

function mapRowToConversation(row) {
  const phone = row.phone || row.sender_phone || row.contact_phone || row.from || row.to || row.whatsapp_number || row.whatsapp_id || null;
  const name = row.contact_name || row.name || row.profile_name || row.sender_name || null;
  const lastMessage = row.body || row.last_message || row.message || row.text || row.content || null;
  const ts = row.updated_at || row.last_message_ts || row.created_at || row.timestamp || null;
  return {
    phone,
    name,
    lastMessage,
    timestamp: ts,
    timeLabel: ts ? formatTime(ts) : null,
    status: row.status || row.direction || null,
  };
}

// GET /api/panel/conversations
export async function getConversations(req, res) {
  // Prefer Supabase if configured
  const client = getSupabaseClient();
  if (client) {
    try {
      // Try chat_sessions table first (preferred for session-based chat history)
      let { data, error } = await client.from('chat_sessions').select('id, history, updated_at').order('updated_at', { ascending: false }).limit(500);
      if (error && String(error.message || '').toLowerCase().includes('relation')) {
        data = null; error = null;
      }

      if (Array.isArray(data) && data.length) {
        const out = [];
        for (const row of data) {
          // history is expected to be an array of messages
          const hist = Array.isArray(row.history) ? row.history : (row.history && typeof row.history === 'string' ? JSON.parse(row.history) : []);
          // try to find phone in session metadata or messages
          let phone = null;
          let name = null;
          let lastMessageText = null;
          let lastTs = row.updated_at || null;
          if (hist.length) {
            // find last non-empty message
            const last = hist[hist.length - 1];
            lastMessageText = last?.text || last?.body || last?.message || null;
            lastTs = last?.timestamp || last?.created_at || lastTs;
            for (const m of hist) {
              if (!phone) phone = m.phone || m.from || m.to || m.sender_phone || m.contact_phone || null;
              if (!name) name = m.contact_name || m.name || m.sender_name || null;
              if (phone && name) break;
            }
          }

          // fallback: use session id if looks like a phone
          if (!phone && typeof row.id === 'string') {
            const digits = row.id.replace(/\D/g, '');
            if (digits.length >= 8) phone = digits;
          }

          if (!phone) continue;

          out.push({ phone, name, lastMessage: lastMessageText, timestamp: lastTs, timeLabel: lastTs ? formatTime(lastTs) : null, status: null });
        }
        return res.json(out);
      }

      // Try a dedicated inbox_entries table
      ({ data, error } = await client.from('inbox_entries').select('*').order('updated_at', { ascending: false }).limit(200));
      if (!error && Array.isArray(data) && data.length) {
        const out = data.map(mapRowToConversation).filter((c) => c.phone).map((c) => ({
          phone: c.phone,
          name: c.name,
          lastMessage: c.lastMessage,
          timestamp: c.timestamp,
          timeLabel: c.timeLabel,
          status: c.status,
        }));
        return res.json(out);
      }

      // Fallback: try a generic messages table and aggregate by phone
      const { data: msgs, error: msgsErr } = await client.from('messages').select('*').order('created_at', { ascending: false }).limit(1000);
      if (!msgsErr && Array.isArray(msgs) && msgs.length) {
        const byPhone = new Map();
        for (const m of msgs) {
          const phoneKey = m.phone || m.to || m.from || m.sender_phone || m.contact_phone || null;
          if (!phoneKey) continue;
          if (!byPhone.has(phoneKey)) {
            byPhone.set(phoneKey, m);
          }
        }
        const out = Array.from(byPhone.values()).map(mapRowToConversation);
        return res.json(out);
      }
    } catch (e) {
      console.warn('panelController.getConversations: supabase query failed:', e && e.message ? e.message : e);
      // fallthrough to file-based fallback
    }
  }

  // File-based fallback
  const dataPath = path.join(process.cwd(), 'data', 'conversations.json');
  const data = (await readJsonIfExists(dataPath)) || [];

  const normalized = data.map((c) => ({
    phone: c.phone,
    name: c.name || c.contactName || null,
    lastMessage: c.lastMessage || null,
    timestamp: c.timestamp || (c.lastMessageTs || null),
    status: c.status || 'unknown'
  }));

  normalized.sort((a, b) => (Number(b.timestamp || 0) - Number(a.timestamp || 0)));

  const out = normalized.map((c) => ({
    phone: c.phone,
    name: c.name,
    lastMessage: c.lastMessage,
    timestamp: c.timestamp,
    timeLabel: c.timestamp ? formatTime(c.timestamp) : null,
    status: c.status
  }));

  res.json(out);
}

// GET /api/panel/messages/:phone
export async function getMessages(req, res) {
  const { phone } = req.params;
  const client = getSupabaseClient();

  // Helper to normalize phone for simple matching (strip non-digits)
  const normalize = (p) => (p ? String(p).replace(/\D/g, '') : p);
  const normPhone = normalize(phone);

  if (client && normPhone) {
    try {
      // Try chat_sessions first: fetch sessions and find matching history entries
      let { data, error } = await client.from('chat_sessions').select('id, history, updated_at').order('updated_at', { ascending: false }).limit(500);
      if (error && String(error.message || '').toLowerCase().includes('relation')) { data = null; error = null; }
      if (Array.isArray(data) && data.length) {
        const messages = [];
        for (const row of data) {
          const hist = Array.isArray(row.history) ? row.history : (row.history && typeof row.history === 'string' ? JSON.parse(row.history) : []);
          for (const m of hist) {
            const candidates = [m.phone, m.from, m.to, m.sender_phone, m.contact_phone, m.whatsapp_id, m.whatsapp_number];
            const found = candidates.map((c)=>c?String(c).replace(/\D/g,''):'').find((d)=>d && d.endsWith(normPhone));
            if (found) {
              messages.push(m);
            }
          }
        }
        // sort by timestamp
        messages.sort((a,b)=>{
          const ta = a.timestamp || a.created_at || a.ts || null;
          const tb = b.timestamp || b.created_at || b.ts || null;
          const na = ta?Number(ta):0; const nb = tb?Number(tb):0; return na - nb;
        });

        const out = messages.map((m)=>{
          const text = m.text || m.body || m.message || null;
          const imgFromTag = text && (text.match(/\[ENVIAR_IMAGEN:\s*([^\]]+)\]/i) || [])[1];
          const rawImgName = imgFromTag || m.image || m.media_url || m.attachment || null;
          let img = null;
          if (rawImgName) {
            // Extract only filename portion
            const fname = String(rawImgName).split(/[\\/]/).pop();
            img = fname.startsWith('/LUMINZU/') ? fname : `/LUMINZU/${fname}`;
          }

          return {
            from: m.from || m.sender || (m.direction === 'outbound' ? 'bot' : 'patient'),
            text: text && String(text).replace(/\[ENVIAR_IMAGEN:[^\]]+\]/gi, '').trim() || null,
            image: img,
            timestamp: m.created_at || m.timestamp || m.ts || null,
            timeLabel: formatTime(m.created_at || m.timestamp || m.ts || null),
          };
        });
        return res.json(out);
      }

      // Query inbox_entries by any phone-like column
      const orFilter = `phone.eq.${normPhone},contact_phone.eq.${normPhone},sender_phone.eq.${normPhone},to.eq.${normPhone},from.eq.${normPhone}`;
      ({ data, error } = await client.from('inbox_entries').select('*').or(orFilter).order('created_at', { ascending: true }).limit(1000));
      if (!error && Array.isArray(data) && data.length) {
        const out = data.map((m) => ({
          from: m.from || m.sender || (m.direction === 'outbound' ? 'bot' : 'patient'),
          text: m.body || m.text || m.message || null,
          image: m.media_url || m.image || m.attachment || null,
          timestamp: m.created_at || m.timestamp || null,
          timeLabel: formatTime(m.created_at || m.timestamp || null),
        }));
        return res.json(out);
      }

      // Fallback to messages table
      const { data: msgs, error: msgsErr } = await client.from('messages').select('*').or(orFilter).order('created_at', { ascending: true }).limit(2000);
      if (!msgsErr && Array.isArray(msgs) && msgs.length) {
        const out = msgs.map((m) => ({
          from: m.from || m.sender || (m.is_bot ? 'bot' : 'patient'),
          text: m.body || m.text || m.message || null,
          image: m.media_url || m.image || m.attachment || null,
          timestamp: m.created_at || m.timestamp || null,
          timeLabel: formatTime(m.created_at || m.timestamp || null),
        }));
        return res.json(out);
      }
    } catch (e) {
      console.warn('panelController.getMessages: supabase query failed:', e && e.message ? e.message : e);
    }
  }

  // File-based fallback
  const phonePath = path.join(process.cwd(), 'data', `messages_${phone}.json`);
  const globalPath = path.join(process.cwd(), 'data', 'messages.json');

  let msgs = (await readJsonIfExists(phonePath));
  if (!msgs) msgs = (await readJsonIfExists(globalPath)) || [];

  if (Array.isArray(msgs) && msgs.length && msgs[0].phone !== undefined) {
    msgs = msgs.filter((m) => String(m.phone) === String(phone));
  }

  msgs.sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));

  const out = msgs.map((m) => ({
    from: m.from || m.sender || (m.isBot ? 'bot' : 'patient'),
    text: m.text || (m.body && m.body.text) || null,
    image: m.image || (m.media && m.media.filename) || null,
    timestamp: m.timestamp || null,
    timeLabel: m.timestamp ? formatTime(m.timestamp) : null
  }));

  res.json(out);
}

// POST /api/panel/toggle-bot/:phone
export async function toggleBot(req, res) {
  const { phone } = req.params;
  const dataDir = path.join(process.cwd(), 'data');
  await fs.mkdir(dataDir, { recursive: true });
  const statePath = path.join(dataDir, 'bot_state.json');
  const state = (await readJsonIfExists(statePath)) || {};

  const current = !!state[phone];
  state[phone] = !current;

  try {
    await fs.writeFile(statePath, JSON.stringify(state, null, 2), 'utf8');
    res.json({ phone, botEnabled: state[phone] });
  } catch (e) {
    console.error('Failed to write bot state', e && e.message ? e.message : e);
    res.status(500).json({ error: 'No se pudo cambiar el estado' });
  }
}

// POST /api/panel/send-message
export async function sendMessage(req, res) {
  return sendPanelMessage(req, res);
}
