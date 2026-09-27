// Supabase falso multi-tabla con los filtros que usan los servicios.
export function fakeDb(tables = {}, { uniqueOn = {} } = {}) {
  const data = Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.map((r) => ({ ...r }))]));
  const log = [];
  return {
    data,
    log,
    from(table) {
      data[table] ||= [];
      const state = { op: 'select', filters: [], payload: null };
      const rows = () => data[table].filter((r) => state.filters.every((f) => f(r)));
      const run = () => {
        log.push([table, state.op, state.payload]);
        if (state.op === 'insert') {
          for (const row of state.payload) {
            const key = uniqueOn[table];
            if (key && data[table].some((r) => key.every((k) => r[k] === row[k]))) return { data: null, error: { code: '23505', message: 'duplicate' } };
            data[table].push({ ...row });
          }
          return { data: state.payload, error: null };
        }
        if (state.op === 'upsert') {
          const [key] = state.conflict;
          const existing = data[table].find((r) => r[key] === state.payload[key]);
          if (existing) Object.assign(existing, state.payload); else data[table].push({ ...state.payload });
          return { data: [state.payload], error: null };
        }
        if (state.op === 'delete') { const match = rows(); data[table] = data[table].filter((r) => !match.includes(r)); return { data: match, error: null }; }
        if (state.op === 'update') { const match = rows(); match.forEach((r) => Object.assign(r, state.payload)); return { data: match, error: null }; }
        let list = rows();
        if (state.sort) { const [c, asc] = state.sort; list = [...list].sort((x, y) => (x[c] > y[c] ? 1 : -1) * (asc ? 1 : -1)); }
        if (state.range) list = list.slice(state.range[0], state.range[1] + 1);
        return { data: list, error: null };
      };
      const b = {
        select() { return b; },
        insert(p) { state.op = 'insert'; state.payload = p; return b; },
        update(p) { state.op = 'update'; state.payload = p; return b; },
        delete() { state.op = 'delete'; return b; },
        upsert(p, opts) { state.op = 'upsert'; state.payload = p; state.conflict = [opts.onConflict]; return b; },
        eq(c, v) { state.filters.push((r) => r[c] === v); return b; },
        in(c, v) { state.filters.push((r) => v.includes(r[c])); return b; },
        gte(c, v) { state.filters.push((r) => r[c] >= v); return b; },
        lte(c, v) { state.filters.push((r) => r[c] <= v); return b; },
        lt(c, v) { state.filters.push((r) => r[c] < v); return b; },
        gt(c, v) { state.filters.push((r) => r[c] > v); return b; },
        is(c, v) { state.filters.push((r) => (v === null ? r[c] == null : r[c] === v)); return b; },
        not(c, op, v) { state.filters.push((r) => (op === 'is' && v === null ? r[c] != null : r[c] !== v)); return b; },
        order(c, { ascending = true } = {}) { state.sort = [c, ascending]; return b; },
        limit() { return b; },
        range(start, end) { state.range = [start, end]; return b; },
        async maybeSingle() {
          const out = run();
          let list = out.data || [];
          if (state.sort) { const [c, asc] = state.sort; list = [...list].sort((x, y) => (x[c] > y[c] ? 1 : -1) * (asc ? 1 : -1)); }
          return { data: list[0] ?? null, error: out.error };
        },
        async single() { const out = run(); return { data: out.data?.[0] ?? null, error: out.error }; },
        then(res, rej) { return Promise.resolve(run()).then(res, rej); },
      };
      return b;
    },
  };
}

export default fakeDb;
