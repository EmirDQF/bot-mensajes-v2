import { describe, it, afterEach } from 'node:test';
import assert from 'assert';

// Fase 5 (agente top): seguimiento ético cuando el paciente no responde. Reglas de parada, límites y persuasión
// solo con datos reales.

process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test';

const { default: clinic, BASE_CLINIC, validateClinic, followUpSettings } = await import('../config/clinic.config.js');
const {
  createFollowUps, stopReason, stageFor, detectObjection, buildFollowUp, realPersuasionFact, REAL_SCARCITY_MAX, answersFollowUp,
} = await import('./followUpService.js');
const { createContactPreferences, detectOptOut, detectMinor } = await import('./contactPreferences.js');
const { default: TEMPLATES } = await import('../config/whatsappTemplates.js');
const { FOLLOW_UP_OPT_OUT_LINE, OPT_OUT_CONFIRMATION } = await import('../config/legalTexts.js');
const { fakeDb } = await import('./testing/fakeSupabase.js');
const { createMemoryDb } = await import('./demo/memoryDb.js');
const { useInMemorySupabase, getSupabase } = await import('./supabaseClient.js');
const { runInTestMode, TEST_PHONE_PREFIX } = await import('./testContext.js');
const { default: webhookController, waitForIdle } = await import('../controllers/webhookController.js');

// Martes 29/09/2026 08:00 en Lima.
const NOW = new Date('2026-09-29T13:00:00Z');
const hoursAgo = (h) => new Date(NOW - h * 3600e3).toISOString();
const SETTINGS = followUpSettings({});
const SLOTS = [
  { date: '2026-09-29', time: '11:00', label: 'martes, 29 de setiembre a las 11:00 a. m.' },
  { date: '2026-09-29', time: '15:00', label: 'martes, 29 de setiembre a las 3:00 p. m.' },
  { date: '2026-09-30', time: '10:00', label: 'miércoles, 30 de setiembre a las 10:00 a. m.' },
];
const ok = (overrides = {}) => ({ settings: SETTINGS, stage: 'seq1', prefs: null, tags: [], sentCount: 0, ...overrides });

describe('configuración del seguimiento', () => {
  it('activado por defecto: 3 h, 22 h, día 3 y máximo 3', () => {
    assert.deepEqual(SETTINGS, { enabled: true, firstHours: 3, secondHours: 22, thirdDays: 3, max: 3 });
    assert.equal(followUpSettings({ followUps: { max: 10 } }).max, 3, 'nunca más de 3');
  });

  it('valida las horas (el 2.º siempre dentro de la ventana de 24 h) y la calificación de Google', () => {
    const c = structuredClone(BASE_CLINIC);
    assert.deepEqual(validateClinic({ ...c, followUps: { enabled: false } }), []);
    assert.match(validateClinic({ ...c, followUps: { secondHours: 30 } }).join(), /secondHours/);
    assert.match(validateClinic({ ...c, followUps: { firstHours: 0 } }).join(), /firstHours/);
    assert.match(validateClinic({ ...c, followUps: { max: 5 } }).join(), /max/);
    assert.match(validateClinic({ ...c, googleRating: { value: 6, count: 10 } }).join(), /googleRating/);
    assert.deepEqual(validateClinic({ ...c, googleRating: { value: 4.8, count: 120 } }), []);
  });

  it('etapas según las horas desde el último mensaje del paciente', () => {
    const cases = [[2.9, null], [3, 'seq1'], [21.9, 'seq1'], [22, 'seq2'], [23.4, 'seq2'], [23.6, null], [71.9, null], [72, 'seq3'], [95.9, 'seq3'], [96, null]];
    for (const [hours, stage] of cases) assert.equal(stageFor(hours, SETTINGS), stage, `${hours} h`);
  });
});

