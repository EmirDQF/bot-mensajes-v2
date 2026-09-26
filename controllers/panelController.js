import fs from 'fs/promises';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import config from '../config/env.js';
import { sendPanelMessage } from './panelMessaging.js';
import { mediaPath } from '../config/clinic.config.js';
import { extractPhotoTags } from '../services/mediaTags.js';
import handoffService from '../services/handoffService.js';
import panelData from '../services/panelDataService.js';

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
        return res.json(await prioritizeWaitingHuman(client, out));
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
        return res.json(await prioritizeWaitingHuman(client, out));
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
        return res.json(await prioritizeWaitingHuman(client, out));
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
          const { keys: tagKeys, cleaned } = extractPhotoTags(text || '');
          const rawImg = m.image || m.media_url || m.attachment || null;
          let img = tagKeys.length ? mediaPath(tagKeys[0]) : null;
          if (!img && rawImg) {
            const value = String(rawImg);
            img = /^https?:\/\//i.test(value) || value.startsWith('/media/') ? value : `/media/${value.split(/[\\/]/).pop()}`;
          }

          return {
            from: m.from || m.sender || (m.direction === 'outbound' ? 'bot' : 'patient'),
            text: cleaned || null,
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
// POST /api/panel/toggle-bot/:phone — pausa o reactiva el bot en una conversación (pase a humano).
// El estado vive en conversations.status ('human' = pausado) vía handoffService, el mismo que usa el webhook.
// Body opcional { paused: true|false } para fijarlo en vez de alternarlo.
export async function toggleBot(req, res) {
  const phone = String(req.params.phone || '').replace(/\D/g, '');
  if (!phone) return res.status(400).json({ error: 'Teléfono inválido' });
  try {
    const paused = typeof req.body?.paused === 'boolean'
      ? await handoffService.setPaused(phone, req.body.paused)
      : await handoffService.toggle(phone);
    return res.json({ phone, botEnabled: !paused });
  } catch (e) {
    console.error('Failed to toggle bot state', e && e.message ? e.message : e);
    return res.status(500).json({ error: 'No se pudo cambiar el estado' });
  }
}

// POST /api/panel/send-message
export async function sendMessage(req, res) {
  return sendPanelMessage(req, res);
}

// Marca las conversaciones con el bot en pausa (conversations.status = 'human') y las pone primero.
export async function prioritizeWaitingHuman(client, list) {
  let waiting = new Set();
  try {
    const { data, error } = await client.from('conversations').select('conversation_id').eq('status', 'human');
    if (error) throw error;
    waiting = new Set((data || []).map((row) => String(row.conversation_id || '').replace(/\D/g, '')));
  } catch (e) {
    console.warn('panelController: no se pudo leer el estado de pase a humano:', e && e.message ? e.message : e);
  }
  return list
    .map((c) => ({ ...c, waitingHuman: waiting.has(String(c.phone || '').replace(/\D/g, '')) }))
    .sort((a, b) => Number(b.waitingHuman) - Number(a.waitingHuman));
}

const sendPanelError = (res, e, fallback) => {
  console.error(`[Panel] ${fallback}:`, e && e.message ? e.message : e);
  if (e?.status === 400) return res.status(400).json({ error: e.message });
  const message = String(e?.message || '');
  const missingTable = message.match(/table '?public\.(\w+)'?|relation "?(?:public\.)?(\w+)"? does not exist/i);
  if (missingTable) {
    const table = missingTable[1] || missingTable[2];
    const migration = table === 'follow_ups' ? '20260926_create_follow_ups.sql' : '20260925_create_appointments.sql';
    return res.status(503).json({ error: `${fallback}: falta la tabla "${table}". Ejecuta migrations/${migration} en Supabase.` });
  }
  if (/Supabase no configurado/i.test(message)) return res.status(503).json({ error: `${fallback}: ${message}` });
  return res.status(500).json({ error: fallback });
};

// GET /api/panel/agenda?day=today|tomorrow|YYYY-MM-DD
export async function getAgenda(req, res) {
  try {
    return res.json(await panelData.getAgenda(String(req.query.day || 'today')));
  } catch (e) {
    return sendPanelError(res, e, 'No se pudo cargar la agenda');
  }
}

// POST /api/panel/appointments/:id/status  { status: 'confirmada'|'asistio'|'no_asistio'|'cancelada' }
export async function setAppointmentStatus(req, res) {
  try {
    const updated = await panelData.setAppointmentStatus(String(req.params.id), String(req.body?.status || ''));
    return res.json({ id: updated?.id || req.params.id, status: updated?.status || req.body?.status });
  } catch (e) {
    return sendPanelError(res, e, 'No se pudo actualizar la cita');
  }
}

// GET /api/panel/metrics?days=30
export async function getMetrics(req, res) {
  try {
    return res.json(await panelData.getMetrics(req.query.days));
  } catch (e) {
    return sendPanelError(res, e, 'No se pudieron calcular las métricas');
  }
}
