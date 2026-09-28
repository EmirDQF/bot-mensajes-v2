import { describe, it, before, after } from 'node:test';
import assert from 'assert';

process.env.NODE_ENV = 'test';

const { createLiveEvents } = await import('./liveEvents.js');
const { createInboxService, toClientMessage, panelMediaUrl } = await import('./inboxService.js');
const { createInboxController } = await import('../controllers/inboxController.js');
const { createHandoffService } = await import('./handoffService.js');
const { describeMetaError } = await import('./metaErrors.js');
const { fakeDb } = await import('./testing/fakeSupabase.js');
const { resetLoginFailures } = await import('../middleware/panelAuth.js');

const PHONE = '51987654321';
const TOKEN = 'EAAG-token-secreto-que-nunca-sale';
const NOW = new Date('2026-09-27T22:30:00Z');

function mockRes() {
  return {
    statusCode: 200, body: null, headers: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    set(h) { Object.assign(this.headers, h); return this; },
    send(body) { this.body = body; return this; },
  };
}

function setup({ lastInboundAt = new Date(NOW - 60 * 60 * 1000), sendFails = null } = {}) {
  const db = fakeDb({
    conversations: [],
    messages: lastInboundAt ? [{ id: 1, phone: PHONE, role: 'user', content: 'hola', created_at: lastInboundAt.toISOString() }] : [],
  });
  const events = createLiveEvents({ bootId: 'test' });
  const published = [];
  events.subscribe((e) => published.push(e));
  const inbox = createInboxService({ getClient: () => db, events, now: () => NOW });
  const handoff = createHandoffService({ getClient: () => db, whatsapp: { async sendTextMessage() {} }, events, now: () => NOW.getTime() });
  const sentWith = [];
  const jobs = {
    async sendWithWindow(to, message, sent = {}) {
      if (sendFails) throw sendFails;
      const open = lastInboundAt && NOW - lastInboundAt < 23.5 * 3600 * 1000;
      sentWith.push({ to, message, channel: open ? 'text' : 'template' });
      sent.result = { messages: [{ id: `wamid.${sentWith.length}` }] };
      return open ? 'text' : 'template';
    },
  };
  const controller = createInboxController({ inbox, events, handoff, jobs, getClient: () => db });
  return { db, events, published, inbox, handoff, controller, sentWith };
}

describe('bus de eventos en vivo', () => {
  it('replays missed events after a reconnection and asks to resync after a restart or a gap', () => {
    const events = createLiveEvents({ bootId: 'a1', bufferSize: 3 });
    const first = events.publish('message', { n: 1 });
    events.publish('status', { n: 2 });
    events.publish('typing', { n: 3 });
    assert.deepEqual(events.since(first.id).events.map((e) => e.data.n), [2, 3]);
    assert.equal(events.since('otroarranque-1').resync, true, 'reinicio del servidor');
    events.publish('bot', { n: 4 });
    events.publish('bot', { n: 5 });
    assert.equal(events.since(first.id).resync, true, 'hueco mayor al búfer');
    assert.throws(() => events.publish('inventado', {}), /desconocido/);
  });
});

