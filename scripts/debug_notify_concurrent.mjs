process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.ADMIN_WHATSAPP_NUMBER = process.env.ADMIN_WHATSAPP_NUMBER || '51987654321';

(async () => {
  const notificationService = await import('../services/notificationService.js');
  const leadService = await import('../services/leadService.js');

  // create same mock as test
  const leads = new Map();
  leads.set('lead-1', { id: 'lead-1', telefono: '999111222', notified_at: null, ready_to_notify: true });
  const mockSupabase = {
    from(table) {
      if (table !== 'leads') throw new Error('unexpected table ' + table);
      return {
        update(payload) {
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
                  console.log('mockSupabase: select.limit called with eq=', self._eq, 'is=', self._is);
                  const row = id ? leads.get(id) : null;
                  if (!row) return { data: [], error: null };
                  if (self._is && self._is.field === 'notified_at' && row.notified_at !== null) {
                    console.log('mockSupabase: select returning empty because notified_at already set');
                    return { data: [], error: null };
                  }
                  Object.assign(row, payload);
                  console.log('mockSupabase: updated row', row);
                  return { data: [row], error: null };
                }
              };
            },
            limit() { return this; }
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
  };

  await leadService.initSupabaseClient(mockSupabase);


  let sends=0;
  const whatsappService = { async sendWhatsAppMessage(to, text, opts) { sends++; return { success:true }; } };

  const lead = { id: 'lead-1', nombre: 'Test', telefono: '999111222', distrito: 'Lima', fecha_hora_texto: 'martes 11 de agosto, 3:00 PM' };

  // Inspect tryClaimNotification behavior in parallel
  try {
    const [c1, c2] = await Promise.all([
      leadService.tryClaimNotification('lead-1'),
      leadService.tryClaimNotification('lead-1')
    ]);
    console.log('tryClaim results', c1, c2);
  } catch (e) {
    console.error('tryClaim threw', e && e.message ? e.message : e);
  }

  // Try notify twice concurrently
  const [n1, n2] = await Promise.all([
    notificationService.notifyAdminNewLead(lead, { whatsappService, leadService }),
    notificationService.notifyAdminNewLead(lead, { whatsappService, leadService })
  ]);
  console.log('notify results', n1, n2);

  console.log('sends:', sends);
  console.log('lead row after:', [...leads.values()][0]);
})();