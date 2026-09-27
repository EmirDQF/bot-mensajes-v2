import { getSupabase } from './supabaseClient.js';
import defaultEvents from './liveEvents.js';
import { isMissingColumn } from './appointmentService.js';
import { describeMetaError } from './metaErrors.js';
import { testMode } from './testContext.js';

// Bandeja de WhatsApp propia: el único lugar que guarda mensajes en conversations/messages.
// Cada escritura publica un evento en el bus en vivo (services/liveEvents.js) para el panel.
// Sin la migración 20260929_live_inbox.sql sigue funcionando: guarda solo las columnas base.

const digits = (phone) => String(phone || '').replace(/\D/g, '');
const shortPhone = (phone) => { const d = digits(phone); return d.length >= 9 ? d.slice(-9) : d; };
const ROLE_BY_SENDER = { patient: 'user', bot: 'assistant', reception: 'assistant' };
const STATUS_RANK = { sent: 1, delivered: 2, read: 3 };
const ACTIVE_APPOINTMENTS = ['pendiente', 'confirmada', 'reprogramada'];
export const INBOX_FILTERS = ['all', 'unread', 'urgent', 'requests', 'paused'];
const LIVE_COLUMNS = ['sender', 'msg_type', 'media_id', 'media_url', 'status', 'status_error', 'status_at', 'is_test'];
const LIVE_CONVERSATION_COLUMNS = ['unread_count', 'last_inbound_at', 'handoff_reason', 'is_test', 'contact_name'];
const WINDOW_MS = 24 * 60 * 60 * 1000;

const previewOf = (text, type) => {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean) return clean.slice(0, 200);
  return { image: '📷 Foto', audio: '🎤 Audio', video: '🎬 Video', document: '📄 Documento', sticker: '💬 Sticker', template: '📨 Plantilla' }[type] || 'Mensaje';
};

// URL que el navegador puede abrir: la media del paciente pasa por el proxy autenticado del panel
// (nunca se expone el token de Meta) y las fotos del bot se sirven desde /media del mismo servidor.
export function panelMediaUrl({ media_id: mediaId, media_url: mediaUrl }) {
  if (mediaId && /^\d+$/.test(String(mediaId))) return `/api/panel/media/${mediaId}`;
  if (!mediaUrl) return null;
  const value = String(mediaUrl);
  const local = value.match(/^https?:\/\/[^/]+(\/media\/.+)$/i);
  if (local) return local[1];
  return /^https:\/\//i.test(value) || value.startsWith('/media/') ? value : null;
}

// Fila de messages → mensaje del panel. Las filas antiguas (sin sender) se deducen por el rol.
export function toClientMessage(row) {
  const sender = row.sender || (row.role === 'user' ? 'patient' : 'bot');
  return {
    id: row.id ?? row.whatsapp_message_id ?? null,
    wamid: row.whatsapp_message_id || null,
    phone: digits(row.phone),
    sender,
    text: row.content || '',
    type: row.msg_type || 'text',
    mediaUrl: panelMediaUrl(row),
    status: row.status || null,
    error: row.status_error || null,
    at: row.created_at || null,
    isTest: Boolean(row.is_test),
  };
}

