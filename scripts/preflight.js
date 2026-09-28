// npm run preflight — revisa que todo esté listo para producción y dice cómo arreglar lo que falte.
// Variables, Supabase (tablas y columnas de TODAS las migraciones), token de WhatsApp (tipo y vigencia),
// WABA (número, app suscrita y plantillas), clave de Gemini y clínica activa. Nunca imprime secretos. No modifica nada (ni .env ni la base de datos).
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { TOKEN_STEPS } from '../services/systemAlerts.js';

const ROOT = process.cwd();

// ---------- Variables de entorno ----------
export const REQUIRED_ENV = [
  ['GEMINI_API_KEY', 'Google AI Studio → https://aistudio.google.com/apikey → "Crear clave de API". Se valida con una llamada real.'],
  ['WHATSAPP_TOKEN', 'Meta → Configuración del negocio → Usuarios del sistema → Generar token (permisos whatsapp_business_messaging y whatsapp_business_management).'],
  ['WHATSAPP_PHONE_NUMBER_ID', 'Meta for Developers → tu app → WhatsApp → Configuración de la API → "Identificador del número de teléfono".'],
  ['WHATSAPP_APP_SECRET', 'Meta for Developers → tu app → Configuración → Básica → "Clave secreta de la app".'],
  ['WHATSAPP_WEBHOOK_VERIFY_TOKEN', 'Inventa una frase larga y usa la misma al configurar el webhook en Meta.'],
  ['SUPABASE_URL', 'Supabase → Project Settings → API → Project URL (https://xxxx.supabase.co, sin /rest/v1).'],
  ['SUPABASE_SERVICE_ROLE_KEY', 'Supabase → Project Settings → API → service_role (secreta).'],
  ['PANEL_USER', 'Usuario del panel de recepción (/panel).'],
  ['PANEL_PASSWORD', 'Contraseña del panel de recepción (mínimo 12 caracteres).'],
  ['CRON_SECRET', 'Genera uno: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'],
  ['CLINIC_PHONE', 'Número de WhatsApp del bot, solo dígitos con código de país (Perú: 51XXXXXXXXX; número de prueba de Meta: 1555XXXXXXX).'],
  ['RECEPTION_ALERT_PHONE', 'WhatsApp de recepción: recibe citas nuevas, urgencias y pases a humano.'],
  ['OWNER_ALERT_PHONE', 'WhatsApp del dueño: recibe el resumen diario y el reporte semanal.'],
];

// Si faltan, el bot funciona pero queda una parte del go-live a mano (⚠️, no ❌).
export const RECOMMENDED_ENV = [
  ['WHATSAPP_BUSINESS_ACCOUNT_ID', 'Meta for Developers → tu app → WhatsApp → Configuración de la API → "Identificador de la cuenta de WhatsApp Business". Lo usan meta:check, meta:subscribe y meta:templates.'],
  ['PANEL_OWNER_USER', 'Usuario del dueño en el panel (⚙️ Configuración y 🧪 Probador). Distinto de PANEL_USER.'],
  ['PANEL_OWNER_PASSWORD', 'Contraseña del dueño (mínimo 12 caracteres, distinta de PANEL_PASSWORD).'],
  ['CRONJOB_API_KEY', 'Opcional: cron-job.org → Settings → API → Create API key. Con ella npm run crons:setup crea las 6 tareas solo.'],
];

const PHONE_VARS = ['CLINIC_PHONE', 'RECEPTION_ALERT_PHONE', 'OWNER_ALERT_PHONE'];

// Celular peruano (9 dígitos, con o sin 51) o cualquier número E.164 internacional (10-15 dígitos),
// como el número de prueba de Meta (+1 555…).
export function isValidPhone(value) {
  const d = String(value || '').replace(/\D/g, '');
  if (/^9\d{8}$/.test(d)) return true;
  if (d.startsWith('51') && d.length === 11) return /^519\d{8}$/.test(d);
  return /^[1-9]\d{9,14}$/.test(d);
}

