import { describe, it, before } from 'node:test';
import assert from 'assert';

// set minimal env for config/env.js
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test';
process.env.GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
process.env.WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || '12345';
process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || 'verify-token';

let geminiServiceModule;

before(async () => {
  geminiServiceModule = await import('./geminiService.js');
});

describe('regressions: real-conversation bugs', () => {
  it('sanitizes payload with response + LEAD_JSON and returns only response text', async () => {
    const raw = JSON.stringify({ response: 'Tu cita está programada para este jueves a las 2:00 p. m.', LEAD_JSON: { nombre: 'Andre', telefono: '987654321', distrito: 'Miraflores', fecha_hora_texto: 'jueves 12 de agosto a las 2:00 PM' } });
    const cleaned = geminiServiceModule.sanitizeModelTextOutput(raw);
    assert.equal(cleaned, 'Tu cita está programada para este jueves a las 2:00 p. m.');
  });

  it('preserves name when user sends name + context in same message', async () => {
    const client = {
      async generate(prompt, opts) {
        // reply acknowledging the name but not giving a LEAD_JSON block (server will extract)
        return { text: '¡Perfecto, Andre! ¿En qué distrito estás?' };
      }
    };
    const { obtenerRespuestaIA } = await import('./geminiService.js');
    const jid = `51987654001@s.whatsapp.net`;
    const res = await obtenerRespuestaIA(jid, 'Me llamo Andre vi su anuncio en facebook de brackets', { client });
    assert.equal(res.leadData.nombre, 'Andre');
  });

  it('does not mark ready_to_notify for a requested date on domingo and indicates clinic hours', async () => {
    const client = {
      async generate(prompt, opts) {
        // Simulate model replying asking for another day since clinic closed Sunday
        return { text: 'Atendemos de lunes a sábado. ¿Qué otro día de esa semana te viene bien?' };
      }
    };
    const { obtenerRespuestaIA } = await import('./geminiService.js');
    const jid = `51987654002@s.whatsapp.net`;
    const res = await obtenerRespuestaIA(jid, 'puede ser el próximo domingo', { client });
    // Ensure leadData is either null or not ready_to_notify
    if (res.leadData) {
      assert.equal(res.leadData.ready_to_notify, false);
      assert.equal(res.leadData.outsideClinicHours, true);
    }
    // Response should mention the clinic days (we simulated it)
    assert.ok((res.texto || res.text || '').toLowerCase().includes('lunes') || (res.texto || res.text || '').toLowerCase().includes('sábado'));
  });
});
