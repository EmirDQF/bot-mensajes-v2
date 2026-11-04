import { describe, it, afterEach } from 'node:test';
import assert from 'assert';

// Camino crítico de un mensaje del paciente: colas por paciente, cachés con vencimiento, logs sin datos
// del paciente, timeouts de la media de Meta, límite de solicitudes y webhooks agrupados de Meta.

process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test';

const { createSerialQueue } = await import('./serialQueue.js');
const { createExpiringMap } = await import('./expiringMap.js');
const { describeError } = await import('./safeLog.js');
const { createNoAiAlert, FALLBACK_ALERT_MS } = await import('./aiFallback.js');
const { createHandoffService } = await import('./handoffService.js');
const { fetchMetaMedia } = await import('./metaMedia.js');
const { default: rateLimiter } = await import('../middleware/rateLimiter.js');
const { createMemoryDb } = await import('./demo/memoryDb.js');
const { useInMemorySupabase } = await import('./supabaseClient.js');
const { runInTestMode, TEST_PHONE_PREFIX } = await import('./testContext.js');
const { default: webhookController, extractIncomingEvents, waitForIdle } = await import('../controllers/webhookController.js');

describe('createSerialQueue (cola por paciente)', () => {
  it('si una tarea falla, la siguiente del mismo paciente igual se ejecuta y el error queda registrado', async () => {
    const errors = [];
    const queue = createSerialQueue({ onError: (error) => errors.push(error.message) });
    const ran = [];
    queue.enqueue('51911', async () => { throw new Error('boom'); });
    await queue.enqueue('51911', async () => { ran.push('segunda'); });
    assert.deepStrictEqual(ran, ['segunda']);
    assert.deepStrictEqual(errors, ['boom']);
    assert.strictEqual(queue.pending('51911'), null);
  });

  it('ejecuta en orden y de a una las tareas del mismo paciente', async () => {
    const queue = createSerialQueue();
    const order = [];
    const slow = () => new Promise((resolve) => setTimeout(resolve, 20));
    queue.enqueue('a', async () => { await slow(); order.push(1); });
    queue.enqueue('a', async () => { order.push(2); });
    await queue.pending('a');
    assert.deepStrictEqual(order, [1, 2]);
  });
});

describe('createExpiringMap (cachés en memoria con vencimiento)', () => {
  it('olvida una entrada al vencer su TTL', () => {
    let t = 0;
    const map = createExpiringMap({ ttlMs: 1000, now: () => t });
    map.set('a', 1);
    t = 999;
    assert.strictEqual(map.get('a'), 1);
    t = 1000;
    assert.strictEqual(map.get('a'), undefined);
    assert.strictEqual(map.has('a'), false);
  });

  it('no supera maxEntries: descarta las más antiguas', () => {
    const map = createExpiringMap({ ttlMs: 60_000, maxEntries: 3 });
    for (const key of ['a', 'b', 'c', 'd', 'e']) map.set(key, key);
    assert.strictEqual(map.size, 3);
    assert.strictEqual(map.has('a'), false);
    assert.strictEqual(map.get('e'), 'e');
  });
});

describe('describeError (logs sin datos del paciente)', () => {
  it('omite el detalle de PostgREST con la fila y enmascara teléfonos', () => {
    const error = {
      code: '23502',
      message: 'null value in column "timestamp" of relation "messages" violates not-null constraint (51987654321)',
      details: 'Failing row contains (51987654321, tengo sangrado en las encías)',
    };
    const text = describeError(error);
    assert.match(text, /23502/);
    assert.match(text, /not-null/);
    assert.doesNotMatch(text, /51987654321/);
    assert.doesNotMatch(text, /sangrado/);
    assert.match(text, /\*\*\*4321/);
  });

  it('acepta errores vacíos o de texto', () => {
    assert.strictEqual(describeError(null), 'error desconocido');
    assert.match(describeError('falló 987654321'), /\*\*\*4321/);
  });
});

