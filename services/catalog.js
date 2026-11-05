import activeClinic, { findTreatments, mediaFileUrl, mediaUrl } from '../config/clinic.config.js';
import { expandColloquial } from '../config/colloquial.js';
import { formatDateEs } from './appointmentService.js';

// Catálogo visual por tratamiento (treatments[].images) y tarjeta del pack de evaluación (evaluationPack).
// Todo sale de config/clinics/<id>.js (o de lo guardado en el panel): si un dato falta, no se menciona.

const formatSoles = (value) => `S/ ${Number(value).toLocaleString('es-PE')}`;

// "¿qué necesito?", "requisitos", "cuánto cuesta empezar", "primera visita", "evaluación"…
export const PACK_INTENT = /\b(?:evaluaci[oó]n|requisitos?|qu[eé] (?:necesito|debo|tengo que) (?:llevar|traer)|qu[eé] necesito|primera (?:visita|consulta)|consulta|cu[aá]nto cuesta (?:empezar|iniciar|la consulta|la evaluaci[oó]n))\b/i;
export const BOOKING_WORDS = /\b(?:citas?|agendar|agendo|agenda|reservar|separar|turnos?|horarios?|disponibilidad|atenderme)\b/i;

// Imágenes de un tratamiento: las del catálogo o, si no tiene, la foto única de media[key].
// Devuelve [{ url, caption }].
export function treatmentImages(key, clinic = activeClinic) {
  const treatment = clinic.treatments.find((t) => t.key === key) || null;
  if (treatment?.images?.length) {
    return treatment.images.map((img) => ({ url: mediaFileUrl(img.file), caption: img.caption || `${clinic.name} 🦷` }))
      .filter((item) => item.url);
  }
  const url = mediaUrl(key);
  return url ? [{ url, caption: `${clinic.name} 🦷` }] : [];
}

// Tratamientos del mensaje que tienen catálogo propio (treatments[].images). Se envían aunque el paciente
// no pida "fotos": así lo hace una recepcionista cuando le preguntan por un tratamiento.
export function catalogKeysForMessage(text) {
  return findTreatments(text).filter((t) => t.images?.length).map((t) => t.key);
}

// Media keys ([ENVIAR_FOTO: x] o deducidas) → imágenes a enviar, sin repetir URL.
export function imagesForKeys(keys, clinic = activeClinic) {
  const seen = new Set();
  const items = [];
  for (const key of keys) {
    for (const item of treatmentImages(key, clinic)) {
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      items.push(item);
    }
  }
  return items;
}

// Promoción del pack vigente hoy (fecha de fin incluida). Una vencida no se menciona nunca.
export function activePackPromotion(pack, today) {
  const promo = pack?.promotion;
  if (!promo?.text) return null;
  if (promo.validUntil && promo.validUntil < today) return null;
  return promo;
}

// Pack listo para mostrar: { title, includes, priceText, promoText, untilText, bring } o null si no hay pack.
export function evaluationPackView(clinic = activeClinic, today) {
  const pack = clinic.evaluationPack;
  if (!pack?.title || !pack.includes?.length) return null;
  const promo = activePackPromotion(pack, today);
  const priceText = typeof pack.price === 'number' ? (pack.price === 0 ? 'Sin costo' : formatSoles(pack.price)) : null;
  const promoPrice = typeof promo?.price === 'number' ? (promo.price === 0 ? 'Sin costo' : formatSoles(promo.price)) : null;
  return {
    title: pack.title,
    includes: pack.includes,
    priceText,
    promoText: promo ? promo.text : null,
    promoPriceText: promoPrice,
    untilText: promo?.validUntil ? formatDateEs(promo.validUntil) : null,
    bring: pack.bring || null,
  };
}

// Texto de la tarjeta (pie de la imagen o mensaje solo si no hay imagen).
export function evaluationPackText(clinic = activeClinic, today) {
  const view = evaluationPackView(clinic, today);
  if (!view) return null;
  const lines = [`🦷 *${view.title}*`, 'Incluye:', ...view.includes.map((item) => `✅ ${item}`)];
  if (view.promoText) {
    const discounted = view.priceText && view.promoPriceText && view.priceText !== view.promoPriceText;
    const price = discounted ? `~${view.priceText}~ *${view.promoPriceText}*` : view.promoPriceText || view.priceText;
    lines.push(`💰 ${price ? `${price} · ` : ''}${view.promoText}${view.untilText ? ` (hasta el ${view.untilText})` : ''}`);
  } else if (view.priceText) {
    lines.push(`💰 ${view.priceText}`);
  }
  if (view.bring) lines.push(`📋 ${view.bring}`);
  return lines.join('\n');
}

// Bloque del prompt: Gemini solo puede repetir estos datos del pack.
export function evaluationPackPrompt(clinic = activeClinic, today) {
  const view = evaluationPackView(clinic, today);
  if (!view) return '';
  const price = view.promoText
    ? `${view.promoPriceText || view.priceText || ''} (${view.promoText}${view.untilText ? `, hasta el ${view.untilText}` : ''})${view.priceText && view.promoPriceText && view.priceText !== view.promoPriceText ? `; precio regular ${view.priceText}` : ''}`
    : view.priceText || 'consultar en recepción';
  return `\n- Pack de primera visita "${view.title}": incluye ${view.includes.join(', ')}. Precio: ${price}.${view.bring ? ` Qué traer: ${view.bring}.` : ''} El sistema envía la tarjeta del pack sola; tú no la repitas completa.`;
}

// ¿Toca mostrar el pack? Pregunta por requisitos/evaluación/primera visita o quiere agendar.
export function wantsEvaluationPack(text) {
  const value = expandColloquial(text);
  return PACK_INTENT.test(value) || BOOKING_WORDS.test(value);
}

export default {
  treatmentImages, catalogKeysForMessage, imagesForKeys, evaluationPackView, evaluationPackText, evaluationPackPrompt, wantsEvaluationPack,
};
