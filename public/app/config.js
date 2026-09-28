import api from './api.js';
import { $, h, clear, loading, failure, toast } from './dom.js';

// Pestaña ⚙️ Configuración (solo el dueño): todo lo que dice y ofrece la asistente, sin código ni redeploy.
// Cada sección guarda, restaura sus valores base o se prueba en el Probador.

const DAYS = [['mon', 'Lunes'], ['tue', 'Martes'], ['wed', 'Miércoles'], ['thu', 'Jueves'], ['fri', 'Viernes'], ['sat', 'Sábado'], ['sun', 'Domingo']];
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
let snap = null;

const lines = (text) => String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
const csv = (text) => String(text || '').split(',').map((l) => l.trim()).filter(Boolean);
const slug = (text) => String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);

function field(label, input, hint = '') {
  return h('label', { class: 'field' }, h('span', {}, label), input, hint ? h('small', {}, hint) : null);
}
const text = (value, attrs = {}) => h('input', { type: 'text', value: value ?? '', ...attrs });
const area = (value, attrs = {}) => { const node = h('textarea', attrs); node.value = value ?? ''; return node; };
const select = (value, options) => {
  const node = h('select', {}, options.map(([v, label]) => h('option', { value: v }, label)));
  node.value = value;
  return node;
};
const check = (checked) => { const node = h('input', { type: 'checkbox' }); node.checked = Boolean(checked); return node; };

// ---------- Carga ----------
export async function loadConfig() {
  const root = $('#view-config');
  clear(root, loading('Cargando configuración…'));
  try {
    snap = await api('/settings');
    render();
  } catch (error) {
    clear(root, failure(error.message));
  }
}

function isOverridden(fields) {
  return fields.some((f) => f in (snap.overrides || {}));
}

// Tarjeta de sección con Guardar / Probar / Restaurar.
function section({ id, title, fields, body, collect, tryMessage, open = false }) {
  const errors = h('ul', { class: 'error-list', role: 'alert' });
  const status = h('span', { class: 'muted' }, isOverridden(fields) ? '✏️ Cambiado desde el panel' : 'Valores base');
  async function save({ thenTry = false } = {}) {
    clear(errors);
    try {
      snap = await api('/settings', { method: 'PUT', body: { changes: collect() } });
      toast('Cambios guardados. La asistente ya responde con ellos.', 'ok');
      render(id);
      if (thenTry) goToTester(tryMessage);
    } catch (error) {
      clear(errors, (error.body?.errors || [error.message]).map((e) => h('li', {}, e)));
      toast(error.message, 'error');
    }
  }
  async function reset() {
    if (!window.confirm(`¿Restaurar "${title}" a los valores base? Se perderán los cambios de esta sección.`)) return;
    try {
      snap = await api('/settings/reset', { method: 'POST', body: { fields } });
      toast('Valores base restaurados.', 'ok');
      render(id);
    } catch (error) {
      toast(error.message, 'error');
    }
  }
  return h('details', { class: 'card', id: `cfg-${id}`, open: open || null },
    h('summary', {}, title),
    h('div', { class: 'card__body' },
      body,
      errors,
      h('div', { class: 'toolbar' },
        h('button', { type: 'button', class: 'btn btn--primary', onclick: () => save() }, 'Guardar'),
        tryMessage ? h('button', { type: 'button', class: 'btn', onclick: () => save({ thenTry: true }), title: 'Guarda y abre el Probador con un mensaje de ejemplo' }, '🧪 Probar este cambio') : null,
        h('button', { type: 'button', class: 'btn btn--ghost', onclick: reset, disabled: !isOverridden(fields) }, '↩️ Restaurar valores base'),
        status)));
}

function goToTester(message) {
  try { sessionStorage.setItem('tester.suggestion', message || ''); } catch { /* sin almacenamiento */ }
  document.querySelector('#tabs [data-view="tester"]')?.click();
}

