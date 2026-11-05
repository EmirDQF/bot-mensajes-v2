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
  // Solo montos: campos de precio y cifras escritas después de "S/" en los textos de la configuración. Así una fecha
  // (2026), una duración (60 min) o un conteo nunca cuentan como un precio permitido.
  const numbers = new Set();
  const add = (value) => { if (typeof value === 'number' && Number.isFinite(value)) numbers.add(value); };
  const fromText = (value) => {
    for (const m of JSON.stringify(value ?? '').matchAll(/S\/\s*([\d][\d.,]*)/g)) numbers.add(parseSoles(m[1]));
  };
  for (const t of clinic.treatments || []) { add(Number(t.priceFrom)); fromText(t.financing); fromText(t.description); }
  add(clinic.evaluationPack?.price);
  add(clinic.evaluationPack?.promotion?.price);
  fromText(clinic.evaluationPack);
  fromText(clinic.campaign);
  fromText(clinic.faq);
  fromText(clinic.financingText);
  fromText(clinic.paymentMethods);
  fromText(activePromotions(today, clinic));
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
