import { describe, it, afterEach } from 'node:test';
import assert from 'assert';

// Fase 7 (agente top): permiso de promociones (una sola vez, Sí/No) y campañas a pacientes anteriores.

process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test';

const { default: clinic, BASE_CLINIC, validateClinic, isWithinMarketingHours } = await import('../config/clinic.config.js');
const {
  createCampaigns, exclusionReason, estimateCost, promotionText, renderPromotionMessage, validateSegment, PROMO_INTERVAL_DAYS, BATCH_SIZE,
} = await import('./campaignService.js');
const { createContactPreferences } = await import('./contactPreferences.js');
const { createMarketingConsent, shouldAskMarketing } = await import('../controllers/marketingConsent.js');
const { default: TEMPLATES } = await import('../config/whatsappTemplates.js');
const legal = await import('../config/legalTexts.js');
const { fakeDb } = await import('./testing/fakeSupabase.js');
const { createMemoryDb } = await import('./demo/memoryDb.js');
const { useInMemorySupabase, getSupabase } = await import('./supabaseClient.js');
const { runInTestMode, TEST_PHONE_PREFIX } = await import('./testContext.js');
const { default: webhookController, waitForIdle } = await import('../controllers/webhookController.js');

// Jueves 05/11/2026 10:00 en Lima.
const NOW = new Date('2026-11-05T15:00:00Z');
const daysAgo = (d) => new Date(NOW - d * 86400e3).toISOString();
const PROMO = { title: 'Blanqueamiento 2x1', description: 'Dos sesiones al precio de una', validUntil: '2026-11-30' };
const CLINIC = { ...structuredClone(BASE_CLINIC), promotions: [PROMO], marketingPrice: { amount: 0.08, currency: 'USD' } };
const optIn = (phone, extra = {}) => ({ clinic_id: clinic.id, phone, marketing_opt_in_at: daysAgo(30), ...extra });
const asked = (phone, content, d = 10) => ({ phone, role: 'user', content, created_at: daysAgo(d) });

function setup(tables = {}, { failCode = null } = {}) {
  const db = fakeDb({ messages: [], appointments: [], leads: [], contact_preferences: [], campaigns: [], campaign_recipients: [], ...tables },
    { uniqueOn: { campaign_recipients: ['campaign_id', 'phone'] } });
  const sent = [];
  const whatsapp = {
    async sendTemplateMessage(to, name, params) {
      if (failCode && failCode.phone === to) throw Object.assign(new Error('meta'), { meta: { code: failCode.code } });
      sent.push({ to, name, params });
      return { messages: [{ id: `wamid.${to}` }] };
    },
  };
  const preferences = createContactPreferences({ getClient: () => db, clinic, now: () => NOW });
  const inbox = { async recordMessage() { return {}; } };
  const campaigns = createCampaigns({ getClient: () => db, whatsapp, preferences, inbox, clinic: CLINIC, now: () => NOW });
  return { db, sent, campaigns };
}

describe('reglas de elegibilidad (una por una)', () => {
  const base = { phone: '51911111111', now: NOW, internal: false, prefs: { marketing_opt_in_at: daysAgo(10) } };
  const cases = [
    ['sin_opt_in', { prefs: null }],
    ['sin_opt_in', { prefs: { marketing_asked_at: daysAgo(1) } }],
    ['opt_out', { prefs: { marketing_opt_in_at: daysAgo(10), marketing_opt_out_at: daysAgo(1) } }],
    ['opt_out', { prefs: { marketing_opt_in_at: daysAgo(10), followups_opt_out_at: daysAgo(1) } }],
    ['menor_de_edad', { prefs: { marketing_opt_in_at: daysAgo(10), minor_at: daysAgo(1) } }],
    ['promocion_reciente', { lastPromoAt: daysAgo(PROMO_INTERVAL_DAYS - 1) }],
    ['interno', { internal: true }],
    ['prueba', { phone: `${TEST_PHONE_PREFIX}1234` }],
  ];
  for (const [reason, overrides] of cases) {
    it(`excluye por "${reason}"`, () => assert.equal(exclusionReason({ ...base, ...overrides }), reason));
  }
  it('con permiso vigente y la última promoción hace 14 días o más, sí recibe', () => {
    assert.equal(exclusionReason(base), null);
    assert.equal(exclusionReason({ ...base, lastPromoAt: daysAgo(PROMO_INTERVAL_DAYS) }), null);
  });
});

