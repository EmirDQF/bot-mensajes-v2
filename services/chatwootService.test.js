import assert from 'assert';
import { describe, it, before } from 'node:test';

process.env.NODE_ENV = 'test';

let chatwootService;

before(async () => {
  chatwootService = (await import('./chatwootService.js')).default;
});

function mockFetch(ok = true, status = 200, jsonBody = {}) {
  global.fetch = async (url, opts) => {
    return {
      ok,
      status,
      json: async () => (Object.assign({ url, opts }, jsonBody)),
      text: async () => JSON.stringify(jsonBody),
    };
  };
}

describe('chatwootService', () => {
  it('getConversation builds correct URL and returns parsed JSON', async () => {
    mockFetch(true, 200, { result: 'ok' });
    const res = await chatwootService.getConversation('123', 'conv-1', 'token-xyz');
    assert.ok(res);
    assert.ok(res.url && res.url.includes('/api/v1/accounts/123/conversations/conv-1'));
  });

  it('sendMessageToConversation posts content payload', async () => {
    mockFetch(true, 200, { message: 'saved' });
    const res = await chatwootService.sendMessageToConversation('123', 'conv-2', 'token-abc', 'Hola!');
    assert.ok(res);
    assert.ok(res.opts.body && JSON.parse(res.opts.body).content === 'Hola!');
  });

  it('updateConversation sends attrs', async () => {
    mockFetch(true, 200, { updated: true });
    const res = await chatwootService.updateConversation('123', 'conv-3', 'token-abc', { status: 'open' });
    assert.ok(res);
    assert.ok(res.opts.body && JSON.parse(res.opts.body).status === 'open');
  });
});