import { createClient } from '@supabase/supabase-js';
import config from '../config/env.js';

// Meta reintenta el webhook si no recibe el 200 a tiempo (por ejemplo, mientras Render despierta).
// Cada message.id se procesa una sola vez: memoria (24 h) + tabla webhook_events, que sobrevive a
// reinicios. Sin la tabla (migrations/20260928_create_webhook_events.sql) queda solo la memoria.

const DAY_MS = 24 * 60 * 60 * 1000;

let defaultClient = null;
function getDefaultClient() {
  if (defaultClient) return defaultClient;
  if (!config.supabase?.url || !config.supabase?.serviceRoleKey) return null;
  defaultClient = createClient(config.supabase.url, config.supabase.serviceRoleKey);
  return defaultClient;
}

export function createMessageDedup({ getClient = getDefaultClient, ttlMs = DAY_MS, maxEntries = 10000, now = () => Date.now() } = {}) {
  const seenAt = new Map();
  let warned = false;

  function remember(id) {
    seenAt.set(id, now());
    if (seenAt.size > maxEntries) {
      // Map conserva el orden de inserción: se descartan los más antiguos.
      for (const [key, at] of seenAt) {
        if (seenAt.size <= maxEntries && now() - at < ttlMs) break;
        seenAt.delete(key);
      }
    }
  }

  // true si el mensaje ya se había recibido (y por lo tanto no debe procesarse otra vez).
  async function seen(messageId) {
    const id = String(messageId || '').trim();
    if (!id) return false;
    const at = seenAt.get(id);
    if (at && now() - at < ttlMs) return true;
    remember(id);
    try {
      const client = await getClient();
      if (!client) return false;
      const { error } = await client.from('webhook_events').insert([{ message_id: id }]);
      if (!error) return false;
      if (error.code === '23505') return true;
      throw error;
    } catch (error) {
      if (!warned) {
        console.warn('[Webhook] Deduplicación solo en memoria (¿falta migrations/20260928_create_webhook_events.sql?):', error?.message || error);
        warned = true;
      }
      return false;
    }
  }

  // Limpieza de la tabla (se llama desde el resumen diario).
  async function prune(days = 7) {
    const client = await getClient();
    if (!client) return { pruned: false };
    const before = new Date(now() - days * DAY_MS).toISOString();
    const { error } = await client.from('webhook_events').delete().lt('received_at', before);
    if (error) throw error;
    return { pruned: true };
  }

  return { seen, prune };
}

const messageDedup = createMessageDedup();
export default messageDedup;
