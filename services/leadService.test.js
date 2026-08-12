import { strict as assert } from 'assert';
import { describe, it, before, beforeEach } from 'node:test';

process.env.NODE_ENV = 'test';

// Simple in-memory mock Supabase client for tests
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
    eq(field, value) {
      this.filters.push({ type: 'eq', field, value });
      return this;
    }
    is(field, value) {
      this.filters.push({ type: 'is', field, value });
      return this;
    }
    gte(field, value) {
      this.filters.push({ type: 'gte', field, value });
      return this;
    }
    order(field, opts) {
      this._order = { field, opts };
      return this;
    }
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
        const newRow = Object.assign({}, r, { id, created_at: r.created_at || now, updated_at: r.updated_at || now });
        store.push(newRow);
        return newRow;
      });
      this._insertRows = toInsert;
      return this;
    }
    update(updates) {
      this._updatePayload = updates;
      return this;
    }
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

let leadServiceModule;
let mockSupabase;

before(async () => {
  mockSupabase = createMockSupabase();
  const mod = await import('./leadService.js');
  mod.initSupabaseClient(mockSupabase);
  leadServiceModule = mod;
});

beforeEach(() => {
  mockSupabase._store.length = 0;
});

describe('leadService (supabase mock)', () => {
  it('saves a lead successfully', async () => {
    const { saveLead, getByPhone } = leadServiceModule;
    const res = await saveLead({ telefono: '987654321', nombre: 'Test User', distrito: 'Miraflores', fechaHoraTexto: 'mañana a las 3pm' });
    assert.equal(res.isNew, true);
    assert.ok(res.lead);
    const byPhone = await getByPhone('987654321');
    assert.ok(byPhone && byPhone.telefono === '987654321');
  });

  it('validateLead strict mode throws when required fields missing', async () => {
    const { validateLead } = leadServiceModule;
    let threw = false;
    try {
      validateLead({ telefono: '987654321' }, { strict: true });
    } catch (e) {
      threw = true;
      assert.equal(e.message, 'nombre is required');
    }
    assert.ok(threw, 'validateLead should throw in strict mode');
  });

  it('deduplicates within 24 hours (updates instead of insert)', async () => {
    const { saveLead, listLeads, getByPhone } = leadServiceModule;
    const r1 = await saveLead({ telefono: '999000001', nombre: 'User1', distrito: 'Lima' });
    assert.equal(r1.isNew, true);
    const r2 = await saveLead({ telefono: '999000001', nombre: 'User1-updated', distrito: 'San Isidro' });
    assert.equal(r2.isNew, false);
    const all = await listLeads();
    const matching = all.filter((x) => x.telefono === '999000001');
    assert.equal(matching.length, 1);
    assert.equal(matching[0].distrito, 'San Isidro');
    assert.equal(matching[0].nombre, 'User1-updated');
    const byPhone = await getByPhone('999000001');
    assert.equal(byPhone?.distrito, 'San Isidro');
  });

  it('returns updated ready_to_notify after explicit confirmation of completed lead data', async () => {
    const { saveLead, getByPhone } = leadServiceModule;
    const initial = await saveLead({ telefono: '999111222', nombre: 'First Name' });
    assert.equal(initial.isNew, true);
    assert.equal(initial.readyToNotify, false);
 
    const updated = await saveLead({ telefono: '999111222', nombre: 'First Name', distrito: 'Barranco', fechaHoraISO: '2026-08-09T22:00:00+00:00', fechaHoraTexto: 'viernes a las 5pm', confirmed: true });
    assert.equal(updated.isNew, false);
    assert.equal(updated.readyToNotify, true);
    assert.equal(updated.lead.ready_to_notify, true);
    assert.equal(updated.lead.distrito, 'Barranco');
 
    const byPhone = await getByPhone('999111222');
    assert.ok(byPhone);
    assert.equal(byPhone.ready_to_notify, true);
    assert.equal(byPhone.distrito, 'Barranco');
  });

  it('does not mark a complete lead ready_to_notify without explicit confirmation when prior partial data existed', async () => {
    const { saveLead } = leadServiceModule;
    const initial = await saveLead({ telefono: '999777888', nombre: 'Ana' });
    assert.equal(initial.readyToNotify, false);
 
    const incompleteUpdate = await saveLead({ telefono: '999777888', distrito: 'Surco', fechaHoraISO: '2026-08-11T15:00:00+00:00', fechaHoraTexto: 'martes a las 10am' });
    assert.equal(incompleteUpdate.readyToNotify, false);
 
    const confirmedUpdate = await saveLead({ telefono: '999777888', nombre: 'Ana', distrito: 'Surco', fechaHoraISO: '2026-08-11T15:00:00+00:00', fechaHoraTexto: 'martes a las 10am', confirmed: true });
    assert.equal(confirmedUpdate.readyToNotify, true);
  });

  it('rejects clinic-related phrases as distrito and preserves existing valid distrito', async () => {
    const { saveLead, getByPhone } = leadServiceModule;
    const initial = await saveLead({ telefono: '999666777', nombre: 'María', distrito: 'Miraflores', fechaHoraISO: '2026-08-11T16:00:00+00:00', fechaHoraTexto: 'martes 11 de agosto a las 11:00 AM', confirmed: true });
    assert.equal(initial.readyToNotify, true);

    const updated = await saveLead({ telefono: '999666777', distrito: 'nuestra clínica en lima' });
    assert.equal(updated.lead.distrito, 'Miraflores');
    const byPhone = await getByPhone('999666777');
    assert.equal(byPhone.distrito, 'Miraflores');
  });

  it('sets ready_to_notify true when fecha_hora_iso valida is provided along with nombre and distrito', async () => {
    const { saveLead, getByPhone } = leadServiceModule;
    const fechaHoraISO = '2026-08-05T14:00:00-05:00';
    const result = await saveLead({ telefono: '999333444', nombre: 'Tom Holland', distrito: 'Miraflores', fechaHoraISO, fechaHoraTexto: 'martes 2pm' });
    assert.equal(result.readyToNotify, true);
    assert.equal(result.lead.ready_to_notify, true);
    assert.equal(result.lead.fecha_hora_iso, fechaHoraISO);
    const byPhone = await getByPhone('999333444');
    assert.equal(byPhone.ready_to_notify, true);
    assert.equal(byPhone.fecha_hora_iso, fechaHoraISO);
  });

  it('does not re-mark readyToNotify if already notified', async () => {
    const { saveLead, getByPhone, markAsNotified } = leadServiceModule;

    // initial incomplete
    const r1 = await saveLead({ telefono: '999222333', nombre: 'Ana' });
    assert.equal(r1.isNew, true);
    assert.equal(r1.readyToNotify, false);

    // complete data without explicit confirmation should not yet signal readyToNotify
    const r2 = await saveLead({ telefono: '999222333', nombre: 'Ana', distrito: 'Surco', fechaHoraISO: '2026-08-10T15:00:00+00:00', fechaHoraTexto: 'lunes 10am' });
    assert.equal(r2.isNew, false);
    assert.equal(r2.readyToNotify, false);

    // explicit confirmation should now mark the lead ready_to_notify
    const r2Confirmed = await saveLead({ telefono: '999222333', nombre: 'Ana', distrito: 'Surco', fechaHoraISO: '2026-08-10T15:00:00+00:00', fechaHoraTexto: 'lunes 10am', confirmed: true });
    assert.equal(r2Confirmed.readyToNotify, true);

    // mark as notified
    const marked = await markAsNotified(r2Confirmed.lead.id);
    assert.ok(marked);
    assert.ok(marked.notified_at);

    // subsequent save with same data should NOT return readyToNotify true again
    const r3 = await saveLead({ telefono: '999222333', nombre: 'Ana', distrito: 'Surco', fechaHoraTexto: 'lunes 10am' });
    assert.equal(r3.isNew, false);
    assert.equal(r3.readyToNotify, false, 'Second save after notified should not signal readyToNotify');
  });

  it('getByPhone and listLeads work', async () => {
    const { saveLead, getByPhone, listLeads } = leadServiceModule;
    await saveLead({ telefono: '987654321', nombre: 'Test User', distrito: 'Miraflores', fechaHoraTexto: 'mañana a las 3pm' });
    const byPhone = await getByPhone('987654321');
    assert.ok(byPhone);
    const all = await listLeads();
    assert.equal(Array.isArray(all), true);
    assert.ok(all.length >= 1);
  });
});
