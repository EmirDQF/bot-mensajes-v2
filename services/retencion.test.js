import { describe, it, afterEach } from 'node:test';
import assert from 'assert';
import { readFileSync, readdirSync } from 'node:fs';

// Fase 3: retención y avisos (botones en el recordatorio, seguimiento a ~4 h y ~23 h con el anuncio,
// reactivación a 6 meses, alerta de cita con resumen y agenda del día a las 7:30 a. m.).

process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test';

const { createJobs } = await import('./jobsService.js');
const { createJobsRouter } = await import('../routes/jobs.js');
const { sendButtonsMessage } = await import('./whatsappService.js');
const { handleAppointmentCommands } = await import('../controllers/webhookController.js');
const { createAppointmentService } = await import('./appointmentService.js');
const gemini = await import('./geminiService.js');
const { CRON_JOBS } = await import('../scripts/crons-setup.js');
const { default: clinic } = await import('../config/clinic.config.js');
const { fakeDb } = await import('./testing/fakeSupabase.js');

// Martes 29/09/2026 08:00 en Lima.
const NOW = new Date('2026-09-29T13:00:00Z');
const hoursAgo = (h) => new Date(NOW - h * 3600e3).toISOString();
const daysAgoDate = (d) => new Date(NOW - d * 86400e3).toISOString().slice(0, 10);

const fakeWhatsapp = ({ buttons = true } = {}) => {
  const api = {
    sent: [],
    async sendTextMessage(to, text) { api.sent.push({ kind: 'text', to, text }); return { messages: [{ id: 'w' }] }; },
    async sendTemplateMessage(to, name, params) { api.sent.push({ kind: 'template', to, name, params }); return { messages: [{ id: 'w' }] }; },
  };
  if (buttons) api.sendButtonsMessage = async (to, text, options) => { api.sent.push({ kind: 'buttons', to, text, buttons: options }); return { messages: [{ id: 'w' }] }; };
  return api;
};
const noPause = { async isPaused() { return false; } };

afterEach(() => {
  delete process.env.OWNER_ALERT_PHONE;
  delete process.env.RECEPTION_ALERT_PHONE;
});

describe('Fase 3: recordatorio con botones Confirmar / Reagendar', () => {
  it('dentro de la ventana de 24 h el recordatorio lleva botones interactivos', async () => {
    const db = fakeDb({
      appointments: [{ id: 'a24', clinic_id: clinic.id, sender_phone: '51911111111', patient_name: 'Ana Torres', treatment: 'Limpieza', appointment_date: '2026-09-30', appointment_time: '07:00', status: 'pendiente' }],
      messages: [{ phone: '51911111111', role: 'user', created_at: hoursAgo(3) }],
    });
    const whatsapp = fakeWhatsapp();
    const appointments = { async updateStatus() {} };
    const result = await createJobs({ getClient: () => db, whatsapp, appointments, now: () => NOW }).runReminders();
    assert.equal(result.sent24h, 1);
    const [msg] = whatsapp.sent;
    assert.equal(msg.kind, 'buttons');
    assert.deepEqual(msg.buttons.map((b) => b.title), ['Confirmar', 'Reagendar']);
    assert.ok(msg.text.includes('Limpieza') && msg.text.includes(clinic.address));
  });

  it('el mensaje interactivo usa el formato de la Cloud API', async () => {
    const bodies = [];
    const fetchImpl = async (url, options) => { bodies.push(JSON.parse(options.body)); return new Response('{"messages":[{"id":"w"}]}', { status: 200 }); };
    await sendButtonsMessage('51999000111', '¿Confirmas tu cita?', [{ id: 'confirmar', title: 'Confirmar' }, { id: 'reagendar', title: 'Reagendar' }], { fetchImpl });
    assert.deepEqual(bodies[0], {
      messaging_product: 'whatsapp', to: '51999000111', type: 'interactive',
      interactive: { type: 'button', body: { text: '¿Confirmas tu cita?' }, action: { buttons: [
        { type: 'reply', reply: { id: 'confirmar', title: 'Confirmar' } },
        { type: 'reply', reply: { id: 'reagendar', title: 'Reagendar' } },
      ] } },
    });
  });

  it('tocar "Confirmar" confirma y tocar "Reagendar" ofrece horarios nuevos', async () => {
    const appointment = { id: 'c1', appointment_date: '2026-09-30', appointment_time: '07:00', status: 'pendiente', treatment: 'Limpieza', reminder_24h_sent_at: hoursAgo(1) };
    const calls = [];
    const appointments = {
      async findUpcomingByPhone() { return appointment; },
      async confirm(id) { calls.push(['confirm', id]); return appointment; },
      async notifyReception() {},
      async findNextSlots() { return [{ date: '2026-10-01', time: '10:00', label: 'jueves 1 de octubre, 10:00 a. m.' }]; },
    };
    const confirmed = await handleAppointmentCommands('51955500001', 'Confirmar', { appointments, gemini });
    assert.match(confirmed, /confirmada/);
    assert.deepEqual(calls, [['confirm', 'c1']]);
    const rescheduled = await handleAppointmentCommands('51955500002', 'Reagendar', { appointments, gemini });
    assert.match(rescheduled, /Horarios disponibles/);
  });
});

