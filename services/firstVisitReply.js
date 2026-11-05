import activeClinic, { findTreatments } from '../config/clinic.config.js';
import { expandColloquial } from '../config/colloquial.js';
import { evaluationPackView, PACK_INTENT } from './catalog.js';

// "¿Qué necesito, qué días tienen, cuánto cuesta empezar y cómo agendo?" → un solo mensaje ordenado en bloques,
// como en el video de referencia:
//   📋 *¿Qué necesitas llevar?*   💰 *Inversión y planes:*   📅 *¿Cómo agendamos?*
// Todo sale de la configuración (pack, precios "desde", financiamiento, pagos) y de la agenda (horarios libres
// reales). Si falta un dato, su línea no aparece: nunca se completa con algo inventado.

const NUMBER_EMOJI = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
const PAYMENT_WORDS = /\b(?:pago|pagar|tarjeta|yape|plin|efectivo|cuotas?|financ\w*)\b/i;
const formatSoles = (value) => `S/ ${Number(value).toLocaleString('es-PE')}`;

// ¿El paciente pregunta por la primera visita (requisitos, qué traer, cuánto cuesta empezar)?
// "¿Tengo que llevar radiografías?" (frase del video) también cuenta.
const BRING_INTENT = /\b(?:tengo que|debo|hay que)\s+(?:llevar|traer)\b/i;
export function asksFirstVisit(text) {
  const value = expandColloquial(text);
  return PACK_INTENT.test(value) || BRING_INTENT.test(value);
}

function packPriceLine(view) {
  if (!view.priceText && !view.promoPriceText) return null;
  if (view.promoText) {
    const discounted = view.priceText && view.promoPriceText && view.priceText !== view.promoPriceText;
    const price = discounted ? `~${view.priceText}~ *${view.promoPriceText}*` : `*${view.promoPriceText || view.priceText}*`;
    return `• ${view.title}: ${price} (${view.promoText}${view.untilText ? `, hasta el ${view.untilText}` : ''})`;
  }
  return `• ${view.title}: *${view.priceText}*`;
}

const treatmentLine = (t) => `• ${t.name}: desde *${formatSoles(t.priceFrom)}*${t.financing ? ` (${t.financing})` : ''}`;

// interestText: lo que dijo el paciente en esta conversación (para saber qué tratamientos le interesan).
export function firstVisitText({ clinic = activeClinic, today, interestText = '', messageText = '', slots = [], firstName = '' } = {}) {
  const view = evaluationPackView(clinic, today);
  if (!view || !slots?.length) return null;
  const treatments = findTreatments(expandColloquial(interestText)).filter((t) => typeof t.priceFrom === 'number').slice(0, 3);
  const money = [packPriceLine(view), ...treatments.map(treatmentLine)].filter(Boolean);
  if (PAYMENT_WORDS.test(messageText) && clinic.paymentMethods?.length) money.push(`• Medios de pago: ${clinic.paymentMethods.join(', ')}`);
  const blocks = [`¡Excelente${firstName ? `, ${firstName}` : ''}! Aquí te detallo todo para tu primera visita ✨`];
  if (view.bring) blocks.push(`📋 *¿Qué necesitas llevar?*\n• ${view.bring}`);
  if (money.length) blocks.push(`💰 *Inversión y planes:*\n${money.join('\n')}`);
  const slotLines = slots.map((slot, i) => `${NUMBER_EMOJI[i] || `${i + 1})`} ${slot.label}`);
  blocks.push(`📅 *¿Cómo agendamos?*\nElige el horario que mejor te quede:\n${slotLines.join('\n')}\n\nTócalo aquí 👇 o responde con el número.`);
  return blocks.join('\n\n');
}

// Pie corto de la tarjeta del pack cuando el detalle va en este mensaje (sin repetir lo mismo dos veces).
export const packShortCaption = (clinic = activeClinic, today) => {
  const view = evaluationPackView(clinic, today);
  if (!view) return null;
  const items = view.includes.map((item, i) => (i ? item.charAt(0).toLowerCase() + item.slice(1) : item));
  const list = items.length > 1 ? `${items.slice(0, -1).join(', ')} y ${items.at(-1)}` : items[0];
  return `🦷 *${view.title}*${list ? `: ${list}.` : ''}`;
};

export default { asksFirstVisit, firstVisitText, packShortCaption };