export function checkEnv(env) {
  const results = [];
  for (const [name, fix] of REQUIRED_ENV) {
    const value = String(env[name] || '').trim();
    if (!value) {
      results.push(fail(`${name} no está definida`, fix));
      continue;
    }
    if (PHONE_VARS.includes(name) && !isValidPhone(value)) {
      results.push(fail(`${name} no parece un número de WhatsApp válido`, 'Solo dígitos con código de país: 51 + 9 dígitos en Perú (519XXXXXXXX) o el E.164 completo (10-15 dígitos), sin + ni espacios.'));
      continue;
    }
    results.push(pass(`${name} definida`));
  }
  for (const [name, fix] of RECOMMENDED_ENV) {
    if (!String(env[name] || '').trim()) results.push(warn(`${name} no está definida`, fix));
  }
  if (/\/rest\/v1\/?$/i.test(String(env.SUPABASE_URL || '').trim())) {
    results.push(warn('SUPABASE_URL termina en /rest/v1', 'Funciona (el bot lo corrige), pero déjala como https://xxxx.supabase.co.'));
  }
  if (env.CRON_SECRET && String(env.CRON_SECRET).length < 24) {
    results.push(fail('CRON_SECRET es muy corto', 'Usa al menos 24 caracteres aleatorios.'));
  }
  if (env.PANEL_PASSWORD && String(env.PANEL_PASSWORD).length < 12) {
    results.push(warn('PANEL_PASSWORD es corta', 'Usa al menos 12 caracteres: el panel muestra datos de pacientes.'));
  }
  if (String(env.ENFORCE_WHATSAPP_SIGNATURE || '').toLowerCase() !== 'true') {
    results.push(warn('ENFORCE_WHATSAPP_SIGNATURE no está en true', 'Ponla en true en producción: así solo Meta puede enviar mensajes al webhook.'));
  }
  const publicUrl = env.PUBLIC_BASE_URL || env.RENDER_EXTERNAL_URL || '';
  if (!publicUrl) {
    results.push(warn('PUBLIC_BASE_URL no está definida', 'En Render se usa RENDER_EXTERNAL_URL solo; en otro hosting define la URL pública (para las fotos).'));
  } else if (/localhost|127\.0\.0\.1/.test(publicUrl)) {
    results.push(warn('PUBLIC_BASE_URL apunta a localhost', 'WhatsApp no puede descargar fotos desde localhost: usa la URL pública.'));
  }
  return results;
}

// ---------- Esquema esperado (leído de migrations/*.sql) ----------
function splitTopLevel(body) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const ch of body) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current);
  return parts;
}

// Devuelve { tabla: { columns: Map(columna → migración), required, created } }.
export function parseMigrationSchema(files) {
  const schema = {};
  const table = (name) => (schema[name] ||= { columns: new Map(), required: false, created: false });
  for (const { name: file, sql } of files) {
    const text = sql.replace(/--[^\n]*/g, '').replace(/\r\n/g, '\n');
    for (const match of text.matchAll(/CREATE TABLE IF NOT EXISTS\s+(?:public\.)?(\w+)\s*\(([\s\S]*?)\n\);/gi)) {
      const t = table(match[1].toLowerCase());
      t.created = true;
      t.required = true;
      for (const item of splitTopLevel(match[2])) {
        const column = item.trim().match(/^"?(\w+)"?\s+/)?.[1];
        if (column && !/^(constraint|primary|unique|check|foreign)$/i.test(column) && !t.columns.has(column)) t.columns.set(column, file);
      }
    }
    for (const match of text.matchAll(/ALTER TABLE\s+(IF EXISTS\s+)?(?:public\.)?(\w+)([\s\S]*?);/gi)) {
      const t = table(match[2].toLowerCase());
      if (!match[1]) t.required = true;
      for (const add of match[3].matchAll(/ADD COLUMN\s+(?:IF NOT EXISTS\s+)?"?(\w+)"?/gi)) {
        if (!t.columns.has(add[1])) t.columns.set(add[1], file);
      }
    }
  }
  return schema;
}

export function readMigrations(dir = path.join(ROOT, 'migrations')) {
  return fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
    .map((name) => ({ name, sql: fs.readFileSync(path.join(dir, name), 'utf8') }));
}

// Tablas que el producto ya no usa (se conservan en Supabase, sin borrar datos): clinics guardaba la
// integración con Chatwoot, reemplazada por la bandeja propia del panel.
export const LEGACY_TABLES = new Set(['clinics']);

const TABLE_MISSING = new Set(['42P01', 'PGRST205', 'PGRST106']);
const COLUMN_MISSING = new Set(['42703', 'PGRST204']);

