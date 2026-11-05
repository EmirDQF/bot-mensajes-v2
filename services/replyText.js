// Limpieza del texto que devuelve Gemini antes de enviarlo por WhatsApp.

const TEXT_KEYS = ['content', 'respuesta', 'response', 'texto', 'text', 'message'];

function textFromParsed(parsed) {
  for (const key of TEXT_KEYS) {
    const value = parsed?.[key];
    if (value === undefined || value === null) continue;
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'object') {
      const nested = extractPlainText(value);
      if (nested && nested.trim()) return nested.trim();
    }
  }
  if (Array.isArray(parsed)) {
    const arrayText = parsed.map((item) => extractPlainText(item)).filter(Boolean).join(' ');
    if (arrayText) return arrayText;
  }
  if (parsed && typeof parsed === 'object') {
    const traversed = Object.values(parsed).map((value) => extractPlainText(value)).filter(Boolean).join(' ').trim();
    if (traversed) return traversed;
  }
  return null;
}

// Si el modelo respondió con JSON ({"respuesta": "..."}) o con bloques ```, devuelve solo el texto.
export function extractPlainText(input) {
  let cleaned = typeof input === 'string' ? input : JSON.stringify(input);
  cleaned = cleaned.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  const looksJson = (cleaned.startsWith('{') && cleaned.endsWith('}')) || (cleaned.startsWith('[') && cleaned.endsWith(']'));
  if (!looksJson) return cleaned;
  try {
    const parsed = JSON.parse(cleaned);
    return (parsed && textFromParsed(parsed)) || cleaned;
  } catch (e) {
    const malformedPrefixMatch = cleaned.match(/^\s*\{\s*"(?:content|respuesta|response|texto|text|message)"\s*:\s*"?(.*)$/i);
    if (malformedPrefixMatch && malformedPrefixMatch[1]) {
      return malformedPrefixMatch[1].replace(/\}?\s*$/, '').replace(/^"/, '').trim();
    }
    const match = cleaned.match(/"(?:content|respuesta|response|texto|text|message)"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/i);
    return match && match[1] ? match[1].trim() : cleaned;
  }
}

// Quita etiquetas de instrucciones que el paciente nunca debe ver.
export function stripInstructionTags(text) {
  return String(text || '')
    .replace(/\[\s*(?:ENVIAR[_ ]?(?:FOTO|IMAGEN)|FOTO|IMAGEN)\s*:[^\]]+\]/gi, '')
    .replace(/\[AGENDAR_CITA:\{.*?\}\]/gi, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export default { extractPlainText, stripInstructionTags };
