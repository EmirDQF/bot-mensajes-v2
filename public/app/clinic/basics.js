import { h, clear } from '../dom.js';
import {
  DAYS, area, check, field, number, numOrNull, photoPicker, section, text, today,
} from './ui.js';

// Mi clínica → Datos (dirección, mapa, reseñas, logo y colores) y Horario (por día, con refrigerio y feriados).

export function dataSection(c) {
  const name = text(c.name, { maxlength: 80 });
  const address = text(c.address, { maxlength: 200 });
  const reference = text(c.addressReference || '', { maxlength: 200, placeholder: 'A media cuadra del parque…' });
  const maps = text(c.mapsUrl, { type: 'url', placeholder: 'https://maps.google.com/…' });
  const lat = number(c.latitude ?? '', { step: 'any', placeholder: '-12.0977' });
  const lng = number(c.longitude ?? '', { step: 'any', placeholder: '-77.0365' });
  const review = text(c.reviewUrl || '', { type: 'url', placeholder: 'https://g.page/r/…' });
  const rating = number(c.googleRating?.value ?? '', { step: '0.1', min: 1, max: 5, placeholder: '4.8' });
  const ratingCount = number(c.googleRating?.count ?? '', { step: 1, min: 1, placeholder: '120' });
  const primary = h('input', { type: 'color', value: c.colors?.primary || '#0f766e' });
  const accent = h('input', { type: 'color', value: c.colors?.accent || '#14b8a6' });
  const media = { ...(c.media || {}) };
  const photo = (key, label) => field(label, photoPicker(key, media[key], (url) => { media[key] = url; }, label));
  return section({
    id: 'data', title: '🏥 Datos, ubicación, logo y colores', open: true,
    fields: ['name', 'address', 'addressReference', 'mapsUrl', 'latitude', 'longitude', 'reviewUrl', 'googleRating', 'colors', 'media'],
    tryMessage: '¿dónde quedan?',
    body: [
      field('Nombre de la clínica', name),
      field('Dirección', address), field('Referencia para llegar', reference),
      field('Enlace de Google Maps', maps),
      h('div', { class: 'grid-2' },
        field('Latitud', lat, 'Google Maps → clic derecho en el pin → copia las coordenadas.'),
        field('Longitud', lng, 'Con ambas, la asistente envía la ubicación como mensaje de mapa.')),
      field('Enlace de reseñas de Google', review, 'Si existe, al marcar "Asistió" se pide una reseña.'),
      h('div', { class: 'grid-2' },
        field('Calificación en Google (1 a 5)', rating, 'Solo si es la calificación real: la asistente la menciona tal cual.'),
        field('Número de reseñas', ratingCount)),
      h('div', { class: 'grid-3' }, photo('logo', 'Logo'), photo('fachada', 'Fachada'), photo('ubicacion', 'Mapa o croquis')),
      h('div', { class: 'grid-2' }, field('Color principal', primary), field('Color de acento', accent)),
    ],
    collect: () => ({
      name: name.value.trim(),
      address: address.value.trim(),
      ...(reference.value.trim() ? { addressReference: reference.value.trim() } : { addressReference: null }),
      mapsUrl: maps.value.trim(),
      latitude: numOrNull(lat), longitude: numOrNull(lng),
      reviewUrl: review.value.trim() || null,
      googleRating: rating.value && ratingCount.value ? { value: Number(rating.value), count: Math.round(Number(ratingCount.value)) } : null,
      colors: { primary: primary.value, accent: accent.value },
      media,
    }),
  });
}

// Un día con hasta dos turnos: [abre, inicio del refrigerio] y [fin del refrigerio, cierra].
function dayRow(key, label, ranges) {
  const first = ranges[0];
  const last = ranges[ranges.length - 1];
  const open = check(ranges.length > 0);
  const from = h('input', { type: 'time', value: first?.[0] || '09:00', 'aria-label': `${label}: abre` });
  const to = h('input', { type: 'time', value: last?.[1] || '18:00', 'aria-label': `${label}: cierra` });
  const lunch = check(ranges.length > 1);
  const lunchFrom = h('input', { type: 'time', value: ranges.length > 1 ? first[1] : '13:00', 'aria-label': `${label}: inicio del refrigerio` });
  const lunchTo = h('input', { type: 'time', value: ranges.length > 1 ? ranges[1][0] : '14:00', 'aria-label': `${label}: fin del refrigerio` });
  const lunchBox = h('div', { class: 'field--inline field' }, 'Refrigerio', lunchFrom, '–', lunchTo);
  const sync = () => { lunchBox.hidden = !lunch.checked || !open.checked; };
  lunch.addEventListener('change', sync);
  open.addEventListener('change', sync);
  sync();
  return {
    key, label,
    ranges: () => {
      if (!open.checked) return [];
      return lunch.checked ? [[from.value, lunchFrom.value], [lunchTo.value, to.value]] : [[from.value, to.value]];
    },
    describe: () => (lunch.checked ? `${label} de ${from.value} a ${lunchFrom.value} y de ${lunchTo.value} a ${to.value}` : `${label} de ${from.value} a ${to.value}`),
    isOpen: () => open.checked,
    node: h('div', { class: 'hours' },
      h('label', { class: 'field--inline field' }, open, label),
      h('div', { class: 'field--inline field' }, from, '–', to),
      h('label', { class: 'field--inline field' }, lunch, 'con refrigerio'),
      lunchBox),
  };
}

export function hoursSection(c) {
  const rows = DAYS.map(([key, label]) => dayRow(key, label, c.workingHours[key] || []));
  const hoursText = area(c.workingHoursText, { rows: 2, maxlength: 300 });
  const slot = number(c.slotMinutes ?? 30, { min: 10, max: 240, step: 5 });
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
  const generate = () => { hoursText.value = `${rows.filter((r) => r.isOpen()).map((r) => r.describe()).join('; ')}.`; };
  return section({
    id: 'hours', title: '🕘 Horario, refrigerio, feriados y duración de cita',
    fields: ['workingHours', 'workingHoursText', 'holidays', 'slotMinutes'],
    tryMessage: '¿atienden este sábado?',
    body: [
      h('div', { class: 'rows' }, rows.map((r) => r.node)),
      field('Horario como lo dice la asistente', hoursText),
      h('button', { type: 'button', class: 'btn btn--small', onclick: generate }, 'Generar texto desde el horario'),
      field('Duración de cada cita (minutos)', slot, 'Cada cuánto se ofrecen horarios. Cada tratamiento puede tener su propia duración.'),
      h('h4', {}, 'Feriados y días cerrados'), holidayBox,
      h('button', { type: 'button', class: 'btn btn--small', onclick: () => { holidays.push({ date: today(), label: '' }); drawHolidays(); } }, '+ Agregar día cerrado'),
    ],
    collect: () => ({
      workingHours: Object.fromEntries(rows.map((r) => [r.key, r.ranges()])),
      workingHoursText: hoursText.value.trim(),
      slotMinutes: Math.round(Number(slot.value)),
      holidays: holidays.filter((d) => d.date).map((d) => ({ date: d.date, ...(d.label ? { label: d.label.trim() } : {}) })),
    }),
  });
}