describe('segmentos, costo y mensaje', () => {
  it('valida el segmento', () => {
    assert.deepEqual(validateSegment({ type: 'pregunto_no_agendo', treatmentKey: 'ortodoncia', days: 60 }), []);
    assert.ok(validateSegment({ type: 'pregunto_no_agendo', treatmentKey: 'no-existe', days: 60 }).length);
    assert.ok(validateSegment({ type: 'otro' }).length);
  });

  it('el costo usa la tarifa que escribió el dueño; sin tarifa no hay costo', () => {
    assert.deepEqual(estimateCost(25, { amount: 0.08, currency: 'USD' }), { count: 25, cost: 2, currency: 'USD', price: 0.08 });
    assert.equal(estimateCost(25, null).cost, null);
    assert.match(validateClinic({ ...CLINIC, marketingPrice: { amount: 99 } }).join(), /marketingPrice/);
  });

  it('la plantilla es de MARKETING, con la opción de baja al final y la promoción con su fecha real', () => {
    assert.equal(TEMPLATES.promotion.category, 'MARKETING');
    assert.ok(TEMPLATES.promotion.body.endsWith(legal.PROMOTION_OPT_OUT_LINE));
    const text = promotionText(PROMO);
    assert.match(text, /Blanqueamiento 2x1: Dos sesiones al precio de una\. Válida hasta el .*30 de noviembre\./);
    assert.doesNotMatch(text, /\n/);
    const msg = renderPromotionMessage({ patient: 'Ana', clinicName: clinic.name, promotion: text });
    assert.match(msg, /^Hola Ana 👋 Te escribe Clínica Dental Denvari\. Blanqueamiento 2x1/);
  });

  it('solo se envía de 9:00 a 20:00 (hora de la clínica)', () => {
    assert.equal(isWithinMarketingHours(clinic, NOW), true);
    assert.equal(isWithinMarketingHours(clinic, new Date('2026-11-06T02:00:00Z')), false); // 21:00 Lima
  });
});

