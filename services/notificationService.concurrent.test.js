import { describe, it, before } from 'node:test';
import assert from 'assert';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_KEY = process.env.SUPABASE_KEY || 'anon';
process.env.ADMIN_WHATSAPP_NUMBER = process.env.ADMIN_WHATSAPP_NUMBER || '51987654321';

let notificationService;
let leadService;

before(async () => {
  notificationService = await import('./notificationService.js');
  leadService = await import('./leadService.js');
});

function createMockSupabase() {
  // simple in-memory leads table
  const leads = new Map();
  // insert a lead with id 'lead-1'
  leads.set('lead-1', { id: 'lead-1', telefono: '999111222', notified_at: null, ready_to_notify: true });

  function from(table) {
    if (table !== 'leads') throw new Error('unexpected table ' + table);
    return {
      update(payload) {
        // build the query chain but only apply at select(). This mirrors real supabase client's lazy chain.
        const chain = {
          _is: null,
          _eq: null,
          is(field, val) { this._is = { field, val }; return this; },
          eq(field, val) { this._eq = { field, val }; return this; },
          select() {
            const self = this;
            return {
              async limit() {
                const id = self._eq && self._eq.field === 'id' ? self._eq.val : null;
                const row = id ? leads.get(id) : null;
                if (!row) return { data: [], error: null };
                if (self._is && self._is.field === 'notified_at' && row.notified_at !== null) {
                  return { data: [], error: null };
                }
                // perform update
                Object.assign(row, payload);
                return { data: [row], error: null };
              }
            };
          }
        };
        return chain;
      },
      select() {
        return {
          eq(field, val) {
            if (field === 'id') {
              const r = leads.get(val);
              return { single: async () => ({ data: r || null, error: null }) };
            }
            return { single: async () => ({ data: null, error: null }) };
          }
        };
      }
    };
  }

  return { from };
}

describe('notificationService idempotency', () => {
  it('allows only one claimant to set notified_at (tryClaimNotification)', async () => {
    const mockSupabase = createMockSupabase();
    // inject mock client into leadService
    await leadService.initSupabaseClient(mockSupabase);

    // capture sends
    let sends = 0;
    const whatsappService = {
      async sendWhatsAppMessage(to, text, opts) { sends += 1; return { success: true }; }
    };

    // call notifyAdminNewLead twice concurrently
    const lead = { id: 'lead-1', nombre: 'Test', telefono: '999111222', distrito: 'Lima', fecha_hora_texto: 'martes 11 de agosto, 3:00 PM' };

    await Promise.all([
      notificationService.notifyAdminNewLead(lead, { whatsappService }),
      notificationService.notifyAdminNewLead(lead, { whatsappService })
    ]);

    assert.equal(sends, 1, 'Admin should receive only one send');
  });
});