describe('reglas de parada (una por una)', () => {
  const cases = [
    ['desactivado', { settings: { ...SETTINGS, enabled: false } }],
    ['interno', { internal: true }],
    ['prueba', { testPhone: true }],
    ['opt_out', { prefs: { followups_opt_out_at: hoursAgo(1) } }],
    ['opt_out', { tags: ['no_contactar'] }],
    ['agendó', { booked: true }],
    ['pasado_a_humano', { paused: true }],
    ['urgencia', { urgent: true }],
    ['menor_de_edad', { minor: true }],
    ['menor_de_edad', { prefs: { minor_at: hoursAgo(5) } }],
    ['tope', { sentCount: 3 }],
    ['etapa_ya_enviada', { stageAlreadySent: true }],
    ['sin_opt_in', { stage: 'seq3' }],
    ['sin_opt_in', { stage: 'seq3', prefs: { marketing_opt_in_at: hoursAgo(100), marketing_opt_out_at: hoursAgo(2) } }],
  ];
  for (const [reason, overrides] of cases) {
    it(`para por "${reason}" (${Object.keys(overrides).join(', ')})`, () => assert.equal(stopReason(ok(overrides)), reason));
  }

  it('sin ninguna regla, envía; el día 3 solo con opt-in de marketing', () => {
    assert.equal(stopReason(ok()), null);
    assert.equal(stopReason(ok({ sentCount: 2 })), null);
    assert.equal(stopReason(ok({ stage: 'seq3', prefs: { marketing_opt_in_at: hoursAgo(100) } })), null);
  });

  it('detecta "no", "stop", "no me escriban" y menores de edad', () => {
    for (const text of ['no', 'No gracias', 'ya no', 'NO', 'nop 👍']) assert.equal(detectOptOut(text), 'soft', text);
    for (const text of ['stop', 'STOP', 'no me escriban más', 'dejen de escribirme', 'no quiero recibir mensajes', 'no me interesa', 'darme de baja']) assert.equal(detectOptOut(text), 'explicit', text);
    for (const text of ['no tengo dudas', 'no sé cuál elegir', 'me gusta bastante', 'quiero una cita', 'no puedo el martes']) assert.equal(detectOptOut(text), null, text);
    assert.equal(detectMinor('tengo 15 años'), true);
    assert.equal(detectMinor('soy menor de edad'), true);
    assert.equal(detectMinor('mi hijo tiene 8 años'), false);
    assert.equal(detectMinor('tengo 25 años'), false);
  });
});

describe('textos: persuasión solo con datos reales', () => {
  const FORBIDDEN = /[úu]ltim[oa]s?\s+(?:cupos|horarios)|solo\s+hoy|se\s+te\s+van?\s+a\s+caer|vas\s+a\s+perder|antes\s+de\s+que\s+sea\s+tarde|urgente|testimoni|nuestros\s+pacientes\s+dicen|deber[ií]as|culpa|empeorar/i;
  const base = { clinic, today: '2026-09-29', slots: SLOTS, name: 'Ana', treatment: clinic.treatments[0], freeSlotsThisWeek: 30 };
  const allTexts = () => ['precio', 'miedo', 'tiempo', null].flatMap((objection) => ['seq1', 'seq2']
    .map((stage) => buildFollowUp(stage, { ...base, objection }).text));

  it('nada de escasez falsa, urgencias, testimonios, miedo por la salud ni culpa', () => {
    for (const text of allTexts()) assert.doesNotMatch(text, FORBIDDEN, text);
  });

  it('las 3 h: retoma con 2 horarios en botones (un solo mensaje)', () => {
    const msg = buildFollowUp('seq1', base);
    assert.equal(msg.slots.length, 2);
    assert.match(msg.text, /Hola Ana/);
    assert.match(msg.text, /Horarios disponibles/);
    const retake = buildFollowUp('seq1', { ...base, lastBotOfferedSlots: true });
    assert.match(retake.text, /¿Te acomoda alguno de estos horarios/);
  });

  it('las 22 h: precio → financiamiento configurado; miedo → "no te compromete"; tiempo → horario más cercano', () => {
    const price = buildFollowUp('seq2', { ...base, objection: 'precio' }).text;
    assert.ok(price.includes(clinic.treatments[0].financing));
    const numbers = (price.match(/\d+/g) || []).map(Number);
    const configured = JSON.stringify([clinic.treatments, clinic.evaluationPack, clinic.campaign]).match(/\d+/g).map(Number);
    for (const n of numbers) assert.ok(configured.includes(n), `número inventado: ${n}`);
    assert.match(buildFollowUp('seq2', { ...base, objection: 'miedo' }).text, /no te compromete a nada/);
    const time = buildFollowUp('seq2', { ...base, objection: 'tiempo' });
    assert.equal(time.slots.length, 1);
    assert.ok(time.text.includes(SLOTS[0].label));
  });

  it('cupos solo si de verdad quedan pocos; promo con su fecha real; Google solo si está configurado', () => {
    assert.match(realPersuasionFact({ clinic, today: '2026-09-29', freeSlotsThisWeek: 4 }), /quedan 4 horarios libres/);
    assert.equal(realPersuasionFact({ clinic: { ...clinic, promotions: [], googleRating: undefined }, today: '2026-09-29', freeSlotsThisWeek: REAL_SCARCITY_MAX + 10 }), null);
    const promo = realPersuasionFact({ clinic: { ...clinic, promotions: [{ title: 'Limpieza 2x1', validUntil: '2026-10-15' }] }, today: '2026-09-29', freeSlotsThisWeek: 50 });
    assert.match(promo, /"Limpieza 2x1" es válida hasta el .*15 de octubre/);
    assert.equal(realPersuasionFact({ clinic: { ...clinic, promotions: [{ title: 'Vencida', validUntil: '2026-09-01' }] }, today: '2026-09-29', freeSlotsThisWeek: 50 }), null);
    assert.match(realPersuasionFact({ clinic: { ...clinic, promotions: [], googleRating: { value: 4.8, count: 120 } }, today: '2026-09-29', freeSlotsThisWeek: 50 }), /4,8 ⭐ en Google con 120 reseñas/);
  });

  it('objeción más reciente de lo que dijo el paciente', () => {
    assert.equal(detectObjection(['me da miedo', 'está muy caro']), 'precio');
    assert.equal(detectObjection(['está caro', 'pero me da miedo el dolor del tratamiento']), 'miedo');
    assert.equal(detectObjection(['no tengo tiempo, trabajo todo el día']), 'tiempo');
    assert.equal(detectObjection(['hola', 'quiero info']), null);
  });

  it('el día 3 es una plantilla de MARKETING que termina con "Responde NO…"', () => {
    const msg = buildFollowUp('seq3', base);
    assert.equal(msg.template.name, 'seguimiento_dia3');
    assert.equal(TEMPLATES.followUpDay3.category, 'MARKETING');
    assert.ok(TEMPLATES.followUpDay3.body.endsWith(FOLLOW_UP_OPT_OUT_LINE));
    assert.deepEqual(TEMPLATES.followUpDay3.buttons, ['Quiero una cita', 'NO']);
    assert.equal(msg.params.length, 2);
  });
});

