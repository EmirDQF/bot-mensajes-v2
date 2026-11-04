import { describe, it, afterEach } from 'node:test';
import assert from 'assert';
import { readFileSync, readdirSync } from 'node:fs';

// Fase 1: bugs vistos en los logs de producción (respuestas cortadas, Gemini lento o saturado,
// métrica fuera de rango, "Status update failed: 400", LEAD_ATASCADO y saludo con el nombre del perfil).

process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test';

const { default: config, GEMINI_MIN_OUTPUT_TOKENS, resolveMaxOutputTokens, parseThinkingConfig } = await import('../config/env.js');
const gemini = await import('./geminiService.js');
const { getFinishReason, trimToLastSentence } = await import('./geminiOutput.js');
const { splitForWhatsApp, sendTextMessage, sendTypingIndicator, resetStatusSupport } = await import('./whatsappService.js');
const { createConversationMetrics, MAX_PLAUSIBLE_RESPONSE_MS } = await import('./conversationMetrics.js');
const { quickAnswer } = await import('./quickAnswers.js');
const { extractDistrict, looksLikeRealName, nextMissingField, questionFor } = await import('./leadFields.js');
const { default: clinic } = await import('../config/clinic.config.js');

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const jid = (n) => `5199887${String(n).padStart(4, '0')}@s.whatsapp.net`;
const sdkResult = (text, finishReason = 'STOP') => ({
  response: { text: () => text, candidates: [{ finishReason, content: { parts: [{ text }] } }] },
});

describe('Fase 1.1: respuestas cortadas (tokens y MAX_TOKENS)', () => {
  it('maxOutputTokens sale de un solo lugar y nunca baja de 1024', () => {
    assert.equal(GEMINI_MIN_OUTPUT_TOKENS, 1024);
    assert.ok(config.gemini.maxOutputTokens >= 1024);
    assert.equal(resolveMaxOutputTokens('100'), 1024);
    assert.equal(resolveMaxOutputTokens(undefined), 1024);
    assert.equal(resolveMaxOutputTokens('2048'), 2048);
    assert.equal(resolveMaxOutputTokens('abc'), 1024);
  });

  it('el pedido a Gemini usa el máximo configurado (no 300) y el pensamiento solo si está configurado', async () => {
    let request;
    await gemini.obtenerRespuestaIA(jid(1), 'hola', {
      client: { async generateContent(value) { request = value; return sdkResult('¡Hola! ¿En qué te ayudo?'); } },
    });
    assert.equal(request.generationConfig.maxOutputTokens, config.gemini.maxOutputTokens);
    assert.equal('thinkingConfig' in request.generationConfig, Boolean(config.gemini.thinkingConfig));
  });

  it('lee GEMINI_THINKING_BUDGET / GEMINI_THINKING_LEVEL con validación', () => {
    assert.equal(parseThinkingConfig({}), null);
    assert.deepEqual(parseThinkingConfig({ GEMINI_THINKING_BUDGET: '0' }), { thinkingBudget: 0 });
    assert.deepEqual(parseThinkingConfig({ GEMINI_THINKING_LEVEL: 'minimal' }), { thinkingLevel: 'minimal' });
    assert.equal(parseThinkingConfig({ GEMINI_THINKING_LEVEL: 'turbo' }), null);
    assert.equal(parseThinkingConfig({ GEMINI_THINKING_BUDGET: '-3' }), null);
  });

  it('lee el finishReason de las respuestas del SDK', () => {
    assert.equal(getFinishReason(sdkResult('x', 'MAX_TOKENS')), 'MAX_TOKENS');
    assert.equal(getFinishReason({ text: 'x' }), null);
  });

  it('corta en la última oración completa', () => {
    assert.equal(trimToLastSentence('¡Hola, Diego! ¿Cómo estás? Me alegra'), '¡Hola, Diego! ¿Cómo estás?');
    assert.equal(trimToLastSentence('tenemos una campaña con cu'), '');
    assert.equal(trimToLastSentence('Listo. Te espero 😊'), 'Listo. Te espero 😊');
  });

  it('si Gemini corta por MAX_TOKENS nunca se envía media frase', async () => {
    const result = await gemini.obtenerRespuestaIA(jid(2), '¿tienen promociones?', {
      client: { async generateContent() { return sdkResult('Sí, este mes tenemos evaluación sin costo. Además tenemos una campaña con cu', 'MAX_TOKENS'); } },
    });
    assert.equal(result.texto, 'Sí, este mes tenemos evaluación sin costo.');
  });

  it('si lo cortado no deja ninguna oración completa, va al respaldo (no envía "tenemos una campaña con cu")', async () => {
    const result = await gemini.obtenerRespuestaIA(jid(3), '¿tienen promociones?', {
      client: { async generateContent() { return sdkResult('tenemos una campaña con cu', 'MAX_TOKENS'); } },
      maxRetries: 0,
    });
    assert.equal(result.skipResponse, true);
    assert.equal(result.texto, null);
  });

  it('WhatsApp: un texto de más de 4096 caracteres se divide por párrafos, sin perder nada', () => {
    const paragraph = 'a'.repeat(3000);
    const chunks = splitForWhatsApp(`${paragraph}\n\n${paragraph}\n\nfin`);
    assert.equal(chunks.length, 2);
    assert.ok(chunks.every((c) => c.length <= 4096));
    assert.equal(chunks.join('\n\n'), `${paragraph}\n\n${paragraph}\n\nfin`);
    assert.deepEqual(splitForWhatsApp('corto'), ['corto']);
    const huge = splitForWhatsApp('b'.repeat(9000));
    assert.ok(huge.every((c) => c.length <= 4096));
    assert.equal(huge.join(''), 'b'.repeat(9000));
  });

  it('sendTextMessage envía cada parte por separado y no recorta el texto', async () => {
    const bodies = [];
    const fetchImpl = async (url, options) => {
      bodies.push(JSON.parse(options.body).text.body);
      return new Response(JSON.stringify({ messages: [{ id: `wamid.${bodies.length}` }] }), { status: 200 });
    };
    const text = `${'x'.repeat(4000)}\n\n${'y'.repeat(200)}`;
    const result = await sendTextMessage('51999000111', text, { fetchImpl });
    assert.deepEqual(bodies, ['x'.repeat(4000), 'y'.repeat(200)]);
    assert.equal(result.messages[0].id, 'wamid.1');
  });
});

