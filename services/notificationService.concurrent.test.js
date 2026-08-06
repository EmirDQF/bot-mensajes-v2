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
        // simulate conditional update with .is and .eq
        return {
          is(field, val) {
            this._is = { field, val };
            return this;
          },
          eq(field, val) {
            this._eq = { field, val };
            // perform the conditional update now
            const id = this._eq.value || val;
            // find a lead matching id and is condition
            const row = [...leads.values()].find(r => r.id === val);
            if (!row) return { select: async () => ({ data: [], error: null }) };
            if (this._is && this._is.field === 'notified_at' && row.notified_at !== null) {
              return { select: async () => ({ data: [], error: null }) };
            }
            // perform update
            Object.assign(row, payload);
            return { select: async () => ({ data: [row], error: null }) };
          }
        };
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
    const lead = { id: 'lead-1', nombre: 'Test', telefono: '999111222', fecha_hora_texto: 'martes 11 de agosto, 3:00 PM' };

    await Promise.all([
      notificationService.notifyAdminNewLead(lead, { whatsappService }),
      notificationService.notifyAdminNewLead(lead, { whatsappService })
    ]);

    assert.equal(sends, 1, 'Admin should receive only one send');
  });
});