function setup(tables, { failWith = null } = {}) {
  const db = fakeDb({ appointments: [], follow_ups: [], leads: [], ...tables }, { uniqueOn: { follow_ups: ['clinic_id', 'phone', 'stage', 'anchor_at'] } });
  const sent = [];
  const fail = () => { if (failWith) throw failWith; };
  const whatsapp = {
    async sendTextMessage(to, text) { fail(); sent.push({ kind: 'text', to, text }); return {}; },
    async sendButtonsMessage(to, text, buttons) { fail(); sent.push({ kind: 'buttons', to, text, buttons }); return {}; },
    async sendListMessage(to, text, button, rows) { fail(); sent.push({ kind: 'list', to, text, rows }); return {}; },
    async sendTemplateMessage(to, name, params) { fail(); sent.push({ kind: 'template', to, name, params }); return {}; },
  };
  const appointments = { async findNextSlots(treatment, { count = 3 } = {}) { return SLOTS.slice(0, count); } };
  const paused = new Set(tables.paused || []);
  const handoff = { async isPaused(phone) { return paused.has(phone); } };
  const preferences = createContactPreferences({ getClient: () => db, clinic, now: () => NOW });
  const followUps = createFollowUps({ getClient: () => db, whatsapp, appointments, handoff, preferences, clinic, now: () => NOW });
  return { db, sent, followUps, preferences };
}
const inbound = (phone, hours, content = 'hola') => ({ phone, role: 'user', content, created_at: hoursAgo(hours) });

