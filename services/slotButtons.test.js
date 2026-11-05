import { describe, it, afterEach } from 'node:test';
import assert from 'assert';

// Fase 2 (agente top): horarios libres reales como botones (hasta 3) o lista, con respaldo en texto.

process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test';

const {
  slotButtonTitle, slotPicker, matchSlotText, sendWithSlotPicker, CHOOSE_PROMPT,
} = await import('./slotButtons.js');
const { sendListMessage } = await import('./whatsappService.js');
const { formatSlotList } = await import('./aiFallback.js');
const gemini = await import('./geminiService.js');
const { createMemoryDb } = await import('./demo/memoryDb.js');
const { useInMemorySupabase, getSupabase } = await import('./supabaseClient.js');
const { runInTestMode, TEST_PHONE_PREFIX } = await import('./testContext.js');
const { default: webhookController, waitForIdle } = await import('../controllers/webhookController.js');

// 2026-11-05 es jueves; 2026-11-07, sábado.
const SLOTS = [
  { date: '2026-11-05', time: '11:00', label: 'jueves, 5 de noviembre a las 11:00 a. m.' },
  { date: '2026-11-05', time: '16:30', label: 'jueves, 5 de noviembre a las 4:30 p. m.' },
  { date: '2026-11-07', time: '10:00', label: 'sábado, 7 de noviembre a las 10:00 a. m.' },
];
const MORE = [...SLOTS, { date: '2026-11-07', time: '15:00', label: 'sábado, 7 de noviembre a las 3:00 p. m.' }];

function fakeWhatsapp({ failInteractive = false } = {}) {
  const calls = [];
  return {
    calls,
    async sendTextMessage(to, text) { calls.push(['text', text]); return { messages: [{ id: 'w.text' }] }; },
    async sendButtonsMessage(to, text, buttons) { calls.push(['buttons', text, buttons]); if (failInteractive) throw new Error('131051 unsupported'); return { messages: [{ id: 'w.btn' }] }; },
    async sendListMessage(to, text, button, rows) { calls.push(['list', text, button, rows]); if (failInteractive) throw new Error('131051'); return { messages: [{ id: 'w.list' }] }; },
  };
}

describe('títulos y tipo de selector', () => {
  it('el título del botón entra en 20 caracteres y dice día, número y hora', () => {
    assert.equal(slotButtonTitle(SLOTS[1]), 'Jue 5 · 4:30 p. m.');
    assert.equal(slotButtonTitle({ date: '2026-11-11', time: '10:30' }), 'Mié 11 · 10:30 a. m.');
    for (const s of MORE) assert.ok(slotButtonTitle(s).length <= 20);
  });

  it('hasta 3 horarios son botones; con más, una lista de máximo 10', () => {
    const buttons = slotPicker(SLOTS);
    assert.equal(buttons.type, 'buttons');
    assert.deepEqual(buttons.buttons.map((b) => b.id), ['slot:2026-11-05T11:00', 'slot:2026-11-05T16:30', 'slot:2026-11-07T10:00']);
    const list = slotPicker(MORE);
    assert.equal(list.type, 'list');
    assert.equal(list.rows.length, 4);
    assert.ok(list.rows[0].description.length <= 72);
    const many = Array.from({ length: 14 }, (_, i) => ({ date: '2026-11-05', time: `${String(8 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`, label: 'x' }));
    assert.equal(slotPicker(many).rows.length, 10);
    assert.equal(slotPicker([]), null);
  });
});

describe('elegir un horario: botón, número o texto', () => {
  it('reconoce el título del botón tocado', () => {
    assert.equal(matchSlotText('Jue 5 · 4:30 p. m.', SLOTS), SLOTS[1]);
    assert.equal(gemini.pickOfferedSlot('Sáb 7 · 10:00 a. m.', SLOTS), SLOTS[2]);
  });

  it('reconoce "jueves 4:30", "el sábado a las 10" y "4:30 pm"', () => {
    assert.equal(matchSlotText('me queda el jueves a las 4:30', SLOTS), SLOTS[1]);
    assert.equal(matchSlotText('Me queda perfecto el Jueves a las 4:30 p. m. Soy Carlos Mendoza', SLOTS), SLOTS[1]);
    assert.equal(matchSlotText('el sábado a las 10', SLOTS), SLOTS[2]);
    assert.equal(matchSlotText('4:30 pm', SLOTS), SLOTS[1]);
    assert.equal(matchSlotText('a las 11 de la mañana', SLOTS), SLOTS[0]);
  });

  it('no adivina: sin hora, con hora que no está o ambigua devuelve null', () => {
    assert.equal(matchSlotText('el jueves', SLOTS), null);
    assert.equal(matchSlotText('tengo 25 años', SLOTS), null);
    assert.equal(matchSlotText('mejor el 2 de octubre', SLOTS), null);
    assert.equal(matchSlotText('a las 6 pm', SLOTS), null);
    const twins = [{ date: '2026-11-05', time: '10:00', label: 'a' }, { date: '2026-11-07', time: '10:00', label: 'b' }];
    assert.equal(matchSlotText('a las 10', twins), null);
    assert.equal(matchSlotText('el sábado a las 10', twins), twins[1]);
  });

  it('con lista se puede responder con el número (hasta 9)', () => {
    assert.equal(gemini.pickOfferedSlot('4', MORE), MORE[3]);
    assert.equal(gemini.pickOfferedSlot('4', SLOTS), null);
  });

  it('el texto siempre trae los horarios escritos y explica cómo elegir', () => {
    const text = formatSlotList(SLOTS);
    assert.match(text, /1️⃣ jueves, 5 de noviembre a las 11:00 a\. m\./);
    assert.match(text, /Toca el horario que prefieras 👇 o responde 1, 2 o 3\./);
    assert.match(formatSlotList(MORE), /responde 1, 2, 3 o 4\./);
  });
});

