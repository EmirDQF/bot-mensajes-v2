import { AsyncLocalStorage } from 'async_hooks';

// Modo prueba del Probador del panel: el MISMO flujo real (debounce, Gemini, agenda, bandeja), pero
// dentro de este contexto WhatsApp es falso, la hora puede ser simulada y todo lo guardado queda
// marcado como prueba (is_test). El contexto viaja con la ejecución (también por el debounce), así que
// las conversaciones reales que llegan al mismo tiempo no se ven afectadas.

const storage = new AsyncLocalStorage();

// Números del Probador: 5100000XXXX no es un celular peruano válido, así que nunca choca con un paciente.
export const TEST_PHONE_PREFIX = '5100000';
export const isTestPhone = (phone) => String(phone || '').replace(/\D/g, '').startsWith(TEST_PHONE_PREFIX);

// options: { clockOffsetMs, onSend(to, payload) }
export function runInTestMode(options, fn) {
  return storage.run({ isTest: true, ...options }, fn);
}

export function testMode() {
  return storage.getStore() || null;
}

export default testMode;
