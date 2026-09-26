import { describe, it } from 'node:test';
import assert from 'assert';

process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test';

const { detectHandoff, patientHandoffReply, createHandoffService } = await import('./handoffService.js');
const { createJobs, isWithinWorkingHours } = await import('./jobsService.js');
const { requireCronSecret } = await import('../routes/jobs.js');
const { sendTemplateMessage } = await import('./whatsappService.js');
const { handleAppointmentCommands, sanitizeReferral } = await import('../controllers/webhookController.js');
const gemini = await import('./geminiService.js');
const { default: clinic } = await import('../config/clinic.config.js');
const { fakeDb } = await import('./testing/fakeSupabase.js');
const { fetchAllRows } = await import('./supabasePaging.js');
const { DATA_DELETION } = await import('../controllers/webhookController.js');

const fakeWhatsapp = () => ({
  sent: [],
  async sendTextMessage(to, text) { this.sent.push({ kind: 'text', to, text }); },
  async sendTemplateMessage(to, name, params) { this.sent.push({ kind: 'template', to, name, params }); },
});

describe('handoff: urgencias y pase a humano', () => {
  it('detects urgencies and human requests', () => {
    assert.equal(detectHandoff('me duele muchísimo la muela y está hinchada'), 'urgencia');
    assert.equal(detectHandoff('tengo sangrado en la encía'), 'urgencia');
    assert.equal(detectHandoff('quiero hablar con una persona'), 'humano');
    assert.equal(detectHandoff('asesor'), 'humano');
    assert.equal(detectHandoff('cuánto cuestan los brackets'), null);
  });

  it('never gives a diagnosis or medication in the urgency reply', () => {
    const reply = patientHandoffReply('urgencia');
    assert.ok(reply.includes('no puedo darte diagnóstico ni indicarte medicamentos'));
    assert.ok(reply.includes(clinic.address));
  });

  it('pauses the conversation (conversations.status = human) and alerts reception', async () => {
    process.env.RECEPTION_ALERT_PHONE = '999888777';
    const db = fakeDb({ conversations: [{ conversation_id: '51911111111', status: 'active' }] });
    const whatsapp = fakeWhatsapp();
    const service = createHandoffService({ getClient: () => db, whatsapp });
    assert.equal(await service.isPaused('51911111111'), false);
    const result = await service.handoff({ phone: '51911111111', reason: 'urgencia', message: 'me sangra mucho', contactName: 'Ana' });
    assert.deepEqual(result, { notified: true });
    assert.equal(db.data.conversations[0].status, 'human');
    assert.equal(await service.isPaused('51911111111'), true);
    assert.equal(whatsapp.sent[0].to, '51999888777');
    assert.ok(whatsapp.sent[0].text.includes('URGENCIA'));
    assert.ok(whatsapp.sent[0].text.includes('wa.me/51911111111'));
    assert.equal(await service.toggle('51911111111'), false); // recepción lo reactiva desde el panel
    assert.equal(db.data.conversations[0].status, 'active');
    delete process.env.RECEPTION_ALERT_PHONE;
  });
});

// Martes 29/09/2026 08:00 en Lima.
const NOW = new Date('2026-09-29T13:00:00Z');
const hoursAgo = (h) => new Date(NOW - h * 3600e3).toISOString();

describe('jobs: recordatorios 24 h / 2 h', () => {
  it('sends each reminder once, text inside the 24h window and template outside', async () => {
    const db = fakeDb({
      appointments: [
        { id: 'a24', clinic_id: 'denvari', sender_phone: '51911111111', patient_name: 'Ana Torres', treatment: 'Limpieza', appointment_date: '2026-09-30', appointment_time: '07:00', status: 'pendiente' },
        { id: 'a2', clinic_id: 'denvari', sender_phone: '51922222222', patient_name: 'Luis', treatment: 'Ortodoncia', appointment_date: '2026-09-29', appointment_time: '09:30', status: 'confirmada' },
        { id: 'done', clinic_id: 'denvari', sender_phone: '51933333333', appointment_date: '2026-09-30', appointment_time: '07:30', status: 'pendiente', reminder_24h_sent_at: hoursAgo(1) },
        { id: 'far', clinic_id: 'denvari', sender_phone: '51944444444', appointment_date: '2026-10-01', appointment_time: '10:00', status: 'pendiente' },
        { id: 'off', clinic_id: 'denvari', sender_phone: '51955555555', appointment_date: '2026-09-29', appointment_time: '09:00', status: 'cancelada' },
      ],
      messages: [{ phone: '51911111111', role: 'user', created_at: hoursAgo(3) }],
    });
    const whatsapp = fakeWhatsapp();
    const updates = [];
    const appointments = { async updateStatus(id, status, changes) { updates.push({ id, status, changes }); } };
    const jobs = createJobs({ getClient: () => db, whatsapp, appointments, now: () => NOW });

    const result = await jobs.runReminders();
    assert.equal(result.sent24h, 1);
    assert.equal(result.sent2h, 1);
    assert.equal(result.failed, 0);

    const text = whatsapp.sent.find((m) => m.to === '51911111111');
    assert.equal(text.kind, 'text');
    assert.ok(text.text.includes('1️⃣ Confirmo') && text.text.includes('2️⃣ Reprogramar'));
    const template = whatsapp.sent.find((m) => m.to === '51922222222');
    assert.equal(template.kind, 'template');
    assert.equal(template.name, 'recordatorio_cita_2h');
    assert.deepEqual(template.params, ['Luis', clinic.name, '9:30 a. m.', clinic.address]);

    assert.deepEqual(updates.map((u) => [u.id, u.status, Object.keys(u.changes)[0]]), [
      ['a24', 'pendiente', 'reminder_24h_sent_at'],
      ['a2', 'confirmada', 'reminder_2h_sent_at'],
    ]);
  });
});

