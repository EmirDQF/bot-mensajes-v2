// Supabase-backed DB adapter. Uses SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (service role) from env.
// Exposes the same interface: init, getConversations, getMessages, saveMessage, searchConversations, emitter

const { EventEmitter } = require('events');
const emitter = new EventEmitter();
const { createClient } = require('@supabase/supabase-js');

let supabase = null;

async function init() {
  if (supabase) return;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.warn('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set — falling back to in-memory DB');
    return;
  }
  supabase = createClient(url, key, { auth: { persistSession: false } });
}

async function getConversations() {
  if (!supabase) return [];
  // Select conversations ordered by last_message_at desc
  const { data, error } = await supabase
    .from('conversations')
    .select('id,conversation_id,contact_number,contact_name,last_message_at,created_at')
    .order('last_message_at', { ascending: false });
  if (error) {
    console.error('getConversations error', error);
    return [];
  }
  return data;
}

async function getMessages(conversation_id, limit = 1000) {
  if (!supabase) return [];
  // Fetch messages for conversation_id ordered ascending by created_at
  const { data, error } = await supabase
    .from('messages')
    .select('id,conversation_id,sender,type,content,media_url,created_at')
    .eq('conversation_id', conversation_id)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) {
    console.error('getMessages error', error);
    return [];
  }
  return data;
}

async function saveMessage(msg) {
  // msg: { conversation_id, contact_name, sender, type, content, media_url, timestamp }
  if (!supabase) {
    // no DB — emit but do nothing
    const fallback = { id: `local-${Date.now()}`, ...msg, created_at: msg.timestamp || new Date().toISOString() };
    emitter.emit('message_saved', fallback);
    return fallback;
  }

  const t = msg.timestamp || new Date().toISOString();
  // Ensure conversation exists (upsert)
  const convPayload = {
    conversation_id: msg.conversation_id,
    contact_number: msg.conversation_id,
    contact_name: msg.contact_name || null,
    last_message_at: t
  };

  // Upsert conversation by conversation_id
  const { error: upsertErr } = await supabase
    .from('conversations')
    .upsert(convPayload, { onConflict: 'conversation_id' });
  if (upsertErr) console.error('upsert conversation error', upsertErr);

  // Insert message
  const insertPayload = {
    conversation_id: msg.conversation_id,
    sender: msg.sender,
    type: msg.type || 'text',
    content: msg.content || null,
    media_url: msg.media_url || null,
    created_at: t,
    raw_payload: msg.raw_payload || null
  };

  const { data, error: insertErr } = await supabase
    .from('messages')
    .insert([insertPayload])
    .select()
    .single();

  if (insertErr) {
    console.error('insert message error', insertErr);
    // still emit fallback
    const fallback = { id: `err-${Date.now()}`, ...insertPayload };
    emitter.emit('message_saved', fallback);
    return fallback;
  }

  // Update conversation last_message_at (in case upsert didn't)
  const { error: convUpdateErr } = await supabase
    .from('conversations')
    .update({ last_message_at: t, contact_name: msg.contact_name || null })
    .eq('conversation_id', msg.conversation_id);
  if (convUpdateErr) console.error('conversation update error', convUpdateErr);

  // Compose message object to emit
  const message = {
    id: data.id,
    conversation_id: data.conversation_id,
    sender: data.sender,
    type: data.type,
    content: data.content,
    media_url: data.media_url,
    created_at: data.created_at
  };

  emitter.emit('message_saved', message);
  return message;
}

async function searchConversations(q) {
  if (!supabase) return [];
  if (!q) return await getConversations();

  // Search by contact_name or contact_number ILIKE
  const { data, error } = await supabase
    .from('conversations')
    .select('id,conversation_id,contact_number,contact_name,last_message_at,created_at')
    .or(`contact_name.ilike.%${q}%,contact_number.ilike.%${q}%`)
    .order('last_message_at', { ascending: false });
  if (error) {
    console.error('searchConversations error', error);
    return [];
  }
  return data;
}

module.exports = {
  init,
  getConversations,
  getMessages,
  saveMessage,
  searchConversations,
  emitter
};