describe('Fase 3: seguimiento a ~4 h y ~23 h con el anuncio', () => {
  it('envía uno a las ~4 h y otro a las ~23 h, cada uno una sola vez, con el tratamiento del anuncio', async () => {
    const db = fakeDb({
      messages: [
        { phone: '51911111111', role: 'user', created_at: hoursAgo(5) }, // ~4 h
        { phone: '51922222222', role: 'user', created_at: hoursAgo(21) }, // ~23 h (ya recibió el de 4 h)
        { phone: '51933333333', role: 'user', created_at: hoursAgo(2) }, // todavía no
      ],
      leads: [{ telefono: '911111111', tags: [], ad_referral: { headline: 'Brackets con cuota inicial S/ 0' } }],
      appointments: [],
      follow_ups: [{ clinic_id: clinic.id, phone: '51922222222', stage: 'first' }],
    }, { uniqueOn: { follow_ups: ['clinic_id', 'phone', 'stage'] } });
    const whatsapp = fakeWhatsapp();
    const jobs = createJobs({ getClient: () => db, whatsapp, handoff: noPause, now: () => NOW });
    const result = await jobs.runFollowUps();
    assert.equal(result.sent, 2);
    const early = whatsapp.sent.find((m) => m.to === '51911111111');
    assert.equal(early.kind, 'text');
    assert.match(early.text, /Ortodoncia/);
    assert.ok(whatsapp.sent.some((m) => m.to === '51922222222'));
    assert.deepEqual(db.data.follow_ups.map((f) => [f.phone, f.stage]).sort(), [
      ['51911111111', 'first'], ['51922222222', 'final'], ['51922222222', 'first'],
    ]);
    assert.equal((await jobs.runFollowUps()).sent, 0, 'nunca se repite una etapa');
  });

  it('hay una migración idempotente con la etapa del seguimiento', () => {
    const file = readdirSync(new URL('../migrations/', import.meta.url)).find((f) => /^20261104_.*follow/.test(f));
    assert.ok(file, 'falta la migración de follow_ups.stage');
    const sql = readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8');
    assert.match(sql, /ADD COLUMN IF NOT EXISTS stage/i);
    assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS[\s\S]*\(clinic_id, phone, stage\)/i);
  });
});

describe('Fase 3: reactivación a los 6 meses', () => {
  it('escribe con la plantilla a quien vino hace ~6 meses y no volvió, una sola vez', async () => {
    const db = fakeDb({
      appointments: [
        { clinic_id: clinic.id, sender_phone: '51911111111', appointment_date: daysAgoDate(182), status: 'asistio' },
        { clinic_id: clinic.id, sender_phone: '51922222222', appointment_date: daysAgoDate(183), status: 'asistio' },
        { clinic_id: clinic.id, sender_phone: '51922222222', appointment_date: daysAgoDate(30), status: 'asistio' }, // volvió
        { clinic_id: clinic.id, sender_phone: '51933333333', appointment_date: daysAgoDate(181), status: 'cancelada' },
        { clinic_id: clinic.id, sender_phone: '51944444444', appointment_date: daysAgoDate(182), status: 'asistio' }, // no contactar
      ],
      leads: [{ telefono: '944444444', tags: ['no_contactar'] }],
      messages: [],
      follow_ups: [],
    }, { uniqueOn: { follow_ups: ['clinic_id', 'phone', 'stage'] } });
    const whatsapp = fakeWhatsapp();
    const jobs = createJobs({ getClient: () => db, whatsapp, handoff: noPause, now: () => NOW });
    const result = await jobs.runReactivation();
    assert.equal(result.sent, 1);
    assert.deepEqual(whatsapp.sent.map((m) => [m.to, m.kind, m.name]), [['51911111111', 'template', 'reactivacion_paciente']]);
    assert.equal((await jobs.runReactivation()).sent, 0);
  });

  it('corre con el cron de seguimientos (sin tarea nueva) y también por POST /jobs/reactivation', () => {
    const router = createJobsRouter({ runFollowUps: async () => ({}), runReactivation: async () => ({}) }, {});
    const paths = router.stack.map((layer) => layer.route?.path).filter(Boolean);
    assert.ok(paths.includes('/reactivation'));
    assert.ok(paths.includes('/follow-ups'));
  });
});

