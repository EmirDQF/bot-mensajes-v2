// Salida de Gemini: motivo de fin (finishReason) y recorte seguro cuando el modelo se quedó sin tokens.
// Nunca se envía media frase al paciente ("tenemos una campaña con cu").

// "STOP", "MAX_TOKENS", "SAFETY"… o null si el cliente no lo informa (clientes de prueba).
export function getFinishReason(result) {
  const candidates = result?.response?.candidates || result?.candidates;
  return candidates?.[0]?.finishReason || result?.finishReason || null;
}

export const isTruncated = (finishReason) => finishReason === 'MAX_TOKENS';

// Fin de oración: . ! ? … (con comillas o paréntesis de cierre) o un emoji al final del texto.
const SENTENCE_END = /[.!?…]["»”')\]]*(?=\s|$)/gu;
const ENDS_WITH_EMOJI = /\p{Extended_Pictographic}️?\s*$/u;

// Devuelve el texto hasta la última oración completa ('' si no queda ninguna).
export function trimToLastSentence(text) {
  const value = String(text || '').trim();
  if (!value) return '';
  if (ENDS_WITH_EMOJI.test(value) || /[.!?…]["»”')\]]*$/u.test(value)) return value;
  let end = -1;
  for (const match of value.matchAll(SENTENCE_END)) end = match.index + match[0].length;
  return end > 0 ? value.slice(0, end).trim() : '';
}

export default { getFinishReason, isTruncated, trimToLastSentence };
