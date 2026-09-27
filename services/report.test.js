import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'assert';
import express from 'express';

process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test';

const { createReport, formatDuration, guaranteeLine } = await import('./reportService.js');
const { createJobsRouter } = await import('../routes/jobs.js');
const { createJobs } = await import('./jobsService.js');
const { fakeDb } = await import('./testing/fakeSupabase.js');

// Lunes 28 de setiembre de 2026, 8:00 a. m. en Lima → rango por defecto: 21 al 27 de setiembre.
const MONDAY_8AM = new Date('2026-09-28T13:00:00Z');
const AD = { headline: 'Brackets S/ 0' };

function weekDb({ withMetrics = true } = {}) {
  return fakeDb({
    messages: [
      { phone: '51911111111', role: 'user', created_at: '2026-09-22T03:30:00Z' }, // lun 22:30 → fuera de horario
      { phone: '51911111111', role: 'user', created_at: '2026-09-23T15:00:00Z' },
      { phone: '51922222222', role: 'user', created_at: '2026-09-22T16:00:00Z' }, // mar 11:00 → en horario
      { phone: '51988000111', role: 'user', created_at: '2026-09-22T17:00:00Z' }, // recepción: no cuenta
      { phone: '51933333333', role: 'user', created_at: '2026-09-20T15:00:00Z' }, // fuera del rango
      { phone: '51922222222', role: 'assistant', created_at: '2026-09-22T16:00:02Z' },
    ],
    conversations: withMetrics ? [
      { conversation_id: '51911111111', first_message_at: '2026-09-22T03:30:00Z', first_response_ms: 2000 },
      { conversation_id: '51922222222', first_message_at: '2026-09-22T16:00:00Z', first_response_ms: 4000 },
    ] : [],
    appointments: [
      { id: '1', clinic_id: 'denvari', treatment: 'Ortodoncia (brackets metálicos y estéticos)', status: 'confirmada', created_at: '2026-09-22T03:40:00Z', ad_referral: AD },
      { id: '2', clinic_id: 'denvari', treatment: 'Limpieza dental (profilaxis)', status: 'asistio', after_hours: false, created_at: '2026-09-23T15:00:00Z', ad_referral: AD },
      { id: '3', clinic_id: 'denvari', treatment: 'Implantes dentales', status: 'cancelada', created_at: '2026-09-24T15:00:00Z' },
      { id: '4', clinic_id: 'denvari', treatment: 'Limpieza dental (profilaxis)', status: 'reprogramada', after_hours: true, rescheduled_at: '2026-09-25T15:00:00Z', created_at: '2026-09-25T02:00:00Z' },
      { id: '5', clinic_id: 'denvari', treatment: 'Limpieza dental (profilaxis)', status: 'no_asistio', created_at: '2026-09-26T15:00:00Z' },
      { id: '6', clinic_id: 'denvari', treatment: 'Limpieza dental (profilaxis)', status: 'confirmada', created_at: '2026-09-10T15:00:00Z' },
      { id: '7', clinic_id: 'otra', treatment: 'Limpieza dental (profilaxis)', status: 'confirmada', created_at: '2026-09-22T15:00:00Z' },
    ],
    handoffs: withMetrics ? [
      { clinic_id: 'denvari', reason: 'urgencia', created_at: '2026-09-23T04:00:00Z' },
      { clinic_id: 'denvari', reason: 'humano', created_at: '2026-09-23T05:00:00Z' },
      { clinic_id: 'denvari', reason: 'urgencia', created_at: '2026-09-01T04:00:00Z' },
    ] : [],
  });
}

// Sin tabla handoffs ni columnas de métricas (migración 20260927 pendiente).
function withoutMetrics(db) {
  const missing = new Proxy({}, {
    get: (_, prop) => {
      if (prop === 'then') return undefined;
      if (prop === 'range') return async () => ({ data: null, error: { code: '42P01', message: 'no existe' } });
      return () => missing;
    },
  });
  const from = db.from.bind(db);
  db.from = (table) => (table === 'handoffs' || table === 'conversations' ? missing : from(table));
  return db;
}

