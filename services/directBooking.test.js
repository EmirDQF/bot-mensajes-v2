import { describe, it, afterEach, before, after } from 'node:test';
import assert from 'assert';

// Fase 3 (agente top): bookingMode, reserva atómica (gana el primero), código de cita y pase de cita en PNG.

process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test';

const {
  default: clinic, BASE_CLINIC, validateClinic, specialistFor, bookingModeOf,
} = await import('../config/clinic.config.js');
const {
  createAppointmentService, appointmentCode, SlotTakenError, OutsideHoursError,
} = await import('./appointmentService.js');
const { appointmentPassSvg, appointmentPassPng, canHavePass } = await import('./cards/appointmentPass.js');
const { confirmedBookingText, passPreviewPath } = await import('../controllers/bookingReplies.js');
const { createMemoryDb } = await import('./demo/memoryDb.js');
const { buildDemoData } = await import('./demo/seed.js');
const { useInMemorySupabase, getSupabase } = await import('./supabaseClient.js');
const { runInTestMode, TEST_PHONE_PREFIX } = await import('./testContext.js');
const { default: webhookController, waitForIdle } = await import('../controllers/webhookController.js');
const { createApp } = await import('../app.js');

// Jueves 5 de noviembre de 2026, 8:00 a. m. en Lima (13:00 UTC): la clínica abre a las 9:00.
const NOW = new Date('2026-11-05T13:00:00Z');
const DATE = '2026-11-06';
const events = { publish() {} };
const silentWhatsapp = { async sendTextMessage() { return {}; } };
const service = (db) => createAppointmentService({ getClient: () => db, now: () => NOW, events, whatsapp: silentWhatsapp });
const request = (overrides = {}) => ({
  senderPhone: '51911000001', patientName: 'Carlos Mendoza', treatment: 'Limpieza dental (profilaxis)',
  appointmentDate: DATE, appointmentTime: '10:00', ...overrides,
});

describe('configuración del agendamiento', () => {
  it('por defecto es "solicitud"; solo acepta los dos modos', () => {
    assert.equal(bookingModeOf({}), 'solicitud');
    assert.equal(bookingModeOf(BASE_CLINIC), 'solicitud');
    assert.equal(bookingModeOf({ bookingMode: 'confirmacion_directa' }), 'confirmacion_directa');
    assert.match(validateClinic({ ...structuredClone(BASE_CLINIC), bookingMode: 'automatico' }).join(), /bookingMode/);
  });

  it('valida especialistas y el prefijo del código', () => {
    const c = structuredClone(BASE_CLINIC);
    assert.match(validateClinic({ ...c, specialists: [{ name: 'Dr. X', treatments: ['no-existe'] }] }).join(), /specialists\[0\]\.treatments/);
    assert.match(validateClinic({ ...c, specialists: [{ name: '' }] }).join(), /specialists\[0\]/);
    assert.match(validateClinic({ ...c, appointmentCodePrefix: 'dv1' }).join(), /appointmentCodePrefix/);
  });

  it('el especialista de la demo está marcado como ficticio y se asigna por tratamiento', () => {
    assert.ok(BASE_CLINIC.specialists.every((s) => s.fictitious === true && /ficticia|ficticio/i.test(s.name)));
    assert.equal(specialistFor('ortodoncia', BASE_CLINIC)?.name, BASE_CLINIC.specialists[0].name);
    assert.equal(specialistFor('extraccion', BASE_CLINIC), null);
    assert.equal(specialistFor('limpieza', { specialists: [{ name: 'Dr. General' }] })?.name, 'Dr. General');
  });

  it('el código es corto: prefijo + 4 dígitos', () => {
    assert.equal(appointmentCode({ appointmentCodePrefix: 'DV' }, () => 472), 'DV-0472');
    assert.match(appointmentCode({ id: 'denvari' }), /^DE-\d{4}$/);
  });
});

