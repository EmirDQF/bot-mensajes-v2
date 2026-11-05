import { describe, it, afterEach } from 'node:test';
import assert from 'assert';

// Fase 8 (agente top): audios del paciente transcritos con Gemini (solo con GEMINI_PAID_TIER=true).

process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test';
process.env.WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || 'token-de-prueba';

const {
  createAudioTranscriber, oggDurationSeconds, audioSeconds, audioTranscriptionEnabled, MAX_AUDIO_SECONDS,
} = await import('./audioTranscription.js');
const { AUDIO_TOO_LONG_REPLY, UNSUPPORTED_REPLIES } = await import('../controllers/firstContact.js');
const { createMemoryDb } = await import('./demo/memoryDb.js');
const { useInMemorySupabase, getSupabase } = await import('./supabaseClient.js');
const { runInTestMode, TEST_PHONE_PREFIX } = await import('./testContext.js');
const { default: webhookController, waitForIdle } = await import('../controllers/webhookController.js');

// Ogg mínimo: primera página y última página con la posición (48 kHz) del final del audio.
function ogg(seconds) {
  const page = (granule) => {
    const b = Buffer.alloc(27);
    b.write('OggS', 0, 'latin1');
    b.writeBigUInt64LE(BigInt(Math.round(granule)), 6);
    return b;
  };
  return Buffer.concat([page(0), Buffer.alloc(200, 1), page(seconds * 48000)]);
}
const PAID = { GEMINI_PAID_TIER: 'true' };
const client = (text, calls = []) => ({ async generateContent(request) { calls.push(request); return { response: { text: () => text } }; } });

describe('transcripción de audios', () => {
  it('solo con GEMINI_PAID_TIER=true (son datos de salud)', async () => {
    assert.equal(audioTranscriptionEnabled({}), false);
    assert.equal(audioTranscriptionEnabled({ GEMINI_PAID_TIER: 'true' }), true);
    let downloaded = false;
    const t = createAudioTranscriber({ env: {}, fetchMedia: async () => { downloaded = true; return {}; } });
    assert.deepEqual(await t.transcribe({ id: '123456' }), { reason: 'disabled' });
    assert.equal(downloaded, false, 'sin plan pagado ni siquiera se descarga');
  });

  it('mide la duración del Ogg y estima la de otros formatos', () => {
    assert.equal(Math.round(oggDurationSeconds(ogg(30))), 30);
    assert.equal(oggDurationSeconds(Buffer.from('no es ogg')), null);
    assert.equal(audioSeconds(Buffer.alloc(8000)), 2);
  });

  it('transcribe con Gemini (audio en línea + instrucción) y devuelve el texto', async () => {
    const calls = [];
    const buffer = ogg(20);
    const t = createAudioTranscriber({ env: PAID, getClient: () => client('Hola, cuánto cuestan los brackets', calls), fetchMedia: async () => ({ buffer, contentType: 'audio/ogg; codecs=opus' }) });
    assert.deepEqual(await t.transcribe({ id: '123456' }), { text: 'Hola, cuánto cuestan los brackets' });
    const parts = calls[0].contents[0].parts;
    assert.equal(parts[0].inlineData.mimeType, 'audio/ogg');
    assert.match(parts[1].text, /Transcribe literalmente/);
    assert.ok(buffer.every((b) => b === 0), 'el audio se borra de la memoria al terminar');
  });

  it('más de 2 minutos: no se transcribe', async () => {
    let called = false;
    const t = createAudioTranscriber({ env: PAID, getClient: () => { called = true; return client('x'); }, fetchMedia: async () => ({ buffer: ogg(MAX_AUDIO_SECONDS + 30), contentType: 'audio/ogg' }) });
    assert.deepEqual(await t.transcribe({ id: '123456' }), { reason: 'too_long' });
    assert.equal(called, false);
  });

  it('si falla la descarga, Gemini o no se entiende, devuelve "failed"', async () => {
    const ok = async () => ({ buffer: ogg(10), contentType: 'audio/ogg' });
    const failing = { async generateContent() { throw new Error('503'); } };
    for (const t of [
      createAudioTranscriber({ env: PAID, getClient: () => client('x'), fetchMedia: async () => { throw new Error('404'); } }),
      createAudioTranscriber({ env: PAID, getClient: () => failing, fetchMedia: ok }),
      createAudioTranscriber({ env: PAID, getClient: () => client('[INAUDIBLE]'), fetchMedia: ok }),
      createAudioTranscriber({ env: PAID, getClient: () => null, fetchMedia: ok }),
    ]) assert.deepEqual(await t.transcribe({ id: '123456' }), { reason: 'failed' });
  });
});

