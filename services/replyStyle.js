// Forma final de la respuesta de la asistente: tope de emojis según la clínica (emojiLevel) y cierre con una
// pregunta o un siguiente paso. Es el respaldo determinista de lo que el prompt ya pide.

export const EMOJI_LIMITS = { ninguno: 0, pocos: 1, normal: 3 };

// Un emoji con sus variantes (tono de piel, ZWJ, selector de variación) cuenta como uno.
const EMOJI = /\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier}|‍\p{Extended_Pictographic}️?)*/gu;

export function limitEmojis(text, max = EMOJI_LIMITS.pocos) {
  let seen = 0;
  return String(text || '')
    .replace(EMOJI, (emoji) => (seen++ < max ? emoji : ''))
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([.,!?])/g, '$1')
    .replace(/[ \t]+$/gm, '')
    .trim();
}

// Si la respuesta no tiene ninguna pregunta, se agrega el siguiente paso (p. ej. "¿Te propongo horarios?").
export function ensureNextStep(text, nextStep) {
  const value = String(text || '').trim();
  if (!value || !nextStep || value.includes('?')) return value;
  return `${value} ${nextStep}`;
}

export default { EMOJI_LIMITS, limitEmojis, ensureNextStep };