describe('Fase 1.2: Gemini saturado o lento', () => {
  const httpError = (status, message) => Object.assign(new Error(`[${status}] ${message}`), { status });
  const client = (steps) => {
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
  };

  it('timeout por intento por defecto de 20 s y tope total de 35 s', () => {
    assert.equal(config.gemini.timeoutMs, 20000);
    assert.equal(config.gemini.totalTimeoutMs, 35000);
  });

  it('respeta el tope total: no deja al paciente esperando aunque queden modelos', async () => {
    const models = [client(['hang']), client(['hang']), client(['hang']), client(['ok'])];
    const started = Date.now();
    await assert.rejects(gemini.callGemini(models[0], { structured: false, prompt: 'hola' }, {
      fallbackClients: models.slice(1), timeoutMs: 80, totalTimeoutMs: 150, backoffMs: [1], minAttemptMs: 20,
    }));
    assert.ok(Date.now() - started < 400);
    assert.equal(models[3].calls, 0);
  });

  it('backoff exponencial con jitter entre intentos', () => {
    const noJitter = () => 0;
    assert.equal(gemini.backoffDelay(0, { baseMs: 500, random: noJitter }), 500);
    assert.equal(gemini.backoffDelay(1, { baseMs: 500, random: noJitter }), 1000);
    assert.equal(gemini.backoffDelay(2, { baseMs: 500, random: noJitter }), 2000);
    const jittered = gemini.backoffDelay(1, { baseMs: 500, random: () => 0.5 });
    assert.equal(jittered, 1250);
  });

  it('una cuota agotada (429) en un modelo pasa al siguiente modelo', async () => {
    const primary = client([httpError(429, 'RESOURCE_EXHAUSTED quota')]);
    const backup = client(['Respuesta del respaldo']);
    const result = await gemini.callGemini(primary, { structured: false, prompt: 'hola' }, { fallbackClients: [backup], backoffMs: [1], timeoutMs: 50 });
    assert.equal(result.text, 'Respuesta del respaldo');
  });

  it('si el modelo rechaza thinkingConfig (400), reintenta sin él', async () => {
    const seen = [];
    const flaky = {
      async generateContent(request) {
        seen.push(Boolean(request.generationConfig.thinkingConfig));
        if (request.generationConfig.thinkingConfig) throw httpError(400, 'Invalid JSON payload received. Unknown name "thinkingConfig"');
        return sdkResult('ok.');
      },
    };
    const request = { structured: true, request: { contents: [], generationConfig: { maxOutputTokens: 1024, thinkingConfig: { thinkingBudget: 0 } } } };
    await gemini.callGemini(flaky, request, { backoffMs: [1], timeoutMs: 50 });
    assert.deepEqual(seen, [true, false]);
  });

  it('respuesta sin IA para preguntas comunes, con datos de la clínica', () => {
    const today = '2026-11-04';
    const price = quickAnswer('cuánto cuesta la limpieza?', { clinic, today });
    assert.match(price.text, /Limpieza dental/);
    assert.match(price.text, /S\/ 80/);
    const where = quickAnswer('¿dónde quedan?', { clinic, today });
    assert.ok(where.text.includes(clinic.address));
    assert.ok(where.text.includes(clinic.mapsUrl));
    assert.ok(quickAnswer('qué horario tienen', { clinic, today }).text.includes(clinic.workingHoursText));
    assert.match(quickAnswer('tienen alguna promoción?', { clinic, today }).text, /Evaluación digital 3D sin costo/);
    assert.match(quickAnswer('aceptan yape?', { clinic, today }).text, /Yape y Plin/);
    assert.equal(quickAnswer('me duele la cabeza y quiero conversar', { clinic, today }), null);
    // Siempre termina con un siguiente paso.
    assert.match(price.text, /\?$/);
  });

  it('no inventa: sin formas de pago configuradas no responde sobre pagos', () => {
    const bare = { ...clinic, paymentMethods: [], financingText: null };
    assert.equal(quickAnswer('aceptan tarjeta?', { clinic: bare, today: '2026-11-04' }), null);
  });
});

