import { describe, it } from 'node:test';
import assert from 'assert';
import { callGemini, isRetriableGeminiError, obtenerRespuestaIA } from './geminiService.js';
import { createSystemAlerts, isTokenError, TOKEN_STEPS } from './systemAlerts.js';
import systemAlerts from './systemAlerts.js';
import { sendWhatsAppMessage } from './whatsappService.js';

const fast = { maxRetries: 2, backoffMs: [1, 1], timeoutMs: 50 };

function sequenceClient(steps) {
  let calls = 0;
  return {
    get calls() { return calls; },
    async generate() {
      const step = steps[Math.min(calls, steps.length - 1)];
      calls += 1;
      if (step === 'hang') return new Promise(() => {});
      if (step instanceof Error) throw step;
      return { text: step };
    },
  };
}

const httpError = (status, message) => Object.assign(new Error(`[${status}] ${message}`), { status });

describe('Gemini: reintento corto y respaldo', () => {
  it('reintenta si Gemini está saturado (503) y devuelve la respuesta del segundo intento', async () => {
    const client = sequenceClient([httpError(503, 'The model is overloaded'), 'Hola 👋']);
    const result = await callGemini(client, { structured: false, prompt: 'hola' }, fast);
    assert.equal(result.text, 'Hola 👋');
    assert.equal(client.calls, 2);
  });

  it('corta un intento que no responde a tiempo y reintenta', async () => {
    const client = sequenceClient(['hang', 'Respuesta tras timeout']);
    const result = await callGemini(client, { structured: false, prompt: 'hola' }, fast);
    assert.equal(result.text, 'Respuesta tras timeout');
    assert.equal(client.calls, 2);
  });

  it('no reintenta una clave inválida ni la cuota agotada (4xx): pasa directo al respaldo', async () => {
    for (const error of [httpError(400, 'API_KEY_INVALID'), httpError(429, 'RESOURCE_EXHAUSTED quota')]) {
      const client = sequenceClient([error, 'no debería llegar']);
      await assert.rejects(callGemini(client, { structured: false, prompt: 'hola' }, fast));
      assert.equal(client.calls, 1);
    }
  });

  it('se rinde tras los reintentos y el paciente recibe el respaldo (skipResponse), nunca silencio', async () => {
    const client = sequenceClient([httpError(503, 'UNAVAILABLE')]);
    const result = await obtenerRespuestaIA('51999000111@s.whatsapp.net', 'hola', { client, skipDebounce: true, ...fast });
    assert.equal(client.calls, 3);
    assert.equal(result.skipResponse, true);
    assert.equal(result.texto, null);
  });

  it('clasifica errores reintentables', () => {
    assert.equal(isRetriableGeminiError(new Error('fetch failed')), true);
    assert.equal(isRetriableGeminiError({ code: 'ETIMEDOUT', message: 'Gemini timeout' }), true);
    assert.equal(isRetriableGeminiError(httpError(500, 'INTERNAL')), true);
    assert.equal(isRetriableGeminiError(httpError(403, 'PERMISSION_DENIED')), false);
  });
});

describe('Alerta: token de WhatsApp vencido (error 190)', () => {
  it('registra "TOKEN DE WHATSAPP VENCIDO", avisa al panel una vez y se limpia al volver a enviar', () => {
    const published = [];
    const logs = [];
    const alerts = createSystemAlerts({ events: { publish: (type, data) => published.push({ type, data }) }, log: (m) => logs.push(m) });
    alerts.tokenExpired({ code: 190, error_subcode: 463 });
    alerts.tokenExpired({ code: 190 });
    assert.equal(logs.length, 2);
    assert.match(logs[0], /TOKEN DE WHATSAPP VENCIDO \(error 190\/463\)/);
    assert.equal(published.length, 1);
    assert.equal(alerts.active()[0].code, 'whatsapp_token');
    assert.equal(alerts.active()[0].detail, TOKEN_STEPS);
    alerts.whatsappOk();
    assert.deepEqual(alerts.active(), []);
    assert.deepEqual(published[1], { type: 'alert', data: { code: 'whatsapp_token', resolved: true } });
    alerts.whatsappOk();
    assert.equal(published.length, 2);
  });

  it('whatsappService activa la alerta con un 401 code 190 de Meta, sin reintentar ni filtrar el token', async () => {
    assert.equal(isTokenError({ code: 190 }), true);
    assert.equal(isTokenError({ code: 100 }), false);
    const metaBody = JSON.stringify({ error: { message: 'Error validating access token: Session has expired', type: 'OAuthException', code: 190, error_subcode: 463 } });
    let calls = 0;
    const fetchImpl = async () => { calls += 1; return { ok: false, status: 401, text: async () => metaBody, json: async () => JSON.parse(metaBody) }; };
    const original = console.error;
    const logged = [];
    console.error = (...args) => logged.push(args.join(' '));
    try {
      await assert.rejects(sendWhatsAppMessage('51999000111', 'hola', { fetchImpl, maxRetries: 2 }), (err) => err.status === 401 && err.meta.code === 190);
    } finally {
      console.error = original;
    }
    assert.equal(calls, 1);
    assert.equal(systemAlerts.active().some((a) => a.code === 'whatsapp_token'), true);
    assert.ok(logged.some((l) => l.includes('TOKEN DE WHATSAPP VENCIDO')));
    assert.ok(!logged.some((l) => process.env.WHATSAPP_TOKEN && l.includes(process.env.WHATSAPP_TOKEN)));

    const okFetch = async () => ({ ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.ok' }] }) });
    await sendWhatsAppMessage('51999000111', 'hola', { fetchImpl: okFetch });
    assert.equal(systemAlerts.active().length, 0);
  });
});