export async function checkSupabase(client, schema) {
  const results = [];
  if (!client) return [fail('No hay conexión a Supabase', 'Define SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.')];
  for (const [name, info] of Object.entries(schema)) {
    if (!info.required && !info.created) continue; // ALTER TABLE IF EXISTS sobre una tabla opcional
    if (LEGACY_TABLES.has(name)) continue;
    const columns = [...info.columns.keys()];
    const { error } = await client.from(name).select(columns.join(',') || '*').limit(1);
    if (!error) {
      results.push(pass(`Tabla ${name} (${columns.length} columnas)`));
      continue;
    }
    if (/invalid api key|jwt/i.test(String(error.message || '')) || error.code === '401') {
      return [fail('Supabase rechazó la clave', 'Revisa SUPABASE_SERVICE_ROLE_KEY (debe ser la service_role, no la anon).')];
    }
    if (TABLE_MISSING.has(error.code) || /does not exist|could not find the table/i.test(error.message || '') && !/column/i.test(error.message || '')) {
      const file = [...info.columns.values()][0];
      results.push({ ...fail(`Falta la tabla ${name}`, `Ejecuta migrations/${file} en Supabase → SQL Editor.`), files: [file] });
      continue;
    }
    if (COLUMN_MISSING.has(error.code) || /column/i.test(error.message || '')) {
      // Se busca cuál columna falta para decir qué migración ejecutar.
      const missing = [];
      for (const column of columns) {
        const { error: colError } = await client.from(name).select(column).limit(1);
        if (colError) missing.push(column);
      }
      const files = [...new Set(missing.map((c) => info.columns.get(c)))];
      results.push({ ...fail(`Tabla ${name}: faltan columnas (${missing.join(', ') || 'desconocidas'})`, `Ejecuta en Supabase → SQL Editor: ${files.map((f) => `migrations/${f}`).join(', ')}`), files });
      continue;
    }
    results.push(fail(`Tabla ${name}: ${error.message || error.code}`, 'Revisa SUPABASE_URL y que el proyecto no esté pausado (Supabase → Restore).'));
  }
  return results;
}

// Migraciones que faltan (en orden de fecha) según los ❌ de checkSupabase. Todas son idempotentes:
// volver a pegar una que ya estaba no rompe nada.
export function pendingMigrationFiles(results) {
  return [...new Set(results.flatMap((r) => r.files || []))].filter(Boolean).sort();
}

// Bloques "PEGA N° X" para el SQL Editor de Supabase. Al final se recarga la caché de PostgREST
// (si no, la API puede seguir diciendo que la tabla no existe aunque ya se creó).
export function formatPasteBlocks(files, readSql = (f) => fs.readFileSync(path.join(ROOT, 'migrations', f), 'utf8')) {
  if (!files.length) return '';
  const blocks = files.map((file, i) => {
    const reload = i === files.length - 1 ? "\n\n-- Recarga la caché de la API de Supabase\nNOTIFY pgrst, 'reload schema';" : '';
    return `===== PEGA N° ${i + 1} de ${files.length} — migrations/${file} =====\n${readSql(file).trim()}${reload}\n`;
  });
  return `\nSupabase → SQL Editor → New query: pega cada bloque, pulsa Run y espera "Success" antes del siguiente.\n\n${blocks.join('\n')}`;
}