describe('runFollowUps: límites y paradas con datos', () => {
  it('3 h → botones con 2 horarios; ~22 h → un mensaje; nunca se repite la etapa', async () => {
    const { db, sent, followUps } = setup({
      messages: [inbound('51911111111', 4, 'info de brackets'), inbound('51922222222', 22.5, 'uy está caro')],
    });
    const first = await followUps.runFollowUps();
    assert.deepEqual(first.stages, { seq1: 1, seq2: 1 });
    const early = sent.find((m) => m.to === '51911111111');
    assert.equal(early.kind, 'buttons');
    assert.equal(early.buttons.length, 2);
    assert.match(early.text, /Ortodoncia/);
    const late = sent.find((m) => m.to === '51922222222');
    assert.equal(late.kind, 'text');
    assert.match(late.text, /Sobre el costo/);
    assert.equal(sent.filter((m) => m.to === '51922222222').length, 1, '1 mensaje por bloque');
    assert.equal((await followUps.runFollowUps()).sent, 0);
    assert.equal(db.data.follow_ups.length, 2);
  });

  it('máximo 3 seguimientos por conversación', async () => {
    const { sent, followUps } = setup({
      messages: [inbound('51911111111', 22.5)],
      follow_ups: ['seq1', 'seq2', 'seq1'].map((stage, i) => ({ clinic_id: clinic.id, phone: '51911111111', stage, sent_at: hoursAgo(100 + i), anchor_at: hoursAgo(200 + i) })),
    });
    const result = await followUps.runFollowUps();
    assert.equal(result.sent, 0);
    assert.deepEqual(result.stopped, { tope: 1 });
    assert.equal(sent.length, 0);
  });

  it('día 3 SIN opt-in de marketing: no se envía (la secuencia terminó a las 22 h)', async () => {
    const { sent, followUps } = setup({ messages: [inbound('51911111111', 73)] });
    const result = await followUps.runFollowUps();
    assert.equal(result.sent, 0);
    assert.deepEqual(result.stopped, { sin_opt_in: 1 });
    assert.equal(sent.length, 0);
  });

  it('día 3 CON opt-in de marketing: una sola plantilla aprobada', async () => {
    const { sent, followUps } = setup({
      messages: [inbound('51911111111', 73)],
      contact_preferences: [{ clinic_id: clinic.id, phone: '51911111111', marketing_opt_in_at: hoursAgo(200) }],
    });
    const result = await followUps.runFollowUps();
    assert.equal(result.sent, 1);
    assert.deepEqual(sent.map((m) => [m.kind, m.name]), [['template', 'seguimiento_dia3']]);
  });

  it('para si agendó, dijo no (opt-out), es menor, está en urgencia o pasado a humano', async () => {
    const { sent, followUps } = setup({
      messages: [
        inbound('51911111111', 5), inbound('51922222222', 5), inbound('51933333333', 5, 'tengo 15 años, quiero brackets'),
        inbound('51944444444', 5), inbound('51955555555', 5), inbound('51966666666', 5),
      ],
      appointments: [{ clinic_id: clinic.id, sender_phone: '51911111111', status: 'pendiente', created_at: hoursAgo(4) }],
      contact_preferences: [{ clinic_id: clinic.id, phone: '51922222222', followups_opt_out_at: hoursAgo(4) }],
      handoffs: [{ clinic_id: clinic.id, phone: '51944444444', reason: 'urgencia', created_at: hoursAgo(5) }],
      paused: ['51955555555'],
    });
    const result = await followUps.runFollowUps();
    assert.deepEqual(result.stopped, { 'agendó': 1, opt_out: 1, menor_de_edad: 1, urgencia: 1, pasado_a_humano: 1 });
    assert.deepEqual(sent.map((m) => m.to), ['51966666666']);
  });

  it('si Meta no puede entregarle (bloqueo), queda como opt-out y no se le vuelve a escribir', async () => {
    const blocked = Object.assign(new Error('WhatsApp API returned status 400'), { meta: { code: 131026 } });
    const { db, followUps } = setup({ messages: [inbound('51911111111', 5)] }, { failWith: blocked });
    const result = await followUps.runFollowUps();
    assert.equal(result.failed, 1);
    const pref = db.data.contact_preferences.find((p) => p.phone === '51911111111');
    assert.ok(pref.followups_opt_out_at);
    assert.equal(pref.opt_out_reason, 'bloqueo');
  });

  it('desactivado desde la configuración: no envía nada', async () => {
    const { sent } = setup({ messages: [inbound('51911111111', 5)] });
    const off = createFollowUps({ getClient: () => fakeDb({}), clinic: { ...clinic, followUps: { enabled: false } }, now: () => NOW });
    assert.equal((await off.runFollowUps()).disabled, true);
    assert.equal(sent.length, 0);
  });

  it('sin la tabla contact_preferences, el opt-out queda como etiqueta "no_contactar" de la ficha', async () => {
    const db = fakeDb({ leads: [{ telefono: '911111111', tags: ['vip'] }] });
    const from = db.from.bind(db);
    db.from = (table) => {
      if (table !== 'contact_preferences') return from(table);
      const missing = { data: null, error: { code: '42P01', message: 'relation "contact_preferences" does not exist' } };
      const b = { upsert: () => b, select: () => b, eq: () => b, in: () => b, then: (res) => Promise.resolve(missing).then(res) };
      return b;
    };
    const prefs = createContactPreferences({ getClient: () => db, clinic, now: () => NOW });
    assert.equal(await prefs.optOut('51911111111'), true);
    assert.deepEqual(db.data.leads[0].tags, ['vip', 'no_contactar']);
  });
});