describe('Fase 1.3: métrica first_response_ms fuera de rango', () => {
  it('hay una migración idempotente que pasa first_response_ms a BIGINT', () => {
    const file = readdirSync(new URL('../migrations/', import.meta.url)).find((f) => /^20261104_.*\.sql$/.test(f));
    assert.ok(file, 'falta migrations/20261104_*.sql');
    const sql = readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8');
    assert.match(sql, /first_response_ms[\s\S]*BIGINT/i);
    assert.match(sql, /IF EXISTS|DO \$\$/i);
  });

  it('un tiempo imposible (reloj desfasado) no se guarda como métrica', async () => {
    const updates = [];
    const fakeClient = {
      from() {
        const chain = { update(p) { updates.push(p); return chain; }, eq() { return chain; }, is() { return Promise.resolve({ error: null }); } };
        return chain;
      },
    };
    const metrics = createConversationMetrics({ getClient: async () => fakeClient, leads: { saveLeadAfterHours: async () => {} } });
    const respondedAt = new Date('2026-11-04T15:00:00Z');
    const result = await metrics.recordFirstContact({ phone: '51999', firstMessageAt: new Date(respondedAt - 288915076252), respondedAt });
    assert.equal(updates[0].first_response_ms, null);
    assert.equal(result.firstResponseMs, null);
    assert.ok(MAX_PLAUSIBLE_RESPONSE_MS <= 2147483647);
  });
});