describe('campaña de punta a punta', () => {
  const tables = () => ({
    messages: [
      asked('51911111111', 'cuánto cuestan los brackets?'), asked('51922222222', 'info de frenillos'),
      asked('51933333333', 'precio de brackets'), asked('51944444444', 'brackets?'), asked('51955555555', 'brackets por favor'),
      asked('51966666666', 'limpieza'),
    ],
    appointments: [{ clinic_id: clinic.id, sender_phone: '51955555555', status: 'pendiente', created_at: daysAgo(5) }],
    contact_preferences: [
      optIn('51911111111'), optIn('51922222222'), optIn('51933333333', { minor_at: daysAgo(3) }), optIn('51955555555'), optIn('51966666666'),
    ],
    campaign_recipients: [{ campaign_id: 'vieja', clinic_id: clinic.id, phone: '51922222222', status: 'enviado', sent_at: daysAgo(3) }],
    leads: [{ telefono: '911111111', nombre: 'Ana Torres' }],
  });
  const SEGMENT = { type: 'pregunto_no_agendo', treatmentKey: 'ortodoncia', days: 60 };

  it('vista previa: destinatarios elegibles, quiénes no reciben y por qué, costo y mensaje', async () => {
    const { campaigns } = setup(tables());
    const p = await campaigns.preview({ segment: SEGMENT, promotionIndex: 0 });
    assert.equal(p.segmentSize, 4); // 1, 2, 3, 4 (el 5 agendó y el 6 preguntó por otra cosa)
    assert.equal(p.recipients, 1);
    assert.deepEqual(p.excluded, { promocion_reciente: 1, menor_de_edad: 1, sin_opt_in: 1 });
    assert.equal(p.estimate.cost, 0.08);
    assert.match(p.message, /Responde NO para no recibir más promociones\.$/);
  });

  it('exige la confirmación escrita del dueño y la tarifa', async () => {
    const { campaigns } = setup(tables());
    await assert.rejects(campaigns.create({ name: 'X', segment: SEGMENT, promotionIndex: 0, confirmation: 'si' }), /ENVIAR/);
    const noPrice = createCampaigns({ getClient: () => fakeDb(tables()), clinic: { ...CLINIC, marketingPrice: undefined }, now: () => NOW });
    await assert.rejects(noPrice.create({ name: 'X', segment: SEGMENT, promotionIndex: 0, confirmation: 'ENVIAR' }), /tarifa/);
  });

  it('no permite una promoción vencida o que todavía no empieza', async () => {
    const { campaigns } = setup(tables());
    await assert.rejects(campaigns.preview({ segment: SEGMENT, promotionIndex: 0, scheduledDate: '2026-12-15' }), /no está vigente/);
  });

  it('envía por lotes solo a los elegibles, con la plantilla, y no repite si el cron corre dos veces', async () => {
    const { db, sent, campaigns } = setup(tables());
    const row = await campaigns.create({ name: 'Brackets', segment: SEGMENT, promotionIndex: 0, confirmation: 'ENVIAR', by: 'dueño' });
    assert.equal(row.status, 'programada');
    const first = await campaigns.runCampaigns();
    assert.equal(first.sent, 1);
    assert.deepEqual(sent.map((s) => [s.to, s.name, s.params[0]]), [['51911111111', 'promocion_pacientes', 'Ana']]);
    assert.equal(db.data.campaigns[0].status, 'terminada');
    assert.equal((await campaigns.runCampaigns()).sent, 0);
  });

  it('se detiene sola si Meta devuelve un error de calidad o de límite', async () => {
    const t = tables();
    t.contact_preferences.push(optIn('51944444444'));
    const { db, campaigns } = setup(t, { failCode: { phone: '51911111111', code: 131048 } });
    await campaigns.create({ name: 'B', segment: SEGMENT, promotionIndex: 0, confirmation: 'ENVIAR' });
    const result = await campaigns.runCampaigns();
    assert.equal(result.paused, 1);
    assert.equal(db.data.campaigns[0].status, 'pausada');
    assert.match(db.data.campaigns[0].status_reason, /131048/);
  });

  it('si Meta dice que el paciente ya no acepta marketing (131050), queda como opt-out y sigue con los demás', async () => {
    const t = tables();
    t.contact_preferences.push(optIn('51944444444'));
    const { db, sent, campaigns } = setup(t, { failCode: { phone: '51911111111', code: 131050 } });
    await campaigns.create({ name: 'C', segment: SEGMENT, promotionIndex: 0, confirmation: 'ENVIAR' });
    await campaigns.runCampaigns();
    assert.ok(db.data.contact_preferences.find((p) => p.phone === '51911111111').followups_opt_out_at);
    assert.ok(sent.some((s) => s.to === '51944444444'));
  });

  it('reporte con números medidos: entregados, leídos, respuestas y citas', async () => {
    const { db, campaigns } = setup(tables());
    const row = await campaigns.create({ name: 'R', segment: SEGMENT, promotionIndex: 0, confirmation: 'ENVIAR' });
    await campaigns.runCampaigns();
    const sentAt = db.data.campaign_recipients.find((r) => r.campaign_id === row.id).sent_at;
    const later = new Date(new Date(sentAt).getTime() + 3600e3).toISOString();
    db.data.messages.push({ whatsapp_message_id: 'wamid.51911111111', status: 'read', phone: '51911111111', role: 'assistant', created_at: sentAt });
    db.data.messages.push({ phone: '51911111111', role: 'user', content: 'quiero una cita', created_at: later });
    db.data.appointments.push({ clinic_id: clinic.id, sender_phone: '51911111111', status: 'pendiente', created_at: later });
    const r = await campaigns.report(row.id);
    assert.deepEqual([r.sent, r.delivered, r.read, r.replies, r.appointments], [1, 1, 1, 1, 1]);
  });

  it('el lote tiene un tope por corrida', () => assert.ok(BATCH_SIZE >= 1 && BATCH_SIZE <= 200));
});

