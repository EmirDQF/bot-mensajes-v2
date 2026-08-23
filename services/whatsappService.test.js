// Ensure config/env.js validation passes during tests by setting minimal env vars
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test-key';
process.env.GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
process.env.WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || '12345';
process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || 'verify-token';

import { describe, it, before } from 'node:test';
import assert from 'assert';

let sendWhatsAppMessage;

// Helper to create a mock fetch that returns given sequence of responses
function mockFetchSequence(responses, options = {}) {
  let call = 0;
  return async (url, opts) => {
    const idx = call < responses.length ? call : responses.length - 1;
    call += 1;
    const resp = responses[idx];
    if (typeof resp === 'function') return resp(url, opts);
    return resp;
  };
}

function makeResponse({ ok = true, status = 200, jsonObj = {}, textBody = '' } = {}) {
  return {
    ok,
    status,
    json: async () => jsonObj,
    text: async () => textBody,
  };
}

function makeAbortFetchThatNeverResolves() {
  return (url, opts) => new Promise((resolve, reject) => {
    // Listen to signal
    const signal = opts && opts.signal;
    if (signal) {
      signal.addEventListener('abort', () => {
        const err = new Error('Aborted'); err.name = 'AbortError'; reject(err);
      });
    }
    // never resolve
  });
}

describe('whatsappService', () => {
  before(async () => {
    // Dynamic import after setting env vars
    const mod = await import('./whatsappService.js');
    sendWhatsAppMessage = mod.sendWhatsAppMessage;
  });
  it('succeeds on first attempt', async () => {
    const fetch = mockFetchSequence([makeResponse({ ok: true, status: 200, jsonObj: { id: 'ok' } })]);
    const res = await sendWhatsAppMessage('987654321', 'hola', { fetchImpl: fetch, timeoutMs: 2000, maxRetries: 2 });
    assert.deepEqual(res, { id: 'ok' });
  });

  it('retries on 5xx and then succeeds', async () => {
    let calls = 0;
    const fetch = async (url, opts) => {
      calls += 1;
      if (calls === 1) return makeResponse({ ok: false, status: 500, textBody: 'server error' });
      return makeResponse({ ok: true, status: 200, jsonObj: { id: 'after-retry' } });
    };

    const res = await sendWhatsAppMessage('987654322', 'hola', { fetchImpl: fetch, timeoutMs: 2000, maxRetries: 2 });
    assert.deepEqual(res, { id: 'after-retry' });
  });

  it('times out and retries then ultimately throws after retries exhausted', async () => {
    const fetch = mockFetchSequence([makeAbortFetchThatNeverResolves(), makeAbortFetchThatNeverResolves(), makeAbortFetchThatNeverResolves()]);
    let threw = false;
    try {
      await sendWhatsAppMessage('987654323', 'hola', { fetchImpl: fetch, timeoutMs: 100, maxRetries: 2 });
    } catch (e) {
      threw = true;
    }
    assert.equal(threw, true);
  });

  it('does not retry on 4xx', async () => {
    let calls = 0;
    const fetch = async (url, opts) => {
      calls += 1;
      return makeResponse({ ok: false, status: 400, textBody: 'bad request' });
    };

    let threw = false;
    try {
      await sendWhatsAppMessage('987654324', 'hola', { fetchImpl: fetch, timeoutMs: 2000, maxRetries: 2 });
    } catch (e) {
      threw = true;
    }
    assert.equal(threw, true);
    assert.equal(calls, 1);
  });
});
