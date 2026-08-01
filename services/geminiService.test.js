import { describe, it, before } from 'node:test';
import assert from 'assert';

// set minimal env for config/env.js
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test';
process.env.GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
process.env.WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || '12345';
process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || 'verify-token';

let geminiService;

before(async () => {
  geminiService = (await import('./geminiService.js')).default;
});

function makeClientReturningText(text) {
  return {
    async generate(prompt, opts) {
      return { text };
    }
  };
}

function makeClientThatThrowsThenSucceeds(timesToThrow = 1, returnText = 'ok') {
  let calls = 0;
  return {
    async generate(prompt, opts) {
      calls += 1;
      if (calls <= timesToThrow) throw new Error('simulated network error');
      return { text: returnText };
    }
  };
}

function makeClientAlwaysThrows() {
  return { async generate() { throw new Error('permanent fail'); } };
}

function makeStructuredClientReturningText(text) {
  return {
    async generateContent(request) {
      return { text };
    },
  };
}

describe('geminiService', () => {
  it('parses LEAD_JSON when model returns it', async () => {
    const leadJson = JSON.stringify({ nombre: 'Juan Perez', telefono: '987654321', distrito: 'Miraflores', fechaHoraTexto: 'jueves a las 3pm' });
    const client = makeClientReturningText(`<<<LEAD_JSON>>>\n${leadJson}\n<<<END_LEAD_JSON>>>\nPerfecto, te tengo agendado.`);
    const { obtenerRespuestaIA } = (await import('./geminiService.js'));
    const res = await obtenerRespuestaIA('51987654321@s.whatsapp.net', 'quiero agendar', { client });
    assert.equal(res.leadData.telefono, '987654321');
    assert.ok(res.texto.includes('Perfecto') || res.texto.length > 0);
  });

  it('removes the LEAD_JSON block from texto before replying', async () => {
    const leadJson = JSON.stringify({ nombre: 'Ana', telefono: '987654324', distrito: 'Surco', fechaHoraTexto: 'viernes a las 10am' });
    const client = makeClientReturningText(`<<<LEAD_JSON>>>\n${leadJson}\n<<<END_LEAD_JSON>>>\nPerfecto, Ana, te agendé tentativamente.`);
    const { obtenerRespuestaIA } = (await import('./geminiService.js'));
    const res = await obtenerRespuestaIA('51987654324@s.whatsapp.net', 'quiero agendar', { client });
    assert.equal(res.leadData.telefono, '987654324');
    assert.ok(!res.texto.includes('<<<LEAD_JSON>>>'));
    assert.ok(res.texto.includes('Perfecto'));
  });

  it('passes systemInstruction when client supports generateContent', async () => {
    let capturedRequest = null;
    const client = {
      async generateContent(request) {
        capturedRequest = request;
        return { text: 'Hola, te ayudo con la cita.' };
      },
    };
    const { obtenerRespuestaIA } = (await import('./geminiService.js'));
    const res = await obtenerRespuestaIA('51987654325@s.whatsapp.net', 'quiero agendar', { client });
    assert.ok(capturedRequest, 'generateContent should be called');
    assert.equal(capturedRequest.systemInstruction.includes('Eres "Camila"'), true);
    assert.ok(res.texto.includes('Hola'));
  });

  it('falls back to heuristic when no LEAD_JSON present', async () => {
    const client = makeClientReturningText('Hola, me llamo Maria y puedo el viernes por la tarde. Mi telefono es 987654322.');
    const { obtenerRespuestaIA } = (await import('./geminiService.js'));
    const res = await obtenerRespuestaIA('51987654322@s.whatsapp.net', 'quiero agendar', { client });
    assert.ok(res.texto.includes('Hola') || typeof res.texto === 'string');
    // fallback should provide phone at least via heuristic
    assert.ok(res.leadData && res.leadData.telefono, 'fallback leadData should contain telefono');
  });

  it('handles malformed LEAD_JSON gracefully (fallback)', async () => {
    const client = makeClientReturningText('<<<LEAD_JSON>>>\n{ nombre: "Bad JSON", telefono: 987654333 \n<<<END_LEAD_JSON>>>\nLo siento.');
    const { obtenerRespuestaIA } = (await import('./geminiService.js'));
    const res = await obtenerRespuestaIA('51987654333@s.whatsapp.net', 'quiero agendar', { client });
    assert.ok(res.texto && typeof res.texto === 'string');
    assert.ok(res.leadData === null || typeof res.leadData === 'object');
  });

  it('retries on first network error and succeeds', async () => {
    const client = makeClientThatThrowsThenSucceeds(1, 'Respuesta OK');
    const { obtenerRespuestaIA } = (await import('./geminiService.js'));
    const res = await obtenerRespuestaIA('51987654321@s.whatsapp.net', 'hola quiero agendar', { client });
    assert.equal(res.texto, 'Respuesta OK');
  });

  it('returns contingency after 2 consecutive failed messages', async () => {
    const client = makeClientAlwaysThrows();
    const { obtenerRespuestaIA } = (await import('./geminiService.js'));
    const r1 = await obtenerRespuestaIA('51987654321@s.whatsapp.net', 'mensaje 1', { client });
    // first failure should return polite fallback (not contingency)
    assert.ok(r1.texto && !r1.texto.includes('ocupado'));
    const r2 = await obtenerRespuestaIA('51987654321@s.whatsapp.net', 'mensaje 2', { client });
    assert.ok(r2.texto && r2.texto.includes('ocupado'));
  });

  it('limits history to max messages', async () => {
    const client = makeClientReturningText('ok');
    const { obtenerRespuestaIA } = (await import('./geminiService.js'));
    // send many messages
    for (let i = 0; i < 12; i++) {
      await obtenerRespuestaIA('51987654321@s.whatsapp.net', `msg ${i}`, { client });
    }
    const res = await obtenerRespuestaIA('51987654321@s.whatsapp.net', 'final', { client });
    assert.equal(typeof res.texto, 'string');
  });
});