describe('jobs: resumen diario y seguimiento', () => {
  it('builds the owner summary from yesterday activity', async () => {
    process.env.OWNER_ALERT_PHONE = '988777666';
    const db = fakeDb({
      messages: [
        { phone: '51911111111', role: 'user', created_at: '2026-09-29T03:30:00Z' }, // 22:30 del lunes → fuera de horario
        { phone: '51922222222', role: 'user', created_at: '2026-09-28T16:00:00Z' }, // 11:00 del lunes → en horario
        { phone: '51933333333', role: 'user', created_at: '2026-09-29T04:00:00Z' }, // 23:00 → fuera de horario
      ],
      appointments: [
        { id: 'x', clinic_id: 'denvari', sender_phone: '51911111111', created_at: '2026-09-29T03:40:00Z', appointment_date: '2026-09-29', status: 'pendiente', ad_referral: { headline: 'Brackets S/ 0' } },
        { id: 'y', clinic_id: 'denvari', sender_phone: '51900000000', created_at: '2026-09-25T15:00:00Z', appointment_date: '2026-10-02', status: 'pendiente', ad_referral: { headline: 'Brackets S/ 0' } },
      ],
    });
    const whatsapp = fakeWhatsapp();
    const jobs = createJobs({ getClient: () => db, whatsapp, now: () => NOW });
    const result = await jobs.runDailySummary();
    assert.deepEqual(result.summary, {
      date: result.summary.date, afterHours: 2, created: 1, today: 1, unbooked: 2, topAd: 'Brackets S/ 0 (2 citas)',
    });
    assert.equal(whatsapp.sent[0].to, '51988777666');
    assert.equal(whatsapp.sent[0].name, 'resumen_diario');
    delete process.env.OWNER_ALERT_PHONE;
  });

  it('sends a single follow-up at ~20h to leads without appointment', async () => {
    const db = fakeDb({
      messages: [
        { phone: '51911111111', role: 'user', created_at: hoursAgo(21) }, // candidato
        { phone: '51922222222', role: 'user', created_at: hoursAgo(21) }, // ya tiene cita
        { phone: '51933333333', role: 'user', created_at: hoursAgo(10) }, // todavía no
        { phone: '51944444444', role: 'user', created_at: hoursAgo(22) }, // ya recibió seguimiento
      ],
      appointments: [{ clinic_id: 'denvari', sender_phone: '51922222222', created_at: hoursAgo(20) }],
      follow_ups: [{ clinic_id: 'denvari', phone: '51944444444' }],
    }, { uniqueOn: { follow_ups: ['clinic_id', 'phone'] } });
    const whatsapp = fakeWhatsapp();
    const handoff = { async isPaused() { return false; } };
    const jobs = createJobs({ getClient: () => db, whatsapp, handoff, now: () => NOW });

    const first = await jobs.runFollowUps();
    assert.deepEqual(first, { candidates: 3, sent: 1, skipped: 2, failed: 0 });
    assert.equal(whatsapp.sent[0].to, '51911111111');
    assert.equal(whatsapp.sent[0].kind, 'text');
    assert.ok(whatsapp.sent[0].text.includes('quiero una cita'));

    const second = await jobs.runFollowUps();
    assert.equal(second.sent, 0); // nunca un segundo mensaje
  });

  it('knows the clinic working hours', () => {
    assert.equal(isWithinWorkingHours(clinic, new Date('2026-09-29T15:00:00Z')), true); // martes 10:00
    assert.equal(isWithinWorkingHours(clinic, new Date('2026-10-04T15:00:00Z')), false); // domingo
  });
});