describe('Fase 1.4: "Status update failed: 400"', () => {
  it('un solo pedido "leído + escribiendo" con el formato vigente de Meta', async () => {
    resetStatusSupport();
    const bodies = [];
    globalThis.fetch = async (url, options) => { bodies.push(JSON.parse(options.body)); return new Response('{"success":true}', { status: 200 }); };
    await sendTypingIndicator('wamid.ABC', { phoneNumberId: '123', token: 't' });
    assert.deepEqual(bodies, [{ messaging_product: 'whatsapp', status: 'read', message_id: 'wamid.ABC', typing_indicator: { type: 'text' } }]);
  });

  it('si Meta rechaza "escribiendo" (400), registra el motivo sin token ni teléfono y marca solo como leído', async () => {
    resetStatusSupport();
    const bodies = [];
    const logs = [];
    const originalError = console.error;
    console.error = (...args) => logs.push(args.join(' '));
    globalThis.fetch = async (url, options) => {
      const body = JSON.parse(options.body);
      bodies.push(body);
      if (body.typing_indicator) {
        return new Response(JSON.stringify({ error: { code: 100, message: 'Invalid parameter for 51987654321', error_subcode: 2494010 } }), { status: 400 });
      }
      return new Response('{"success":true}', { status: 200 });
    };
    try {
      await sendTypingIndicator('wamid.XYZ', { phoneNumberId: '123', token: 'secreto-token' });
      await sendTypingIndicator('wamid.XYZ2', { phoneNumberId: '123', token: 'secreto-token' });
    } finally {
      console.error = originalError;
    }
    assert.equal(bodies.length, 3, 'tras el primer 400 ya no se insiste con "escribiendo"');
    assert.equal(bodies[1].typing_indicator, undefined);
    const log = logs.join('\n');
    assert.match(log, /100/);
    assert.match(log, /Invalid parameter/);
    assert.equal(log.includes('secreto-token'), false);
    assert.equal(log.includes('51987654321'), false);
  });

  it('nunca lanza: un fallo de red en el estado no bloquea la respuesta', async () => {
    resetStatusSupport();
    globalThis.fetch = async () => { throw new Error('fetch failed'); };
    const originalError = console.error;
    console.error = () => {};
    try {
      assert.equal(await sendTypingIndicator('wamid.1', { phoneNumberId: '123', token: 't' }), null);
    } finally {
      console.error = originalError;
    }
  });
});

describe('Fase 1.5: LEAD_ATASCADO (pide un dato por mensaje y no repite)', () => {
  it('reconoce el distrito en frases naturales o como respuesta corta', () => {
    assert.equal(extractDistrict('vivo en San Juan de Lurigancho'), 'San Juan De Lurigancho');
    assert.equal(extractDistrict('soy de surco'), 'Surco');
    assert.equal(extractDistrict('Miraflores', { asked: true }), 'Miraflores');
    assert.equal(extractDistrict('Arequipa', { asked: true }), 'Arequipa');
    assert.equal(extractDistrict('quiero brackets'), null);
    assert.equal(extractDistrict('Lima'), null);
  });

  it('el siguiente dato que falta va en orden y de a uno', () => {
    assert.equal(nextMissingField({}), 'tratamiento');
    assert.equal(nextMissingField({ motivo: 'brackets' }), 'nombre');
    assert.equal(nextMissingField({ motivo: 'brackets', nombre: 'Ana Torres' }), 'distrito');
    assert.equal(nextMissingField({ motivo: 'brackets', nombre: 'Ana Torres', distrito: 'Surco' }), 'horario');
    assert.equal(nextMissingField({ motivo: 'brackets', nombre: 'Ana Torres', distrito: 'Surco', fechaHoraISO: 'x' }), null);
    for (const field of ['tratamiento', 'nombre', 'distrito', 'horario']) {
      assert.equal((questionFor(field).match(/\?/g) || []).length, 1, `${field}: una sola pregunta`);
    }
  });

  it('guarda nombre y distrito cuando el paciente responde solo con el dato que se le pidió', async () => {
    const id = jid(50);
    const reply = (text) => ({ async generateContent() { return sdkResult(text); } });
    await gemini.obtenerRespuestaIA(id, 'quiero brackets', { client: reply('¡Claro! ¿A nombre de quién registro la solicitud?') });
    const named = await gemini.obtenerRespuestaIA(id, 'Ana Torres', { client: reply('Gracias, Ana. ¿De qué distrito nos escribes?'), skipDebounce: true });
    assert.equal(named.leadData.nombre, 'Ana Torres');
    const withDistrict = await gemini.obtenerRespuestaIA(id, 'Surco', { client: reply('Perfecto. ¿Qué día te acomoda?'), skipDebounce: true });
    assert.equal(withDistrict.leadData.distrito, 'Surco');
    assert.equal(withDistrict.leadData.nombre, 'Ana Torres');
  });

  it('el prompt dice qué ya respondió (para no repetir) y cuál es el único dato que falta', async () => {
    const id = jid(51);
    let prompt = '';
    const client = { async generateContent(request) { prompt = request.systemInstruction; return sdkResult('Listo. ¿De qué distrito nos escribes?'); } };
    await gemini.obtenerRespuestaIA(id, 'Me llamo Rosa Díaz y quiero una limpieza', { client });
    assert.match(prompt, /YA RESPONDIDO[^\n]*Rosa Díaz/);
    assert.match(prompt, /PRÓXIMO DATO[^\n]*distrito/i);
  });

  it('si el modelo afirma una cita que no existe, pide solo el dato que falta (no la plantilla de 3)', async () => {
    const result = await gemini.obtenerRespuestaIA(jid(52), 'quiero blanqueamiento', {
      client: { async generate() { return { text: 'Tu cita ya quedó agendada.' }; } },
    });
    assert.equal((result.texto.match(/\?/g) || []).length, 1);
    assert.match(result.texto, /nombre/i);
  });
});

