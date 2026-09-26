import { describe, it, beforeEach } from 'node:test';
import assert from 'assert';

process.env.NODE_ENV = 'test';

const {
  createAppointmentService, SlotTakenError, formatTimeEs, slotLabel, toInstant, localParts,
} = await import('./appointmentService.js');

// Supabase falso en memoria: soporta los encadenamientos que usa appointmentService.
function fakeSupabase({ failWith = null, uniqueViolation = false } = {}) {
  const rows = [];
  let seq = 0;
  const client = {
    rows,
    from(table) {
      assert.equal(table, 'appointments');
      const state = { filters: [], op: 'select', payload: null };
      const run = () => {
        if (failWith) return { data: null, error: failWith };
        if (state.op === 'insert') {
          if (uniqueViolation) return { data: null, error: { code: '23505', message: 'duplicate key' } };
          const row = { id: `apt-${++seq}`, created_at: new Date().toISOString(), ...state.payload[0] };
          rows.push(row);
          return { data: [row], error: null };
        }
        const match = rows.filter((r) => state.filters.every((f) => f(r)));
        if (state.op === 'update') {
          match.forEach((r) => Object.assign(r, state.payload));
          return { data: match, error: null };
        }
        return { data: match, error: null };
      };
      const builder = {
        select() { return builder; },
        insert(payload) { state.op = 'insert'; state.payload = payload; return builder; },
        update(payload) { state.op = 'update'; state.payload = payload; return builder; },
        eq(col, val) { state.filters.push((r) => r[col] === val); return builder; },
        in(col, vals) { state.filters.push((r) => vals.includes(r[col])); return builder; },
        gte(col, val) { state.filters.push((r) => r[col] >= val); return builder; },
        order() { return builder; },
        limit() { return builder; },
        async single() { const { data, error } = run(); return { data: data?.[0] ?? null, error }; },
        async maybeSingle() { const { data, error } = run(); return { data: data?.[0] ?? null, error }; },
        then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject); },
      };
      return builder;
    },
  };
  return client;
}

// Martes 29/09/2026 08:00 en Lima (13:00 UTC).
const NOW = new Date('2026-09-29T13:00:00Z');

function makeService(client, whatsapp = { sent: [], async sendTextMessage(to, text) { this.sent.push({ to, text }); } }) {
  const service = createAppointmentService({ getClient: () => client, now: () => NOW, whatsapp });
  return { service, whatsapp };
}

describe('appointmentService helpers', () => {
  it('formats times and dates in Spanish and converts local time to an instant', () => {
    assert.equal(formatTimeEs('09:00'), '9:00 a. m.');
    assert.equal(formatTimeEs('15:30'), '3:30 p. m.');
    // es-PE escribe "setiembre" (uso peruano).
    assert.match(slotLabel({ date: '2026-09-29', time: '10:00' }), /^martes,? 29 de se(p)?tiembre a las 10:00 a. m.$/);
    assert.equal(toInstant('2026-09-29', '10:00', 'America/Lima').toISOString(), '2026-09-29T15:00:00.000Z');
    assert.equal(localParts('America/Lima', NOW).date, '2026-09-29');
  });
});

describe('appointmentService.getAvailableSlots / findNextSlots', () => {
  let client;
  beforeEach(() => { client = fakeSupabase(); });

  it('uses working hours, treatment duration, lead time and existing appointments', async () => {
    const { service } = makeService(client);
    client.rows.push({ id: 'x', clinic_id: 'denvari', appointment_date: '2026-09-29', appointment_time: '10:00', duration_min: 60, status: 'pendiente' });
    const slots = await service.getAvailableSlots('2026-09-29', 'ortodoncia');
    assert.equal(slots[0], '09:00'); // 08:00 + 60 min de anticipación
    assert.equal(slots.includes('09:30'), false); // chocaría con la cita de 10:00
    assert.equal(slots.includes('10:30'), false);
    assert.equal(slots.includes('11:00'), true);
    assert.equal(slots.at(-1), '19:00'); // 60 min deben caber antes de las 20:00
  });

  it('returns no slots on closed days or past dates', async () => {
    const { service } = makeService(client);
    assert.deepEqual(await service.getAvailableSlots('2026-10-04', 'limpieza'), []); // domingo
    assert.deepEqual(await service.getAvailableSlots('2026-09-28', 'limpieza'), []); // ayer
    assert.equal((await service.getAvailableSlots('2026-10-03', 'limpieza')).at(-1), '13:30'); // sábado hasta 14:00
  });

  it('offers 3 concrete, spaced options', async () => {
    const { service } = makeService(client);
    const options = await service.findNextSlots('limpieza');
    assert.equal(options.length, 3);
    assert.deepEqual(options.map((o) => o.time), ['09:00', '11:00', '13:00']);
    assert.match(options[0].label, /29 de se(p)?tiembre/);
  });
});