describe('Fase 3: alerta a recepción y briefing de las 7:30', () => {
  it('la alerta de nueva solicitud trae nombre, tratamiento, anuncio y un resumen de 2 líneas', async () => {
    process.env.RECEPTION_ALERT_PHONE = '999888777';
    const whatsapp = fakeWhatsapp();
    const service = createAppointmentService({ getClient: () => fakeDb({}), whatsapp });
    await service.notifyReception({
      sender_phone: '51911111111', patient_name: 'Ana Torres', treatment: 'Ortodoncia', appointment_date: '2026-10-01', appointment_time: '10:00',
      ad_referral: { headline: 'Brackets con cuota inicial S/ 0' },
    }, { summary: ['Consultó: "¿cuánto cuestan los brackets?"', 'Distrito: Surco · escribió con la clínica cerrada'] });
    const text = whatsapp.sent[0].text;
    for (const piece of ['Ana Torres', 'Ortodoncia', 'Brackets con cuota inicial S/ 0', 'Consultó', 'Distrito: Surco']) assert.ok(text.includes(piece), piece);
  });

  it('arma el resumen de 2 líneas de la conversación sin inventar', async () => {
    const jid = '51977700001@s.whatsapp.net';
    const client = { async generateContent() { return { response: { text: () => '¿A nombre de quién registro la solicitud?' } }; } };
    await gemini.obtenerRespuestaIA(jid, '¿cuánto cuestan los brackets?', { client });
    await gemini.obtenerRespuestaIA(jid, 'Ana Torres, soy de Surco', { client, skipDebounce: true });
    const summary = gemini.conversationSummary(jid);
    assert.equal(summary.length, 2);
    assert.match(summary[0], /brackets/);
    assert.match(summary[1], /Surco/);
    assert.deepEqual(gemini.conversationSummary('51900000000@s.whatsapp.net'), []);
  });

  it('el briefing diario trae la agenda de hoy y llega al dueño y a recepción', async () => {
    process.env.OWNER_ALERT_PHONE = '988777666';
    process.env.RECEPTION_ALERT_PHONE = '977666555';
    const db = fakeDb({
      messages: [],
      appointments: [
        { id: 'h1', clinic_id: clinic.id, sender_phone: '51911111111', patient_name: 'Ana Torres', treatment: 'Limpieza', appointment_date: '2026-09-29', appointment_time: '10:00', status: 'confirmada', created_at: hoursAgo(48) },
        { id: 'h2', clinic_id: clinic.id, sender_phone: '51922222222', patient_name: 'Luis Rojas', treatment: 'Ortodoncia', appointment_date: '2026-09-29', appointment_time: '09:00', status: 'pendiente', created_at: hoursAgo(48) },
      ],
    });
    const whatsapp = fakeWhatsapp();
    const result = await createJobs({ getClient: () => db, whatsapp, now: () => NOW }).runDailySummary();
    assert.match(result.text, /Agenda de hoy/);
    assert.ok(result.text.indexOf('9:00 a. m.') < result.text.indexOf('10:00 a. m.'), 'ordenada por hora');
    assert.match(result.text, /Luis · Ortodoncia/);
    assert.deepEqual(whatsapp.sent.map((m) => m.to).sort(), ['51977666555', '51988777666']);
  });

  it('el cron del briefing corre a las 12:30 UTC (7:30 a. m. de Lima)', () => {
    const daily = CRON_JOBS.find((j) => j.key === 'daily-summary');
    assert.deepEqual([daily.schedule.hours, daily.schedule.minutes], [[12], [30]]);
  });
});
