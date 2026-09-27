import { findTreatment, resolveMediaKey } from '../config/clinic.config.js';

// Acepta [ENVIAR_FOTO: x], [ENVIAR_IMAGEN: x], sus variantes sin "_" o con espacio, y [FOTO: x].
// Cada etiqueta puede traer varias categorías separadas por comas.
const PHOTO_TAG = /\[\s*(?:ENVIAR[_ ]?(?:FOTO|IMAGEN)|FOTO|IMAGEN)\s*:\s*([^\]]+)\]/gi;
const PHOTO_INTENT = /\b(fotos?|im[aá]genes?|resultados?|antes\s*y\s*despu[eé]s|mostrar|ense[nñ]ar|ver)\b/i;
const PLACE_INTENT = /\b(ubicaci[oó]n|direcci[oó]n|d[oó]nde\s+(?:est[aá]n|quedan?)|mapa|croquis)\b/i;
const FACADE_INTENT = /\b(fachada|local|consultorio|instalaciones)\b/i;

// Lee las etiquetas del texto CRUDO del modelo (antes de sanitizeModelTextOutput) y devuelve
// las claves de clinic.media en orden, sin duplicados, junto al texto sin etiquetas.
export function extractPhotoTags(rawText) {
  const text = String(rawText || '');
  const keys = [];
  for (const match of text.matchAll(PHOTO_TAG)) {
    for (const category of match[1].split(',')) {
      const key = resolveMediaKey(category);
      if (key && !keys.includes(key)) keys.push(key);
    }
  }
  const cleaned = text.replace(PHOTO_TAG, '').replace(/[ \t]{2,}/g, ' ').trim();
  return { keys, cleaned };
}

// Si el paciente pidió fotos explícitamente y el modelo no puso etiqueta, deduce la categoría.
export function inferPhotoKeyFromMessage(messageText) {
  const text = String(messageText || '');
  if (PLACE_INTENT.test(text)) return resolveMediaKey('ubicacion');
  if (FACADE_INTENT.test(text)) return resolveMediaKey('fachada');
  if (!PHOTO_INTENT.test(text)) return null;
  const treatment = findTreatment(text);
  return treatment ? resolveMediaKey(treatment.key) : null;
}

export default { extractPhotoTags, inferPhotoKeyFromMessage };
