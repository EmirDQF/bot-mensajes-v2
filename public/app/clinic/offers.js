import { h, clear } from '../dom.js';
import {
  area, check, csv, field, lines, livePreview, number, orderButtons, section, select, slug, text, today,
} from './ui.js';

// Mi clínica → Pack de evaluación (con vista previa), campaña y promociones (inicio y fin), pagos, preguntas
// frecuentes, reglas de recomendación, respuestas rápidas y frases prohibidas.

export function packSection(c) {
  const p = c.evaluationPack || {};
  const title = text(p.title || '', { maxlength: 60, placeholder: 'Evaluación digital 3D' });
  const includes = area((p.includes || []).join('\n'), { rows: 4, placeholder: 'Radiografía panorámica\nEscaneo intraoral 3D\nPlan de tratamiento' });
  const price = number(p.price ?? '', { min: 0, step: 1, placeholder: '50' });
  const promoText = text(p.promotion?.text || '', { maxlength: 80, placeholder: 'Precio de campaña' });
  const promoPrice = number(p.promotion?.price ?? '', { min: 0, step: 1, placeholder: '0' });
  const promoUntil = h('input', { type: 'date', value: p.promotion?.validUntil || '' });
  const bring = text(p.bring || '', { maxlength: 120, placeholder: 'Solo trae tu DNI.' });
  const collectPack = () => {
    if (!title.value.trim()) return null;
    return {
      title: title.value.trim(),
      includes: lines(includes.value).slice(0, 6),
      ...(price.value !== '' ? { price: Number(price.value) } : {}),
      ...(promoText.value.trim() ? {
        promotion: {
          text: promoText.value.trim(),
          ...(promoPrice.value !== '' ? { price: Number(promoPrice.value) } : {}),
          ...(promoUntil.value ? { validUntil: promoUntil.value } : {}),
        },
      } : {}),
      ...(bring.value.trim() ? { bring: bring.value.trim() } : {}),
    };
  };
  return section({
    id: 'pack', title: '🎫 Pack de evaluación (primera visita)',
    fields: ['evaluationPack'],
    tryMessage: '¿qué necesito llevar y cuánto cuesta la evaluación?',
    body: [
      h('p', { class: 'muted' }, 'La asistente envía esta tarjeta una vez por conversación cuando preguntan por la evaluación, los requisitos o quieren agendar. Solo con estos datos: nunca inventa precios.'),
      field('Nombre del pack', title), field('Qué incluye (uno por línea, máximo 6)', includes),
      h('div', { class: 'grid-2' }, field('Precio regular (S/; 0 = sin costo)', price), field('Qué traer', bring)),
      h('div', { class: 'grid-3' }, field('Promoción', promoText), field('Precio con promoción (S/)', promoPrice), field('Promoción válida hasta', promoUntil, 'Al vencer deja de mencionarse.')),
      livePreview('pack', () => ({ evaluationPack: collectPack(), colors: c.colors, name: c.name }), 'Vista previa de la tarjeta del pack'),
    ],
    collect: () => ({ evaluationPack: collectPack() }),
  });
}

export function promotionsSection(c) {
  const items = (c.promotions || []).map((p) => ({ ...p }));
  const campaign = { ...(c.campaign || {}) };
  const box = h('div', { class: 'rows' });
  const draw = () => clear(box, items.length ? items.map((p, i) => {
    const expired = p.validUntil && p.validUntil < today();
    const upcoming = p.validFrom && p.validFrom > today();
    const active = check(p.active !== false);
    active.addEventListener('change', () => { p.active = active.checked; });
    const title = text(p.title || '', { maxlength: 120 });
    title.addEventListener('input', () => { p.title = title.value; });
    const desc = area(p.description || '', { rows: 2, maxlength: 400 });
    desc.addEventListener('input', () => { p.description = desc.value; });
    const from = h('input', { type: 'date', value: p.validFrom || '' });
    from.addEventListener('change', () => { p.validFrom = from.value || null; draw(); });
    const until = h('input', { type: 'date', value: p.validUntil || '' });
    until.addEventListener('change', () => { p.validUntil = until.value || null; draw(); });
    return h('div', { class: 'row' },
      h('div', { class: 'row__head' }, h('label', { class: 'field--inline field' }, active, 'Activa'),
        expired ? h('span', { class: 'badge badge--cancelada' }, 'Vencida: la asistente no la menciona') : null,
        upcoming ? h('span', { class: 'badge' }, 'Todavía no empieza') : null,
        orderButtons(items, i, draw, `la promoción ${p.title || i + 1}`)),
      field('Título', title),
      h('div', { class: 'grid-2' }, field('Desde', from, 'Vacío = desde ya.'), field('Hasta (inclusive)', until, 'Vacío = sin fecha de fin.')),
      field('Detalle', desc));
  }) : h('p', { class: 'muted' }, 'Sin promociones. La campaña de arriba se menciona siempre.'));
  draw();
  const campaignInputs = Object.entries({ evaluation: 'Evaluación', initialFee: 'Cuota inicial', installments: 'Cuotas' })
    .map(([key, label]) => { const n = text(campaign[key] || ''); n.addEventListener('input', () => { campaign[key] = n.value; }); return field(label, n); });
  return section({
    id: 'promotions', title: '🎁 Campaña y promociones (con fecha de inicio y de fin)',
    fields: ['promotions', 'campaign'],
    tryMessage: '¿tienen alguna promoción?',
    body: [h('div', { class: 'grid-3' }, campaignInputs), box,
      h('button', { type: 'button', class: 'btn btn--small', onclick: () => { items.push({ title: '', description: '', validFrom: null, validUntil: null, active: true }); draw(); } }, '+ Agregar promoción')],
    collect: () => ({
      campaign: Object.fromEntries(Object.entries(campaign).map(([k, v]) => [k, String(v || '').trim()]).filter(([, v]) => v)),
      promotions: items.filter((p) => p.title?.trim()).map((p) => ({
        title: p.title.trim(), ...(p.description?.trim() ? { description: p.description.trim() } : {}),
        ...(p.validFrom ? { validFrom: p.validFrom } : {}), validUntil: p.validUntil || null, active: p.active !== false,
      })),
    }),
  });
}

