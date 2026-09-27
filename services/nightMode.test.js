import { describe, it } from 'node:test';
import assert from 'assert';

process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test';

const {
  createAppointmentService, OutsideHoursError, SlotTakenError, isWithinWorkingHours, parseRequestedDay,
} = await import('./appointmentService.js');
const { createConversationMetrics } = await import('./conversationMetrics.js');
const { createHandoffService } = await import('./handoffService.js');
const {
  takeAfterHoursNotice, buildWelcomeCaption, AFTER_HOURS_NOTICE, aiFallbackReply, GREETING_ONLY,
} = await import('../controllers/webhookController.js');
const { default: clinic } = await import('../config/clinic.config.js');
const { fakeDb } = await import('./testing/fakeSupabase.js');

// Jueves 1 de octubre de 2026 en Lima (UTC-5).
const NIGHT = new Date('2026-10-02T03:30:00Z'); // 10:30 p. m.
const DAY = new Date('2026-10-01T15:00:00Z'); // 10:00 a. m.
const noWhatsapp = { async sendTextMessage() {} };

// Supabase falso que responde PGRST204 si se envía una columna de la migración de métricas.
function legacyDb() {
  const db = fakeDb({ appointments: [] });
  const from = db.from.bind(db);
  db.from = (table) => {
    const builder = from(table);
    const insert = builder.insert.bind(builder);
    const update = builder.update.bind(builder);
    const fail = (payload) => [payload].flat().some((row) => 'after_hours' in row || 'confirmed_at' in row || 'rescheduled_at' in row);
    const failing = { select: () => failing, single: async () => ({ data: null, error: { code: 'PGRST204', message: "Could not find the 'after_hours' column" } }), eq: () => failing };
    builder.insert = (payload) => (fail(payload) ? failing : insert(payload));
    builder.update = (payload) => (fail(payload) ? failing : update(payload));
    return builder;
  };
  return db;
}

describe('modo nocturno: horario de la clínica', () => {
  it('knows when the clinic is closed, in the clinic timezone', () => {
    assert.equal(isWithinWorkingHours(clinic, DAY), true);
    assert.equal(isWithinWorkingHours(clinic, NIGHT), false);
    assert.equal(isWithinWorkingHours(clinic, new Date('2026-10-03T20:00:00Z')), false); // sábado 3:00 p. m.
  });

  it('reads the day the patient asks for', () => {
    const today = '2026-10-01'; // jueves
    assert.equal(parseRequestedDay('¿tienen cita el sábado?', today), '2026-10-03');
    assert.equal(parseRequestedDay('mañana en la mañana', today), '2026-10-02');
    assert.equal(parseRequestedDay('pasado mañana', today), '2026-10-03');
    assert.equal(parseRequestedDay('por la mañana', today), null);
    assert.equal(parseRequestedDay('cuánto cuestan los brackets', today), null);
  });

  it('says the clinic is closed once per night and puts it in the welcome', () => {
    assert.equal(takeAfterHoursNotice('51900000001', NIGHT), true);
    assert.equal(takeAfterHoursNotice('51900000001', new Date(NIGHT.getTime() + 20 * 60e3)), false);
    assert.equal(takeAfterHoursNotice('51900000002', DAY), false);
    assert.ok(buildWelcomeCaption({ afterHours: true }).includes(AFTER_HOURS_NOTICE));
    assert.ok(!buildWelcomeCaption({ afterHours: false }).includes(AFTER_HOURS_NOTICE));
    assert.ok(buildWelcomeCaption().includes(clinic.privacyNotice));
    assert.match(AFTER_HOURS_NOTICE, /recepción te la confirma/);
  });

  it('never leaves the patient without an answer when Gemini fails', () => {
    const slots = [{ date: '2026-10-02', time: '09:00', label: 'viernes, 2 de octubre a las 9:00 a. m.' }];
    assert.match(aiFallbackReply(slots), /Horarios disponibles:[\s\S]*9:00 a\. m\./);
    assert.match(aiFallbackReply(null), /avisé al equipo de la clínica/);
  });

  it('treats only greetings as greetings; a question gets an immediate answer', () => {
    for (const text of ['hola', 'Hola, buenas noches', 'buenas tardes!', 'Holaa 👋', 'info']) assert.ok(GREETING_ONLY.test(text), text);
    for (const text of ['Hola, ¿cuánto cuestan los brackets?', 'buenas noches, vi su anuncio', 'quiero una cita']) assert.ok(!GREETING_ONLY.test(text), text);
  });

  it('offers tomorrow-morning slots at 10:30 p. m.', async () => {
    const service = createAppointmentService({ getClient: () => fakeDb({ appointments: [] }), whatsapp: noWhatsapp, now: () => NIGHT });
    const slots = await service.findNextSlots('limpieza');
    assert.equal(slots.length, 3);
    assert.equal(slots[0].date, '2026-10-02');
    assert.equal(slots[0].time, '09:00');
  });
});