describe('fetchMetaMedia con tope de tiempo', () => {
  it('corta la descarga si Meta no responde (no bloquea la cola del paciente)', async () => {
    const hang = (url, { signal } = {}) => new Promise((_, reject) => {
      signal?.addEventListener('abort', () => reject(signal.reason));
    });
    const started = Date.now();
    await assert.rejects(
      Promise.race([
        fetchMetaMedia('1234567890', { fetchImpl: hang, token: 'x', version: 'v21.0', timeoutMs: 30 }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('sin timeout')), 1000)),
      ]),
      (error) => error.status === 504,
    );
    assert.ok(Date.now() - started < 1000);
  });
});

describe('rateLimiter y estados de entrega de Meta', () => {
  it('los estados de distintos pacientes no comparten el cupo de la IP de Meta', () => {
    const limit = rateLimiter({ max: 20, windowMs: 60_000 });
    let passed = 0;
    for (let i = 0; i < 25; i += 1) {
      const body = Buffer.from(JSON.stringify({
        entry: [{ changes: [{ value: { statuses: [{ id: `wamid.${i}`, status: 'delivered', recipient_id: `5199900${String(i).padStart(4, '0')}` }] } }] }],
      }));
      const res = { setHeader() {}, status() { return this; }, json() { return this; } };
      limit({ body, ip: '173.252.0.1', headers: {} }, res, () => { passed += 1; });
    }
    assert.strictEqual(passed, 25);
  });
});

describe('handoffService: caché del estado del bot con tope', () => {
  it('no guarda más de cacheMaxEntries números (los más antiguos vuelven a consultarse)', async () => {
    const reads = [];
    const getClient = async () => ({
      from: () => ({
        select: () => ({ eq: (column, id) => ({ maybeSingle: async () => { reads.push(id); return { data: null, error: null }; } }) }),
      }),
    });
    const service = createHandoffService({ getClient, cacheMaxEntries: 2, events: { publish() {} } });
    for (const phone of ['51911', '51922', '51933']) await service.isPaused(phone);
    await service.isPaused('51933');
    assert.deepStrictEqual(reads, ['51911', '51922', '51933']);
    await service.isPaused('51911');
    assert.deepStrictEqual(reads, ['51911', '51922', '51933', '51911']);
  });
});

describe('createNoAiAlert (respaldo cuando Gemini falla)', () => {
  it('avisa a recepción una sola vez por paciente por hora', async () => {
    let t = 0;
    const sent = [];
    const alert = createNoAiAlert({
      whatsapp: { async sendTextMessage(to, text) { sent.push({ to, text }); } },
      getPhone: () => '51900000001', clinic: { name: 'Clínica Prueba' }, now: () => t,
    });
    assert.strictEqual(await alert('51911111111', '¿precio de brackets?'), true);
    assert.strictEqual(await alert('51911111111', 'otra vez'), false);
    t = FALLBACK_ALERT_MS;
    assert.strictEqual(await alert('51911111111', 'una hora después'), true);
    assert.strictEqual(sent.length, 2);
    assert.match(sent[0].text, /Clínica Prueba/);
    assert.match(sent[0].text, /precio de brackets/);
  });

  it('no lanza si WhatsApp falla ni si falta RECEPTION_ALERT_PHONE', async () => {
    const failing = createNoAiAlert({ whatsapp: { async sendTextMessage() { throw new Error('caído'); } }, getPhone: () => '51900000001' });
    assert.strictEqual(await failing('51911111112', 'hola'), false);
    const noPhone = createNoAiAlert({ getPhone: () => null });
    assert.strictEqual(await noPhone('51911111113', 'hola'), false);
  });
});

