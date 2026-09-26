import { describe, it } from 'node:test';
import assert from 'assert';

process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test';
process.env.GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';

const gemini = await import('./geminiService.js');
const { handleAppointmentCommands, formatSlotList } = await import('../controllers/webhookController.js');
const { default: clinic } = await import('../config/clinic.config.js');

const SLOTS = [
  { date: '2026-10-01', time: '09:00', label: 'jueves, 1 de octubre a las 9:00 a. m.' },
  { date: '2026-10-01', time: '11:00', label: 'jueves, 1 de octubre a las 11:00 a. m.' },
  { date: '2026-10-01', time: '13:00', label: 'jueves, 1 de octubre a las 1:00 p. m.' },
];
const jid = (n) => `519111110${String(n).padStart(2, '0')}@s.whatsapp.net`;
const textClient = (text) => ({ async generate() { return { text }; } });

describe('booking flow in geminiService (Fase B with offered slots)', () => {
  it('picks the offered slot from "1/2/3" or ordinals', () => {
    assert.equal(gemini.pickOfferedSlot('2', SLOTS), SLOTS[1]);
    assert.equal(gemini.pickOfferedSlot('opción 3 por favor', SLOTS), SLOTS[2]);
    assert.equal(gemini.pickOfferedSlot('la primera', SLOTS), SLOTS[0]);
    assert.equal(gemini.pickOfferedSlot('Me llamo Ana Torres, la 2', SLOTS), SLOTS[1]);
    assert.equal(gemini.pickOfferedSlot('3, soy Luis', SLOTS), SLOTS[2]);
    assert.equal(gemini.pickOfferedSlot('tengo 25 años', SLOTS), null);
    assert.equal(gemini.pickOfferedSlot('mejor el 2 de octubre', SLOTS), null);
    assert.equal(gemini.pickOfferedSlot('a las 2 pm', SLOTS), null);
    assert.equal(gemini.pickOfferedSlot('la 1:30', SLOTS), null);
    assert.equal(gemini.pickOfferedSlot('2', null), null);
  });

  it('confirms with the exact request wording and returns an appointmentRequest', async () => {
    await gemini.obtenerRespuestaIA(jid(1), 'quiero una cita para limpieza', {
      client: textClient('¡Claro! Elige un horario.'), availableSlots: SLOTS, skipDebounce: true,
    });
    const result = await gemini.obtenerRespuestaIA(jid(1), 'Me llamo Ana Torres, la 2', {
      client: textClient('Perfecto'), skipDebounce: true,
    });
    assert.deepEqual(result.appointmentRequest, {
      nombre: 'Ana Torres', tratamiento: 'Limpieza dental (profilaxis)', fecha: '2026-10-01', hora: '11:00',
    });
    assert.match(result.texto, /^¡Listo, Ana Torres! Tu solicitud de cita para Limpieza dental \(profilaxis\) el jueves, 1 de octubre a las 11:00 a\. m\. quedó registrada en /);
    assert.ok(result.texto.includes(clinic.address));
    assert.ok(result.texto.endsWith('Recepción te la confirmará.'));
    assert.equal(/bloquead|confirmad[ao] tu (?:cita|horario)/i.test(result.texto), false);
    assert.equal(gemini.isSessionBooked(jid(1)), true);
  });

  it('does not confirm with a vague day and no time', async () => {
    const result = await gemini.obtenerRespuestaIA(jid(2), 'Me llamo Luis Rojas, quiero limpieza mañana en la tarde', {
      client: textClient('Te propongo horarios.'), skipDebounce: true,
    });
    assert.equal(result.appointmentRequest, null);
  });

  it('releases the booking when the slot could not be saved', async () => {
    gemini.getOrCreateSession(jid(3)).booked = true;
    gemini.releaseBooking(jid(3));
    assert.equal(gemini.isSessionBooked(jid(3)), false);
  });

  it('adds the offered slots to the prompt context', () => {
    const session = { history: [], offeredSlots: SLOTS, booked: false };
    const prompt = gemini.buildSystemPromptWithContext(jid(4), session);
    assert.ok(prompt.includes('1) jueves, 1 de octubre a las 9:00 a. m.'));
  });
});

