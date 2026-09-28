import crypto from 'crypto';
import { assertDemoAllowed, isDemoMode } from './demoFlag.js';

// Arranque del modo demo: Supabase en memoria con los pacientes inventados de seed.js.
// index.js lo llama con import() dinámico después de cargar todos los servicios (evita ciclos).

export async function enableDemoMode({ env = process.env, log = console.log } = {}) {
  assertDemoAllowed(env);
  if (!isDemoMode(env)) return null;
  const [{ useInMemorySupabase }, { createMemoryDb }, { buildDemoData }, { default: clinic }, { now }] = await Promise.all([
    import('../supabaseClient.js'), import('./memoryDb.js'), import('./seed.js'), import('../../config/clinic.config.js'), import('../clock.js'),
  ]);
  const db = createMemoryDb(buildDemoData(clinic, now()), { now });
  useInMemorySupabase(db);

  // Sin cuenta de dueño en .env, se crea una de demo (solo para esta sesión local).
  if (!(env.PANEL_OWNER_USER && env.PANEL_OWNER_PASSWORD)) {
    env.PANEL_OWNER_USER = 'demo';
    env.PANEL_OWNER_PASSWORD = crypto.randomBytes(9).toString('base64url');
    log(`[Demo] Panel del dueño: usuario "demo", contraseña "${env.PANEL_OWNER_PASSWORD}" (solo para esta sesión)`);
  }
  const counts = Object.entries(db.data).map(([table, rows]) => `${rows.length} ${table}`).join(', ');
  log(`[Demo] MODO DEMO: Supabase en memoria (${counts}); WhatsApp simulado. Nada se guarda en la base real.`);
  return db;
}

export default enableDemoMode;