describe('reserva atómica (confirmación directa)', () => {
  it('la cita nace confirmada por el bot, con código y especialista', async () => {
    const db = createMemoryDb();
    const apt = await service(db).reserveSlot({ ...request(), specialist: 'Dra. Prueba' });
    assert.equal(apt.status, 'confirmada');
    assert.equal(apt.confirmed_by, 'bot');
    assert.match(apt.code, /^DV-\d{4}$/);
    assert.equal(apt.specialist, 'Dra. Prueba');
    assert.ok(apt.confirmed_at);
  });

  it('dos pacientes al mismo tiempo por el mismo horario: gana el primero, el otro recibe SlotTakenError', async () => {
    const db = createMemoryDb();
    const appointments = service(db);
    const results = await Promise.allSettled([
      appointments.reserveSlot(request({ senderPhone: '51911000001' })),
      appointments.reserveSlot(request({ senderPhone: '51911000002' })),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    const rejected = results.find((r) => r.status === 'rejected');
    assert.ok(rejected.reason instanceof SlotTakenError);
    assert.equal(results[0].status, 'fulfilled', 'gana el primero');
    assert.equal(db.data.appointments.length, 1);
  });

  it('también choca si se solapa por duración aunque empiece a otra hora', async () => {
    const db = createMemoryDb();
    const appointments = service(db);
    await Promise.allSettled([
      appointments.reserveSlot(request({ treatment: 'Ortodoncia (brackets metálicos y estéticos)', appointmentTime: '10:00' })),
      appointments.reserveSlot(request({ senderPhone: '51911000002', appointmentTime: '10:30' })),
    ]);
    assert.equal(db.data.appointments.length, 1);
  });

  it('rechaza horarios fuera de atención', async () => {
    await assert.rejects(service(createMemoryDb()).reserveSlot(request({ appointmentTime: '23:00' })), OutsideHoursError);
  });

  it('usa la función reserve_appointment de Postgres cuando existe y traduce SLOT_TAKEN', async () => {
    const calls = [];
    const row = { id: 'a1', status: 'confirmada', code: 'DV-0001', sender_phone: '51911000001' };
    const rpcDb = { rpc: async (name, args) => { calls.push([name, args]); return { data: row, error: null }; }, from() { throw new Error('no debía usar insert'); } };
    assert.deepEqual(await service(rpcDb).reserveSlot(request()), row);
    assert.equal(calls[0][0], 'reserve_appointment');
    assert.equal(calls[0][1].p_date, DATE);
    assert.equal(calls[0][1].p_time, '10:00');
    assert.match(calls[0][1].p_code, /^DV-\d{4}$/);

    const busy = { rpc: async () => ({ data: null, error: { code: 'P0001', message: 'SLOT_TAKEN' } }) };
    await assert.rejects(service(busy).reserveSlot(request()), SlotTakenError);
  });

  it('si falta la función (migración pendiente) usa el candado del proceso y no la vuelve a pedir', async () => {
    const db = createMemoryDb();
    let rpcCalls = 0;
    db.rpc = async () => { rpcCalls += 1; return { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.reserve_appointment' } }; };
    const appointments = service(db);
    const first = await appointments.reserveSlot(request());
    await appointments.reserveSlot(request({ senderPhone: '51911000002', appointmentTime: '15:00' }));
    assert.equal(first.status, 'confirmada');
    assert.equal(rpcCalls, 1);
  });

  it('si falta la columna "code", la cita se guarda como solicitud (recepción confirma)', async () => {
    const db = createMemoryDb();
    const from = db.from.bind(db);
    db.from = (table) => {
      const builder = from(table);
      if (table !== 'appointments') return builder;
      const insert = builder.insert.bind(builder);
      builder.insert = (rows) => ([].concat(rows)[0].code
        ? { select: () => ({ single: async () => ({ data: null, error: { code: 'PGRST204', message: "Could not find the 'code' column" } }) }) }
        : insert(rows));
      return builder;
    };
    const apt = await service(db).reserveSlot(request());
    assert.equal(apt.status, 'pendiente');
    assert.equal(apt.code, undefined);
    assert.equal(canHavePass(apt), false);
  });
});

describe('pase de cita', () => {
  const APT = {
    id: 'abc-123', code: 'DV-0472', status: 'confirmada', patient_name: 'Carlos <Mendoza>', sender_phone: '51987654321',
    treatment: 'Limpieza dental (profilaxis)', appointment_date: '2026-11-06', appointment_time: '16:30', specialist: 'Dra. Prueba',
  };

  it('solo existe para citas confirmadas con código', () => {
    assert.equal(appointmentPassSvg({ ...APT, status: 'pendiente' }), null);
    assert.equal(appointmentPassSvg({ ...APT, code: null }), null);
    assert.ok(appointmentPassSvg(APT));
  });

  it('muestra los datos de la cita escapados y NO incluye el teléfono', () => {
    const svg = appointmentPassSvg(APT);
    for (const text of ['PASE DE CITA', 'CONFIRMADA', 'DV-0472', 'Carlos &lt;Mendoza&gt;', 'Dra. Prueba', 'Viernes, 6 de noviembre']) assert.ok(svg.includes(text), text);
    assert.ok(!svg.includes('987654321'));
    assert.ok(!svg.includes('51987654321'));
  });

  it('el QR depende solo del código: mismo código, mismo QR aunque cambien los datos del paciente', () => {
    const qr = (svg) => svg.match(/<path d="(M[^"]+)" fill="#0b1f26"\/>/)[1];
    const a = qr(appointmentPassSvg(APT));
    const b = qr(appointmentPassSvg({ ...APT, patient_name: 'Otra Persona', sender_phone: '51900000000', specialist: null }));
    const c = qr(appointmentPassSvg({ ...APT, code: 'DV-9999' }));
    assert.equal(a.length > 100, true);
    assert.notEqual(a, c);
    // Con otro nombre cambia la altura de la tarjeta (filas), no los módulos: se comparan las celdas relativas.
    const cells = (d) => d.match(/h[\d.]+v[\d.]+/g).length;
    assert.equal(cells(a), cells(b));
  });

  it('se genera como PNG', () => {
    const png = appointmentPassPng(APT);
    assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  });

  it('el texto de confirmación dice "confirmada", con código, especialista y dirección; nunca "solicitud"', () => {
    const text = confirmedBookingText(APT);
    assert.match(text, /confirmada/);
    assert.match(text, /DV-0472/);
    assert.match(text, /Dra\. Prueba/);
    assert.ok(text.includes(clinic.address));
    assert.doesNotMatch(text, /solicitud/i);
    assert.equal(passPreviewPath(APT), '/api/panel/appointments/abc-123/pass.png');
  });
});

describe('webhook: modo solicitud vs confirmación directa', () => {
  const realFetch = globalThis.fetch;
  const savedMode = clinic.bookingMode;
  const savedReception = process.env.RECEPTION_ALERT_PHONE;
  afterEach(() => {
    globalThis.fetch = realFetch;
    useInMemorySupabase(null);
    clinic.bookingMode = savedMode;
    if (savedReception === undefined) delete process.env.RECEPTION_ALERT_PHONE; else process.env.RECEPTION_ALERT_PHONE = savedReception;
  });
  const envelope = (phone, message) => ({ entry: [{ changes: [{ value: { contacts: [{ profile: { name: 'Carlos Mendoza' } }], messages: [{ id: `wamid.db.${Math.random().toString(36).slice(2)}`, from: phone, timestamp: String(Math.floor(Date.now() / 1000)), ...message }] } }] }] });
  async function deliver(phone, message, sent) {
    await runInTestMode({ onSend: (to, payload) => sent.push({ to, ...payload }) }, async () => {
      await webhookController({ body: envelope(phone, message) }, { status() { return this; }, send() { return this; } });
      await waitForIdle(phone);
    });
  }
  const tap = (title) => ({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'slot:x', title } } });
  const typed = (body) => ({ type: 'text', text: { body } });
  async function offer(phone, sent) {
    await deliver(phone, typed('hola'), sent);
    sent.length = 0;
    await deliver(phone, typed('quiero una cita para limpieza'), sent);
    return sent.find((m) => m.to === phone && m.buttons?.length);
  }
  const stubGemini = () => {
    globalThis.fetch = async (url, options) => (String(url).includes('generativelanguage.googleapis.com')
      ? new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: 'Perfecto, elige tu horario.' }] }, finishReason: 'STOP' }] }), { status: 200 })
      : realFetch(url, options));
  };

  it('en "solicitud" el texto dice solicitud y no se envía pase de cita', async () => {
    useInMemorySupabase(createMemoryDb());
    stubGemini();
    clinic.bookingMode = 'solicitud';
    const phone = `${TEST_PHONE_PREFIX}8301`;
    const sent = [];
    const offered = await offer(phone, sent);
    sent.length = 0;
    await deliver(phone, tap(offered.buttons[0]), sent);
    const toPatient = sent.filter((m) => m.to === phone);
    assert.ok(toPatient.some((m) => /solicitud/i.test(m.text || '') && /Recepción te la confirmará/.test(m.text || '')));
    assert.equal(toPatient.some((m) => /pass\.png/.test(m.media || '')), false);
    assert.equal((await getSupabase()).data.appointments[0].status, 'pendiente');
  });

  it('en "confirmacion_directa" reserva, envía el pase (sin URL pública) y avisa a recepción que ya está confirmada', async () => {
    useInMemorySupabase(createMemoryDb());
    stubGemini();
    clinic.bookingMode = 'confirmacion_directa';
    process.env.RECEPTION_ALERT_PHONE = '51911122255';
    const phone = `${TEST_PHONE_PREFIX}8302`;
    const sent = [];
    const offered = await offer(phone, sent);
    sent.length = 0;
    await deliver(phone, tap(offered.buttons[0]), sent);
    const [apt] = (await getSupabase()).data.appointments;
    assert.equal(apt.status, 'confirmada');
    assert.match(apt.code, /^DV-\d{4}$/);
    const toPatient = sent.filter((m) => m.to === phone);
    const passIndex = toPatient.findIndex((m) => m.media === `/api/panel/appointments/${apt.id}/pass.png`);
    const textIndex = toPatient.findIndex((m) => /quedó \*confirmada\*/.test(m.text || ''));
    assert.ok(passIndex >= 0, 'debía enviar el pase');
    assert.ok(textIndex > passIndex, 'primero el pase, luego el texto');
    assert.ok(toPatient[textIndex].text.includes(apt.code));
    assert.ok(sent.some((m) => m.to === '51911122255' && /CONFIRMADA por el asistente/.test(m.text || '')));
  });

  it('con Gemini caído, elegir un horario ofrecido igual registra la cita (no necesita IA)', async () => {
    useInMemorySupabase(createMemoryDb());
    globalThis.fetch = async (url, options) => (String(url).includes('generativelanguage.googleapis.com')
      ? new Response('{"error":{"code":503}}', { status: 503 })
      : realFetch(url, options));
    clinic.bookingMode = 'confirmacion_directa';
    const phone = `${TEST_PHONE_PREFIX}8305`;
    const sent = [];
    const offered = await offer(phone, sent);
    assert.ok(offered, 'sin IA también ofrece horarios en botones');
    sent.length = 0;
    await deliver(phone, typed('la 2'), sent);
    const [apt] = (await getSupabase()).data.appointments;
    assert.equal(apt?.status, 'confirmada');
    assert.ok(sent.some((m) => m.to === phone && /quedó \*confirmada\*/.test(m.text || '')));
  });

  it('si otro paciente tomó el horario, al segundo se le ofrecen horarios nuevos en botones', async () => {
    useInMemorySupabase(createMemoryDb());
    stubGemini();
    clinic.bookingMode = 'confirmacion_directa';
    const first = `${TEST_PHONE_PREFIX}8303`;
    const second = `${TEST_PHONE_PREFIX}8304`;
    const sent = [];
    const offerFirst = await offer(first, sent);
    const offerSecond = await offer(second, sent);
    assert.equal(offerSecond.buttons[0], offerFirst.buttons[0]);
    await deliver(first, tap(offerFirst.buttons[0]), sent);
    sent.length = 0;
    await deliver(second, tap(offerSecond.buttons[0]), sent);
    const reply = sent.find((m) => m.to === second && /se acaba de ocupar/.test(m.text || ''));
    assert.ok(reply, 'debía avisar que se ocupó');
    assert.ok(reply.buttons?.length >= 1);
    assert.equal(reply.buttons.includes(offerFirst.buttons[0]), false);
    const rows = (await getSupabase()).data.appointments;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].sender_phone, first);
  });
});