async function uploadPhoto(file) {
  if (!file) return null;
  if (file.size > 2 * 1024 * 1024) { toast('La foto pesa más de 2 MB. Redúcela e intenta de nuevo.', 'error'); return null; }
  try {
    const { url } = await api('/settings/photo', { method: 'POST', body: file, raw: true, headers: { 'Content-Type': file.type } });
    return url;
  } catch (error) {
    toast(error.message, 'error');
    return null;
  }
}

// Foto con vista previa y botón para cambiarla (se guarda en clinic.media[key]).
function photoPicker(key, media, onChange) {
  const src = media[key] ? (/^https:\/\//.test(media[key]) ? media[key] : `/media/${snap.effective.id}/${media[key]}`) : null;
  const img = h('img', { src: src || '', alt: `Foto ${key}`, hidden: !src });
  const input = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', class: 'sr-only', id: `photo-${key}` });
  input.addEventListener('change', async () => {
    const url = await uploadPhoto(input.files[0]);
    if (url) { img.src = url; img.hidden = false; onChange(url); toast('Foto subida. Guarda la sección para usarla.', 'ok'); }
  });
  return h('div', { class: 'row__photo' }, img, input, h('label', { for: `photo-${key}`, class: 'btn btn--small' }, src ? 'Cambiar foto' : 'Subir foto'));
}

// ---------- Secciones ----------
function assistantSection(c) {
  const clinicName = text(c.name, { maxlength: 80 });
  const botName = text(c.botName, { maxlength: 40 });
  const tone = select(c.tone || 'cercano', [['cercano', 'Cercano (tutea)'], ['formal', 'Formal (usted)'], ['juvenil', 'Juvenil']]);
  const emojis = select(c.emojiLevel || 'pocos', [['pocos', 'Pocos (máx. 2)'], ['ninguno', 'Ninguno'], ['normal', 'Normal (máx. 4)']]);
  const welcome = area(c.welcomeCaption, { maxlength: 1200, rows: 7 });
  const night = area(c.afterHoursNotice || '', { maxlength: 400, rows: 2, placeholder: '🌙 Ahora la clínica está cerrada, pero yo te ayudo ya mismo…' });
  const preview = h('div', { class: 'preview', 'aria-live': 'polite' });
  const updatePreview = () => { preview.textContent = [welcome.value, night.value ? `(de noche) ${night.value}` : null].filter(Boolean).join('\n\n'); };
  welcome.addEventListener('input', updatePreview);
  night.addEventListener('input', updatePreview);
  updatePreview();
  return section({
    id: 'assistant', title: '🤖 Clínica y asistente: nombres, tono y bienvenida', open: true,
    fields: ['name', 'botName', 'tone', 'emojiLevel', 'welcomeCaption', 'afterHoursNotice'],
    tryMessage: 'hola',
    body: [
      h('div', { class: 'grid-2' }, field('Nombre de la clínica', clinicName), field('Nombre de la asistente', botName)),
      h('div', { class: 'grid-2' }, field('Tono', tone), field('Emojis', emojis)),
      field('Mensaje de bienvenida (primer contacto)', welcome, 'Va con el logo y el aviso de privacidad.'),
      field('Aviso nocturno (clínica cerrada)', night, 'Vacío = texto por defecto.'),
      h('p', { class: 'field' }, h('span', {}, 'Vista previa')), preview,
    ],
    collect: () => ({
      name: clinicName.value.trim(), botName: botName.value.trim(), tone: tone.value, emojiLevel: emojis.value,
      welcomeCaption: welcome.value.trim(), ...(night.value.trim() ? { afterHoursNotice: night.value.trim() } : {}),
    }),
  });
}

function hoursSection(c) {
  const rows = DAYS.map(([key, label]) => {
    const [first] = c.workingHours[key] || [];
    const open = check(Boolean(first));
    const from = h('input', { type: 'time', value: first?.[0] || '09:00', 'aria-label': `${label}: abre` });
    const to = h('input', { type: 'time', value: first?.[1] || '18:00', 'aria-label': `${label}: cierra` });
    const extra = (c.workingHours[key] || []).slice(1);
    return {
      key, label, open, from, to, extra,
      node: h('div', { class: 'hours' }, h('label', { class: 'field--inline field' }, open, label),
        h('div', { class: 'field--inline field' }, from, '–', to, extra.length ? h('small', {}, `+ ${extra.map((r) => r.join('–')).join(', ')}`) : null)),
    };
  });
  const hoursText = area(c.workingHoursText, { rows: 2, maxlength: 300 });
  const holidays = (c.holidays || []).map((d) => ({ ...d }));
  const holidayBox = h('div', { class: 'rows' });
  const drawHolidays = () => clear(holidayBox, holidays.length ? holidays.map((d, i) => {
    const date = h('input', { type: 'date', value: d.date });
    date.addEventListener('change', () => { d.date = date.value; });
    const label = text(d.label || '', { placeholder: 'Feriado, vacaciones…' });
    label.addEventListener('input', () => { d.label = label.value; });
    return h('div', { class: 'row' }, h('div', { class: 'grid-2' }, field('Fecha', date), field('Motivo', label)),
      h('button', { type: 'button', class: 'btn btn--small btn--danger', onclick: () => { holidays.splice(i, 1); drawHolidays(); } }, 'Quitar'));
  }) : h('p', { class: 'muted' }, 'Sin feriados ni días cerrados.'));
  drawHolidays();
  const toLabel = (hhmm) => { const [hh, mm] = hhmm.split(':').map(Number); const h12 = ((hh + 11) % 12) + 1; return `${h12}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'a. m.' : 'p. m.'}`; };
  const generate = () => {
    hoursText.value = `${rows.filter((r) => r.open.checked).map((r) => `${r.label} de ${toLabel(r.from.value)} a ${toLabel(r.to.value)}`).join(', ')}.`;
  };
  return section({
    id: 'hours', title: '🕘 Horario, feriados y días cerrados',
    fields: ['workingHours', 'workingHoursText', 'holidays'],
    tryMessage: '¿atienden este sábado?',
    body: [
      h('div', { class: 'rows' }, rows.map((r) => r.node)),
      field('Horario como lo dice la asistente', hoursText),
      h('button', { type: 'button', class: 'btn btn--small', onclick: generate }, 'Generar texto desde el horario'),
      h('h4', {}, 'Feriados y días cerrados'), holidayBox,
      h('button', { type: 'button', class: 'btn btn--small', onclick: () => { holidays.push({ date: today(), label: '' }); drawHolidays(); } }, '+ Agregar día cerrado'),
    ],
    collect: () => ({
      workingHours: Object.fromEntries(rows.map((r) => [r.key, r.open.checked ? [[r.from.value, r.to.value], ...r.extra] : []])),
      workingHoursText: hoursText.value.trim(),
      holidays: holidays.filter((d) => d.date).map((d) => ({ date: d.date, ...(d.label ? { label: d.label.trim() } : {}) })),
    }),
  });
}

function treatmentsSection(c) {
  const items = c.treatments.map((t) => ({ ...t, synonyms: [...(t.synonyms || [])] }));
  const media = { ...(c.media || {}) };
  const box = h('div', { class: 'rows' });
  const draw = () => clear(box, items.map((t) => {
    const bind = (node, prop, parse = (v) => v) => { node.addEventListener('input', () => { t[prop] = parse(node.value); }); return node; };
    const active = check(t.active !== false);
    active.addEventListener('change', () => { t.active = active.checked; });
    return h('div', { class: 'row' },
      h('div', { class: 'row__head' }, h('strong', {}, t.name || 'Nuevo tratamiento'), h('label', { class: 'field--inline field' }, active, 'Activo')),
      h('div', { class: 'grid-2' },
        field('Nombre', bind(text(t.name), 'name')),
        field('Precio "desde" (S/)', bind(h('input', { type: 'number', min: 0, step: 1, value: t.priceFrom ?? '' }), 'priceFrom', Number)),
        field('Duración (min)', bind(h('input', { type: 'number', min: 10, step: 5, value: t.durationMin ?? 30 }), 'durationMin', (v) => Math.round(Number(v)))),
        field('Financiamiento', bind(text(t.financing || ''), 'financing'))),
      field('Sinónimos (separados por comas)', bind(text((t.synonyms || []).join(', ')), 'synonyms', csv), 'Palabras con las que un paciente lo pide: "brackets, frenillos, aparatos".'),
      field('Descripción corta', bind(area(t.description || '', { rows: 2, maxlength: 300 }), 'description')),
      photoPicker(t.key, media, (url) => { media[t.key] = url; }));
  }));
  draw();
  return section({
    id: 'treatments', title: '🦷 Tratamientos, precios y fotos',
    fields: ['treatments', 'media'],
    tryMessage: '¿cuánto cuestan los brackets?',
    body: [
      box,
      h('button', {
        type: 'button', class: 'btn btn--small',
        onclick: () => {
          const name = window.prompt('Nombre del tratamiento nuevo');
          const key = slug(name);
          if (!key || items.some((t) => t.key === key)) return;
          items.push({ key, name, priceFrom: 0, durationMin: 30, financing: '', synonyms: [name.toLowerCase()], active: true });
          draw();
        },
      }, '+ Agregar tratamiento'),
    ],
    collect: () => ({
      treatments: items.map(({ description, ...t }) => ({ ...t, ...(description ? { description } : {}) })),
      media,
    }),
  });
}

function promotionsSection(c) {
  const items = (c.promotions || []).map((p) => ({ ...p }));
  const campaign = { ...(c.campaign || {}) };
  const box = h('div', { class: 'rows' });
  const draw = () => clear(box, items.length ? items.map((p, i) => {
    const expired = p.validUntil && p.validUntil < today();
    const active = check(p.active !== false);
    active.addEventListener('change', () => { p.active = active.checked; });
    const title = text(p.title || '', { maxlength: 120 });
    title.addEventListener('input', () => { p.title = title.value; });
    const desc = area(p.description || '', { rows: 2, maxlength: 400 });
    desc.addEventListener('input', () => { p.description = desc.value; });
    const until = h('input', { type: 'date', value: p.validUntil || '' });
    until.addEventListener('change', () => { p.validUntil = until.value || null; draw(); });
    return h('div', { class: 'row' },
      h('div', { class: 'row__head' }, h('label', { class: 'field--inline field' }, active, 'Activa'),
        expired ? h('span', { class: 'badge badge--cancelada' }, 'Vencida: la asistente no la menciona') : null,
        h('button', { type: 'button', class: 'btn btn--small btn--danger', onclick: () => { items.splice(i, 1); draw(); } }, 'Quitar')),
      h('div', { class: 'grid-2' }, field('Título', title), field('Válida hasta (inclusive)', until, 'Vacío = sin fecha de fin.')),
      field('Detalle', desc));
  }) : h('p', { class: 'muted' }, 'Sin promociones. La campaña de arriba se menciona siempre.'));
  draw();
  const campaignInputs = Object.entries({ evaluation: 'Evaluación', initialFee: 'Cuota inicial', installments: 'Cuotas' })
    .map(([key, label]) => { const n = text(campaign[key] || ''); n.addEventListener('input', () => { campaign[key] = n.value; }); return field(label, n); });
  return section({
    id: 'promotions', title: '🎁 Campaña y promociones con vencimiento',
    fields: ['promotions', 'campaign'],
    tryMessage: '¿tienen alguna promoción?',
    body: [h('div', { class: 'grid-2' }, campaignInputs), box,
      h('button', { type: 'button', class: 'btn btn--small', onclick: () => { items.push({ title: '', description: '', validUntil: null, active: true }); draw(); } }, '+ Agregar promoción')],
    collect: () => ({
      campaign: Object.fromEntries(Object.entries(campaign).map(([k, v]) => [k, String(v || '').trim()]).filter(([, v]) => v)),
      promotions: items.filter((p) => p.title?.trim()).map((p) => ({
        title: p.title.trim(), ...(p.description?.trim() ? { description: p.description.trim() } : {}), validUntil: p.validUntil || null, active: p.active !== false,
      })),
    }),
  });
}

function paymentsSection(c) {
  const methods = area((c.paymentMethods || []).join('\n'), { rows: 4, placeholder: 'Tarjeta de crédito y débito\nYape y Plin\nEfectivo' });
  const financing = area(c.financingText || '', { rows: 2, maxlength: 300 });
  return section({
    id: 'payments', title: '💳 Formas de pago y financiamiento',
    fields: ['paymentMethods', 'financingText'],
    tryMessage: '¿aceptan Yape? ¿puedo pagar en cuotas?',
    body: [field('Formas de pago (una por línea)', methods), field('Financiamiento', financing)],
    collect: () => ({ paymentMethods: lines(methods.value), ...(financing.value.trim() ? { financingText: financing.value.trim() } : {}) }),
  });
}

function locationSection(c) {
  const address = text(c.address, { maxlength: 200 });
  const maps = text(c.mapsUrl, { type: 'url' });
  const review = text(c.reviewUrl || '', { type: 'url', placeholder: 'https://g.page/r/…' });
  const media = { ...(c.media || {}) };
  return section({
    id: 'location', title: '📍 Dirección, mapa, reseñas y fotos del local',
    fields: ['address', 'mapsUrl', 'reviewUrl', 'media'],
    tryMessage: '¿dónde quedan?',
    body: [
      field('Dirección', address), field('Enlace de Google Maps', maps),
      field('Enlace de reseñas de Google', review, 'Si existe, al marcar "Asistió" se pide una reseña al paciente.'),
      h('div', { class: 'grid-2' }, ['logo', 'fachada', 'ubicacion'].map((key) => field({ logo: 'Logo', fachada: 'Fachada', ubicacion: 'Mapa o croquis' }[key], photoPicker(key, media, (url) => { media[key] = url; })))),
    ],
    collect: () => ({ address: address.value.trim(), mapsUrl: maps.value.trim(), reviewUrl: review.value.trim() || null, media }),
  });
}

function faqSection(c) {
  const items = (c.faq || []).map((f) => ({ ...f }));
  const box = h('div', { class: 'rows' });
  const draw = () => clear(box, items.map((f, i) => {
    const q = text(f.q, { maxlength: 300 });
    q.addEventListener('input', () => { f.q = q.value; });
    const a = area(f.a, { rows: 2, maxlength: 1000 });
    a.addEventListener('input', () => { f.a = a.value; });
    return h('div', { class: 'row' }, field('Pregunta', q), field('Respuesta', a),
      h('button', { type: 'button', class: 'btn btn--small btn--danger', onclick: () => { items.splice(i, 1); draw(); } }, 'Quitar'));
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

function rulesSection(c) {
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
      h('button', { type: 'button', class: 'btn btn--small btn--danger', onclick: () => { items.splice(i, 1); draw(); } }, 'Quitar'));
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

function listSection({ id, title, fieldName, value, hint, tryMessage }) {
  const input = area((value || []).join('\n'), { rows: 5 });
  return section({
    id, title, fields: [fieldName], tryMessage,
    body: [field('Una por línea', input, hint)],
    collect: () => ({ [fieldName]: lines(input.value) }),
  });
}

function brandSection(c) {
  const primary = h('input', { type: 'color', value: c.colors?.primary || '#0f766e' });
  const accent = h('input', { type: 'color', value: c.colors?.accent || '#14b8a6' });
  return section({
    id: 'brand', title: '🎨 Colores del panel', fields: ['colors'],
    body: [h('div', { class: 'grid-2' }, field('Color principal', primary), field('Color de acento', accent))],
    collect: () => ({ colors: { primary: primary.value, accent: accent.value } }),
  });
}

function phonesCard() {
  return h('details', { class: 'card' }, h('summary', {}, '📱 Teléfonos (solo lectura)'),
    h('div', { class: 'card__body' },
      h('p', { class: 'muted' }, 'Por seguridad los teléfonos no se editan aquí: se cambian en Render → Environment.'),
      Object.entries(snap.phones || {}).map(([name, value]) => h('p', {}, h('strong', {}, name), ': ', h('span', { class: 'readonly' }, value || 'sin definir')))));
}

function auditCard() {
  const box = h('div', {}, h('p', { class: 'muted' }, 'Ábrelo para ver quién cambió qué y cuándo.'));
  const card = h('details', { class: 'card' }, h('summary', {}, '🕑 Historial de cambios'), h('div', { class: 'card__body' }, box));
  card.addEventListener('toggle', async () => {
    if (!card.open) return;
    clear(box, loading('Cargando historial…'));
    try {
      const rows = await api('/settings/audit?limit=50');
      clear(box, rows.length ? h('table', { class: 'report-table' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Cuándo'), h('th', {}, 'Quién'), h('th', {}, 'Qué'))),
        h('tbody', {}, rows.map((r) => h('tr', {}, h('td', {}, new Date(r.changed_at).toLocaleString('es-PE')), h('td', {}, r.changed_by || '—'), h('td', {}, r.field)))))
        : h('p', { class: 'muted' }, 'Todavía no hay cambios.'));
    } catch (error) {
      clear(box, failure(error.message));
    }
  });
  return card;
}

function render(openId = null) {
  const c = snap.effective;
  const root = $('#view-config');
  const meta = snap.meta || {};
  const cards = [
    assistantSection(c), hoursSection(c), treatmentsSection(c), promotionsSection(c), paymentsSection(c),
    locationSection(c), faqSection(c), rulesSection(c),
    listSection({ id: 'quick', title: '⚡ Respuestas rápidas de recepción', fieldName: 'quickReplies', value: c.quickReplies, hint: 'Aparecen como botones debajo del chat en la Bandeja.' }),
    listSection({ id: 'forbidden', title: '🚫 Frases prohibidas', fieldName: 'forbiddenPhrases', value: c.forbiddenPhrases, hint: 'La asistente nunca las escribe. Ej.: "garantizado", "sin dolor".', tryMessage: '¿el tratamiento es garantizado?' }),
    brandSection(c), phonesCard(), auditCard(),
  ];
  clear(root, h('div', { class: 'config' },
    h('div', { class: 'config__bar' },
      h('strong', {}, `Configuración de ${c.name}`),
      h('span', { class: 'config__status' }, meta.updatedAt ? `Último cambio: ${new Date(meta.updatedAt).toLocaleString('es-PE')} por ${meta.updatedBy || '—'}` : 'Usando los valores base del archivo de la clínica'),
      h('button', {
        type: 'button', class: 'btn btn--ghost',
        onclick: async () => {
          if (!window.confirm('¿Restaurar TODA la configuración a los valores base?')) return;
          snap = await api('/settings/reset', { method: 'POST', body: { fields: 'all' } }).catch((error) => { toast(error.message, 'error'); return snap; });
          render();
        },
      }, '↩️ Restaurar todo')),
    meta.invalid ? h('p', { class: 'state state--error', role: 'alert' }, `⚠️ Los cambios guardados no eran válidos y se usa la base: ${meta.invalid.join(' · ')}`) : null,
    cards));
  if (openId) {
    const card = $(`#cfg-${openId}`);
    if (card) { card.open = true; card.scrollIntoView({ block: 'start' }); }
  }
}
