import { activePromotions, activeTreatments, findTreatment } from '../config/clinic.config.js';

// Respuestas sin IA para las preguntas más comunes (precio, ubicación, horario, campaña y formas de pago),
// solo con los datos de config/clinics/<id>.js. Se usan cuando Gemini no responde, antes del aviso genérico.
// Nunca inventan: si la clínica no tiene el dato configurado, esa parte no se responde.

const formatSoles = (value) => `S/ ${Number(value).toLocaleString('es-PE')}`;

const INTENTS = {
  precio: /\b(?:precios?|cu[aá]nto|cuesta|costo|valor|tarifa|inicial)\b/i,
  ubicacion: /\b(?:d[oó]nde|direcci[oó]n|ubicaci[oó]n|ubicad[oa]s?|quedan?|c[oó]mo llego|local|sede|mapa)\b/i,
  horario: /\b(?:horarios?|atienden|abren|cierran|hasta qu[eé] hora|qu[eé] d[ií]as)\b/i,
  campana: /\b(?:promo(?:ci[oó]n|ciones)?|campa[nñ]a|descuentos?|ofertas?)\b/i,
  pago: /\b(?:pagos?|pagar|tarjetas?|yape|plin|efectivo|cuotas?|financ\w*|transferencia)\b/i,
};

function priceAnswer(text, clinic) {
  const treatment = findTreatment(text);
  if (treatment) {
    return `${treatment.name}: desde ${formatSoles(treatment.priceFrom)}${treatment.financing ? ` (${treatment.financing})` : ''}. El costo exacto lo define el doctor en la evaluación.`;
  }
  const list = activeTreatments(clinic).slice(0, 4).map((t) => `• ${t.name}: desde ${formatSoles(t.priceFrom)}`);
  return list.length ? `Nuestros precios de referencia:\n${list.join('\n')}\nEl costo exacto lo define el doctor en la evaluación.` : null;
}

function locationAnswer(clinic) {
  const reference = clinic.addressReference ? ` (${clinic.addressReference})` : '';
  return `Estamos en ${clinic.address}${reference}. Ubicación en el mapa: ${clinic.mapsUrl}`;
}

function campaignAnswer(clinic, today) {
  const items = [
    ...Object.values(clinic.campaign || {}).filter(Boolean),
    ...activePromotions(today, clinic).map((p) => p.title),
  ];
  return items.length ? `Este mes tenemos: ${items.join(' · ')}.` : null;
}

function paymentAnswer(clinic) {
  const items = [...(clinic.paymentMethods || []), clinic.financingText].filter(Boolean);
  return items.length ? `Puedes pagar con: ${items.join(' · ')}.` : null;
}

// Devuelve { text, kinds } o null si el mensaje no es una pregunta común o la clínica no tiene el dato.
export function quickAnswer(message, { clinic, today }) {
  const text = String(message || '');
  if (!text.trim() || !clinic) return null;
  const builders = {
    precio: () => (INTENTS.precio.test(text) || (findTreatment(text) && /\?/.test(text)) ? priceAnswer(text, clinic) : null),
    ubicacion: () => (INTENTS.ubicacion.test(text) ? locationAnswer(clinic) : null),
    horario: () => (INTENTS.horario.test(text) && clinic.workingHoursText ? `Nuestro horario: ${clinic.workingHoursText}` : null),
    campana: () => (INTENTS.campana.test(text) ? campaignAnswer(clinic, today) : null),
    pago: () => (INTENTS.pago.test(text) ? paymentAnswer(clinic) : null),
  };
  const parts = [];
  const kinds = [];
  for (const [kind, build] of Object.entries(builders)) {
    const part = build();
    if (part) { parts.push(/[.!?]$|https?:\/\/\S+$/.test(part) ? part : `${part}.`); kinds.push(kind); }
  }
  if (!parts.length) return null;
  return { text: `${parts.join('\n\n')}\n\n¿Te propongo horarios para tu evaluación?`, kinds };
}

export default quickAnswer;
