import { createClient } from '@supabase/supabase-js';
import config from '../config/env.js';

// Cliente único de Supabase (service role) para todo el servidor. Devuelve null si faltan
// SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY: cada servicio decide cómo degradar sin base de datos.
// Los tests no lo usan: inyectan un Supabase falso con las fábricas create*({ getClient }).

let client = null;

export function getSupabase() {
  if (client) return client;
  if (!config.supabase?.url || !config.supabase?.serviceRoleKey) return null;
  client = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

export default getSupabase;