describe('modo nocturno: la cita guarda after_hours', () => {
  const request = { senderPhone: '51911111111', patientName: 'Ana Torres', treatment: 'limpieza', appointmentDate: '2026-10-02', appointmentTime: '09:00' };

  it('marks a request made at night and one made during the day', async () => {
    const db = fakeDb({ appointments: [] });
    const night = createAppointmentService({ getClient: () => db, whatsapp: noWhatsapp, now: () => NIGHT });
    await night.saveAppointment(request);
    const day = createAppointmentService({ getClient: () => db, whatsapp: noWhatsapp, now: () => DAY });
    await day.saveAppointment({ ...request, appointmentTime: '16:00' });
    assert.deepEqual(db.data.appointments.map((a) => a.after_hours), [true, false]);
  });

  it('rejects 11 p. m., Sundays and past times with OutsideHoursError', async () => {
    const service = createAppointmentService({ getClient: () => fakeDb({ appointments: [] }), whatsapp: noWhatsapp, now: () => NIGHT });
    await assert.rejects(service.saveAppointment({ ...request, appointmentTime: '23:00' }), OutsideHoursError);
    await assert.rejects(service.saveAppointment({ ...request, appointmentDate: '2026-10-04' }), OutsideHoursError);
    await assert.rejects(service.saveAppointment({ ...request, appointmentDate: '2026-10-01', appointmentTime: '19:00' }), OutsideHoursError);
    await assert.rejects(service.saveAppointment({ ...request, appointmentDate: '2026-10-03', appointmentTime: '13:45' }), SlotTakenError); // cierra 14:00
  });

  it('still saves the appointment when the metrics migration is missing', async () => {
    const db = legacyDb();
    const service = createAppointmentService({ getClient: () => db, whatsapp: noWhatsapp, now: () => NIGHT });
    const saved = await service.saveAppointment(request);
    assert.equal(saved.patient_name, 'Ana Torres');
    assert.equal('after_hours' in db.data.appointments[0], false);
  });

  it('stamps confirmed_at and rescheduled_at', async () => {
    const db = fakeDb({ appointments: [{ id: 'a1', clinic_id: clinic.id, status: 'pendiente', appointment_date: '2026-10-02', appointment_time: '09:00', duration_min: 30 }] });
    const service = createAppointmentService({ getClient: () => db, whatsapp: noWhatsapp, now: () => NIGHT });
    await service.confirm('a1');
    assert.equal(db.data.appointments[0].confirmed_at, NIGHT.toISOString());
    await service.reschedule('a1', { appointmentDate: '2026-10-02', appointmentTime: '11:00', durationMin: 30 });
    assert.equal(db.data.appointments[0].rescheduled_at, NIGHT.toISOString());
  });
});

describe('modo nocturno: primer contacto y pase a humano', () => {
  it('stores first response time and after_hours only once per conversation', async () => {
    const db = fakeDb({ conversations: [{ conversation_id: '51922222222', first_response_ms: null }] });
    const leadCalls = [];
    const leads = { async saveLeadAfterHours(phone, value) { leadCalls.push([phone, value]); } };
    const metrics = createConversationMetrics({ getClient: () => db, leads, now: () => NIGHT });
    const out = await metrics.recordFirstContact({ phone: '+51 922 222 222', firstMessageAt: new Date(NIGHT.getTime() - 1800), respondedAt: NIGHT });
    assert.deepEqual(out, { afterHours: true, firstResponseMs: 1800, saved: true });
    assert.equal(db.data.conversations[0].first_response_ms, 1800);
    assert.equal(db.data.conversations[0].after_hours, true);
    await metrics.recordFirstContact({ phone: '51922222222', firstMessageAt: new Date(NIGHT.getTime() - 9000), respondedAt: NIGHT });
    assert.equal(db.data.conversations[0].first_response_ms, 1800);
    assert.deepEqual(leadCalls[0], ['51922222222', true]);
  });

  it('logs every handoff with its reason for the weekly report', async () => {
    const db = fakeDb({ conversations: [], handoffs: [] });
    const service = createHandoffService({ getClient: () => db, whatsapp: noWhatsapp, now: () => NIGHT.getTime() });
    await service.handoff({ phone: '51933333333', reason: 'urgencia', message: 'me duele mucho y está hinchado' });
    assert.equal(db.data.handoffs.length, 1);
    assert.equal(db.data.handoffs[0].reason, 'urgencia');
    assert.equal(db.data.handoffs[0].after_hours, true);
    assert.equal(db.data.conversations[0].status, 'human');
  });
});
