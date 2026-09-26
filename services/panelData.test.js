import { describe, it } from 'node:test';
import assert from 'assert';

process.env.NODE_ENV = 'test';

const { createPanelData } = await import('./panelDataService.js');
const { prioritizeWaitingHuman } = await import('../controllers/panelController.js');
const { fakeDb } = await import('./testing/fakeSupabase.js');
const { default: clinic } = await import('../config/clinic.config.js');

// Martes 29/09/2026 08:00 en Lima.
const NOW = new Date('2026-09-29T13:00:00Z');

const appointmentsTable = () => ([
  { id: 'b', clinic_id: 'denvari', sender_phone: '51922222222', patient_name: 'Luis Rojas', treatment: 'Ortodoncia', appointment_date: '2026-09-29', appointment_time: '11:00:00', status: 'confirmada', ad_referral: { headline: 'Brackets S/ 0' }, reminder_24h_sent_at: '2026-09-28T16:00:00Z', created_at: '2026-09-27T12:00:00Z' },
  { id: 'a', clinic_id: 'denvari', sender_phone: '51911111111', patient_name: 'Ana Torres', treatment: 'Limpieza', appointment_date: '2026-09-29', appointment_time: '09:00:00', status: 'pendiente', created_at: '2026-09-28T03:00:00Z' },
  { id: 'c', clinic_id: 'denvari', sender_phone: '51933333333', patient_name: 'Rosa', appointment_date: '2026-09-30', appointment_time: '10:00:00', status: 'pendiente', created_at: '2026-09-28T04:00:00Z' },
  { id: 'd', clinic_id: 'denvari', sender_phone: '51944444444', appointment_date: '2026-09-20', appointment_time: '10:00:00', status: 'no_asistio', ad_referral: { headline: 'Brackets S/ 0' }, created_at: '2026-09-15T12:00:00Z' },
  { id: 'e', clinic_id: 'denvari', sender_phone: '51955555555', appointment_date: '2026-09-21', appointment_time: '10:00:00', status: 'asistio', created_at: '2026-09-16T12:00:00Z' },
  { id: 'z', clinic_id: 'otra-clinica', sender_phone: '51966666666', appointment_date: '2026-09-29', appointment_time: '10:00:00', status: 'pendiente', created_at: '2026-09-28T12:00:00Z' },
]);

describe('panel: agenda de hoy / mañana', () => {
  it('lists today appointments of the active clinic sorted by time', async () => {
    const panel = createPanelData({ getClient: () => fakeDb({ appointments: appointmentsTable() }), now: () => NOW });
    const agenda = await panel.getAgenda('today');
    assert.equal(agenda.date, '2026-09-29');
    assert.deepEqual(agenda.appointments.map((a) => a.id), ['a', 'b']); // sin la otra clínica
    assert.deepEqual(agenda.appointments[1], {
      id: 'b', time: '11:00', timeLabel: '11:00 a. m.', patientName: 'Luis Rojas', phone: '51922222222',
      treatment: 'Ortodoncia', status: 'confirmada', ad: 'Brackets S/ 0', reminderSent: true,
    });
    const tomorrow = await panel.getAgenda('tomorrow');
    assert.deepEqual(tomorrow.appointments.map((a) => a.id), ['c']);
  });
});

describe('panel: botones de estado', () => {
  it('only accepts confirmar / asistió / no asistió / cancelar', async () => {
    const calls = [];
    const appointments = { async updateStatus(id, status) { calls.push([id, status]); return { id, status, sender_phone: '51911111111', patient_name: 'Ana' }; } };
    const panel = createPanelData({ getClient: () => fakeDb(), appointments, now: () => NOW });
    for (const status of ['confirmada', 'asistio', 'no_asistio', 'cancelada']) await panel.setAppointmentStatus('a', status);
    assert.deepEqual(calls.map((c) => c[1]), ['confirmada', 'asistio', 'no_asistio', 'cancelada']);
    await assert.rejects(panel.setAppointmentStatus('a', 'reprogramada'), (e) => e.status === 400);
  });

  it('asks for a review after "asistió" only when the clinic has reviewUrl', async () => {
    const sent = [];
    const jobs = { async sendWithWindow(to, message) { sent.push({ to, message }); return 'text'; } };
    const appointments = { async updateStatus(id, status) { return { id, status, sender_phone: '51911111111', patient_name: 'Ana Torres' }; } };
    const withoutUrl = createPanelData({ getClient: () => fakeDb(), appointments, jobs, now: () => NOW });
    await withoutUrl.setAppointmentStatus('a', 'asistio');
    assert.equal(sent.length, 0);

    const withUrl = createPanelData({ getClient: () => fakeDb(), appointments, jobs, clinic: { ...clinic, reviewUrl: 'https://example.test/review' }, now: () => NOW });
    await withUrl.setAppointmentStatus('a', 'asistio');
    assert.equal(sent[0].to, '51911111111');
    assert.equal(sent[0].message.template.name, 'solicitud_resena');
    assert.deepEqual(sent[0].message.params, ['Ana', clinic.name, 'https://example.test/review']);
  });
});

describe('panel: métricas', () => {
  it('computes leads, appointments, booking rate, no-shows and appointments by ad', async () => {
    const db = fakeDb({
      appointments: appointmentsTable(),
      messages: [
        { phone: '51911111111', role: 'user', created_at: '2026-09-28T03:00:00Z' },
        { phone: '51911111111', role: 'user', created_at: '2026-09-28T03:01:00Z' },
        { phone: '51922222222', role: 'user', created_at: '2026-09-27T12:00:00Z' },
        { phone: '51977777777', role: 'user', created_at: '2026-09-27T12:00:00Z' },
        { phone: '51988888888', role: 'user', created_at: '2026-09-26T12:00:00Z' },
        { phone: '51911111111', role: 'assistant', created_at: '2026-09-28T03:02:00Z' },
      ],
    });
    const panel = createPanelData({ getClient: () => db, now: () => NOW });
    const m = await panel.getMetrics(30);
    assert.equal(m.leads, 4);
    assert.equal(m.appointments, 5); // sin la otra clínica
    assert.equal(m.bookingRate, 50); // 2 de 4 leads agendaron
    assert.equal(m.attended, 1);
    assert.equal(m.noShows, 1);
    assert.equal(m.noShowRate, 50);
    assert.deepEqual(m.byAd, [
      { ad: 'Orgánico / sin anuncio', count: 3 },
      { ad: 'Brackets S/ 0', count: 2 },
    ]);
  });
});

describe('panel: conversaciones que esperan a un humano primero', () => {
  it('flags and sorts conversations with the bot paused', async () => {
    const db = fakeDb({ conversations: [{ conversation_id: '51922222222', status: 'human' }, { conversation_id: '51911111111', status: 'active' }] });
    const list = await prioritizeWaitingHuman(db, [{ phone: '51911111111' }, { phone: '+51 922 222 222' }, { phone: '51933333333' }]);
    assert.deepEqual(list.map((c) => [c.phone, c.waitingHuman]), [
      ['+51 922 222 222', true], ['51911111111', false], ['51933333333', false],
    ]);
  });
});