describe('envío del selector de horarios', () => {
  it('un texto corto con 3 horarios sale en UN mensaje con botones', async () => {
    const whatsapp = fakeWhatsapp();
    await sendWithSlotPicker('51999', `Te propongo:${formatSlotList(SLOTS)}`, SLOTS, { whatsapp });
    assert.equal(whatsapp.calls.length, 1);
    assert.equal(whatsapp.calls[0][0], 'buttons');
    assert.equal(whatsapp.calls[0][2].length, 3);
  });

  it('un texto largo sale primero y los botones después', async () => {
    const whatsapp = fakeWhatsapp();
    await sendWithSlotPicker('51999', 'x'.repeat(1500), SLOTS, { whatsapp });
    assert.deepEqual(whatsapp.calls.map((c) => c[0]), ['text', 'buttons']);
    assert.equal(whatsapp.calls[1][1], CHOOSE_PROMPT);
  });

  it('con más de 3 horarios usa una lista', async () => {
    const whatsapp = fakeWhatsapp();
    await sendWithSlotPicker('51999', 'Elige', MORE, { whatsapp });
    assert.equal(whatsapp.calls[0][0], 'list');
    assert.equal(whatsapp.calls[0][3].length, 4);
  });

  it('si Meta rechaza el mensaje interactivo, se envía el texto (que ya trae los horarios)', async () => {
    const whatsapp = fakeWhatsapp({ failInteractive: true });
    const text = `Te propongo:${formatSlotList(SLOTS)}`;
    const result = await sendWithSlotPicker('51999', text, SLOTS, { whatsapp });
    assert.deepEqual(whatsapp.calls.map((c) => c[0]), ['buttons', 'text']);
    assert.equal(whatsapp.calls[1][1], text);
    assert.equal(result.messages[0].id, 'w.text');
  });

  it('sin horarios es un texto normal', async () => {
    const whatsapp = fakeWhatsapp();
    await sendWithSlotPicker('51999', 'Hola', null, { whatsapp });
    assert.deepEqual(whatsapp.calls.map((c) => c[0]), ['text']);
  });

  it('la lista va a Meta con el formato de la Cloud API y respeta los límites', async () => {
    const bodies = [];
    const fetchImpl = async (url, options) => { bodies.push(JSON.parse(options.body)); return new Response('{"messages":[{"id":"w"}]}', { status: 200 }); };
    await sendListMessage('51999', 'Elige', 'Ver horarios disponibles hoy', [{ id: 'slot:1', title: 'Un título larguísimo de más de 24', description: 'd'.repeat(90) }], { fetchImpl });
    const { interactive } = bodies[0];
    assert.equal(interactive.type, 'list');
    assert.equal(interactive.action.button.length <= 20, true);
    assert.equal(interactive.action.sections[0].rows[0].title.length, 24);
    assert.equal(interactive.action.sections[0].rows[0].description.length, 72);
  });
});

describe('webhook: agendar con 1 toque', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; useInMemorySupabase(null); });
  const envelope = (phone, message) => ({ entry: [{ changes: [{ value: { contacts: [{ profile: { name: 'Ana Torres' } }], messages: [{ id: `wamid.slot.${Math.random().toString(36).slice(2)}`, from: phone, timestamp: String(Math.floor(Date.now() / 1000)), ...message }] } }] }] });
  async function deliver(phone, message, sent) {
    await runInTestMode({ onSend: (to, payload) => sent.push({ to, ...payload }) }, async () => {
      await webhookController({ body: envelope(phone, message) }, { status() { return this; }, send() { return this; } });
      await waitForIdle(phone);
    });
  }

  it('ofrece horarios en botones y, al tocar uno, registra la solicitud de cita', async () => {
    useInMemorySupabase(createMemoryDb());
    globalThis.fetch = async (url, options) => (String(url).includes('generativelanguage.googleapis.com')
      ? new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: '¡Claro! Elige el horario que prefieras.' }] }, finishReason: 'STOP' }] }), { status: 200 })
      : realFetch(url, options));
    const phone = `${TEST_PHONE_PREFIX}8201`;
    const sent = [];
    await deliver(phone, { type: 'text', text: { body: 'hola' } }, sent);
    sent.length = 0;
    await deliver(phone, { type: 'text', text: { body: 'quiero una cita para limpieza' } }, sent);
    const offer = sent.find((m) => m.to === phone && m.buttons?.length);
    assert.ok(offer, 'debía enviar botones');
    assert.equal(offer.buttonsKind, 'buttons');
    assert.ok(offer.buttons.length <= 3);
    assert.match(offer.text, /Horarios disponibles:/, 'el texto trae los horarios escritos');

    const chosen = offer.buttons[1];
    await deliver(phone, { type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'slot:x', title: chosen } } }, sent);
    const appointments = ((await getSupabase()).data.appointments || []).filter((a) => a.sender_phone === phone);
    assert.equal(appointments.length, 1, 'la solicitud de cita debía quedar registrada');
    assert.equal(appointments[0].patient_name, 'Ana Torres');
  });
});
