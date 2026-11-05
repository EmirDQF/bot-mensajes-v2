import { describe, it, afterEach } from 'node:test';
import assert from 'assert';

// Fase 4 (agente top): recordatorios configurables (48 h y 2 h por defecto), ficha para el doctor o recepción y
// métricas reales del panel.

process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test';

const { default: clinic, BASE_CLINIC, validateClinic, reminderHours } = await import('../config/clinic.config.js');
const { createJobs } = await import('./jobsService.js');
const { createAppointmentService } = await import('./appointmentService.js');
const { reminderStatusText, patientCardLines, conversationLink } = await import('./patientCard.js');
const { notifyDoctor, doctorCardText, interestOf } = await import('./doctorAlert.js');
const { handleAppointmentCommands } = await import('../controllers/webhookController.js');
const { createPanelData } = await import('./panelDataService.js');
const { fakeDb } = await import('./testing/fakeSupabase.js');
const { default: TEMPLATES } = await import('../config/whatsappTemplates.js');
const { confirmedBookingText } = await import('../controllers/bookingReplies.js');

// Martes 29/09/2026 08:00 en Lima.
const NOW = new Date('2026-09-29T13:00:00Z');
const hoursAgo = (h) => new Date(NOW - h * 3600e3).toISOString();
const OLD = hoursAgo(72);

function fakeWhatsapp() {
  const sent = [];
  return {
    sent,
    async sendTextMessage(to, text) { sent.push({ kind: 'text', to, text }); return {}; },
    async sendButtonsMessage(to, text, buttons) { sent.push({ kind: 'buttons', to, text, buttons }); return {}; },
    async sendTemplateMessage(to, name, params) { sent.push({ kind: 'template', to, name, params }); return {}; },
  };
}
const apt = (id, date, time, extra = {}) => ({
  id, clinic_id: clinic.id, sender_phone: `5191111${id.padStart(4, '0')}`.slice(0, 11), patient_name: 'Ana Torres', treatment: 'Limpieza',
  appointment_date: date, appointment_time: time, status: 'pendiente', created_at: OLD, ...extra,
});

describe('recordatorios configurables', () => {
  it('por defecto 48 h y 2 h; null apaga uno; valida los rangos', () => {
    assert.deepEqual(reminderHours({}), { firstHours: 48, secondHours: 2 });
    assert.deepEqual(reminderHours({ reminders: { firstHours: 24 } }), { firstHours: 24, secondHours: 2 });
    assert.deepEqual(reminderHours({ reminders: { firstHours: null, secondHours: 3 } }), { firstHours: null, secondHours: 3 });
    const c = structuredClone(BASE_CLINIC);
    assert.deepEqual(validateClinic({ ...c, reminders: { firstHours: 48, secondHours: 2 } }), []);
    assert.match(validateClinic({ ...c, reminders: { firstHours: 200 } }).join(), /firstHours/);
    assert.match(validateClinic({ ...c, reminders: { secondHours: 12 } }).join(), /secondHours/);
  });

  it('envía el de 48 h (no el de una cita recién pedida) y el de 2 h, cada uno una vez', async () => {
    const db = fakeDb({
      appointments: [
        apt('1', '2026-10-01', '07:00'), // 47 h → primero
        apt('2', '2026-10-01', '07:30', { created_at: hoursAgo(2) }), // 47 h pero recién pedida → todavía no
        apt('3', '2026-10-01', '10:00'), // 50 h → todavía no
        apt('4', '2026-09-29', '09:30', { status: 'confirmada' }), // 1,5 h → segundo
        apt('5', '2026-09-30', '10:00', { reminder_24h_sent_at: hoursAgo(5) }), // ya enviado
      ],
    });
    const whatsapp = fakeWhatsapp();
    const updates = [];
    const appointments = { async updateStatus(id, status, changes) { updates.push([id, Object.keys(changes)[0]]); } };
    const result = await createJobs({ getClient: () => db, whatsapp, appointments, now: () => NOW }).runReminders();
    assert.equal(result.sent24h, 1);
    assert.equal(result.sent2h, 1);
    assert.deepEqual(result.hours, { firstHours: 48, secondHours: 2 });
    assert.deepEqual(updates, [['1', 'reminder_24h_sent_at'], ['4', 'reminder_2h_sent_at']]);
    // Fuera de la ventana de 24 h: solo plantillas aprobadas de utilidad.
    assert.deepEqual(whatsapp.sent.map((m) => [m.kind, m.name]), [['template', 'recordatorio_cita_24h'], ['template', 'recordatorio_cita_2h']]);
    assert.equal(TEMPLATES.reminder24h.category, 'UTILITY');
    assert.doesNotMatch(TEMPLATES.reminder24h.body, /mañana/);
  });

  it('dentro de la ventana lleva botones "Confirmo" y "Reprogramar"', async () => {
    const db = fakeDb({
      appointments: [apt('1', '2026-10-01', '07:00', { sender_phone: '51911110001' })],
      messages: [{ phone: '51911110001', role: 'user', created_at: hoursAgo(3) }],
    });
    const whatsapp = fakeWhatsapp();
    await createJobs({ getClient: () => db, whatsapp, appointments: { async updateStatus() {} }, now: () => NOW }).runReminders();
    assert.equal(whatsapp.sent[0].kind, 'buttons');
    assert.deepEqual(whatsapp.sent[0].buttons.map((b) => b.title), ['Confirmo', 'Reprogramar']);
  });

  it('con firstHours 72 busca citas más lejanas; con null no envía el primero', async () => {
    const rows = [apt('1', '2026-10-02', '07:00')]; // 71 h
    const run = (reminders) => createJobs({
      getClient: () => fakeDb({ appointments: structuredClone(rows) }), whatsapp: fakeWhatsapp(),
      appointments: { async updateStatus() {} }, now: () => NOW, clinic: { ...clinic, reminders },
    }).runReminders();
    assert.equal((await run({ firstHours: 72 })).sent24h, 1);
    assert.equal((await run({ firstHours: null })).sent24h, 0);
  });

  it('el texto de confirmación dice las horas configuradas', () => {
    const base = { code: 'DV-1', status: 'confirmada', appointment_date: '2026-10-01', appointment_time: '10:00', treatment: 'Limpieza' };
    assert.match(confirmedBookingText(base), /te recordaremos por aquí 48 h y 2 h antes de tu cita\./);
    assert.doesNotMatch(confirmedBookingText(base, { ...clinic, reminders: { firstHours: null, secondHours: null } }), /recordaremos/);
  });
});

