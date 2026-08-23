import assert from 'assert';
import { describe, it, before } from 'node:test';

process.env.NODE_ENV = 'test';

let webhookController;

before(async () => {
  webhookController = (await import('./webhookController.js')).default;
});

describe('webhookController Chatwoot handover', () => {
  it('pauses session, updates chatwoot and notifies admin when user requests human', async () => {
    // spy/override services
    const chatwootService = await import('../services/chatwootService.js');
    const geminiService = await import('../services/geminiService.js');
    const notificationService = await import('../services/notificationService.js');

    let updated = null;
    chatwootService.updateConversation = async (acct, convId, token, attrs) => { updated = { acct, convId, token, attrs }; return {}; };

    let pausedFor = null;
    geminiService.pauseSessionById = (sid) => { pausedFor = sid; return true; };

    let notified = null;
    notificationService.notifyAdminNewLead = async (lead, opts) => { notified = { lead, opts }; return true; };

    // Build fake req/res
    const payload = {
      event: 'message_created',
      payload: {
        message: { content: 'Quiero hablar con un asesor' },
        conversation: { id: 'conv-1', status: 'open', assignee_id: null },
        inbox: { id: 'inbox-1' },
        sender_contact: { phone_number: '+51987654321', name: 'Shawmie' }
      },
      account_id: 'acct-1'
    };

    const req = { parsedBody: payload };
    let statusCode = null;
    let jsonBody = null;
    const res = {
      status(code) { statusCode = code; return this; },
      json(obj) { jsonBody = obj; return this; }
    };

    await webhookController(req, res, () => {});

    // Assertions
    assert.equal(statusCode, 200);
    assert.equal(jsonBody?.ok, true);
    assert.equal(jsonBody?.reason, 'handover_requested');

    assert.ok(updated, 'chatwoot update should be called');
    assert.equal(pausedFor, '51987654321');
    assert.ok(notified, 'admin should be notified');
  });
});