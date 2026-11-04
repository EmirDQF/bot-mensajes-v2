// Map en memoria con vencimiento (TTL) y tope de entradas: para cachés por paciente que, sin límite,
// crecerían con cada número nuevo mientras el proceso siga vivo. Cada set() renueva la entrada.

const DEFAULT_MAX_ENTRIES = 5000;

export function createExpiringMap({ ttlMs, maxEntries = DEFAULT_MAX_ENTRIES, now = () => Date.now() } = {}) {
  if (!(ttlMs > 0)) throw new Error('createExpiringMap necesita ttlMs > 0');
  const entries = new Map();
  const isFresh = (entry) => now() - entry.at < ttlMs;

  // Map conserva el orden de inserción: las entradas más antiguas están al principio.
  function prune() {
    for (const [key, entry] of entries) {
      if (entries.size <= maxEntries && isFresh(entry)) break;
      entries.delete(key);
    }
  }

  function has(key) {
    const entry = entries.get(key);
    if (!entry) return false;
    if (isFresh(entry)) return true;
    entries.delete(key);
    return false;
  }

  return {
    has,
    get: (key) => (has(key) ? entries.get(key).value : undefined),
    set(key, value) {
      entries.delete(key);
      entries.set(key, { value, at: now() });
      prune();
      return this;
    },
    delete: (key) => entries.delete(key),
    get size() { return entries.size; },
  };
}

export default createExpiringMap;