describe('bandeja: mensajes y estados de Meta', () => {
  it('records an incoming message, counts it as unread and publishes it live', async () => {
    const { db, inbox, published } = setup();
    const message = await inbox.recordMessage({ phone: PHONE, sender: 'patient', text: 'cuánto cuestan los brackets', contactName: 'Ana', wamid: 'wamid.in' });
    assert.equal(message.sender, 'patient');
    await inbox.recordMessage({ phone: PHONE, sender: 'patient', type: 'audio', mediaId: '123456789' });
    const conversation = db.data.conversations.find((c) => c.conversation_id === PHONE);
    assert.equal(conversation.unread_count, 2);
    assert.equal(conversation.contact_name, 'Ana');
    assert.equal(conversation.last_message, '🎤 Audio');
    assert.equal(published.filter((e) => e.type === 'message').length, 2);
    await inbox.markRead(PHONE);
    assert.equal(db.data.conversations[0].unread_count, 0);
  });

  it('always saves a timestamp (legacy NOT NULL column) and still saves when the table has no such column', async () => {
    const { db, inbox } = setup();
    await inbox.recordMessage({ phone: PHONE, sender: 'patient', text: 'hola', wamid: 'wamid.ts' });
    assert.equal(db.data.messages.find((m) => m.whatsapp_message_id === 'wamid.ts').timestamp, NOW.toISOString());

    const inserted = [];
    const noTimestampColumn = {
      from(table) {
        const inner = db.from(table);
        if (table !== 'messages') return inner;
        return {
          insert(rows) {
            inserted.push(rows[0]);
            if ('timestamp' in rows[0]) {
              const failed = { select: () => failed, maybeSingle: async () => ({ data: null, error: { code: 'PGRST204', message: "Could not find the 'timestamp' column of 'messages' in the schema cache" } }) };
              return failed;
            }
            return inner.insert(rows);
          },
        };
      },
    };
    const legacy = createInboxService({ getClient: () => noTimestampColumn, events: createLiveEvents({ bootId: 't' }), now: () => NOW });
    const message = await legacy.recordMessage({ phone: PHONE, sender: 'bot', text: 'respuesta', wamid: 'wamid.nots' });
    assert.equal(message.sender, 'bot');
    assert.equal(inserted.length, 2);
    assert.equal(inserted[1].sender, 'bot', 'solo quita "timestamp", no las columnas de la bandeja en vivo');
    assert.ok(db.data.messages.some((m) => m.whatsapp_message_id === 'wamid.nots'));
  });

  it('never goes back in delivery status and saves the reason when Meta rejects a message', async () => {
    const { db, inbox, published } = setup();
    await inbox.recordMessage({ phone: PHONE, sender: 'bot', text: 'Te propongo 3 horarios', wamid: 'wamid.out' });
    await inbox.applyStatuses([{ id: 'wamid.out', status: 'read', recipient_id: PHONE, timestamp: '1790000000' }]);
    await inbox.applyStatuses([{ id: 'wamid.out', status: 'delivered', recipient_id: PHONE }]);
    const row = db.data.messages.find((m) => m.whatsapp_message_id === 'wamid.out');
    assert.equal(row.status, 'read');
    await inbox.applyStatuses([{ id: 'wamid.out', status: 'failed', recipient_id: PHONE, errors: [{ code: 131047, title: 'Re-engagement message' }] }]);
    assert.equal(row.status, 'failed');
    assert.match(row.status_error, /24 h/);
    assert.deepEqual(published.filter((e) => e.type === 'status').map((e) => e.data.status), ['read', 'failed']);
    assert.match(describeMetaError({ code: 999, message: 'raro' }), /raro.*999/);
  });

  it('shows patient media through the authenticated proxy and bot photos from /media', () => {
    assert.equal(panelMediaUrl({ media_id: '987654321' }), '/api/panel/media/987654321');
    assert.equal(panelMediaUrl({ media_url: 'https://bot.onrender.com/media/denvari/logo.png' }), '/media/denvari/logo.png');
    assert.equal(panelMediaUrl({ media_url: 'javascript:alert(1)' }), null);
    assert.equal(toClientMessage({ role: 'assistant', content: 'hola', phone: PHONE }).sender, 'bot');
  });

  it('lists conversations with urgent ones first and filters them', async () => {
    const { db, inbox } = setup();
    db.data.conversations.push(
      { conversation_id: '51911111111', last_message: 'hola', last_message_at: '2026-09-27T22:00:00Z', unread_count: 1, status: 'active' },
      { conversation_id: '51922222222', last_message: 'me sangra', last_message_at: '2026-09-27T21:00:00Z', status: 'human', handoff_reason: 'urgencia', after_hours: true },
    );
    db.data.appointments = [{ sender_phone: '51911111111', status: 'pendiente', appointment_date: '2026-09-28', appointment_time: '10:00:00' }];
    const all = await inbox.listConversations();
    assert.deepEqual(all.map((c) => c.phone), ['51922222222', '51911111111']);
    assert.equal(all[0].urgent, true);
    assert.equal(all[0].afterHours, true);
    assert.deepEqual(all[1].request, { status: 'pendiente', date: '2026-09-28', time: '10:00' });
    assert.deepEqual((await inbox.listConversations({ filter: 'requests' })).map((c) => c.phone), ['51911111111']);
    assert.deepEqual((await inbox.listConversations({ filter: 'unread' })).map((c) => c.phone), ['51911111111']);
    assert.deepEqual((await inbox.listConversations({ q: 'sangra' })).map((c) => c.phone), ['51922222222']);
  });
});

