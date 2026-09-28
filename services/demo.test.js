import { describe, it, before, after } from 'node:test';
import assert from 'assert';

process.env.NODE_ENV = 'test';

const { createMemoryDb } = await import('./demo/memoryDb.js');
const { buildDemoData, isDemoPhone } = await import('./demo/seed.js');
const { isDemoMode, assertDemoAllowed } = await import('./demo/demoFlag.js');
const { enableDemoMode } = await import('./demo/demoMode.js');
const { getSupabase, useInMemorySupabase } = await import('./supabaseClient.js');
const { createReport } = await import('./reportService.js');
const { createPanelData } = await import('./panelDataService.js');
const { createInboxService } = await import('./inboxService.js');
const { createLiveEvents } = await import('./liveEvents.js');
const { testMode, isTestPhone } = await import('./testContext.js');
const { now: clockNow } = await import('./clock.js');
const { createTesterController, testerPhone, nightOffsetMs, testPayload } = await import('../controllers/testerController.js');
const { resetLoginFailures } = await import('../middleware/panelAuth.js');
const { default: clinic } = await import('../config/clinic.config.js');
const { localParts } = await import('./appointmentService.js');

const NOW = new Date('2026-09-27T20:00:00Z'); // domingo 3:00 p. m. en Lima

function mockRes() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

describe('modo demo: Supabase en memoria', () => {
  it('fills id and created_at, enforces unique keys and supports upsert arrays, or(), order and limit', async () => {
    const db = createMemoryDb({}, { now: () => NOW });
    const { data: inserted } = await db.from('messages').insert([{ phone: '1', role: 'user' }]).select().maybeSingle();
    assert.ok(inserted.id);
    assert.equal(inserted.created_at, NOW.toISOString());
    assert.equal((await db.from('webhook_events').insert([{ message_id: 'a' }])).error, null);
    assert.equal((await db.from('webhook_events').insert([{ message_id: 'a' }])).error.code, '23505');
    await db.from('chat_sessions').upsert([{ id: 'x', history: [] }], { onConflict: 'id' });
    await db.from('chat_sessions').upsert([{ id: 'x', history: [1] }], { onConflict: 'id' });
    assert.equal(db.data.chat_sessions.length, 1);
    assert.deepEqual(db.data.chat_sessions[0].history, [1]);
    await db.from('messages').insert([{ phone: '2', role: 'user' }, { phone: '3', role: 'bot' }]);
    await db.from('messages').delete().or('phone.eq.1,phone.eq.2');
    assert.deepEqual(db.data.messages.map((m) => m.phone), ['3']);
    const { data: limited } = await db.from('messages').select('*').order('phone', { ascending: false }).limit(1);
    assert.equal(limited.length, 1);
    const { data: url } = db.storage.from('clinic-media').getPublicUrl('demo/a.png');
    assert.match(url.publicUrl, /\/demo-media\/clinic-media\/demo\/a\.png$/);
  });
});

