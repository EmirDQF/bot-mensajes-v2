import { describe, it } from 'node:test';
import assert from 'assert';

process.env.NODE_ENV = 'test';

const {
  checkEnv, parseMigrationSchema, readMigrations, checkSupabase, checkWhatsApp, checkGemini, checkClinic, printSection,
} = await import('../scripts/preflight.js');

const SECRET = 'AIzaSECRETO-que-no-debe-imprimirse-123';
const jsonResponse = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

function printed(results) {
  const lines = [];
  printSection('x', results, (line) => lines.push(line));
  return lines.join('\n');
}

describe('preflight: variables de entorno', () => {
  it('fails on missing variables with a fix, and never prints values', () => {
    const results = checkEnv({ GEMINI_API_KEY: SECRET, RECEPTION_ALERT_PHONE: '12345', CRON_SECRET: 'corto' });
    const byLabel = (text) => results.find((r) => r.label.includes(text));
    assert.equal(byLabel('GEMINI_API_KEY').status, 'ok');
    assert.equal(byLabel('WHATSAPP_TOKEN').status, 'fail');
    assert.ok(byLabel('WHATSAPP_TOKEN').fix.length > 10);
    assert.equal(byLabel('RECEPTION_ALERT_PHONE').status, 'fail');
    assert.equal(byLabel('CRON_SECRET es muy corto').status, 'fail');
    assert.ok(!printed(results).includes(SECRET));
  });

  it('accepts Peruvian mobiles with or without 51', () => {
    const results = checkEnv({ CLINIC_PHONE: '51912345678', RECEPTION_ALERT_PHONE: '912345678', OWNER_ALERT_PHONE: '+51 912 345 678' });
    for (const name of ['CLINIC_PHONE', 'RECEPTION_ALERT_PHONE', 'OWNER_ALERT_PHONE']) {
      assert.equal(results.find((r) => r.label.startsWith(name)).status, 'ok', name);
    }
  });
});

describe('preflight: esquema de las migraciones', () => {
  it('reads tables and columns from every migration, CHECK constraints included', () => {
    const schema = parseMigrationSchema([
      { name: '1.sql', sql: "CREATE TABLE IF NOT EXISTS public.citas (\n  id UUID PRIMARY KEY,\n  status TEXT CHECK (status IN ('a', 'b')),\n  CONSTRAINT x UNIQUE (id)\n);" },
      { name: '2.sql', sql: 'ALTER TABLE IF EXISTS public.citas ADD COLUMN IF NOT EXISTS after_hours BOOLEAN;\nALTER TABLE IF EXISTS opcional ADD COLUMN IF NOT EXISTS x TEXT;' },
    ]);
    assert.deepEqual([...schema.citas.columns.keys()], ['id', 'status', 'after_hours']);
    assert.equal(schema.citas.columns.get('after_hours'), '2.sql');
    assert.equal(schema.opcional.required, false);
  });

  it('covers the tables the bot needs', () => {
    const schema = parseMigrationSchema(readMigrations());
    for (const table of ['leads', 'messages', 'conversations', 'appointments', 'follow_ups', 'handoffs', 'webhook_events']) {
      assert.ok(schema[table]?.required, table);
    }
    assert.ok(schema.appointments.columns.has('after_hours'));
    assert.ok(schema.conversations.columns.has('first_response_ms'));
  });

  it('says which migration to run for a missing table or column', async () => {
    const schema = parseMigrationSchema([
      { name: 'a.sql', sql: 'CREATE TABLE IF NOT EXISTS public.appointments (\n  id UUID\n);\nALTER TABLE IF EXISTS public.appointments ADD COLUMN IF NOT EXISTS after_hours BOOLEAN;' },
      { name: 'b.sql', sql: 'CREATE TABLE IF NOT EXISTS public.handoffs (\n  id BIGINT\n);' },
    ]);
    const client = {
      from(table) {
        return {
          select(columns) {
            return {
              async limit() {
                if (table === 'handoffs') return { error: { code: '42P01', message: 'relation "handoffs" does not exist' } };
                if (columns.includes('after_hours')) return { error: { code: '42703', message: 'column appointments.after_hours does not exist' } };
                return { error: null };
              },
            };
          },
        };
      },
    };
    const results = await checkSupabase(client, schema);
    assert.match(results[0].label, /faltan columnas \(after_hours\)/);
    assert.match(results[0].fix, /a\.sql/);
    assert.match(results[1].label, /Falta la tabla handoffs/);
    assert.match(results[1].fix, /b\.sql/);
  });
});

describe('preflight: WhatsApp, Gemini y clínica', () => {
  it('checks the WhatsApp token against the phone number id', async () => {
    const ok = await checkWhatsApp({ WHATSAPP_TOKEN: SECRET, WHATSAPP_PHONE_NUMBER_ID: '123' }, async () => jsonResponse(200, { verified_name: 'Clínica', display_phone_number: '+51 900 000 000', quality_rating: 'GREEN' }));
    assert.equal(ok[0].status, 'ok');
    assert.ok(!ok[0].label.includes('900 000'), 'solo muestra los últimos 4 dígitos');
    const expired = await checkWhatsApp({ WHATSAPP_TOKEN: SECRET, WHATSAPP_PHONE_NUMBER_ID: '123' }, async () => jsonResponse(401, { error: { code: 190 } }));
    assert.match(expired[0].label, /venció/);
    assert.ok(!printed(expired).includes(SECRET));
  });

  it('checks the Gemini key and model', async () => {
    const ok = await checkGemini({ GEMINI_API_KEY: SECRET, GEMINI_MODEL: 'gemini-3.5-flash-lite' }, async () => jsonResponse(200, {}));
    assert.equal(ok[0].status, 'ok');
    const bad = await checkGemini({ GEMINI_API_KEY: SECRET }, async () => jsonResponse(401, { error: { details: [{ reason: 'API_KEY_INVALID' }] } }));
    assert.match(bad[0].label, /API_KEY_INVALID/);
    assert.match(bad[0].fix, /aistudio/);
    assert.ok(!printed(bad).includes(SECRET));
  });

  it('validates the active clinic and its photos', async () => {
    const ok = await checkClinic();
    assert.ok(ok.every((r) => r.status === 'ok'));
    const broken = await checkClinic(async () => { throw new Error('config/clinics/x.js: falta "address"'); });
    assert.equal(broken[0].status, 'fail');
    assert.match(broken[0].fix, /falta "address"/);
  });
});
