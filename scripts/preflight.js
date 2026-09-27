// npm run preflight — revisa que todo esté listo para producción y dice cómo arreglar lo que falte.
// Variables, Supabase (tablas y columnas de TODAS las migraciones), token de WhatsApp, clave de Gemini
// y clínica activa. Nunca imprime secretos. No modifica nada (ni .env ni la base de datos).
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const ROOT = process.cwd();

// ---------- Variables de entorno ----------
export const REQUIRED_ENV = [
  ['GEMINI_API_KEY', 'Crea una clave en https://aistudio.google.com/apikey (empieza con "AIza").'],
  ['WHATSAPP_TOKEN', 'Meta → Configuración del negocio → Usuarios del sistema → Generar token (permisos whatsapp_business_messaging y whatsapp_business_management).'],
  ['WHATSAPP_PHONE_NUMBER_ID', 'Meta for Developers → tu app → WhatsApp → Configuración de la API → "Identificador del número de teléfono".'],
  ['WHATSAPP_APP_SECRET', 'Meta for Developers → tu app → Configuración → Básica → "Clave secreta de la app".'],
  ['WHATSAPP_WEBHOOK_VERIFY_TOKEN', 'Inventa una frase larga y usa la misma al configurar el webhook en Meta.'],
  ['SUPABASE_URL', 'Supabase → Project Settings → API → Project URL (https://xxxx.supabase.co, sin /rest/v1).'],
  ['SUPABASE_SERVICE_ROLE_KEY', 'Supabase → Project Settings → API → service_role (secreta).'],
  ['PANEL_USER', 'Usuario del panel de recepción (/panel).'],
  ['PANEL_PASSWORD', 'Contraseña del panel de recepción (mínimo 12 caracteres).'],
  ['CRON_SECRET', 'Genera uno: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'],
  ['CLINIC_PHONE', 'Teléfono de la clínica que se muestra al paciente (51XXXXXXXXX).'],
  ['RECEPTION_ALERT_PHONE', 'WhatsApp de recepción: recibe citas nuevas, urgencias y pases a humano.'],
  ['OWNER_ALERT_PHONE', 'WhatsApp del dueño: recibe el resumen diario y el reporte semanal.'],
];

const PHONE_VARS = ['CLINIC_PHONE', 'RECEPTION_ALERT_PHONE', 'OWNER_ALERT_PHONE'];

export function checkEnv(env) {
  const results = [];
  for (const [name, fix] of REQUIRED_ENV) {
    const value = String(env[name] || '').trim();
    if (!value) {
      results.push(fail(`${name} no está definida`, fix));
      continue;
    }
    if (PHONE_VARS.includes(name) && !/^(?:51)?9\d{8}$/.test(value.replace(/\D/g, ''))) {
      results.push(fail(`${name} no parece un celular peruano`, 'Formato: 51 + 9 dígitos (ej. 519XXXXXXXX), sin espacios ni +.'));
      continue;
    }
    results.push(pass(`${name} definida`));
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

const TABLE_MISSING = new Set(['42P01', 'PGRST205', 'PGRST106']);
const COLUMN_MISSING = new Set(['42703', 'PGRST204']);

export async function checkSupabase(client, schema) {
  const results = [];
  if (!client) return [fail('No hay conexión a Supabase', 'Define SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.')];
  for (const [name, info] of Object.entries(schema)) {
    if (!info.required && !info.created) continue; // ALTER TABLE IF EXISTS sobre una tabla opcional
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
      results.push(fail(`Falta la tabla ${name}`, `Ejecuta migrations/${file} en Supabase → SQL Editor.`));
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
      results.push(fail(`Tabla ${name}: faltan columnas (${missing.join(', ') || 'desconocidas'})`, `Ejecuta en Supabase → SQL Editor: ${files.map((f) => `migrations/${f}`).join(', ')}`));
      continue;
    }
    results.push(fail(`Tabla ${name}: ${error.message || error.code}`, 'Revisa SUPABASE_URL y que el proyecto no esté pausado (Supabase → Restore).'));
  }
  return results;
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
      return [pass(`WhatsApp: número "${body.verified_name || 'sin nombre'}" (…${last4 || '????'}), calidad ${body.quality_rating || 'sin dato'}`)];
    }
    const code = body.error?.code;
    if (code === 190) return [fail('WhatsApp: el token venció o no es válido', 'Genera un token PERMANENTE de usuario del sistema en Meta Business y cámbialo en Render.')];
    if (code === 100) return [fail('WhatsApp: WHATSAPP_PHONE_NUMBER_ID no existe para este token', 'Copia el "Identificador del número de teléfono" (no el número) desde Meta for Developers → WhatsApp → Configuración de la API.')];
    return [fail(`WhatsApp respondió ${res.status}`, body.error?.message ? `Meta dice: ${body.error.message}` : 'Revisa el token y el phone number id.')];
  } catch (error) {
    return [fail('No se pudo contactar a Meta', `Revisa tu conexión (${error.message}).`)];
  }
}

export async function checkGemini(env, fetchImpl) {
  if (!env.GEMINI_API_KEY) return [fail('Gemini sin probar', 'Define GEMINI_API_KEY.')];
  const model = env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
  try {
    const res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}`, {
      headers: { 'x-goog-api-key': env.GEMINI_API_KEY },
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) return [pass(`Gemini: clave válida y modelo ${model} disponible`)];
    const reason = body.error?.details?.find((d) => d.reason)?.reason || body.error?.status || res.status;
    if (res.status === 404) return [fail(`Gemini: el modelo ${model} no existe para esta clave`, 'Usa GEMINI_MODEL=gemini-3.5-flash-lite (o el que liste Google AI Studio).')];
    return [fail(`Gemini rechazó la clave (${reason})`, 'Crea una clave en https://aistudio.google.com/apikey (empieza con "AIza") y pégala en GEMINI_API_KEY.')];
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
  sections.push([`Supabase (tablas y columnas de ${migrations.length} migraciones)`, await checkSupabase(client, parseMigrationSchema(migrations))]);
  sections.push(['WhatsApp Cloud API', await checkWhatsApp(env, fetch)]);
  sections.push(['Gemini', await checkGemini(env, fetch)]);

  for (const [title, results] of sections) printSection(title, results);
  const all = sections.flatMap(([, results]) => results);
  const count = (status) => all.filter((r) => r.status === status).length;
  console.log(`\nResumen: ${count('ok')} ✅ · ${count('warn')} ⚠️  · ${count('fail')} ❌`);
  console.log(count('fail') ? 'Corrige los ❌ y vuelve a correr npm run preflight.' : 'Listo para producción 🚀');
  process.exit(count('fail') ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error('Preflight falló:', error?.message || error);
    process.exit(1);
  });
}