describe('Fase 1.6: nombre del perfil de WhatsApp', () => {
  it('solo acepta perfiles que parecen un nombre real', () => {
    for (const ok of ['Diego', 'María José Pérez', "D'Angelo Ruiz", 'Ana-Lucía Soto']) assert.equal(looksLikeRealName(ok), true, ok);
    for (const bad of ['Diego 2024', '💕Mary💕', 'Dental Store SAC', 'Importaciones Ruiz', 'Diegooo', 'xX_Dark_Xx', '51987654321', 'Mamá', 'Clínica Sonrisa', 'Ventas', 'A', '']) {
      assert.equal(looksLikeRealName(bad), false, bad);
    }
  });

  it('un perfil raro no llega al prompt y se pide el nombre al agendar', async () => {
    let prompt = '';
    await gemini.obtenerRespuestaIA(jid(60), 'hola, info de brackets', {
      profileName: 'Tienda Dental Store 💎',
      client: { async generateContent(request) { prompt = request.systemInstruction; return sdkResult('¿A nombre de quién registro la solicitud?'); } },
    });
    assert.equal(prompt.includes('Tienda Dental Store'), false);
    assert.match(prompt, /No sabes su nombre/);
  });

  it('un perfil con nombre real se usa para saludar', async () => {
    let prompt = '';
    await gemini.obtenerRespuestaIA(jid(61), 'hola, info de brackets', {
      profileName: 'Lucía Ramos',
      client: { async generateContent(request) { prompt = request.systemInstruction; return sdkResult('¡Hola, Lucía! ¿Te cuento de los brackets?'); } },
    });
    assert.match(prompt, /perfil de WhatsApp: Lucía Ramos/);
  });
});

describe('Fase 1.2: webhook con Gemini caído responde con datos de la clínica', () => {
  it('ante "¿dónde quedan?" con Gemini en 503, el paciente recibe la dirección y el mapa (sin alerta a recepción)', async () => {
    const { createMemoryDb } = await import('./demo/memoryDb.js');
    const { useInMemorySupabase } = await import('./supabaseClient.js');
    const { runInTestMode, TEST_PHONE_PREFIX } = await import('./testContext.js');
    const { default: webhookController, waitForIdle } = await import('../controllers/webhookController.js');
    const previousReception = process.env.RECEPTION_ALERT_PHONE;
    process.env.RECEPTION_ALERT_PHONE = '51911122233';
    useInMemorySupabase(createMemoryDb());
    globalThis.fetch = async (url, options) => (String(url).includes('generativelanguage.googleapis.com')
      ? new Response(JSON.stringify({ error: { code: 503, message: 'This model is currently experiencing high demand', status: 'UNAVAILABLE' } }), { status: 503 })
      : realFetch(url, options));
    const phone = `${TEST_PHONE_PREFIX}7701`;
    const sent = [];
    const originalError = console.error;
    console.error = () => {};
    try {
      const message = { id: `wamid.f1.${Date.now()}`, from: phone, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: 'Buenas, ¿dónde quedan exactamente?' } };
      await runInTestMode({ onSend: (to, payload) => sent.push({ to, ...payload }) }, async () => {
        await webhookController({ body: { entry: [{ changes: [{ value: { messages: [message] } }] }] } }, { status() { return this; }, send() { return this; } });
        await waitForIdle(phone);
      });
    } finally {
      console.error = originalError;
      useInMemorySupabase(null);
      process.env.RECEPTION_ALERT_PHONE = previousReception;
    }
    assert.ok(sent.some((m) => m.to === phone && (m.text || '').includes(clinic.mapsUrl)), 'el paciente debía recibir el mapa');
    assert.equal(sent.some((m) => m.to === '51911122233'), false, 'no debía alertar a recepción');
  });
});