describe('permiso de promociones: una sola vez, con botones Sí/No', () => {
  it('no se pregunta a quien ya respondió, pidió no recibir mensajes o es menor', () => {
    assert.equal(shouldAskMarketing(null), true);
    for (const prefs of [{ marketing_asked_at: daysAgo(1) }, { marketing_opt_out_at: daysAgo(1) }, { marketing_opt_in_at: daysAgo(1) }, { followups_opt_out_at: daysAgo(1) }, { minor_at: daysAgo(1) }]) {
      assert.equal(shouldAskMarketing(prefs), false, JSON.stringify(prefs));
    }
  });

  function consentSetup() {
    const db = fakeDb({ contact_preferences: [] });
    const sent = [];
    const whatsapp = { async sendButtonsMessage(to, text, buttons) { sent.push({ to, text, buttons }); return {}; } };
    const preferences = createContactPreferences({ getClient: () => db, clinic, now: () => NOW });
    return { db, sent, consent: createMarketingConsent({ preferences, whatsapp, now: () => NOW, record: async () => {} }) };
  }

  it('pregunta una sola vez con el texto legal y guarda la fecha y el texto aceptado', async () => {
    const { db, sent, consent } = consentSetup();
    assert.equal(await consent.askAfterBooking('51911111111'), true);
    assert.equal(await consent.askAfterBooking('51911111111'), false, 'nunca dos veces');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].text, legal.MARKETING_OPT_IN_QUESTION);
    assert.deepEqual(sent[0].buttons.map((b) => b.title), [legal.MARKETING_OPT_IN_BUTTONS.yes, legal.MARKETING_OPT_IN_BUTTONS.no]);
    assert.equal(await consent.handleAnswer('51911111111', 'Sí, quiero'), legal.MARKETING_OPT_IN_YES_REPLY);
    const row = db.data.contact_preferences[0];
    assert.ok(row.marketing_opt_in_at);
    assert.equal(row.marketing_opt_in_text, legal.MARKETING_OPT_IN_QUESTION);
  });

  it('"No, gracias" se guarda y nunca se vuelve a preguntar; fuera de la pregunta, "sí" no cuenta', async () => {
    const { db, consent } = consentSetup();
    assert.equal(await consent.handleAnswer('51922222222', 'sí'), null, 'sin pregunta pendiente no es un permiso');
    await consent.askAfterBooking('51922222222');
    assert.equal(await consent.handleAnswer('51922222222', 'No, gracias'), legal.MARKETING_OPT_IN_NO_REPLY);
    assert.ok(db.data.contact_preferences[0].marketing_opt_out_at);
    assert.equal(db.data.contact_preferences[0].followups_opt_out_at, undefined, 'decir no a promociones no corta los recordatorios');
    assert.equal(await consent.askAfterBooking('51922222222'), false);
  });
});

describe('webhook: después de agendar se pregunta por las promociones', () => {
  const realFetch = globalThis.fetch;
  const savedMode = clinic.bookingMode;
  afterEach(() => { globalThis.fetch = realFetch; useInMemorySupabase(null); clinic.bookingMode = savedMode; });
  const envelope = (phone, message) => ({ entry: [{ changes: [{ value: { contacts: [{ profile: { name: 'Carlos Mendoza' } }], messages: [{ id: `wamid.cp.${Math.random().toString(36).slice(2)}`, from: phone, timestamp: String(Math.floor(Date.now() / 1000)), ...message }] } }] }] });
  async function deliver(phone, message, sent) {
    await runInTestMode({ onSend: (to, payload) => sent.push({ to, ...payload }) }, async () => {
      await webhookController({ body: envelope(phone, message) }, { status() { return this; }, send() { return this; } });
      await waitForIdle(phone);
    });
  }
  const typed = (body) => ({ type: 'text', text: { body } });

  it('agenda → pregunta con botones → "Sí, quiero" queda guardado', async () => {
    useInMemorySupabase(createMemoryDb());
    globalThis.fetch = async (url, options) => (String(url).includes('generativelanguage.googleapis.com')
      ? new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: 'Elige tu horario.' }] }, finishReason: 'STOP' }] }), { status: 200 })
      : realFetch(url, options));
    clinic.bookingMode = 'confirmacion_directa';
    const phone = `${TEST_PHONE_PREFIX}8701`;
    const sent = [];
    await deliver(phone, typed('hola'), sent);
    await deliver(phone, typed('quiero una cita para limpieza'), sent);
    sent.length = 0;
    await deliver(phone, typed('la 1'), sent);
    const question = sent.find((m) => m.to === phone && m.text === legal.MARKETING_OPT_IN_QUESTION);
    assert.ok(question, 'debía preguntar por las promociones');
    assert.deepEqual(question.buttons, [legal.MARKETING_OPT_IN_BUTTONS.yes, legal.MARKETING_OPT_IN_BUTTONS.no]);
    sent.length = 0;
    await deliver(phone, { type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'promo_si', title: legal.MARKETING_OPT_IN_BUTTONS.yes } } }, sent);
    assert.ok(sent.some((m) => m.text === legal.MARKETING_OPT_IN_YES_REPLY));
    const prefs = (await getSupabase()).data.contact_preferences.find((p) => p.phone === phone);
    assert.ok(prefs.marketing_opt_in_at);
  });
});
