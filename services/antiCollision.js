// Simple in-process anti-collision lock for appointment slots
// Note: This is an in-memory lock and only works for a single instance. For production, use Redis or another distributed lock.

const locks = new Map(); // slotKey -> timeoutId

function normalizeSlotKey(slotKey) {
  return String(slotKey || '').trim();
}

export function acquireSlot(slotKey, ttlMs = 60 * 1000) {
  const key = normalizeSlotKey(slotKey);
  if (!key) return false;
  if (locks.has(key)) return false;

  // create a timeout to auto-release
  const timeout = setTimeout(() => {
    locks.delete(key);
  }, ttlMs);
  // avoid preventing node from exiting
  if (timeout.unref) timeout.unref();

  locks.set(key, timeout);
  return true;
}

export function releaseSlot(slotKey) {
  const key = normalizeSlotKey(slotKey);
  if (!key) return false;
  const t = locks.get(key);
  if (t) {
    clearTimeout(t);
    locks.delete(key);
    return true;
  }
  return false;
}

export function isSlotLocked(slotKey) {
  const key = normalizeSlotKey(slotKey);
  return locks.has(key);
}

export default { acquireSlot, releaseSlot, isSlotLocked };