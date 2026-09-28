import crypto from 'crypto';
import activeClinic from '../config/clinic.config.js';
import defaultWebhook, { waitForIdle } from './webhookController.js';
import defaultEvents from '../services/liveEvents.js';
import { getSupabase } from '../services/supabaseClient.js';
import { localParts, toInstant } from '../services/appointmentService.js';
import { runInTestMode, TEST_PHONE_PREFIX, isTestPhone } from '../services/testContext.js';

// 🧪 Probador del panel (solo el dueño): el MISMO flujo del webhook (debounce, Gemini real, agenda,
// bandeja, alertas) con WhatsApp falso y, si se pide, la hora simulada a las 10:30 p. m.
// Lo que el bot "envía" llega al panel como evento en vivo "tester"; lo guardado queda marcado como prueba.

const MAX_TEXT = 1000;
const NIGHT_TIME = '22:30';

export const testerPhone = (session) => `${TEST_PHONE_PREFIX}${String(Number(session) || 1).padStart(4, '0').slice(-4)}`;

// Desfase para que el reloj del bot marque hoy a las 10:30 p. m. (hora de la clínica).
export function nightOffsetMs(clinic = activeClinic, realNow = new Date()) {
  const today = localParts(clinic.timezone, realNow).date;
  return toInstant(today, NIGHT_TIME, clinic.timezone).getTime() - realNow.getTime();
}

// Payload con la forma exacta que manda Meta al webhook.
export function testPayload(phone, text, { now = new Date(), name = 'Paciente de prueba' } = {}) {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { phone_number_id: 'prueba' },
          contacts: [{ profile: { name }, wa_id: phone }],
          messages: [{ id: `wamid.prueba.${crypto.randomUUID()}`, from: phone, timestamp: String(Math.floor(now.getTime() / 1000)), type: 'text', text: { body: text } }],
        },
      }],
    }],
  };
}

const noopRes = { status() { return this; }, send() { return this; }, json() { return this; } };

export function createTesterController({
  handleWebhook = defaultWebhook, idle = waitForIdle, events = defaultEvents, getClient = getSupabase, clinic = activeClinic,
} = {}) {
  function run(phone, text, clock) {
    const clockOffsetMs = clock === 'night' ? nightOffsetMs(clinic) : 0;
    const onSend = (to, payload) => {
      const target = String(to).replace(/\D/g, '');
      events.publish('tester', {
        phone, to: target, toPatient: target === phone,
        text: payload.text || '', media: payload.media || null, template: payload.template || null, id: payload.id,
      });
    };
    return runInTestMode({ clockOffsetMs, onSend }, async () => {
      await handleWebhook({ body: testPayload(phone, text, { now: new Date(Date.now() + clockOffsetMs) }) }, noopRes);
      return idle(phone);
    });
  }

  // POST /api/panel/tester/message { text, session, clock: 'now' | 'night' }
  // Responde al instante; las respuestas llegan en vivo (tras el debounce de 2 s y Gemini).
  async function message(req, res) {
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ error: 'Escribe un mensaje de prueba' });
    if (text.length > MAX_TEXT) return res.status(400).json({ error: `Máximo ${MAX_TEXT} caracteres` });
    const clock = req.body?.clock === 'night' ? 'night' : 'now';
    const phone = testerPhone(req.body?.session);
    run(phone, text, clock)
      .catch((error) => console.error('[Probador] Falló el mensaje de prueba:', error?.message || error))
      .finally(() => events.publish('tester', { phone, done: true }));
    return res.status(202).json({ phone, clock });
  }

  // POST /api/panel/tester/reset — "Borrar pruebas": el mismo borrado del bot ("reset") en cada
  // conversación de prueba, más las citas marcadas como prueba.
  async function reset(req, res) {
    try {
      const client = await getClient();
      const phones = new Set();
      if (client) {
        const { data, error } = await client.from('conversations').select('conversation_id').eq('is_test', true);
        if (error) throw error;
        for (const row of data || []) if (isTestPhone(row.conversation_id)) phones.add(String(row.conversation_id));
      }
      if (req.body?.session) phones.add(testerPhone(req.body.session));
      for (const phone of phones) await run(phone, 'reset', 'now');
      let appointments = 0;
      if (client) {
        const { data, error } = await client.from('appointments').delete().eq('is_test', true).select('id');
        if (error) throw error;
        appointments = (data || []).length;
      }
      events.publish('conversation', { resync: true });
      events.publish('appointment', { resync: true });
      return res.json({ conversations: phones.size, appointments });
    } catch (error) {
      console.error('[Probador] No se pudieron borrar las pruebas:', error?.message || error);
      return res.status(500).json({ error: 'No se pudieron borrar las pruebas' });
    }
  }

  return { message, reset };
}

export default createTesterController();
