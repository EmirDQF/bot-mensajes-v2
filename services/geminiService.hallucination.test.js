import { describe, it, before } from 'node:test';
import assert from 'assert';

process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test';
process.env.GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
process.env.WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || '12345';
process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || 'verify-token';

let geminiServiceModule;

before(async () => {
  geminiServiceModule = await import('./geminiService.js');
});

describe('regression: model hallucination should not assert bookings', () => {
  it('strips booking claims when no confirmed date exists', async () => {
    const client = {
      async generate(prompt, opts) {
        return { text: 'Perfecto. Tu cita ya quedó agendada para este lunes a las 3:00 PM. Gracias.' };
      }
    };

    const { obtenerRespuestaIA } = await import('./geminiService.js');
    const jid = `51990001111@s.whatsapp.net`;
    const res = await obtenerRespuestaIA(jid, '¿Cuánto cuesta el tratamiento?', { client });
    const reply = (res.texto || res.text || '').toLowerCase();
    assert.equal(/qued(o|ó) agend/i.test(reply), false, 'Reply must not claim a confirmed booking');
    assert.match(reply, /nombre completo:/i);
    assert.match(reply, /tratamiento de interés:/i);
    assert.match(reply, /día y turno de preferencia/i);
  });
});