describe('ficha del paciente (doctor / recepción)', () => {
  const APT = {
    id: 'x', sender_phone: '51987654321', patient_name: 'Carlos Mendoza', treatment: 'Ortodoncia (brackets metálicos y estéticos)',
    appointment_date: '2026-10-01', appointment_time: '16:30', status: 'confirmada', confirmed_by: 'bot', code: 'DV-0472',
  };
  const HOURS = { firstHours: 48, secondHours: 2 };

  it('estado del recordatorio', () => {
    assert.equal(reminderStatusText(APT, HOURS), 'programado (48 h y 2 h antes) ✅');
    assert.match(reminderStatusText({ ...APT, reminder_24h_sent_at: 'x' }, HOURS), /enviado el de 48 h/);
    assert.match(reminderStatusText({ ...APT, reminder_reply: 'confirmo' }, HOURS), /confirmó/);
    assert.match(reminderStatusText({ ...APT, reminder_reply: 'reprogramar' }, HOURS), /reprogramar/);
    assert.match(reminderStatusText(APT, { firstHours: null, secondHours: null }), /sin recordatorio/);
  });

  it('el interés son solo nombres de tratamientos de la configuración (nada de síntomas)', () => {
    const interest = interestOf(APT, ['Paciente: me sangran las encías y quiero carillas', 'tengo dolor']);
    assert.deepEqual(interest, ['Ortodoncia (brackets metálicos y estéticos)', 'Carillas y diseño de sonrisa']);
    const text = doctorCardText(APT, { interest });
    assert.doesNotMatch(text, /sangran|dolor/);
    for (const part of ['Carlos Mendoza', 'DV-0472', 'Interés:', 'Recordatorio:', '/panel#chat=51987654321']) assert.ok(text.includes(part), part);
    assert.match(conversationLink('+51 987 654 321'), /\/panel#chat=51987654321$/);
    assert.equal(patientCardLines({ appointment: APT, interest, when: 'x', hours: HOURS }).length, 5);
  });

  const savedDoctor = process.env.DOCTOR_ALERT_PHONE;
  const savedReception = process.env.RECEPTION_ALERT_PHONE;
  afterEach(() => {
    if (savedDoctor === undefined) delete process.env.DOCTOR_ALERT_PHONE; else process.env.DOCTOR_ALERT_PHONE = savedDoctor;
    if (savedReception === undefined) delete process.env.RECEPTION_ALERT_PHONE; else process.env.RECEPTION_ALERT_PHONE = savedReception;
  });

  it('sin DOCTOR_ALERT_PHONE (o si es recepción) no envía nada aparte', async () => {
    delete process.env.DOCTOR_ALERT_PHONE;
    let calls = 0;
    const send = async () => { calls += 1; };
    assert.equal((await notifyDoctor(APT, { send })).sent, false);
    process.env.DOCTOR_ALERT_PHONE = '51911100100';
    process.env.RECEPTION_ALERT_PHONE = '51911100100';
    assert.equal((await notifyDoctor(APT, { send })).sent, false);
    assert.equal(calls, 0);
  });

  it('con DOCTOR_ALERT_PHONE envía texto o, fuera de la ventana, la plantilla con 7 variables sin saltos de línea', async () => {
    process.env.DOCTOR_ALERT_PHONE = '51911100100';
    process.env.RECEPTION_ALERT_PHONE = '51911100200';
    const calls = [];
    const result = await notifyDoctor(APT, { interest: ['Ortodoncia'], send: async (to, payload) => { calls.push({ to, ...payload }); } });
    assert.equal(result.sent, true);
    assert.equal(calls[0].to, '51911100100');
    assert.match(calls[0].text, /Nueva cita confirmada/);
    assert.equal(calls[0].template.name, 'ficha_cita_doctor');
    assert.equal(calls[0].params.length, 7);
    assert.ok(calls[0].params.every((p) => !/\n/.test(p)));
  });

  it('la alerta a recepción trae el estado del recordatorio y el enlace a la conversación', async () => {
    process.env.RECEPTION_ALERT_PHONE = '51911100200';
    const whatsapp = fakeWhatsapp();
    const service = createAppointmentService({ getClient: () => fakeDb({}), whatsapp, now: () => NOW, events: { publish() {} } });
    await service.notifyReception(APT, { interest: ['Ortodoncia', 'Carillas'] });
    const text = whatsapp.sent[0].text;
    assert.match(text, /CONFIRMADA por el asistente \(DV-0472\)/);
    assert.match(text, /Interés: Ortodoncia \+ Carillas/);
    assert.match(text, /🔔 Recordatorio: programado \(48 h y 2 h antes\)/);
    assert.match(text, /\/panel#chat=51987654321/);
  });

  it('"Confirmo" al recordatorio guarda la respuesta aunque la cita ya estuviera confirmada por el bot', async () => {
    const upcoming = { ...APT, reminder_24h_sent_at: hoursAgo(1) };
    const calls = [];
    const appointments = {
      async findUpcomingByPhone() { return upcoming; },
      async confirm(id, changes) { calls.push(['confirm', id, changes]); return upcoming; },
      async updateStatus(id, status, changes) { calls.push(['updateStatus', id, status, changes?.reminder_reply]); return upcoming; },
      async notifyReception(a, { event }) { calls.push(['notify', event, a.reminder_reply]); },
    };
    const gemini = { getOfferedSlots: () => null, pickOfferedSlot: () => null };
    const reply = await handleAppointmentCommands('51987654321', 'Confirmo', { appointments, gemini });
    assert.match(reply, /confirmada/);
    assert.deepEqual(calls.slice(0, 2), [['updateStatus', 'x', 'confirmada', 'confirmo'], ['notify', 'confirmada', 'confirmo']]);
  });
});

describe('métricas reales del panel', () => {
  it('confirmadas, asistencias y % de conversaciones sin intervención humana, desde la base', async () => {
    const db = fakeDb({
      messages: [
        { phone: '51911111111', role: 'user', created_at: hoursAgo(30) },
        { phone: '51922222222', role: 'user', created_at: hoursAgo(30) },
        { phone: '51933333333', role: 'user', created_at: hoursAgo(30) },
        { phone: '51944444444', role: 'user', created_at: hoursAgo(30) },
        { phone: '51922222222', role: 'assistant', sender: 'reception', created_at: hoursAgo(29) },
      ],
      handoffs: [{ clinic_id: clinic.id, phone: '51933333333', reason: 'urgencia', created_at: hoursAgo(29) }],
      appointments: [
        apt('1', '2026-09-28', '10:00', { sender_phone: '51911111111', status: 'asistio', confirmed_at: hoursAgo(40), created_at: hoursAgo(48) }),
        apt('2', '2026-09-30', '10:00', { sender_phone: '51944444444', status: 'confirmada', confirmed_at: hoursAgo(10), created_at: hoursAgo(20) }),
      ],
    });
    const m = await createPanelData({ getClient: () => db, now: () => NOW }).getMetrics(30);
    assert.equal(m.leads, 4);
    assert.equal(m.botOnly, 2); // la 2 tuvo un mensaje de recepción y la 3 pasó a humano
    assert.equal(m.botOnlyRate, 50);
    assert.equal(m.appointments, 2);
    assert.equal(m.attended, 1);
    assert.equal(typeof m.confirmed, 'number');
    assert.ok(m.confirmed >= 1);
  });
});