describe('POST /jobs/* protection', () => {
  const run = (headers) => {
    const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    let nextCalled = false;
    requireCronSecret({ get: (h) => headers[h.toLowerCase()] }, res, () => { nextCalled = true; });
    return { res, nextCalled };
  };

  it('requires CRON_SECRET', () => {
    delete process.env.CRON_SECRET;
    assert.equal(run({}).res.code, 503);
    process.env.CRON_SECRET = 's3cret-value';
    assert.equal(run({ 'x-cron-secret': 'wrong' }).res.code, 401);
    assert.equal(run({}).res.code, 401);
    assert.equal(run({ 'x-cron-secret': 's3cret-value' }).nextCalled, true);
    assert.equal(run({ authorization: 'Bearer s3cret-value' }).nextCalled, true);
    delete process.env.CRON_SECRET;
  });
});

describe('WhatsApp templates, referral and reminder replies', () => {
  it('sends templates by name with single-line parameters', async () => {
    let body;
    const fetchImpl = async (url, init) => { body = JSON.parse(init.body); return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'w1' }] }), text: async () => '' }; };
    await sendTemplateMessage('51911111111', 'recordatorio_cita_2h', ['Ana', 'línea 1\nlínea 2', ''], { fetchImpl });
    assert.equal(body.type, 'template');
    assert.equal(body.template.name, 'recordatorio_cita_2h');
    assert.deepEqual(body.template.components[0].parameters.map((p) => p.text), ['Ana', 'línea 1 línea 2', '-']);
  });

  it('keeps only known Meta referral fields', () => {
    const clean = sanitizeReferral({ source_type: 'ad', source_id: '123', headline: 'Brackets S/ 0', evil: 'x', body: '  ' });
    assert.deepEqual(Object.keys(clean).sort(), ['headline', 'received_at', 'source_id', 'source_type']);
    assert.equal(sanitizeReferral(null), null);
    assert.equal(sanitizeReferral({ foo: 'bar' }), null);
  });

  const upcoming = (extra = {}) => ({
    id: 'apt-9', sender_phone: '51977777777', patient_name: 'Ana', treatment: 'Limpieza',
    appointment_date: '2026-10-02', appointment_time: '10:00', duration_min: 30, status: 'pendiente', ...extra,
  });
  const fakeAppointments = (apt) => {
    const calls = [];
    return {
      calls,
      async findUpcomingByPhone() { return apt; },
      async updateStatus(id, status) { calls.push(['updateStatus', id, status]); return { ...apt, status }; },
      async notifyReception(a, o) { calls.push(['notifyReception', o?.event]); return { sent: true }; },
      async findNextSlots() { return [{ date: '2026-10-03', time: '09:00', label: 'sábado, 3 de octubre a las 9:00 a. m.' }]; },
    };
  };

  it('"1" after a reminder confirms the appointment and alerts reception', async () => {
    const appointments = fakeAppointments(upcoming({ reminder_24h_sent_at: hoursAgo(1) }));
    const reply = await handleAppointmentCommands('51977777777', '1', { appointments, gemini });
    assert.match(reply, /quedó confirmada ✅/);
    assert.deepEqual(appointments.calls, [['updateStatus', 'apt-9', 'confirmada'], ['notifyReception', 'confirmada']]);
  });

  it('"2" after a reminder offers new slots; "1" without a reminder is left to Gemini', async () => {
    const withReminder = fakeAppointments(upcoming({ reminder_2h_sent_at: hoursAgo(1) }));
    const offer = await handleAppointmentCommands('51977777776', '2', { appointments: withReminder, gemini });
    assert.ok(offer.includes('Elige el nuevo horario'));
    const noReminder = fakeAppointments(upcoming());
    assert.equal(await handleAppointmentCommands('51977777775', '1', { appointments: noReminder, gemini }), null);
  });
});

describe('fixes de la revisión de código', () => {
  it('pages through Supabase results beyond one page', async () => {
    const db = fakeDb({ messages: Array.from({ length: 5 }, (_, i) => ({ phone: String(i), role: 'user', created_at: String(i) })) });
    const rows = await fetchAllRows(() => db.from('messages').select('phone').eq('role', 'user').order('created_at'), 2);
    assert.deepEqual(rows.map((r) => r.phone), ['0', '1', '2', '3', '4']);
  });

  it('recognises the data deletion request promised in the privacy notice', () => {
    assert.ok(clinic.privacyNotice.includes('borrar mis datos'));
    for (const text of ['borrar mis datos', 'Borrar mis datos por favor', 'eliminar mis datos personales', 'borra todos mis datos']) {
      assert.equal(DATA_DELETION.test(text), true, text);
    }
    assert.equal(DATA_DELETION.test('¿me pueden borrar la cita?'), false);
  });
});