// ---------- WhatsApp y Gemini ----------
export async function checkWhatsApp(env, fetchImpl) {
  if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) return [fail('WhatsApp sin probar', 'Define WHATSAPP_TOKEN y WHATSAPP_PHONE_NUMBER_ID.')];
  const version = env.WHATSAPP_API_VERSION || 'v21.0';
  try {
    const res = await fetchImpl(`https://graph.facebook.com/${version}/${encodeURIComponent(env.WHATSAPP_PHONE_NUMBER_ID)}?fields=verified_name,display_phone_number,quality_rating`, {
      headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}` },
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      const last4 = String(body.display_phone_number || '').replace(/\D/g, '').slice(-4);
      const results = [pass(`WhatsApp: número "${body.verified_name || 'sin nombre'}" (…${last4 || '????'}), calidad ${body.quality_rating || 'sin dato'}`)];
      if (isTestNumber(body)) {
        results.push(warn('WhatsApp: es el NÚMERO DE PRUEBA de Meta',
          'Solo escribe a los destinatarios autorizados en Meta for Developers → WhatsApp → Configuración de la API (campo "Para", máximo 5). Sirve para la demo, no para pacientes reales: registra el número propio de la clínica (docs/go-live.md).'));
      }
      return results;
    }
    const code = body.error?.code;
    if (code === 190) return [fail('TOKEN DE WHATSAPP VENCIDO: el token venció o no es válido', TOKEN_STEPS)];
    if (code === 100) return [fail('WhatsApp: WHATSAPP_PHONE_NUMBER_ID no existe para este token', 'Copia el "Identificador del número de teléfono" (no el número) desde Meta for Developers → WhatsApp → Configuración de la API.')];
    return [fail(`WhatsApp respondió ${res.status}`, body.error?.message ? `Meta dice: ${body.error.message}` : 'Revisa el token y el phone number id.')];
  } catch (error) {
    return [fail('No se pudo contactar a Meta', `Revisa tu conexión (${error.message}).`)];
  }
}

export const isTestNumber = (phone) => /^test number$/i.test(String(phone?.verified_name || '').trim());

// Se valida con una llamada real (generateContent de pocos tokens): funciona con cualquier formato de clave.
export async function checkGemini(env, fetchImpl) {
  if (!env.GEMINI_API_KEY) return [fail('Gemini sin probar', 'Define GEMINI_API_KEY.')];
  const model = env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
  try {
    const res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': env.GEMINI_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Responde solo: ok' }] }], generationConfig: { maxOutputTokens: 5 } }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) return [pass(`Gemini: la clave responde con el modelo ${model}`)];
    const reason = body.error?.details?.find((d) => d.reason)?.reason || body.error?.status || res.status;
    if (res.status === 404) return [fail(`Gemini: el modelo ${model} no existe para esta clave`, 'Usa GEMINI_MODEL=gemini-3.5-flash-lite (o uno que liste Google AI Studio).')];
    if (res.status === 429) return [warn(`Gemini: cuota agotada por ahora (${reason})`, 'La clave es válida; espera o revisa la cuota en Google AI Studio → Uso.')];
    if (res.status >= 500) return [warn(`Gemini respondió ${res.status} (servicio saturado)`, 'Vuelve a correr el preflight en unos minutos; mientras tanto el bot usa su respuesta de respaldo.')];
    return [fail(`Gemini rechazó la clave (${reason})`, 'Crea una clave en Google AI Studio → https://aistudio.google.com/apikey y pégala en GEMINI_API_KEY.')];
  } catch (error) {
    return [fail('No se pudo contactar a Gemini', `Revisa tu conexión (${error.message}).`)];
  }
}

// ---------- Clínica activa ----------
export async function checkClinic(loadClinic = () => import('../config/clinic.config.js')) {
  try {
    const { default: clinic } = await loadClinic();
    const results = [pass(`Clínica activa: ${clinic.name} (${clinic.id})`)];
    const missing = Object.entries(clinic.media || {})
      .filter(([, file]) => !fs.existsSync(path.join(ROOT, 'media', clinic.id, file)))
      .map(([key, file]) => `${key} → ${file}`);
    results.push(missing.length
      ? fail(`Faltan fotos en media/${clinic.id}/: ${missing.join(', ')}`, 'Copia esas imágenes con esos nombres (o usa las ilustraciones de la demo).')
      : pass(`Fotos completas en media/${clinic.id}/`));
    return results;
  } catch (error) {
    return [fail('La clínica activa no es válida', `${error.message} (revisa ACTIVE_CLINIC y config/clinics/<id>.js)`)];
  }
}

// ---------- Utilidades ----------
function pass(label) { return { status: 'ok', label }; }
function warn(label, fix) { return { status: 'warn', label, fix }; }
function fail(label, fix) { return { status: 'fail', label, fix }; }

const ICON = { ok: '✅', warn: '⚠️ ', fail: '❌' };

export function printSection(title, results, log = console.log) {
  log(`\n${title}`);
  for (const r of results) log(`  ${ICON[r.status]} ${r.label}${r.fix ? `\n      → ${r.fix}` : ''}`);
}

async function main() {
  await import('../src/envLoader.js');
  const env = process.env;
  console.log('🔎 Preflight: revisión antes de producción (no se muestra ningún secreto)');

  const sections = [];
  sections.push(['Variables de entorno', checkEnv(env)]);
  sections.push(['Clínica activa', await checkClinic()]);

  let client = null;
  const { default: config } = await import('../config/env.js');
  if (config.supabase.url && config.supabase.serviceRoleKey) {
    const { createClient } = await import('@supabase/supabase-js');
    client = createClient(config.supabase.url, config.supabase.serviceRoleKey);
  }
  const migrations = readMigrations();
  const supabaseResults = await checkSupabase(client, parseMigrationSchema(migrations));
  sections.push([`Supabase (tablas y columnas de ${migrations.length} migraciones)`, supabaseResults]);
  sections.push(['WhatsApp Cloud API', await checkWhatsApp(env, fetch)]);
  const meta = await import('./lib/meta.js');
  const { TEMPLATES } = await import('../config/whatsappTemplates.js');
  const token = await meta.checkTokenType(env);
  sections.push(['Meta: tipo de token (debug_token)', token]);
  if (!meta.isExpiredResult(token)) sections.push(['Meta: WABA (número, app suscrita y plantillas)', await meta.checkWaba(env, TEMPLATES)]);
  sections.push(['Gemini', await checkGemini(env, fetch)]);

  for (const [title, results] of sections) printSection(title, results);
  const paste = formatPasteBlocks(pendingMigrationFiles(supabaseResults));
  if (paste) console.log(`\n🗄️  SQL pendiente en Supabase (proyecto …${new URL(config.supabase.url).host.split('.')[0].slice(-4)}):${paste}`);
  const all = sections.flatMap(([, results]) => results);
  const count = (status) => all.filter((r) => r.status === status).length;
  console.log(`\nResumen: ${count('ok')} ✅ · ${count('warn')} ⚠️  · ${count('fail')} ❌`);
  console.log(count('fail') ? 'Corrige los ❌ y vuelve a correr npm run preflight.' : 'Listo para producción 🚀');
  process.exitCode = count('fail') ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error('Preflight falló:', error?.message || error);
    process.exitCode = 1;
  });
}