export function createInboxService({ getClient = getSupabase, events = defaultEvents, now = () => new Date() } = {}) {
  async function db() {
    const client = await getClient();
    if (!client) throw Object.assign(new Error('Supabase no configurado (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY)'), { status: 503 });
    return client;
  }

  const hasLiveColumnError = (error, columns) => columns.some((column) => isMissingColumn(error, column));
  const without = (row, columns) => Object.fromEntries(Object.entries(row).filter(([key]) => !columns.includes(key)));

  async function upsertConversation(client, phone, { preview, at, sender, contactName, isTest }) {
    const base = {
      conversation_id: phone, contact_number: phone, phone,
      last_message: preview, last_message_at: at, updated_at: at,
      // status no se envía: 'human' (bot en pausa) lo gestiona handoffService y no debe pisarse.
    };
    const live = {};
    if (contactName && contactName !== phone) live.contact_name = String(contactName).slice(0, 120);
    if (isTest) live.is_test = true;
    if (sender === 'patient') {
      live.last_inbound_at = at;
      const { data } = await client.from('conversations').select('unread_count').eq('conversation_id', phone).maybeSingle();
      live.unread_count = Number(data?.unread_count || 0) + 1;
    }
    let { error } = await client.from('conversations').upsert({ ...base, ...live }, { onConflict: 'conversation_id' });
    if (error && hasLiveColumnError(error, LIVE_CONVERSATION_COLUMNS)) {
      ({ error } = await client.from('conversations').upsert(base, { onConflict: 'conversation_id' }));
    }
    if (error) throw error;
    return live.unread_count ?? null;
  }

  // Guarda un mensaje (paciente, bot o recepción), actualiza la conversación y avisa al panel.
  async function recordMessage({
    phone, sender, text = null, type = 'text', mediaId = null, mediaUrl = null, wamid = null,
    contactName = null, at = null, status = null, statusError = null, isTest = false,
  }) {
    const id = digits(phone);
    isTest = isTest || Boolean(testMode()?.isTest);
    if (!id || !ROLE_BY_SENDER[sender]) throw new Error('recordMessage necesita phone y sender (patient, bot o reception)');
    const ts = (at instanceof Date ? at : at ? new Date(at) : now()).toISOString();
    const client = await db();
    const unread = await upsertConversation(client, id, {
      preview: previewOf(text, type), at: ts, sender, contactName, isTest,
    });
    const row = {
      phone: id, from_phone: id, role: ROLE_BY_SENDER[sender], content: text || null,
      whatsapp_message_id: wamid, created_at: ts,
      sender, msg_type: type, media_id: mediaId, media_url: mediaUrl,
      status: status || (sender === 'patient' ? null : wamid ? 'sent' : null),
      status_error: statusError, is_test: Boolean(isTest),
    };
    let { data, error } = await client.from('messages').insert([row]).select().maybeSingle();
    if (error && hasLiveColumnError(error, LIVE_COLUMNS)) {
      ({ data, error } = await client.from('messages').insert([without(row, LIVE_COLUMNS)]).select().maybeSingle());
    }
    if (error) throw error;
    const message = toClientMessage({ ...row, ...(data || {}) });
    events.publish('message', {
      phone: id, message,
      conversation: { phone: id, name: contactName || null, lastMessage: previewOf(text, type), lastMessageAt: ts, unread },
    });
    return message;
  }

  // Estados de entrega de Meta (sent, delivered, read, failed). Nunca baja de estado: un "delivered"
  // que llega después de "read" se ignora; "failed" siempre se guarda con el motivo.
  async function applyStatuses(statuses = []) {
    const client = await db();
    const applied = [];
    for (const item of statuses) {
      const wamid = item?.id;
      const status = String(item?.status || '');
      if (!wamid || !['sent', 'delivered', 'read', 'failed'].includes(status)) continue;
      const { data: current, error: readError } = await client.from('messages').select('phone, status')
        .eq('whatsapp_message_id', wamid).maybeSingle();
      if (readError) {
        if (hasLiveColumnError(readError, ['status'])) return applied; // sin la migración: no hay dónde guardar
        throw readError;
      }
      if (!current) continue; // mensaje que no salió del bot (p. ej. una alerta a recepción)
      if (status !== 'failed' && (STATUS_RANK[current.status] || 0) >= STATUS_RANK[status]) continue;
      const error = status === 'failed' ? describeMetaError(item.errors?.[0]) : null;
      const at = Number(item.timestamp) > 0 ? new Date(Number(item.timestamp) * 1000).toISOString() : now().toISOString();
      const { error: updateError } = await client.from('messages')
        .update({ status, status_error: error, status_at: at }).eq('whatsapp_message_id', wamid);
      if (updateError) throw updateError;
      const phone = digits(item.recipient_id || current.phone);
      events.publish('status', { phone, wamid, status, error });
      applied.push({ wamid, status });
    }
    return applied;
  }

  async function markRead(phone) {
    const id = digits(phone);
    const client = await db();
    const { error } = await client.from('conversations').update({ unread_count: 0 }).eq('conversation_id', id);
    if (error && !hasLiveColumnError(error, ['unread_count'])) throw error;
    events.publish('conversation', { phone: id, unread: 0 });
    return { phone: id, unread: 0 };
  }

  async function getMessages(phone, { since = null, limit = 300 } = {}) {
    const id = digits(phone);
    const client = await db();
    let query = client.from('messages').select('*').eq('phone', id);
    if (since) query = query.gt('created_at', new Date(since).toISOString());
    const { data, error } = await query.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit);
    if (error) throw error;
    return (data || []).reverse().map(toClientMessage);
  }

  async function lastInboundAt(phone) {
    const client = await db();
    const { data, error } = await client.from('messages').select('created_at')
      .eq('phone', digits(phone)).eq('role', 'user')
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    return data?.created_at ? new Date(data.created_at) : null;
  }

  // ¿Se puede escribir texto libre? (el paciente escribió en las últimas 24 h)
  async function windowState(phone) {
    const last = await lastInboundAt(phone);
    const open = Boolean(last) && now() - last < WINDOW_MS;
    return { open, lastInboundAt: last ? last.toISOString() : null, closesAt: last ? new Date(last.getTime() + WINDOW_MS).toISOString() : null };
  }

  async function optionalRows(builder) {
    const { data, error } = await builder;
    if (error) {
      console.warn('[Inbox] Dato opcional no disponible:', error.message || error.code);
      return [];
    }
    return data || [];
  }

  // Lista de la bandeja con sus insignias: 🌙 fuera de horario, 🚨 urgencia, 📅 solicitud,
  // 🤖/👤 quién atiende, no leídos y lead score (si existe la ficha del paciente).
  async function listConversations({ filter = 'all', q = '', limit = 200 } = {}) {
    const client = await db();
    const { data, error } = await client.from('conversations').select('*')
      .order('last_message_at', { ascending: false }).limit(limit);
    if (error) throw error;
    const rows = data || [];
    const phones = rows.map((r) => digits(r.conversation_id || r.phone)).filter(Boolean);
    const [appointments, leads] = phones.length ? await Promise.all([
      optionalRows(client.from('appointments').select('sender_phone, status, appointment_date, appointment_time')
        .in('sender_phone', phones).in('status', ACTIVE_APPOINTMENTS)),
      optionalRows(client.from('leads').select('*').in('telefono', [...new Set(phones.map(shortPhone))])),
    ]) : [[], []];
    const requestByPhone = new Map(appointments.map((a) => [digits(a.sender_phone), a]));
    const leadByPhone = new Map(leads.map((l) => [shortPhone(l.telefono), l]));

    const list = rows.map((r) => {
      const phone = digits(r.conversation_id || r.phone);
      const lead = leadByPhone.get(shortPhone(phone));
      const request = requestByPhone.get(phone);
      return {
        phone,
        name: r.contact_name || lead?.nombre || null,
        lastMessage: r.last_message || '',
        lastMessageAt: r.last_message_at || r.updated_at || null,
        unread: Number(r.unread_count || 0),
        paused: r.status === 'human',
        urgent: r.status === 'human' && r.handoff_reason === 'urgencia',
        afterHours: Boolean(r.after_hours),
        request: request ? { status: request.status, date: request.appointment_date, time: String(request.appointment_time || '').slice(0, 5) } : null,
        leadScore: lead?.lead_score || null,
        leadScoreReason: lead?.lead_score_reason || null,
        tags: Array.isArray(lead?.tags) ? lead.tags : [],
        isTest: Boolean(r.is_test),
      };
    });
    const term = String(q || '').trim().toLowerCase();
    const termDigits = digits(term);
    // Urgencias primero; el resto, del mensaje más reciente al más antiguo.
    list.sort((a, b) => Number(b.urgent) - Number(a.urgent));
    return list.filter((c) => {
      if (filter === 'unread' && !c.unread) return false;
      if (filter === 'urgent' && !c.urgent) return false;
      if (filter === 'requests' && !c.request) return false;
      if (filter === 'paused' && !c.paused) return false;
      if (!term) return true;
      return (c.name || '').toLowerCase().includes(term) || (termDigits && c.phone.includes(termDigits))
        || c.lastMessage.toLowerCase().includes(term);
    });
  }

  return { recordMessage, applyStatuses, markRead, getMessages, lastInboundAt, windowState, listConversations };
}

const inboxService = createInboxService();
export default inboxService;
