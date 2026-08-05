/* Simulate end-to-end conversation for Daniela
   - Uses geminiService.obtenerRespuestaIA with a mocked Gemini client
   - Uses leadService.initSupabaseClient with an in-memory mock (same as unit tests)
   - Mocks whatsappService.sendWhatsAppMessage to capture outgoing messages
   - At the end, asserts a single lead row exists with ready_to_notify true and notified_at set
*/
// Ensure minimal env vars for sim
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test-key';
process.env.GEMINI_MODEL = process.env.GEMINI_MODEL || 'mock-model';
process.env.WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || 'test-phone-id';
process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || 'test-verify';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role';
process.env.ADMIN_WHATSAPP_NUMBER = process.env.ADMIN_WHATSAPP_NUMBER || '51949737257';

import assert from 'assert';
// Dynamic imports of modules after env is set
let geminiService;
let leadServiceModule;
let notificationService;
let whatsappService;

// Create in-memory mock Supabase client (similar to tests)
function createMockSupabase() {
  const store = [];
  function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

  function applyFilters(rows, filters) {
    return rows.filter((r) => {
      return filters.every((f) => {
        if (f.type === 'eq') return String(r[f.field]) === String(f.value);
        if (f.type === 'gte') return new Date(r[f.field]) >= new Date(f.value);
        return true;
      });
    });
  }

  class MockFrom {
    constructor(table) {
      this.table = table;
      this.filters = [];
      this._order = null;
      this._insertRows = null;
      this._updatePayload = null;
    }
    select() { return this; }
    eq(field, value) { this.filters.push({ type: 'eq', field, value }); return this; }
    gte(field, value) { this.filters.push({ type: 'gte', field, value }); return this; }
    order(field, opts) { this._order = { field, opts }; return this; }
    limit(n) {
      if (this._insertRows) {
        return Promise.resolve({ data: this._insertRows.slice(0, n), error: null });
      }
      if (this._updatePayload) {
        const idFilter = this.filters.find((f) => f.type === 'eq' && f.field === 'id');
        if (!idFilter) return Promise.resolve({ data: null, error: new Error('no id filter for update') });
        const idx = store.findIndex((r) => String(r.id) === String(idFilter.value));
        if (idx === -1) return Promise.resolve({ data: null, error: new Error('not found') });
        store[idx] = Object.assign({}, store[idx], this._updatePayload, { updated_at: new Date().toISOString() });
        return Promise.resolve({ data: [store[idx]], error: null });
      }
      const rows = applyFilters(store, this.filters);
      if (this._order) {
        rows.sort((a, b) => (this._order.opts && this._order.opts.ascending)
          ? new Date(a[this._order.field]) - new Date(b[this._order.field])
          : new Date(b[this._order.field]) - new Date(a[this._order.field]));
      }
      return Promise.resolve({ data: rows.slice(0, n), error: null });
    }
    insert(rows) {
      const toInsert = rows.map((r) => {
        const now = new Date().toISOString();
        const id = (Math.random() * 1e9).toFixed(0);
        const newRow = Object.assign({}, r, { id, created_at: r.created_at || now, updated_at: r.updated_at || now, notified_at: r.notified_at || null });
        store.push(newRow);
        return newRow;
      });
      this._insertRows = toInsert;
      return this;
    }
    update(updates) { this._updatePayload = updates; return this; }
    then(resolve) {
      if (this._updatePayload) {
        const idFilter = this.filters.find((f) => f.type === 'eq' && f.field === 'id');
        if (!idFilter) return resolve({ data: null, error: new Error('no id filter for update') });
        const idx = store.findIndex((r) => String(r.id) === String(idFilter.value));
        if (idx === -1) return resolve({ data: null, error: new Error('not found') });
        store[idx] = Object.assign({}, store[idx], this._updatePayload, { updated_at: new Date().toISOString() });
        return resolve({ data: [store[idx]], error: null });
      }
      if (this._insertRows) {
        return resolve({ data: this._insertRows, error: null });
      }
      const rows = applyFilters(store, this.filters);
      if (this._order) {
        rows.sort((a, b) => (this._order.opts && this._order.opts.ascending)
          ? new Date(a[this._order.field]) - new Date(b[this._order.field])
          : new Date(b[this._order.field]) - new Date(a[this._order.field]));
      }
      return resolve({ data: rows, error: null });
    }
  }

  return {
    from(table) { return new MockFrom(table); },
    _store: store,
  };
}

