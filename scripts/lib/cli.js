// Utilidades compartidas por los scripts de go-live (meta:*, db:*, crons:setup, smoke:prod).
// Regla: ningún script imprime secretos. Todo texto que sale a la consola pasa por redact().
import path from 'path';
import { pathToFileURL } from 'url';

const SECRET_VARS = [
  'WHATSAPP_TOKEN', 'WHATSAPP_APP_SECRET', 'WHATSAPP_WEBHOOK_VERIFY_TOKEN', 'GEMINI_API_KEY',
  'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_DB_URL', 'CRON_SECRET', 'CRONJOB_API_KEY',
  'PANEL_PASSWORD', 'PANEL_OWNER_PASSWORD', 'PANEL_SESSION_SECRET', 'META_APP_SECRET',
];

// Reemplaza cualquier valor secreto del entorno (y tokens con forma de token) por "****".
export function redact(text, env = process.env) {
  let out = String(text ?? '');
  for (const name of SECRET_VARS) {
    const value = String(env[name] || '');
    if (value.length >= 6) out = out.split(value).join('****');
  }
  return out
    .replace(/(access_token|input_token)=[^&\s"]+/gi, '$1=****')
    .replace(/Bearer\s+[\w.|-]+/gi, 'Bearer ****')
    .replace(/postgres(?:ql)?:\/\/[^\s"]+/gi, 'postgres://****');
}

// Solo los últimos 4 caracteres de un id público (PHONE_NUMBER_ID, WABA_ID).
export const last4 = (value) => `…${String(value || '').slice(-4) || '????'}`;

// --dry-run es el defecto: nada cambia hasta que se pase --apply.
export function parseArgs(argv = process.argv.slice(2)) {
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  return { apply: flags.has('--apply'), positional: argv.filter((a) => !a.startsWith('--')), flags };
}

export async function loadEnv() {
  await import('../../src/envLoader.js');
  return process.env;
}

export const ICON = { ok: '✅', warn: '⚠️ ', fail: '❌', info: 'ℹ️ ', skip: '⏭️ ' };

export function printResults(title, results, log = console.log) {
  log(`\n${title}`);
  for (const r of results) log(redact(`  ${ICON[r.status] || '•'} ${r.label}${r.fix ? `\n      → ${r.fix}` : ''}`));
}

export const result = (status, label, fix) => ({ status, label, ...(fix ? { fix } : {}) });

// Ejecuta main() solo si el archivo se llamó directamente (los tests lo importan sin efectos).
export function runIfMain(metaUrl, main) {
  if (!process.argv[1] || metaUrl !== pathToFileURL(path.resolve(process.argv[1])).href) return;
  // exitCode (no process.exit): en Windows, salir con conexiones de fetch abiertas rompe libuv.
  main().then((code) => { process.exitCode = code || 0; }).catch((error) => {
    console.error(redact(`Error: ${error?.message || error}`));
    process.exitCode = 1;
  });
}
