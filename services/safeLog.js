// Resumen de un error apto para el log: código y mensaje, sin "details" ni "hint" (PostgREST copia ahí
// la fila que falló, con el teléfono y los mensajes del paciente) y con los números largos enmascarados.

const LONG_NUMBER = /\d{7,}/g;
const MAX_LOG_CHARS = 500;

export const maskDigits = (text) => String(text ?? '').replace(LONG_NUMBER, (digits) => `***${digits.slice(-4)}`);

export function describeError(error) {
  if (!error) return 'error desconocido';
  if (typeof error !== 'object') return maskDigits(error).slice(0, MAX_LOG_CHARS);
  const code = error.code || error.status;
  const message = error.message || error.name || 'error sin mensaje';
  return maskDigits(`${code ? `[${code}] ` : ''}${message}`).slice(0, MAX_LOG_CHARS);
}

export default describeError;