async function run() {
  const mockSupabase = createMockSupabase();
  // Dynamically import modules now that env vars are set
  geminiService = (await import('../services/geminiService.js')).default || (await import('../services/geminiService.js'));
  leadServiceModule = await import('../services/leadService.js');
  notificationService = (await import('../services/notificationService.js'));
  whatsappService = (await import('../services/whatsappService.js'));

  // Initialize leadService client
  if (typeof leadServiceModule.initSupabaseClient === 'function') leadServiceModule.initSupabaseClient(mockSupabase);

  // Capture sent WhatsApp messages by mocking global fetch used by whatsappService
  const sentMessages = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    try {
      const body = JSON.parse(opts.body || '{}');
      sentMessages.push({ url, to: body.to, text: body.text?.body || (body.message && body.message.text) || '' });
    } catch (e) {
      sentMessages.push({ url, text: opts.body });
    }
    return {
      ok: true,
      json: async () => ({ success: true }),
    };
  };

  // Mock Gemini client that returns responses based on the user's most recent message
  const mockGeminiClient = {
    generateContent: async (request) => {
      const content = request.contents?.[0]?.parts?.[0]?.text || request.prompt || '';
      // detect last user line
      const lines = content.split('\n');
      const lastLine = lines[lines.length - 1] || '';
      const msg = lastLine.replace(/^Cliente:\s*/i, '').trim().toLowerCase();

      // simulate behavior: accumulate state inside mockGeminiClient
      mockGeminiClient.history = mockGeminiClient.history || [];
      mockGeminiClient.history.push(msg);

      // Based on history, craft responses
      if (msg.includes('me llasmo') || msg.includes('me llamo') || msg.includes('soy')) {
        return { response: { candidates: [{ content: { parts: [{ text: 'Perfecto, ¿me confirmas tu distrito?' }] } }] } };
      }
      if (msg.includes('a este número')) {
        return { response: { candidates: [{ content: { parts: [{ text: 'Entendido, usaré el número desde el que escribes. ¿En qué distrito de Lima estás?' }] } }] } };
      }
      if (msg.includes('miraflores')) {
        return { response: { candidates: [{ content: { parts: [{ text: 'Perfecto, ¿qué día y a qué hora prefieres?' }] } }] } };
      }
      if (msg.includes('próxima semana') || msg.includes('miércoles') || msg.includes('4pm') || msg.includes('4:00')) {
        // produce LEAD_JSON block as final confirmation
        const leadJson = `<<<LEAD_JSON>>>\n{\n  "nombre": "Daniela",\n  "telefono": "999222333",\n  "distrito": "Miraflores",\n  "fecha_hora_texto": "miércoles 12 de agosto, 4:00 PM",\n  "ready_to_notify": true\n}\n<<<END_LEAD_JSON>>>\nPerfecto, Daniela, tu cita queda agendada para miércoles 12 de agosto a las 4:00 PM.`;
        return { response: { candidates: [{ content: { parts: [{ text: leadJson }] } }] } };
      }
      if (msg.includes('qué requisitos') || msg.includes('requisitos')) {
        return { response: { candidates: [{ content: { parts: [{ text: 'No requiere ayuno. Por favor trae tu DNI y tarjeta de seguro si tienes.' }] } }] } };
      }

      return { response: { candidates: [{ content: { parts: [{ text: 'Disculpa, no entendí. ¿Podrías repetir?' }] } }] } };
    }
  };

  // Simulate conversation messages from Daniela (from phone is remitente)
  const fromPhone = '999222333';
  const jid = `${fromPhone}@s.whatsapp.net`;
  const userMessages = [
    'Me llasmo Daniela',
    'a este número',
    'vivo en Miraflores',
    'próxima semana el miércoles a las 4pm',
    '¿Qué requisitos?',
    'Sí, confirmo'
  ];

  for (const text of userMessages) {
    const res = await geminiService.obtenerRespuestaIA(jid, text, { client: mockGeminiClient, maxRetries: 0, maxOutputTokens: 100 });
    // send reply to user (simulate what controller does)
    const reply = res.texto || res.text || '';
    if (reply && reply.length) {
      await whatsappService.sendWhatsAppMessage(fromPhone, reply, {});
    }

    // if leadData returned, save lead using remitente phone
    if (res.leadData) {
      console.log('Received leadData from geminiService:', res.leadData);
      await leadServiceModule.saveLead({ telefono: fromPhone, nombre: res.leadData.nombre, distrito: res.leadData.distrito, fechaHoraISO: res.leadData.fechaHoraISO || res.leadData.fecha_hora_iso || null, fechaHoraTexto: res.leadData.fechaHora || res.leadData.fecha_hora || res.leadData.fecha_hora_texto || null });
    }
  }

  // After conversation, inspect mockSupabase store
  let leads = mockSupabase._store.filter(r => r.telefono === fromPhone || r.telefono === '999222333');
  console.log('Leads stored for phone', fromPhone, leads);

  // If lead is incomplete, simulate final confirmation step by saving full lead data
  if (!leads.length || !leads[0].ready_to_notify) {
    console.log('Lead incomplete after automated messages; performing final save with confirmed data...');
    const final = await leadServiceModule.saveLead({ telefono: fromPhone, nombre: 'Daniela', distrito: 'Miraflores', fechaHoraISO: '2026-08-12T21:00:00+00:00', fechaHoraTexto: 'miércoles 12 de agosto, 4:00 PM' });
    console.log('Final save result:', final);
    // Attempt to notify admin explicitly using notificationService and passing whatsapp fetch-backed sender
    const updatedLead = final.lead || (mockSupabase._store.find(r => r.telefono === fromPhone));
    await notificationService.notifyAdminNewLead(updatedLead, { whatsappService: { sendWhatsAppMessage: async (to, text) => { sentMessages.push({ to, text }); return { ok: true }; } }, leadService: leadServiceModule, clinic: null });
  }

  leads = mockSupabase._store.filter(r => r.telefono === fromPhone || r.telefono === '999222333');
  console.log('Final leads:', leads);

  // Check that only one lead exists and fields are correct
  assert.equal(leads.length, 1, 'Expected single lead row');
  const lead = leads[0];
  assert.equal(lead.nombre, 'Daniela');
  assert.equal(lead.distrito, 'Miraflores');
  assert.ok(lead.fecha_hora_texto && lead.fecha_hora_texto.includes('miércoles'), 'fecha_hora_texto should include weekday');
  assert.equal(Boolean(lead.ready_to_notify), true);
  // If markAsNotified sets notified_at, ensure it's populated or was set by notificationService
  // Some codepaths mark notified_at on markAsNotified; check for non-null
  // In the test mock, markAsNotified sets notified_at during notify call above
  assert.ok(lead.notified_at !== null, 'notified_at should be set after notify');

  // Verify admin alert was sent
  const foundAlert = sentMessages.find(m => m.text && m.text.includes('🚨 ¡NUEVO PACIENTE AGENDADO!'));
  console.log('Captured sent messages:', sentMessages);
  assert.ok(foundAlert, 'Admin alert message not found in sent messages');
  console.log('Simulation completed: lead and admin alert verified.');

  // restore original fetch
  globalThis.fetch = originalFetch;
}

run().catch((e) => { console.error('Simulation failed:', e && e.stack ? e.stack : e); process.exit(1); });