describe('webhook: "no" / "stop" / menor de edad', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; useInMemorySupabase(null); });
  let geminiCalls = 0;
  const stubGemini = () => {
    geminiCalls = 0;
    globalThis.fetch = async (url, options) => {
      if (!String(url).includes('generativelanguage.googleapis.com')) return realFetch(url, options);
      geminiCalls += 1;
      return new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: 'Claro, cuéntame.' }] }, finishReason: 'STOP' }] }), { status: 200 });
    };
  };
  const message = (phone, body) => ({ id: `wamid.fu.${Math.random().toString(36).slice(2)}`, from: phone, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body } });
  async function say(phone, body, sent) {
    await runInTestMode({ onSend: (to, payload) => sent.push({ to, ...payload }) }, async () => {
      await webhookController({ body: { entry: [{ changes: [{ value: { messages: [message(phone, body)] } }] }] } }, { status() { return this; }, send() { return this; } });
      await waitForIdle(phone);
    });
  }
  const prefsOf = async (phone) => ((await getSupabase()).data.contact_preferences || []).find((p) => p.phone === phone);

  it('"stop" se confirma con el texto legal, queda registrado y no pasa por la IA', async () => {
    useInMemorySupabase(createMemoryDb());
    stubGemini();
    const phone = `${TEST_PHONE_PREFIX}8501`;
    const sent = [];
    await say(phone, 'hola', sent);
    sent.length = 0;
    const before = geminiCalls;
    await say(phone, 'STOP, no me escriban más', sent);
    assert.ok(sent.some((m) => m.to === phone && m.text === OPT_OUT_CONFIRMATION));
    assert.equal(geminiCalls, before);
    assert.ok((await prefsOf(phone))?.followups_opt_out_at);
  });

  it('un "no" suelto se registra pero la conversación sigue normal', async () => {
    useInMemorySupabase(createMemoryDb());
    stubGemini();
    const phone = `${TEST_PHONE_PREFIX}8502`;
    const sent = [];
    await say(phone, 'hola', sent);
    sent.length = 0;
    await say(phone, 'no', sent);
    assert.ok((await prefsOf(phone))?.followups_opt_out_at, 'cada "no" queda como opt-out');
    assert.equal(sent.some((m) => m.text === OPT_OUT_CONFIRMATION), false);
  });

  it('"NO" en respuesta a un seguimiento se confirma como baja', async () => {
    const db = createMemoryDb();
    useInMemorySupabase(db);
    stubGemini();
    const phone = `${TEST_PHONE_PREFIX}8503`;
    const sent = [];
    await say(phone, 'hola', sent);
    db.data.follow_ups = [{ clinic_id: clinic.id, phone, stage: 'seq3', sent_at: new Date(Date.now() + 1000).toISOString() }];
    await new Promise((r) => setTimeout(r, 1100));
    assert.equal(await answersFollowUp(phone, { getClient: () => db }), true);
    sent.length = 0;
    await say(phone, 'NO', sent);
    assert.ok(sent.some((m) => m.text === OPT_OUT_CONFIRMATION));
  });

  it('"tengo 15 años" marca menor de edad (sin seguimiento comercial)', async () => {
    useInMemorySupabase(createMemoryDb());
    stubGemini();
    const phone = `${TEST_PHONE_PREFIX}8504`;
    const sent = [];
    await say(phone, 'hola', sent);
    await say(phone, 'tengo 15 años y quiero brackets', sent);
    assert.ok((await prefsOf(phone))?.minor_at);
  });
});
