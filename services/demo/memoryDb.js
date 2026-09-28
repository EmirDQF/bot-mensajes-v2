import crypto from 'crypto';

// Supabase en memoria para el modo demo (npm run demo): implementa la parte del cliente de
// @supabase/supabase-js que usa el bot (select/insert/update/upsert/delete, filtros, orden, rango,
// .or() y Storage). Nada sale de este proceso: al cerrarlo, los datos inventados desaparecen.

// Restricciones únicas de las migraciones (así la deduplicación y los "claims" funcionan igual que en Postgres).
export const UNIQUE_KEYS = {
  webhook_events: [['message_id']],
  whatsapp_media_sends: [['recipient', 'image_key', 'campaign_key']],
  follow_ups: [['clinic_id', 'phone']],
  conversations: [['conversation_id']],
  leads: [['telefono']],
  chat_sessions: [['id']],
  clinic_settings: [['clinic_id']],
};

function parseOr(filter) {
  // "phone.eq.51999,conversation_id.eq.51999" → una función por condición
  return String(filter || '').split(',').map((part) => {
    const [column, op, ...rest] = part.split('.');
    const value = rest.join('.');
    if (op === 'eq') return (r) => String(r[column] ?? '') === value;
    if (op === 'is' && value === 'null') return (r) => r[column] == null;
    return () => false;
  });
}

export function createMemoryDb(tables = {}, { now = () => new Date(), publicBaseUrl = '' } = {}) {
  const data = Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.map((r) => ({ ...r }))]));
  const files = new Map();
  let nextId = 1;

  // Valores por defecto de Postgres: id y created_at.
  const withDefaults = (table, row) => {
    const out = { ...row };
    if (out.id === undefined && table !== 'chat_sessions') out.id = table === 'appointments' ? crypto.randomUUID() : nextId++;
    if (out.created_at === undefined) out.created_at = now().toISOString();
    return out;
  };

  const conflicts = (table, row, keys = UNIQUE_KEYS[table] || []) => keys
    .map((key) => data[table].find((r) => key.every((k) => r[k] !== undefined && r[k] === row[k])))
    .find(Boolean);

  function from(table) {
    data[table] ||= [];
    const state = { op: 'select', filters: [], payload: null, sort: [], range: null, limit: null };
    const rows = () => data[table].filter((r) => state.filters.every((f) => f(r)));

    const run = () => {
      if (state.op === 'insert') {
        const list = [].concat(state.payload).map((r) => withDefaults(table, r));
        for (const row of list) {
          if (conflicts(table, row)) return { data: null, error: { code: '23505', message: `duplicate key value violates unique constraint on ${table}` } };
        }
        data[table].push(...list);
        return { data: list.map((r) => ({ ...r })), error: null };
      }
      if (state.op === 'upsert') {
        const keys = state.conflict ? [state.conflict.split(',').map((k) => k.trim())] : UNIQUE_KEYS[table];
        const out = [];
        for (const payload of [].concat(state.payload)) {
          const existing = conflicts(table, payload, keys);
          if (existing) {
            Object.assign(existing, payload);
            out.push({ ...existing });
          } else {
            const row = withDefaults(table, payload);
            data[table].push(row);
            out.push({ ...row });
          }
        }
        return { data: out, error: null };
      }
      if (state.op === 'delete') {
        const match = rows();
        data[table] = data[table].filter((r) => !match.includes(r));
        return { data: match, error: null };
      }
      if (state.op === 'update') {
        const match = rows();
        match.forEach((r) => Object.assign(r, state.payload));
        return { data: match.map((r) => ({ ...r })), error: null };
      }
      let list = rows();
      for (const [column, ascending] of [...state.sort].reverse()) {
        list = [...list].sort((x, y) => {
          if (x[column] === y[column]) return 0;
          if (x[column] == null) return 1;
          if (y[column] == null) return -1;
          return (x[column] > y[column] ? 1 : -1) * (ascending ? 1 : -1);
        });
      }
      if (state.range) list = list.slice(state.range[0], state.range[1] + 1);
      if (state.limit !== null) list = list.slice(0, state.limit);
      return { data: list.map((r) => ({ ...r })), error: null };
    };

    const b = {
      select() { return b; },
      insert(p) { state.op = 'insert'; state.payload = p; return b; },
      update(p) { state.op = 'update'; state.payload = p; return b; },
      delete() { state.op = 'delete'; return b; },
      upsert(p, opts = {}) { state.op = 'upsert'; state.payload = p; state.conflict = opts.onConflict || null; return b; },
      eq(c, v) { state.filters.push((r) => r[c] === v || (r[c] != null && v != null && String(r[c]) === String(v))); return b; },
      neq(c, v) { state.filters.push((r) => r[c] !== v); return b; },
      in(c, v) { state.filters.push((r) => v.includes(r[c])); return b; },
      gte(c, v) { state.filters.push((r) => r[c] != null && r[c] >= v); return b; },
      lte(c, v) { state.filters.push((r) => r[c] != null && r[c] <= v); return b; },
      lt(c, v) { state.filters.push((r) => r[c] != null && r[c] < v); return b; },
      gt(c, v) { state.filters.push((r) => r[c] != null && r[c] > v); return b; },
      is(c, v) { state.filters.push((r) => (v === null ? r[c] == null : r[c] === v)); return b; },
      not(c, op, v) { state.filters.push((r) => (op === 'is' && v === null ? r[c] != null : r[c] !== v)); return b; },
      or(filter) { const any = parseOr(filter); state.filters.push((r) => any.some((f) => f(r))); return b; },
      order(c, { ascending = true } = {}) { state.sort.push([c, ascending]); return b; },
      limit(n) { state.limit = Number(n); return b; },
      range(start, end) { state.range = [start, end]; return b; },
      async maybeSingle() { const out = run(); return { data: out.data?.[0] ?? null, error: out.error }; },
      async single() {
        const out = run();
        if (out.error) return out;
        return out.data?.length ? { data: out.data[0], error: null } : { data: null, error: { code: 'PGRST116', message: 'no rows' } };
      },
      then(res, rej) { return Promise.resolve(run()).then(res, rej); },
    };
    return b;
  }

  // Storage mínimo: las fotos subidas en el panel se sirven desde memoria en /demo-media/<bucket>/<ruta>.
  const storage = {
    async getBucket(name) { return { data: { name }, error: null }; },
    async createBucket() { return { data: {}, error: null }; },
    from(bucket) {
      return {
        async upload(path, buffer, { contentType } = {}) {
          files.set(`${bucket}/${path}`, { buffer, contentType });
          return { data: { path }, error: null };
        },
        getPublicUrl(path) { return { data: { publicUrl: `${publicBaseUrl}/demo-media/${bucket}/${path}` } }; },
      };
    },
  };

  return { data, from, storage, files };
}

export default createMemoryDb;