describe('bandeja: responder desde el panel', () => {
  it('sends, saves the message as reception and pauses the bot in that conversation', async () => {
    const { controller, db, published, sentWith } = setup();
    const res = mockRes();
    await controller.send({ params: { phone: PHONE }, body: { text: 'Hola Ana, te escribe recepción' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(sentWith[0].channel, 'text');
    const saved = db.data.messages.find((m) => m.sender === 'reception');
    assert.equal(saved.content, 'Hola Ana, te escribe recepción');
    assert.equal(saved.whatsapp_message_id, 'wamid.1');
    assert.equal(db.data.conversations[0].status, 'human');
    assert.ok(published.some((e) => e.type === 'bot' && e.data.paused === true));

    const back = mockRes();
    await controller.setBot({ params: { phone: PHONE }, body: { paused: false } }, back);
    assert.equal(back.body.paused, false);
    assert.equal(db.data.conversations[0].status, 'active');
  });

  it('outside the 24 h window only allows an approved template', async () => {
    const { controller, sentWith } = setup({ lastInboundAt: new Date(NOW - 30 * 3600 * 1000) });
    const res = mockRes();
    await controller.send({ params: { phone: PHONE }, body: { text: '¿Sigues interesado?' } }, res);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, 'outside_window');
    assert.equal(res.body.templates[0].key, 'reactivation');
    assert.equal(sentWith.length, 0);

    const withTemplate = mockRes();
    await controller.send({ params: { phone: PHONE }, body: { template: 'reactivation' } }, withTemplate);
    assert.equal(withTemplate.statusCode, 200);
    assert.equal(withTemplate.body.channel, 'template');
  });

  it('shows the Meta reason when the send fails', async () => {
    const failure = Object.assign(new Error('WhatsApp API returned status 400'), { status: 400, meta: { code: 131026 } });
    const { controller, db } = setup({ sendFails: failure });
    const res = mockRes();
    await controller.send({ params: { phone: PHONE }, body: { text: 'hola' } }, res);
    assert.equal(res.statusCode, 502);
    assert.match(res.body.error, /no tiene WhatsApp/);
    assert.equal(db.data.messages.at(-1).status, 'failed');
  });
});

describe('bandeja: proxy de media', () => {
  it('downloads with the token on the server and never returns it to the browser', async () => {
    const { db } = setup();
    db.data.messages.push({ id: 9, phone: PHONE, role: 'user', media_id: '555666777', created_at: NOW.toISOString() });
    const calls = [];
    const fetchImpl = async (url, options) => {
      calls.push({ url, auth: options?.headers?.Authorization });
      if (url.includes('graph.facebook.com')) return { ok: true, json: async () => ({ url: 'https://lookaside.fbsbx.com/x?sig=abc', mime_type: 'audio/ogg', file_size: 10 }) };
      return { ok: true, arrayBuffer: async () => new TextEncoder().encode('OggS-audio').buffer, headers: new Headers() };
    };
    const { fetchMetaMedia } = await import('./metaMedia.js');
    const controller = createInboxController({ getClient: () => db, fetchMedia: (id) => fetchMetaMedia(id, { fetchImpl, token: TOKEN, version: 'v21.0' }) });
    const res = mockRes();
    await controller.media({ params: { mediaId: '555666777' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['Content-Type'], 'audio/ogg');
    assert.ok(calls.every((c) => c.auth === `Bearer ${TOKEN}`), 'el token solo va a Meta');
    const exposed = JSON.stringify(res.headers) + String(res.body);
    assert.ok(!exposed.includes(TOKEN) && !exposed.includes('lookaside'), 'ni el token ni la URL firmada llegan al navegador');

    const unknown = mockRes();
    await controller.media({ params: { mediaId: '111222333' } }, unknown);
    assert.equal(unknown.statusCode, 404, 'solo media de conversaciones de la clínica');
  });

  it('forces a download for documents so they cannot run inside the panel', async () => {
    const { db } = setup();
    db.data.messages.push({ id: 10, phone: PHONE, role: 'user', media_id: '444555666', created_at: NOW.toISOString() });
    const controller = createInboxController({ getClient: () => db, fetchMedia: async () => ({ contentType: 'text/html', buffer: Buffer.from('<script>alert(1)</script>') }) });
    const res = mockRes();
    await controller.media({ params: { mediaId: '444555666' } }, res);
    assert.equal(res.headers['Content-Type'], 'application/octet-stream');
    assert.match(res.headers['Content-Disposition'], /attachment/);
  });
});

describe('panel: acceso y stream en vivo', () => {
  const saved = {};
  const ENV = { PANEL_USER: 'recepcion', PANEL_PASSWORD: 'clave-recepcion-123', PANEL_OWNER_USER: 'dueno', PANEL_OWNER_PASSWORD: 'clave-dueno-456', CRON_SECRET: 'x'.repeat(32) };
  let server;
  let base;

  before(async () => {
    for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; process.env[k] = v; }
    const { createApp } = await import('../app.js');
    const { fakeDb: makeDb } = await import('./testing/fakeSupabase.js');
    const db = makeDb({ conversations: [] });
    const app = createApp({ getSupabase: () => db });
    await new Promise((resolve) => { server = app.listen(0, () => resolve()); });
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => {
    server.close();
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    resetLoginFailures();
  });

  const basic = (user, pass) => ({ Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}` });

  it('rejects the stream and the inbox without a session', async () => {
    assert.equal((await fetch(`${base}/api/panel/stream`)).status, 401);
    assert.equal((await fetch(`${base}/api/panel/conversations`)).status, 401);
    assert.equal((await fetch(`${base}/api/panel/stream`, { headers: basic('recepcion', 'mala') })).status, 401);
    resetLoginFailures();
  });

  it('streams live events to a logged-in session (cookie) and replays after reconnecting', async () => {
    const login = await fetch(`${base}/api/panel/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ user: 'recepcion', password: 'clave-recepcion-123' }),
    });
    assert.equal(login.status, 200);
    assert.equal((await login.json()).role, 'reception');
    const cookie = login.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);

    const controller = new AbortController();
    const res = await fetch(`${base}/api/panel/stream`, { headers: { cookie: cookie.split(';')[0] }, signal: controller.signal });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/event-stream/);
    const reader = res.body.getReader();
    const liveEvents = (await import('./liveEvents.js')).default;
    let text = '';
    const deadline = Date.now() + 3000;
    let published = null;
    while (Date.now() < deadline && !text.includes('"hola en vivo"')) {
      const { value } = await reader.read();
      text += new TextDecoder().decode(value);
      if (!published && text.includes('event: ready')) published = liveEvents.publish('message', { phone: PHONE, message: { text: 'hola en vivo' } });
    }
    controller.abort();
    assert.match(text, /event: message/);
    assert.match(text, new RegExp(`id: ${published.id}`));
  });

  it('locks the login after repeated failures', async () => {
    resetLoginFailures();
    const attempt = () => fetch(`${base}/api/panel/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ user: 'recepcion', password: 'otra' }),
    });
    for (let i = 0; i < 5; i += 1) assert.equal((await attempt()).status, 401);
    assert.equal((await attempt()).status, 429);
    resetLoginFailures();
  });

  it('rejects form posts (only JSON) as a CSRF defense', async () => {
    const res = await fetch(`${base}/api/panel/login`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'user=a&password=b' });
    assert.equal(res.status, 415);
  });

  it('serves the panel page with a strict Content-Security-Policy', async () => {
    const res = await fetch(`${base}/panel`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
    assert.match(res.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  });
});
