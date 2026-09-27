import { describe, it, before, after } from 'node:test';
import assert from 'assert';

process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test';

const { createApp } = await import('../app.js');
const { createMessageDedup } = await import('./messageDedup.js');
const { fakeDb } = await import('./testing/fakeSupabase.js');

const SECRET = 'secreto-de-prueba-largo-123456';

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

describe('infraestructura: /health, /health/deep y webhook', () => {
  let db;
  let broken = false;
  let server;
  let base;
  const savedSecret = process.env.CRON_SECRET;

  before(async () => {
    db = fakeDb({ conversations: [{ conversation_id: '51900000000' }] });
    const getSupabase = () => (broken ? { from: () => ({ select: () => ({ limit: async () => ({ data: null, error: { message: 'connection refused' } }) }) }) } : db);
    ({ server, base } = await listen(createApp({ getSupabase })));
  });

  after(() => {
    server.close();
    if (savedSecret === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = savedSecret;
  });

  it('registers /health before any other route or middleware', () => {
    const app = createApp({ getSupabase: () => db });
    const first = app.router.stack[0];
    assert.equal(first.route?.path, '/health');
  });

  it('answers /health without auth in milliseconds', async () => {
    const started = performance.now();
    const res = await fetch(`${base}/health`);
    const elapsed = performance.now() - started;
    assert.equal(res.status, 200);
    assert.equal((await res.json()).status, 'ok');
    assert.ok(elapsed < 200, `tardó ${elapsed.toFixed(1)} ms`);
  });

  it('protects /health/deep with CRON_SECRET and checks Supabase', async () => {
    delete process.env.CRON_SECRET;
    assert.equal((await fetch(`${base}/health/deep`)).status, 503);
    process.env.CRON_SECRET = SECRET;
    assert.equal((await fetch(`${base}/health/deep`, { headers: { 'x-cron-secret': 'otro' } })).status, 401);
    const ok = await fetch(`${base}/health/deep`, { headers: { 'x-cron-secret': SECRET } });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).supabase, 'ok');
    broken = true;
    const down = await fetch(`${base}/health/deep`, { headers: { authorization: `Bearer ${SECRET}` } });
    broken = false;
    assert.equal(down.status, 503);
  });

  it('answers 200 to Meta before processing the webhook', async () => {
    const payload = { entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.status', status: 'delivered' }] } }] }] };
    const started = performance.now();
    const res = await fetch(`${base}/webhook`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    assert.equal(res.status, 200);
    assert.ok(performance.now() - started < 500);
  });

  it('no longer exposes conversations without authentication', async () => {
    assert.equal((await fetch(`${base}/api/conversations`)).status, 404);
    assert.equal((await fetch(`${base}/api/panel/conversations`)).status >= 401, true);
  });
});

describe('derecho de supresión ("borrar mis datos")', () => {
  it('deletes by the columns the bot actually fills, with and without the 51 prefix', async () => {
    const { dataDeletionFilters } = await import('../controllers/webhookController.js');
    const filters = dataDeletionFilters('51987654321');
    assert.match(filters.messages, /phone\.eq\.51987654321/);
    assert.match(filters.messages, /phone\.eq\.987654321/);
    assert.match(filters.conversations, /conversation_id\.eq\.51987654321/);
    assert.match(filters.leads, /telefono\.eq\.987654321/);
    for (const table of ['follow_ups', 'handoffs', 'whatsapp_media_sends', 'chat_sessions']) assert.ok(filters[table], table);
    assert.equal(filters.appointments, undefined, 'las citas se conservan para la atención');
    assert.ok(!Object.values(filters).some((f) => /sender|contact_name|ilike/.test(f)));
  });
});

describe('deduplicación del webhook por message.id', () => {
  it('processes each message id once, also after a restart', async () => {
    const db = fakeDb({ webhook_events: [] }, { uniqueOn: { webhook_events: ['message_id'] } });
    const first = createMessageDedup({ getClient: () => db });
    assert.equal(await first.seen('wamid.1'), false);
    assert.equal(await first.seen('wamid.1'), true);
    const afterRestart = createMessageDedup({ getClient: () => db });
    assert.equal(await afterRestart.seen('wamid.1'), true);
    assert.equal(await afterRestart.seen('wamid.2'), false);
    assert.equal(await afterRestart.seen(''), false);
  });

  it('falls back to memory when the table is missing', async () => {
    const missing = { from: () => ({ insert: async () => ({ error: { code: 'PGRST205', message: 'table not found' } }) }) };
    const dedup = createMessageDedup({ getClient: () => missing });
    assert.equal(await dedup.seen('wamid.3'), false);
    assert.equal(await dedup.seen('wamid.3'), true);
  });

  it('prunes ids older than 7 days', async () => {
    const now = Date.parse('2026-10-10T00:00:00Z');
    const db = fakeDb({ webhook_events: [
      { message_id: 'viejo', received_at: '2026-09-01T00:00:00.000Z' },
      { message_id: 'nuevo', received_at: '2026-10-09T00:00:00.000Z' },
    ] });
    await createMessageDedup({ getClient: () => db, now: () => now }).prune(7);
    assert.deepEqual(db.data.webhook_events.map((e) => e.message_id), ['nuevo']);
  });
});
