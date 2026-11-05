import fs from 'fs';
import path from 'path';

// Cargador mínimo de .env: líneas KEY=VALUE, ignora comentarios y líneas vacías.
// Solo define process.env[key] si aún no existe (las variables de Render/PM2 mandan).
// IMPORTANTE: tiene que ser el PRIMER import de cada punto de entrada (index.js, scripts/lib/cli.js,
// scripts/preflight.js...). config/env.js lee process.env al importarse: si se importa antes, ve todo vacío
// ("Define SUPABASE_URL…" aunque esté en .env).
export function loadDotEnv({ cwd = process.cwd(), env = process.env } = {}) {
  const envPath = path.resolve(cwd, '.env');
  try {
    if (!fs.existsSync(envPath)) return 0;
    let loaded = 0;
    for (const line of fs.readFileSync(envPath, { encoding: 'utf8' }).split(/\r?\n/)) {
      const l = line.trim();
      if (!l || l.startsWith('#')) continue;
      const idx = l.indexOf('=');
      if (idx === -1) continue;
      const key = l.slice(0, idx).trim();
      let val = l.slice(idx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!Object.prototype.hasOwnProperty.call(env, key) || env[key] === undefined) {
        env[key] = val;
        loaded += 1;
      }
    }
    return loaded;
  } catch (e) {
    // No es fatal; se avisa sin mostrar valores.
    console.warn('envLoader: no se pudo leer .env —', e && e.message ? e.message : e);
    return 0;
  }
}

// Los tests (NODE_ENV=test) nunca leen el .env real: así no tocan Supabase, Meta ni Gemini de verdad.
if (process.env.NODE_ENV !== 'test') loadDotEnv();

export default null;