describe('demo y panel', () => {
  it('la demo activa la confirmación directa desde la configuración (el archivo sigue en "solicitud")', () => {
    const data = buildDemoData(BASE_CLINIC, NOW);
    assert.deepEqual(data.clinic_settings[0].data, { bookingMode: 'confirmacion_directa' });
    assert.equal(BASE_CLINIC.bookingMode, 'solicitud');
  });

  describe('GET /api/panel/appointments/:id/pass.png', () => {
    let server;
    let base;
    const saved = { user: process.env.PANEL_OWNER_USER, pass: process.env.PANEL_OWNER_PASSWORD };
    before(async () => {
      process.env.PANEL_OWNER_USER = 'dueno';
      process.env.PANEL_OWNER_PASSWORD = 'clave-de-prueba-123';
      useInMemorySupabase(createMemoryDb({ appointments: [
        { id: 'ok-1', clinic_id: clinic.id, code: 'DV-1234', status: 'confirmada', patient_name: 'Ana', appointment_date: DATE, appointment_time: '10:00', sender_phone: '51911' },
        { id: 'req-1', clinic_id: clinic.id, status: 'pendiente', patient_name: 'Ana', appointment_date: DATE, appointment_time: '11:00', sender_phone: '51911' },
      ] }));
      const app = createApp({ getSupabase });
      server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
      base = `http://127.0.0.1:${server.address().port}`;
    });
    after(() => {
      server.close();
      useInMemorySupabase(null);
      if (saved.user === undefined) delete process.env.PANEL_OWNER_USER; else process.env.PANEL_OWNER_USER = saved.user;
      if (saved.pass === undefined) delete process.env.PANEL_OWNER_PASSWORD; else process.env.PANEL_OWNER_PASSWORD = saved.pass;
    });
    const auth = { Authorization: `Basic ${Buffer.from('dueno:clave-de-prueba-123').toString('base64')}` };

    it('pide sesión del panel', async () => {
      assert.ok((await fetch(`${base}/api/panel/appointments/ok-1/pass.png`)).status >= 401);
    });

    it('devuelve el PNG de una cita confirmada y 404 para una solicitud', async () => {
      const ok = await fetch(`${base}/api/panel/appointments/ok-1/pass.png`, { headers: auth });
      assert.equal(ok.status, 200);
      assert.equal(ok.headers.get('content-type'), 'image/png');
      assert.match(ok.headers.get('cache-control'), /no-store/);
      assert.equal((await fetch(`${base}/api/panel/appointments/req-1/pass.png`, { headers: auth })).status, 404);
    });
  });
});