describe('webhook: el audio se responde como si lo hubiera escrito', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; useInMemorySupabase(null); delete process.env.GEMINI_PAID_TIER; });
  // Meta (datos del archivo y bytes) y Gemini: la transcripción y luego la respuesta.
  function stub({ transcript, reply = 'Claro, te ayudo.', seconds = 15 }) {
    globalThis.fetch = async (url, options) => {
      const u = String(url);
      if (u.startsWith('https://graph.facebook.com/') && /\/\d+$/.test(u)) return new Response(JSON.stringify({ url: 'https://lookaside.fbsbx.com/audio', mime_type: 'audio/ogg' }), { status: 200 });
      if (u.startsWith('https://lookaside.fbsbx.com/')) return new Response(ogg(seconds), { status: 200 });
      if (u.includes('generativelanguage.googleapis.com')) {
        const isAudio = String(options?.body || '').includes('inlineData') || String(options?.body || '').includes('inline_data');
        return new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: isAudio ? transcript : reply }] }, finishReason: 'STOP' }] }), { status: 200 });
      }
      return realFetch(url, options);
    };
  }
  const audioMessage = (phone) => ({ id: `wamid.au.${Math.random().toString(36).slice(2)}`, from: phone, timestamp: String(Math.floor(Date.now() / 1000)), type: 'audio', audio: { id: '987654321', mime_type: 'audio/ogg; codecs=opus', voice: true } });
  async function say(phone, message, sent) {
    await runInTestMode({ onSend: (to, payload) => sent.push({ to, ...payload }) }, async () => {
      await webhookController({ body: { entry: [{ changes: [{ value: { messages: [message] } }] }] } }, { status() { return this; }, send() { return this; } });
      await waitForIdle(phone);
    });
  }
  const textMessage = (phone, body) => ({ id: `wamid.au.${Math.random().toString(36).slice(2)}`, from: phone, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body } });

  it('urgencia dicha por audio: pasa a una persona; la bandeja guarda solo la transcripción', async () => {
    useInMemorySupabase(createMemoryDb());
    process.env.GEMINI_PAID_TIER = 'true';
    stub({ transcript: 'tengo un dolor muy fuerte en la muela y la cara hinchada' });
    const phone = `${TEST_PHONE_PREFIX}8801`;
    const sent = [];
    await say(phone, textMessage(phone, 'hola'), sent);
    sent.length = 0;
    await say(phone, audioMessage(phone), sent);
    const db = await getSupabase();
    const row = db.data.messages.find((m) => m.phone === phone && String(m.content || '').startsWith('🎤 (transcripción)'));
    assert.ok(row, 'la bandeja muestra la transcripción');
    assert.equal(row.media_id, null, 'no se guarda ninguna referencia al audio');
    assert.ok((db.data.handoffs || []).some((h) => h.phone === phone && h.reason === 'urgencia'), 'la urgencia pasa a una persona');
    assert.equal(sent.some((m) => m.text === UNSUPPORTED_REPLIES.audio), false);
  });

  it('"stop" dicho por audio queda como opt-out', async () => {
    useInMemorySupabase(createMemoryDb());
    process.env.GEMINI_PAID_TIER = 'true';
    stub({ transcript: 'stop, no me escriban más' });
    const phone = `${TEST_PHONE_PREFIX}8802`;
    const sent = [];
    await say(phone, textMessage(phone, 'hola'), sent);
    await say(phone, audioMessage(phone), sent);
    assert.ok((await getSupabase()).data.contact_preferences.find((p) => p.phone === phone)?.followups_opt_out_at);
  });

  it('más de 2 minutos: pide amablemente que lo escriba', async () => {
    useInMemorySupabase(createMemoryDb());
    process.env.GEMINI_PAID_TIER = 'true';
    stub({ transcript: 'x', seconds: 200 });
    const phone = `${TEST_PHONE_PREFIX}8803`;
    const sent = [];
    await say(phone, textMessage(phone, 'hola'), sent);
    sent.length = 0;
    await say(phone, audioMessage(phone), sent);
    assert.ok(sent.some((m) => m.to === phone && m.text === AUDIO_TOO_LONG_REPLY));
  });

  it('sin GEMINI_PAID_TIER sigue como hoy: pide que lo escriba', async () => {
    useInMemorySupabase(createMemoryDb());
    stub({ transcript: 'no debería usarse' });
    const phone = `${TEST_PHONE_PREFIX}8804`;
    const sent = [];
    await say(phone, textMessage(phone, 'hola'), sent);
    sent.length = 0;
    await say(phone, audioMessage(phone), sent);
    assert.ok(sent.some((m) => m.to === phone && m.text === UNSUPPORTED_REPLIES.audio));
  });
});