describe('modo demo: pacientes inventados', () => {
  const data = buildDemoData(clinic, NOW);

  it('seeds 12 conversations (5 at night), 6 requests, 2 confirmed and 1 urgency with fictitious numbers', () => {
    assert.equal(data.conversations.length, 12);
    assert.equal(data.conversations.filter((c) => c.after_hours).length, 5);
    assert.equal(data.appointments.length, 6);
    assert.equal(data.appointments.filter((a) => a.status === 'confirmada').length, 2);
    assert.equal(data.handoffs.filter((h) => h.reason === 'urgencia').length, 1);
    for (const c of data.conversations) assert.ok(isDemoPhone(c.phone), c.phone);
    assert.ok(data.messages.every((m) => isDemoPhone(m.phone)));
    assert.ok(data.leads.every((l) => ['caliente', 'tibio', 'frio'].includes(l.lead_score) && l.lead_score_reason));
  });

  it('includes the four patients of the demo script', () => {
    const lead = (name) => data.leads.find((l) => l.nombre === name);
    const conv = (name) => data.conversations.find((c) => c.contact_name === name);
    const appt = (name) => data.appointments.find((a) => a.patient_name === name);

    // Carlos: brackets, sábado 10:00 a. m., escribió a las 11:15 p. m., 🔥
    assert.equal(lead('Carlos Mendoza').lead_score, 'caliente');
    assert.equal(conv('Carlos Mendoza').after_hours, true);
    assert.equal(localParts(clinic.timezone, new Date(conv('Carlos Mendoza').first_message_at)).minutes, 23 * 60 + 15);
    assert.equal(appt('Carlos Mendoza').appointment_time, '10:00:00');
    assert.equal(new Date(`${appt('Carlos Mendoza').appointment_date}T12:00:00Z`).getUTCDay(), 6);
    assert.match(appt('Carlos Mendoza').treatment, /ortodoncia/i);
    // Mariana: implante, 🔥
    assert.equal(lead('Mariana Paredes').lead_score, 'caliente');
    assert.match(appt('Mariana Paredes').treatment, /implante/i);
    // Rodrigo: carillas o diseño de sonrisa, 🌤️, pendiente (sin cita todavía)
    assert.equal(lead('Rodrigo Silva').lead_score, 'tibio');
    assert.match(lead('Rodrigo Silva').treatment_interest, /carillas|sonrisa/i);
    assert.equal(appt('Rodrigo Silva'), undefined);
    // Sofía: dolor fuerte → urgencia, bot en pausa, 🚨
    assert.equal(conv('Sofía Benavides').status, 'human');
    assert.equal(conv('Sofía Benavides').handoff_reason, 'urgencia');
  });

  it('never states prices that are not in the clinic configuration', () => {
    const prices = new Set(clinic.treatments.map((t) => `S/ ${Number(t.priceFrom).toLocaleString('es-PE')}`));
    for (const m of data.messages.filter((x) => x.sender === 'bot')) {
      for (const price of m.content.match(/S\/ [\d,.]+\d/g) || []) assert.ok(prices.has(price), `${price} en "${m.content}"`);
    }
  });

  it('shows the guarantee met (2/2) and the night KPIs in the report and the metrics', async () => {
    const db = createMemoryDb(data, { now: () => NOW });
    const report = await createReport({ getClient: () => db, clinic, now: () => NOW }).buildReport();
    assert.equal(report.guarantee.met, true);
    assert.equal(report.confirmed, 2);
    assert.ok(report.requestedAfterHours >= 4);
    assert.equal(report.urgencies, 1);
    assert.ok(report.avgFirstResponseMs > 0 && report.avgFirstResponseMs < 60e3);
    const metrics = await createPanelData({ getClient: () => db, clinic, now: () => NOW }).getMetrics(30);
    assert.equal(metrics.guarantee.met, true);
    assert.ok(metrics.afterHoursAppointments >= 4);
    assert.ok(metrics.potentialValue > 0);
    assert.ok(metrics.avgFirstResponseMs > 0);
  });

  it('lists the inbox with the urgency first and the lead score badges', async () => {
    const db = createMemoryDb(data, { now: () => NOW });
    const inbox = createInboxService({ getClient: () => db, events: createLiveEvents({ bootId: 't' }), now: () => NOW });
    const list = await inbox.listConversations();
    assert.equal(list[0].name, 'Sofía Benavides');
    assert.equal(list[0].urgent, true);
    assert.ok(['caliente', 'tibio', 'frio'].every((score) => list.some((c) => c.leadScore === score)));
    assert.equal(list.filter((c) => c.afterHours).length, 5);
    assert.ok((await inbox.getMessages(list[0].phone)).length > 0);
  });
});

describe('modo demo: seguridad', () => {
  it('fails the start in production', async () => {
    assert.throws(() => assertDemoAllowed({ DEMO_MODE: 'true', NODE_ENV: 'production' }), /no está permitido/);
    assert.doesNotThrow(() => assertDemoAllowed({ DEMO_MODE: 'true', NODE_ENV: 'development' }));
    await assert.rejects(enableDemoMode({ env: { DEMO_MODE: 'true', NODE_ENV: 'production' }, log: () => {} }), /no está permitido/);
    assert.equal(await enableDemoMode({ env: {}, log: () => {} }), null);
    assert.equal(isDemoMode({ DEMO_MODE: 'false' }), false);
  });

  it('uses the in-memory Supabase and never the real client', async () => {
    const saved = process.env.DEMO_MODE;
    try {
      const db = await enableDemoMode({ env: { DEMO_MODE: 'true', PANEL_OWNER_USER: 'x', PANEL_OWNER_PASSWORD: 'y' }, log: () => {} });
      assert.equal(getSupabase(), db);
      assert.equal(db.data.conversations.length, 12);
      useInMemorySupabase(null);
      process.env.DEMO_MODE = 'true';
      assert.equal(getSupabase(), null, 'con DEMO_MODE y sin la base en memoria no se conecta a la real');
    } finally {
      useInMemorySupabase(null);
      if (saved === undefined) delete process.env.DEMO_MODE; else process.env.DEMO_MODE = saved;
    }
  });

  it('creates a demo owner login only when none is configured', async () => {
    const env = { DEMO_MODE: 'true' };
    try {
      await enableDemoMode({ env, log: () => {} });
      assert.equal(env.PANEL_OWNER_USER, 'demo');
      assert.ok(env.PANEL_OWNER_PASSWORD.length >= 12);
    } finally {
      useInMemorySupabase(null);
    }
  });

  it('never sends WhatsApp messages in demo mode', async () => {
    const saved = process.env.DEMO_MODE;
    const realFetch = globalThis.fetch;
    let called = false;
    globalThis.fetch = async () => { called = true; throw new Error('no debe llamarse'); };
    const originalLog = console.log;
    console.log = () => {};
    try {
      process.env.DEMO_MODE = 'true';
      const { sendTextMessage } = await import('./whatsappService.js');
      const result = await sendTextMessage('51900000101', 'hola');
      assert.equal(result.demo, true);
      assert.equal(called, false);
    } finally {
      console.log = originalLog;
      globalThis.fetch = realFetch;
      if (saved === undefined) delete process.env.DEMO_MODE; else process.env.DEMO_MODE = saved;
    }
  });
});