describe('extractIncomingEvents (webhooks agrupados de Meta)', () => {
  it('devuelve todos los mensajes y estados de todas las entradas y cambios', () => {
    const payload = {
      entry: [
        { changes: [{ value: { messages: [{ id: 'm1', from: '1' }, { id: 'm2', from: '2' }], contacts: [{ wa_id: '1' }] } }] },
        { changes: [{ value: { statuses: [{ id: 's1', status: 'read' }] } }, { value: { messages: [{ id: 'm3', from: '3' }] } }] },
      ],
    };
    const { messages, statuses } = extractIncomingEvents(payload);
    assert.deepStrictEqual(messages.map(({ message }) => message.id), ['m1', 'm2', 'm3']);
    assert.strictEqual(messages[0].value.contacts[0].wa_id, '1');
    assert.deepStrictEqual(statuses.map((s) => s.id), ['s1']);
  });

  it('tolera payloads vacíos o mal formados', () => {
    assert.deepStrictEqual(extractIncomingEvents(null), { messages: [], statuses: [] });
    assert.deepStrictEqual(extractIncomingEvents({ entry: 'x' }), { messages: [], statuses: [] });
  });
});

// ---------- Flujo completo: webhook → debounce → Gemini (respuesta fija) → WhatsApp falso → bandeja ----------

const GEMINI_HOST = 'generativelanguage.googleapis.com';
const realFetch = globalThis.fetch;
function stubGemini(text) {
  globalThis.fetch = async (url, options) => {
    if (String(url).includes(GEMINI_HOST)) {
      return new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }] }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }
    return realFetch(url, options);
  };
}

const noopRes = { status() { return this; }, send() { return this; }, json() { return this; } };
const testPhone = (n) => `${TEST_PHONE_PREFIX}${String(n).padStart(4, '0')}`;
const metaMessage = (phone, text) => ({
  id: `wamid.critico.${phone}.${Math.random().toString(36).slice(2)}`, from: phone,
  timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: text },
});

describe('webhook: flujo completo del camino crítico', () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
    useInMemorySupabase(null);
  });

  it('responde a todos los mensajes de un webhook agrupado (no solo al primero)', async () => {
    useInMemorySupabase(createMemoryDb());
    stubGemini('Con gusto te ayudo con eso.');
    const [first, second] = [testPhone(9101), testPhone(9102)];
    const sent = [];
    const body = {
      entry: [{ changes: [{ value: { messages: [metaMessage(first, '¿Atienden los sábados?'), metaMessage(second, '¿Dónde quedan?')] } }] }],
    };
    await runInTestMode({ onSend: (to, payload) => sent.push({ to, ...payload }) }, async () => {
      await webhookController({ body }, noopRes);
      await Promise.all([waitForIdle(first), waitForIdle(second)]);
    });
    for (const phone of [first, second]) {
      assert.ok(sent.some((m) => m.to === phone && !m.media && /Con gusto te ayudo/.test(m.text || '')), `sin respuesta para ${phone}`);
    }
  });

  it('si falla el envío de una foto, la respuesta ya enviada queda en la bandeja', async () => {
    const db = createMemoryDb();
    useInMemorySupabase(db);
    stubGemini('Claro, te muestro resultados reales. [ENVIAR_FOTO: ortodoncia]');
    const phone = testPhone(9103);
    const sent = [];
    const onSend = (to, payload) => {
      if (payload.media && /ortodoncia/.test(payload.media)) throw new Error('Meta rechazó la imagen');
      sent.push({ to, ...payload });
    };
    await runInTestMode({ onSend }, async () => {
      await webhookController({ body: { entry: [{ changes: [{ value: { messages: [metaMessage(phone, '¿Tienen promociones?')] } }] }] } }, noopRes);
      await waitForIdle(phone);
    });
    assert.ok(sent.some((m) => m.to === phone && /resultados reales/.test(m.text || '')), 'el texto debía enviarse');
    const { data: rows } = await db.from('messages').select('*').eq('phone', phone);
    assert.ok(rows.some((r) => r.sender === 'bot' && /resultados reales/.test(r.content || '')), 'la respuesta enviada no quedó en la bandeja');
  });
});