export function paymentsSection(c) {
  const methods = area((c.paymentMethods || []).join('\n'), { rows: 4, placeholder: 'Tarjeta de crédito y débito\nYape y Plin\nEfectivo' });
  const financing = area(c.financingText || '', { rows: 2, maxlength: 300 });
  return section({
    id: 'payments', title: '💳 Medios de pago y financiamiento',
    fields: ['paymentMethods', 'financingText'],
    tryMessage: '¿aceptan Yape? ¿puedo pagar en cuotas?',
    body: [field('Medios de pago (uno por línea)', methods), field('Financiamiento', financing)],
    collect: () => ({ paymentMethods: lines(methods.value), ...(financing.value.trim() ? { financingText: financing.value.trim() } : {}) }),
  });
}

export function faqSection(c) {
  const items = (c.faq || []).map((f) => ({ ...f }));
  const box = h('div', { class: 'rows' });
  const draw = () => clear(box, items.map((f, i) => {
    const q = text(f.q, { maxlength: 300 });
    q.addEventListener('input', () => { f.q = q.value; });
    const a = area(f.a, { rows: 2, maxlength: 1000 });
    a.addEventListener('input', () => { f.a = a.value; });
    return h('div', { class: 'row' }, field('Pregunta', q), field('Respuesta', a), orderButtons(items, i, draw, `la pregunta ${i + 1}`));
  }));
  draw();
  return section({
    id: 'faq', title: '❓ Preguntas frecuentes',
    fields: ['faq'],
    tryMessage: '¿hay estacionamiento?',
    body: [box, h('button', { type: 'button', class: 'btn btn--small', onclick: () => { items.push({ q: '', a: '' }); draw(); } }, '+ Agregar pregunta')],
    collect: () => ({ faq: items.filter((f) => f.q?.trim() && f.a?.trim()).map((f) => ({ q: f.q.trim(), a: f.a.trim() })) }),
  });
}

export function rulesSection(c) {
  const items = (c.recommendationRules || []).map((r) => ({ ...r, triggers: [...(r.triggers || [])] }));
  const box = h('div', { class: 'rows' });
  const treatmentOptions = [['', '— Ninguno —'], ...c.treatments.map((t) => [t.key, t.name])];
  const draw = () => clear(box, items.map((r, i) => {
    const triggers = text(r.triggers.join(', '));
    triggers.addEventListener('input', () => { r.triggers = csv(triggers.value); });
    const evaluation = text(r.evaluation || '', { maxlength: 120 });
    evaluation.addEventListener('input', () => { r.evaluation = evaluation.value; });
    const treatment = select(r.treatmentKey || '', treatmentOptions);
    treatment.addEventListener('change', () => { r.treatmentKey = treatment.value || null; });
    const question = text(r.question || '', { maxlength: 200 });
    question.addEventListener('input', () => { r.question = question.value; });
    return h('div', { class: 'row' },
      field('Si el paciente dice… (separado por comas)', triggers),
      h('div', { class: 'grid-2' }, field('Se recomienda una EVALUACIÓN de…', evaluation), field('Tratamiento (precio "desde")', treatment)),
      field('Pregunta para calificar (opcional)', question, 'Ej.: "¿Para qué fecha es tu evento?"'),
      orderButtons(items, i, draw, `la regla ${i + 1}`));
  }));
  draw();
  return section({
    id: 'rules', title: '🎯 Reglas de recomendación (sin diagnosticar)',
    fields: ['recommendationRules'],
    tryMessage: 'tengo los dientes chuecos',
    body: [h('p', { class: 'muted' }, 'La asistente dice "por lo que me cuentas, lo indicado es una EVALUACIÓN de…; el doctor confirma el mejor tratamiento". Dolor fuerte, hinchazón, fiebre o golpe siempre pasan primero a urgencia.'),
      box, h('button', { type: 'button', class: 'btn btn--small', onclick: () => { items.push({ id: `regla_${Date.now()}`, triggers: [], evaluation: '', treatmentKey: null }); draw(); } }, '+ Agregar regla')],
    collect: () => ({
      recommendationRules: items.filter((r) => r.triggers.length && r.evaluation?.trim()).map((r) => ({
        id: r.id || slug(r.evaluation), triggers: r.triggers, evaluation: r.evaluation.trim(),
        ...(r.treatmentKey ? { treatmentKey: r.treatmentKey } : {}), ...(r.question?.trim() ? { question: r.question.trim() } : {}),
        ...(r.priority ? { priority: r.priority } : {}),
      })),
    }),
  });
}

export function listSection({ id, title, fieldName, value, hint, tryMessage }) {
  const input = area((value || []).join('\n'), { rows: 5 });
  return section({
    id, title, fields: [fieldName], tryMessage,
    body: [field('Una por línea', input, hint)],
    collect: () => ({ [fieldName]: lines(input.value) }),
  });
}

