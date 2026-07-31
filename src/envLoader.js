import fs from 'fs';
import path from 'path';

// Minimal .env loader: parse KEY=VALUE lines, ignore comments and blank lines.
// Only set process.env[key] when it's not already defined (so PM2/env overrides keep precedence).
const envPath = path.resolve(process.cwd(), '.env');

function loadEnv() {
  try {
    if (!fs.existsSync(envPath)) return;
    const raw = fs.readFileSync(envPath, { encoding: 'utf8' });
    for (const line of raw.split(/\r?\n/)) {
      const l = line.trim();
      if (!l || l.startsWith('#')) continue;
      const idx = l.indexOf('=');
      if (idx === -1) continue;
      const key = l.slice(0, idx).trim();
      let val = l.slice(idx + 1).trim();
      // remove optional surrounding quotes
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!Object.prototype.hasOwnProperty.call(process.env, key) || process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
  } catch (e) {
    // Non-fatal: we don't want the loader to crash the app
    // Prefer logging a warning so operators can inspect the environment manually
    // but do not print sensitive values.
    console.warn('envLoader: could not load .env —', e && e.message ? e.message : e);
  }
}

loadEnv();

export default null;
