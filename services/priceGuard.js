import { activePromotions } from '../config/clinic.config.js';

// Freno final contra precios inventados (regla: "nunca inventar precios"). Toda cifra "S/ …" de la respuesta del
// modelo debe existir en la configuración de la clínica; si no, se quita la frase que la contiene.

// "1,800" / "1.800" → 1800; "1,50" → 1.5 (decimal: nunca es un precio configurado).
export function parseSoles(raw) {
  const value = String(raw || '').replace(/[.,]$/, '');
  if (/^\d{1,3}(?:[.,]\d{3})+$/.test(value)) return Number(value.replace(/[.,]/g, ''));
  return Number(value.replace(',', '.'));
}

export function configuredAmounts(clinic, today) {
  const numbers = new Set();
  const collect = (value) => {
    for (const m of JSON.stringify(value ?? '').replace(/(\d)[.,](\d{3})/g, '$1$2').matchAll(/\d+(?:\.\d+)?/g)) numbers.add(Number(m[0]));
  };
  for (const t of clinic.treatments || []) { numbers.add(Number(t.priceFrom)); collect(t.financing); collect(t.description); }
  collect(clinic.campaign);
  collect(clinic.faq);
  collect(clinic.evaluationPack);
  collect(clinic.financingText);
  collect(clinic.paymentMethods);
  collect(activePromotions(today, clinic));
  return numbers;
}

const PRICE = /S\/\s*([\d][\d.,]*)/g;

export function unconfiguredPrices(text, clinic, today) {
  const allowed = configuredAmounts(clinic, today);
  return [...String(text || '').matchAll(PRICE)].map((m) => m[1]).filter((raw) => !allowed.has(parseSoles(raw)));
}

// Devuelve { text, replaced }. Quita las frases con montos que no existen; si no queda nada, usa `fallback`.
export function guardPrices(text, { clinic, today, fallback = null }) {
  const invented = unconfiguredPrices(text, clinic, today);
  if (!invented.length) return { text, replaced: false };
  const sentences = String(text).split(/(?<=[.!?])\s+/);
  const kept = sentences.filter((s) => !unconfiguredPrices(s, clinic, today).length).join(' ').trim();
  return { text: kept || fallback || 'El precio exacto te lo confirma el doctor en la evaluación. ¿Te propongo horarios?', replaced: true, invented };
}

export default { guardPrices, unconfiguredPrices, parseSoles };