describe('appointmentService.saveAppointment', () => {
  it('saves a correct appointment and returns the record', async () => {
    const client = fakeSupabase();
    const { service } = makeService(client);
    const saved = await service.saveAppointment({
      senderPhone: '+51 912 345 678', patientName: 'Ana Pérez', treatment: 'Limpieza dental (profilaxis)',
      appointmentDate: '2026-09-30', appointmentTime: '10:00', adReferral: { headline: 'Campaña 3D' },
    });
    assert.equal(saved.status, 'pendiente');
    assert.equal(saved.clinic_id, 'denvari');
    assert.equal(saved.sender_phone, '51912345678');
    assert.equal(saved.duration_min, 30);
    assert.deepEqual(saved.ad_referral, { headline: 'Campaña 3D' });
    assert.equal(client.rows.length, 1);
  });

  it('rejects a slot that overlaps an existing appointment', async () => {
    const client = fakeSupabase();
    const { service } = makeService(client);
    await service.saveAppointment({ senderPhone: '51911111111', treatment: 'ortodoncia', appointmentDate: '2026-09-30', appointmentTime: '10:00' });
    await assert.rejects(
      service.saveAppointment({ senderPhone: '51922222222', treatment: 'limpieza', appointmentDate: '2026-09-30', appointmentTime: '10:30' }),
      (error) => error instanceof SlotTakenError && error.code === 'SLOT_TAKEN',
    );
  });

  it('maps a database unique violation (race condition) to SlotTakenError', async () => {
    const { service } = makeService(fakeSupabase({ uniqueViolation: true }));
    await assert.rejects(
      service.saveAppointment({ senderPhone: '51911111111', appointmentDate: '2026-09-30', appointmentTime: '12:00' }),
      SlotTakenError,
    );
  });

  it('propagates Supabase failures so the caller can log them', async () => {
    const { service } = makeService(fakeSupabase({ failWith: { message: 'connection refused' } }));
    await assert.rejects(
      service.saveAppointment({ senderPhone: '51911111111', appointmentDate: '2026-09-30', appointmentTime: '12:00' }),
      (error) => error.message === 'connection refused',
    );
  });

  it('fails clearly when Supabase is not configured', async () => {
    const service = createAppointmentService({ getClient: () => null, now: () => NOW });
    await assert.rejects(service.saveAppointment({ senderPhone: '51911111111', appointmentDate: '2026-09-30', appointmentTime: '12:00' }), /Supabase no configurado/);
  });
});

describe('appointmentService.updateStatus / reschedule / findUpcomingByPhone', () => {
  it('finds the next active appointment and updates its status', async () => {
    const client = fakeSupabase();
    const { service } = makeService(client);
    const saved = await service.saveAppointment({ senderPhone: '51911111111', appointmentDate: '2026-10-01', appointmentTime: '09:00' });
    assert.equal((await service.findUpcomingByPhone('51911111111')).id, saved.id);
    const cancelled = await service.updateStatus(saved.id, 'cancelada');
    assert.equal(cancelled.status, 'cancelada');
    assert.equal(await service.findUpcomingByPhone('51911111111'), null);
    await assert.rejects(service.updateStatus(saved.id, 'borrada'), /Estado inválido/);
  });

  it('reschedules to a free slot and refuses a taken one', async () => {
    const client = fakeSupabase();
    const { service } = makeService(client);
    const a = await service.saveAppointment({ senderPhone: '51911111111', appointmentDate: '2026-10-01', appointmentTime: '09:00' });
    await service.saveAppointment({ senderPhone: '51922222222', appointmentDate: '2026-10-01', appointmentTime: '11:00' });
    const moved = await service.reschedule(a.id, { appointmentDate: '2026-10-01', appointmentTime: '15:00' });
    assert.equal(moved.status, 'reprogramada');
    assert.equal(moved.appointment_time, '15:00');
    await assert.rejects(service.reschedule(a.id, { appointmentDate: '2026-10-01', appointmentTime: '11:00' }), SlotTakenError);
  });
});

describe('appointmentService.notifyReception', () => {
  const appointment = {
    sender_phone: '51911111111', patient_name: 'Ana Pérez', treatment: 'Limpieza dental',
    appointment_date: '2026-09-30', appointment_time: '10:00', ad_referral: { headline: 'Campaña 3D' },
  };

  it('sends a WhatsApp to RECEPTION_ALERT_PHONE with the lead data', async () => {
    process.env.RECEPTION_ALERT_PHONE = '999888777';
    const { service, whatsapp } = makeService(fakeSupabase());
    const result = await service.notifyReception(appointment);
    assert.deepEqual(result, { sent: true });
    assert.equal(whatsapp.sent[0].to, '51999888777');
    for (const piece of ['Nueva solicitud de cita', 'Ana Pérez', 'wa.me/51911111111', 'Limpieza dental', '10:00 a. m.', 'Campaña 3D']) {
      assert.ok(whatsapp.sent[0].text.includes(piece), `falta "${piece}"`);
    }
  });

  it('does not throw when the phone is missing or WhatsApp fails', async () => {
    delete process.env.RECEPTION_ALERT_PHONE;
    const { service } = makeService(fakeSupabase());
    assert.deepEqual(await service.notifyReception(appointment), { sent: false, reason: 'missing_phone' });
    process.env.RECEPTION_ALERT_PHONE = '999888777';
    const failing = createAppointmentService({ getClient: () => fakeSupabase(), whatsapp: { async sendTextMessage() { throw new Error('WhatsApp down'); } } });
    assert.deepEqual(await failing.notifyReception(appointment), { sent: false, reason: 'send_failed' });
    delete process.env.RECEPTION_ALERT_PHONE;
  });
});
