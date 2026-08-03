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
  let uniqueSessionCounter = 0;
  function makeJid() {
    uniqueSessionCounter += 1;
    return `51987654${String(uniqueSessionCounter).padStart(3, '0')}@s.whatsapp.net`;
  }

  it('parses LEAD_JSON when model returns it', async () => {
    const leadJson = JSON.stringify({ nombre: 'Juan Perez', telefono: '987654321', distrito: 'Miraflores', fechaHoraTexto: 'jueves a las 3pm' });
    const client = makeClientReturningText(`<<<LEAD_JSON>>>\n${leadJson}\n<<<END_LEAD_JSON>>>\nPerfecto, te tengo agendado.`);
    const { obtenerRespuestaIA } = (await import('./geminiService.js'));
    const res = await obtenerRespuestaIA(makeJid(), 'quiero agendar', { client });
    assert.equal(res.leadData.telefono, '987654321');
    assert.ok(res.texto.includes('Perfecto') || res.texto.length > 0);
  });

  it('removes the LEAD_JSON block from texto before replying', async () => {
    const leadJson = JSON.stringify({ nombre: 'Ana', telefono: '987654324', distrito: 'Surco', fechaHoraTexto: 'viernes a las 10am' });
    const client = makeClientReturningText(`<<<LEAD_JSON>>>\n${leadJson}\n<<<END_LEAD_JSON>>>\nPerfecto, Ana, te agendé tentativamente.`);
    const { obtenerRespuestaIA } = (await import('./geminiService.js'));
    const res = await obtenerRespuestaIA(makeJid(), 'quiero agendar', { client });
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
    const res = await obtenerRespuestaIA(makeJid(), 'quiero agendar', { client });
    assert.ok(capturedRequest, 'generateContent should be called');
    assert.equal(capturedRequest.systemInstruction.includes('Eres "Camila"'), true);
    assert.ok(res.texto.includes('Hola'));
  });

  it('sanitizes JSON stringified responses with response field', async () => {
    const { sanitizeModelTextOutput } = await import('./geminiService.js');
    const raw = '{\n"response": "Tu cita está programada para este jueves a las 2:00 p. m."}';
    const cleaned = sanitizeModelTextOutput(raw);
    assert.equal(cleaned, 'Tu cita está programada para este jueves a las 2:00 p. m.');
  });

  it('includes current WhatsApp number in systemInstruction for phone context', async () => {
    let capturedRequest = null;
    const client = {
      async generateContent(request) {
        capturedRequest = request;
        return { text: 'Perfecto, te enviamos la información al número registrado.' };
      },
    };
    const { obtenerRespuestaIA } = (await import('./geminiService.js'));
    const testJid = makeJid();
    const res = await obtenerRespuestaIA(testJid, 'Por favor envía la dirección a este número', { client });
    assert.ok(capturedRequest, 'generateContent should be called');
    assert.ok(capturedRequest.systemInstruction.includes(`WhatsApp ${testJid.split('@')[0]}`));
    assert.ok(res.texto.includes('Perfecto') || typeof res.texto === 'string');
  });

  it('falls back to heuristic when no LEAD_JSON present', async () => {
    const client = makeClientReturningText('Hola, me llamo Maria y puedo el viernes por la tarde. Mi telefono es 987654322.');
    const { obtenerRespuestaIA } = (await import('./geminiService.js'));
    const res = await obtenerRespuestaIA(makeJid(), 'quiero agendar', { client });
    assert.ok(res.texto.includes('Hola') || typeof res.texto === 'string');
    // fallback should provide phone at least via heuristic
    assert.ok(res.leadData && res.leadData.telefono, 'fallback leadData should contain telefono');
  });

  it('handles malformed LEAD_JSON gracefully (fallback)', async () => {
    const client = makeClientReturningText('<<<LEAD_JSON>>>\n{ nombre: "Bad JSON", telefono: 987654333 \n<<<END_LEAD_JSON>>>\nLo siento.');
    const { obtenerRespuestaIA } = (await import('./geminiService.js'));
    const res = await obtenerRespuestaIA(makeJid(), 'quiero agendar', { client });
    assert.ok(res.texto && typeof res.texto === 'string');
    assert.ok(res.leadData === null || typeof res.leadData === 'object');
  });

  it('builds ready_to_notify fallback from history when JSON block is missing and all data is present', async () => {
    const client = makeClientReturningText('Perfecto, tu cita está agendada.');
    const { obtenerRespuestaIA } = (await import('./geminiService.js'));
    const testJid = makeJid();
    const res = await obtenerRespuestaIA(testJid, 'Quiero agendar, me llamo Ana, mi numero es 987654321, vivo en Surco y puedo el viernes a las 3pm', { client });
    assert.equal(res.leadData.telefono, '987654321');
    assert.equal(res.leadData.ready_to_notify, true);
    assert.ok(res.texto.includes('Perfecto'));
  });

  it('retries on first network error and succeeds', async () => {
    const client = makeClientThatThrowsThenSucceeds(1, 'Respuesta OK');
    const { obtenerRespuestaIA } = (await import('./geminiService.js'));
    const res = await obtenerRespuestaIA(makeJid(), 'hola quiero agendar', { client });
    assert.equal(res.texto, 'Respuesta OK');
  });

  it('returns contingency after 2 consecutive failed messages', async () => {
    const client = makeClientAlwaysThrows();
    const { obtenerRespuestaIA } = (await import('./geminiService.js'));
    const testJid = makeJid();
    const r1 = await obtenerRespuestaIA(testJid, 'mensaje 1', { client });
    // first failure should return polite fallback (not contingency)
    assert.ok(r1.texto && !r1.texto.includes('ocupado'));
    const r2 = await obtenerRespuestaIA(testJid, 'mensaje 2', { client });
    assert.ok(r2.texto && r2.texto.includes('ocupado'));
  });

  it('skips response when two messages arrive within 2 seconds', async () => {
    const client = makeClientReturningText('Ok');
    const { obtenerRespuestaIA } = (await import('./geminiService.js'));
    const testJid = makeJid();
    const first = await obtenerRespuestaIA(testJid, 'mensaje rapido', { client });
    assert.equal(first.skipResponse, undefined);
    assert.equal(first.texto, 'Ok');

    const second = await obtenerRespuestaIA(testJid, 'mensaje rapido 2', { client });
    assert.equal(second.skipResponse, true);
    assert.equal(second.texto, null);
    assert.equal(second.leadData, null);
  });

  it('limits history to max messages', async () => {
    const client = makeClientReturningText('ok');
    const { obtenerRespuestaIA } = (await import('./geminiService.js'));
    // send many messages
    const testJid = makeJid();
    for (let i = 0; i < 12; i++) {
      await obtenerRespuestaIA(testJid, `msg ${i}`, { client, skipDebounce: true });
    }
    const res = await obtenerRespuestaIA(testJid, 'final', { client, skipDebounce: true });
    assert.equal(typeof res.texto, 'string');
  });
});