describe('Probador', () => {
  it('builds a Meta-shaped payload from a test number that is never a real mobile', () => {
    const phone = testerPhone(42);
    assert.equal(phone, '51000000042');
    assert.ok(isTestPhone(phone));
    const message = testPayload(phone, 'hola', { now: NOW }).entry[0].changes[0].value.messages[0];
    assert.equal(message.from, phone);
    assert.equal(message.text.body, 'hola');
    assert.match(message.id, /^wamid\.prueba\./);
  });

  it('simulates 10:30 p. m. in the clinic time zone', () => {
    const simulated = localParts(clinic.timezone, new Date(NOW.getTime() + nightOffsetMs(clinic, NOW)));
    assert.equal(simulated.minutes, 22 * 60 + 30);
    assert.equal(simulated.date, localParts(clinic.timezone, NOW).date);
  });

  it('runs the flow in test mode with the simulated clock and relays what the bot sends', async () => {
    const events = createLiveEvents({ bootId: 't' });
    const seen = [];
    events.subscribe((e) => seen.push(e));
    let context = null;
    let clockAtHandler = null;
    const { sendTextMessage } = await import('./whatsappService.js');
    const controller = createTesterController({
      events,
      idle: async () => {},
      handleWebhook: async (req) => {
        context = testMode();
        clockAtHandler = clockNow();
        await sendTextMessage(req.body.entry[0].changes[0].value.messages[0].from, '¡Hola! Soy la asistente');
        await sendTextMessage('51911111111', 'Alerta a recepción');
      },
    });
    const res = mockRes();
    await controller.message({ body: { text: 'hola', session: 7, clock: 'night' } }, res);
    assert.equal(res.statusCode, 202);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(context.isTest, true);
    assert.ok(Math.abs(localParts(clinic.timezone, clockAtHandler).minutes - (22 * 60 + 30)) <= 1);
    const tester = seen.filter((e) => e.type === 'tester').map((e) => e.data);
    assert.equal(tester[0].toPatient, true);
    assert.equal(tester[0].text, '¡Hola! Soy la asistente');
    assert.equal(tester[1].toPatient, false);
    assert.ok(tester.some((d) => d.done));

    const empty = mockRes();
    await controller.message({ body: { text: '  ' } }, empty);
    assert.equal(empty.statusCode, 400);
  });

  it('"Borrar pruebas" resets each test conversation and deletes only test appointments', async () => {
    const db = createMemoryDb({
      conversations: [{ conversation_id: '51000000007', is_test: true }, { conversation_id: '51900000101', is_test: false }],
      appointments: [{ id: 'a', is_test: true }, { id: 'b', is_test: false }],
    });
    const sent = [];
    const controller = createTesterController({
      getClient: () => db, idle: async () => {}, events: createLiveEvents({ bootId: 't' }),
      handleWebhook: async (req) => { const m = req.body.entry[0].changes[0].value.messages[0]; sent.push([m.from, m.text.body]); },
    });
    const res = mockRes();
    await controller.reset({ body: {} }, res);
    assert.deepEqual(res.body, { conversations: 1, appointments: 1 });
    assert.deepEqual(sent, [['51000000007', 'reset']]);
    assert.deepEqual(db.data.appointments.map((a) => a.id), ['b']);
  });

  describe('rutas con auth', () => {
    const saved = {};
    const ENV = { PANEL_USER: 'recepcion', PANEL_PASSWORD: 'clave-recepcion-123', PANEL_OWNER_USER: 'dueno', PANEL_OWNER_PASSWORD: 'clave-dueno-456', CRON_SECRET: 'x'.repeat(32) };
    let server;
    let base;
    const basic = (user, pass) => ({ Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`, 'content-type': 'application/json' });

    before(async () => {
      for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; process.env[k] = v; }
      const { createApp } = await import('../app.js');
      const app = createApp({ getSupabase: () => createMemoryDb() });
      await new Promise((resolve) => { server = app.listen(0, () => resolve()); });
      base = `http://127.0.0.1:${server.address().port}`;
    });

    after(() => {
      server.close();
      for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
      resetLoginFailures();
    });

    it('401 without a session, 403 for reception, 400 for an empty owner message', async () => {
      for (const path of ['/api/panel/tester/message', '/api/panel/tester/reset']) {
        assert.equal((await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401, path);
        assert.equal((await fetch(`${base}${path}`, { method: 'POST', headers: basic('recepcion', 'clave-recepcion-123'), body: '{}' })).status, 403, path);
      }
      const bad = await fetch(`${base}/api/panel/tester/message`, { method: 'POST', headers: basic('dueno', 'clave-dueno-456'), body: JSON.stringify({ text: '' }) });
      assert.equal(bad.status, 400);
    });
  });
});