function fakeAppointments({ upcoming = null, failWith = null } = {}) {
  const calls = [];
  return {
    calls,
    async findUpcomingByPhone(phone) { calls.push(['findUpcomingByPhone', phone]); if (failWith) throw failWith; return upcoming; },
    async updateStatus(id, status) { calls.push(['updateStatus', id, status]); return { ...upcoming, status }; },
    async findNextSlots(treatment) { calls.push(['findNextSlots', treatment]); return SLOTS; },
    async reschedule(id, change) { calls.push(['reschedule', id, change]); return { ...upcoming, status: 'reprogramada', appointment_date: change.appointmentDate, appointment_time: change.appointmentTime }; },
    async notifyReception(appointment, options) { calls.push(['notifyReception', options?.event]); return { sent: true }; },
  };
}

const UPCOMING = {
  id: 'apt-1', sender_phone: '51911111199', patient_name: 'Ana', treatment: 'Limpieza dental (profilaxis)',
  appointment_date: '2026-10-02', appointment_time: '10:00', duration_min: 30, status: 'pendiente',
};

describe('cancel / reschedule commands (webhookController)', () => {
  it('cancels the next appointment and alerts reception', async () => {
    const appointments = fakeAppointments({ upcoming: UPCOMING });
    const reply = await handleAppointmentCommands('51911111199', 'quiero cancelar mi cita', { appointments, gemini });
    assert.match(reply, /cancelamos tu cita del viernes, 2 de octubre a las 10:00 a\. m\./);
    assert.deepEqual(appointments.calls.filter((c) => c[0] !== 'findUpcomingByPhone'), [['updateStatus', 'apt-1', 'cancelada'], ['notifyReception', 'cancelada']]);
  });

  it('offers 3 new slots, then reschedules with "2"', async () => {
    const appointments = fakeAppointments({ upcoming: UPCOMING });
    const offer = await handleAppointmentCommands('51911111198', 'necesito cambiar mi cita', { appointments, gemini });
    assert.ok(offer.includes('1️⃣ jueves, 1 de octubre a las 9:00 a. m.'));
    assert.ok(offer.includes('Responde 1, 2 o 3'));
    const done = await handleAppointmentCommands('51911111198', '2', { appointments, gemini });
    assert.match(done, /quedó registrada para el jueves, 1 de octubre a las 11:00 a\. m\./);
    assert.deepEqual(appointments.calls.find((c) => c[0] === 'reschedule'), ['reschedule', 'apt-1', { appointmentDate: '2026-10-01', appointmentTime: '11:00', durationMin: 30 }]);
    assert.ok(appointments.calls.some((c) => c[0] === 'notifyReception' && c[1] === 'reprogramada'));
  });

  it('lets Gemini answer when there is no appointment or no command', async () => {
    const appointments = fakeAppointments({ upcoming: null });
    assert.equal(await handleAppointmentCommands('51911111197', 'cancelar cita', { appointments, gemini }), null);
    assert.equal(await handleAppointmentCommands('51911111197', 'cuánto cuesta la limpieza', { appointments, gemini }), null);
  });

  it('logs and falls back to Gemini when Supabase fails', async () => {
    const appointments = fakeAppointments({ failWith: new Error('supabase down') });
    const errors = [];
    const original = console.error;
    console.error = (...args) => errors.push(args.join(' '));
    try {
      assert.equal(await handleAppointmentCommands('51911111196', 'cancelar mi cita', { appointments, gemini }), null);
    } finally {
      console.error = original;
    }
    assert.ok(errors.some((e) => e.includes('[Appointments]') && e.includes('supabase down')));
  });

  it('formats the slot list with numbered options', () => {
    assert.equal(formatSlotList([]), '');
    assert.ok(formatSlotList(SLOTS).startsWith('\n\n📅 Horarios disponibles:\n1️⃣ '));
  });
});
