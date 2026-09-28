import { createClient } from '@supabase/supabase-js';
import config from '../config/env.js';
import { isDemoMode } from './demo/demoFlag.js';

// Cliente único de Supabase (service role) para todo el servidor. Devuelve null si faltan
// SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY: cada servicio decide cómo degradar sin base de datos.
// Los tests no lo usan: inyectan un Supabase falso con las fábricas create*({ getClient }).
// Modo demo (npm run demo): se usa el Supabase EN MEMORIA de services/demo/; con DEMO_MODE activo
// nunca se devuelve el cliente real, así los datos inventados jamás llegan a la base de la clínica.

let client = null;
let inMemory = null;

export function useInMemorySupabase(db) {
  inMemory = db || null;
}

export function getSupabase() {
  if (inMemory) return inMemory;
  if (isDemoMode()) return null;
  if (client) return client;
  if (!config.supabase?.url || !config.supabase?.serviceRoleKey) return null;
  client = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

export default getSupabase;