describe('reporte semanal: métricas medidas', () => {
  beforeEach(() => { process.env.RECEPTION_ALERT_PHONE = '988000111'; });
  afterEach(() => { delete process.env.RECEPTION_ALERT_PHONE; delete process.env.OWNER_ALERT_PHONE; });

  it('uses the 7 full days before today by default', () => {
    const report = createReport({ getClient: () => weekDb(), now: () => MONDAY_8AM });
    assert.deepEqual(report.resolveRange(), { from: '2026-09-21', to: '2026-09-27' });
    assert.throws(() => report.resolveRange({ from: '2026-09-27', to: '2026-09-01' }), (e) => e.status === 400);
  });

  it('counts conversations, after-hours, appointments, urgencies and potential value', async () => {
    const r = await createReport({ getClient: () => weekDb(), now: () => MONDAY_8AM }).buildReport();
    assert.equal(r.conversations, 2);
    assert.equal(r.conversationsAfterHours, 1);
    assert.equal(r.avgFirstResponseMs, 3000);
    assert.equal(r.requested, 5);
    assert.equal(r.requestedAfterHours, 2, 'la 1 se deduce de la hora (22:40) y la 4 trae after_hours');
    assert.equal(r.confirmed, 2);
    assert.equal(r.attended, 1);
    assert.equal(r.noShows, 1);
    assert.equal(r.rescheduled, 1);
    assert.equal(r.cancelled, 1);
    assert.equal(r.urgencies, 1);
    assert.equal(r.potentialValue, 1800 + 80 + 80 + 80, 'precio "desde" de las citas no canceladas');
    assert.deepEqual(r.byAd[0], { ad: 'Orgánico / sin anuncio', requested: 3, confirmed: 0 });
    assert.deepEqual(r.byAd[1], { ad: 'Brackets S/ 0', requested: 2, confirmed: 2 });
    assert.equal(r.guarantee.line, 'Citas de evaluación confirmadas: 2 / meta 2 → ✅ cumplido');
    assert.equal(r.guarantee.met, true);
  });

  it('still works before the metrics migration', async () => {
    const r = await createReport({ getClient: () => withoutMetrics(weekDb({ withMetrics: false })), now: () => MONDAY_8AM }).buildReport();
    assert.equal(r.requested, 5);
    assert.equal(r.urgencies, null);
    assert.equal(r.avgFirstResponseMs, null);
  });

  it('writes the guarantee line and durations', () => {
    assert.equal(guaranteeLine(1, 2), 'Citas de evaluación confirmadas: 1 / meta 2 → ⏳ pendiente');
    assert.equal(guaranteeLine(3, 2), 'Citas de evaluación confirmadas: 3 / meta 2 → ✅ cumplido');
    assert.equal(formatDuration(2400), '2 s');
    assert.equal(formatDuration(5 * 60e3), '5 min');
    assert.equal(formatDuration(null), 'sin datos');
  });

  it('sends a short WhatsApp report to OWNER_ALERT_PHONE', async () => {
    process.env.OWNER_ALERT_PHONE = '977666555';
    const sent = [];
    const jobs = { async sendWithWindow(to, message) { sent.push({ to, message }); return 'template'; } };
    const out = await createReport({ getClient: () => weekDb(), jobs, now: () => MONDAY_8AM }).runWeeklyReport();
    assert.equal(out.sent, true);
    assert.equal(sent[0].to, '51977666555');
    assert.equal(sent[0].message.template.name, 'reporte_semanal');
    assert.equal(sent[0].message.params.length, 6);
    assert.match(sent[0].message.text, /💬 Conversaciones: 2 \(🌙 1 fuera de horario\)/);
    assert.match(sent[0].message.text, /🎯 Citas de evaluación confirmadas: 2 \/ meta 2 → ✅ cumplido/);
    assert.match(sent[0].message.text, /💰 Valor potencial: S\/ 2[.,]?040/);
    assert.ok(sent[0].message.text.split('\n').length <= 16, 'corto');
  });

  it('does not send without OWNER_ALERT_PHONE', async () => {
    const jobs = { async sendWithWindow() { throw new Error('no debería enviar'); } };
    const out = await createReport({ getClient: () => weekDb(), jobs, now: () => MONDAY_8AM }).runWeeklyReport();
    assert.equal(out.sent, false);
  });
});

describe('reporte semanal: endpoint y resumen diario', () => {
  it('POST /jobs/weekly-report requires CRON_SECRET and passes the range', async () => {
    const saved = process.env.CRON_SECRET;
    process.env.CRON_SECRET = 'secreto-semanal-de-prueba-123456';
    const calls = [];
    const report = { async runWeeklyReport(range) { calls.push(range); return { sent: true, channel: 'text', report: { from: '2026-09-21', to: '2026-09-27', guarantee: { met: true } } }; } };
    const app = express().use('/jobs', createJobsRouter({}, report));
    const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      assert.equal((await fetch(`${base}/jobs/weekly-report`, { method: 'POST' })).status, 401);
      const res = await fetch(`${base}/jobs/weekly-report?from=2026-09-21&to=2026-09-27`, { method: 'POST', headers: { 'x-cron-secret': process.env.CRON_SECRET } });
      assert.equal(res.status, 200);
      assert.equal((await res.json()).result.guarantee.met, true);
      assert.deepEqual(calls[0], { from: '2026-09-21', to: '2026-09-27' });
    } finally {
      server.close();
      if (saved === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = saved;
    }
  });

  it('daily summary adds the appointments requested while the clinic was closed', async () => {
    process.env.OWNER_ALERT_PHONE = '988777666';
    const db = fakeDb({
      messages: [],
      appointments: [
        { id: 'a', clinic_id: 'denvari', sender_phone: '51911111111', created_at: '2026-09-28T03:40:00Z', appointment_date: '2026-09-29', status: 'pendiente' }, // dom 22:40
        { id: 'b', clinic_id: 'denvari', sender_phone: '51922222222', created_at: '2026-09-27T15:00:00Z', appointment_date: '2026-09-29', status: 'pendiente' }, // dom 10:00 (cerrado)
      ],
    });
    const sent = [];
    const whatsapp = { async sendTextMessage(to, text) { sent.push({ to, text }); }, async sendTemplateMessage(to, name, params) { sent.push({ to, name, params }); } };
    const out = await createJobs({ getClient: () => db, whatsapp, now: () => MONDAY_8AM }).runDailySummary();
    assert.equal(out.summary.afterHoursAppointments, 2, 'domingo la clínica está cerrada todo el día');
    assert.match(out.text, /🌙 Citas solicitadas mientras la clínica estaba cerrada: 2/);
    assert.equal(sent[0].params.length, 7);
    delete process.env.OWNER_ALERT_PHONE;
  });
});
