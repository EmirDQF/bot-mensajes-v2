import { h, clear, toast } from '../dom.js';
import {
  area, check, csv, field, mediaSrc, number, orderButtons, section, select, slug, text, uploadPhoto,
} from './ui.js';

// Mi clínica → Tratamientos (agregar, editar, ordenar y borrar; precio "desde", financiamiento, duración,
// sinónimos, especialista e imágenes del catálogo) y la lista de especialistas.

const MAX_IMAGES = 6;

// Catálogo de un tratamiento: subir, ordenar, borrar y editar el texto de cada imagen.
function imagesEditor(t, redrawAll) {
  t.images = Array.isArray(t.images) ? t.images : [];
  const box = h('div', { class: 'catalog' });
  const draw = () => clear(box,
    t.images.length ? t.images.map((img, i) => {
      const caption = area(img.caption || '', { rows: 2, maxlength: 1000, placeholder: 'Texto que acompaña la imagen' });
      caption.addEventListener('input', () => { img.caption = caption.value; });
      return h('div', { class: 'catalog__item' },
        h('img', { src: mediaSrc(img.file), alt: `Imagen ${i + 1} de ${t.name}`, loading: 'lazy' }),
        field(`Texto de la imagen ${i + 1}`, caption),
        orderButtons(t.images, i, draw, `la imagen ${i + 1}`));
    }) : h('p', { class: 'muted' }, 'Sin imágenes de catálogo: se usa la foto única del tratamiento si existe.'),
    t.images.length < MAX_IMAGES ? uploader() : h('p', { class: 'muted' }, `Máximo ${MAX_IMAGES} imágenes.`));
  function uploader() {
    const id = `catalog-${t.key}-${Date.now()}`;
    const input = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', class: 'sr-only', id });
    input.addEventListener('change', async () => {
      const url = await uploadPhoto(input.files[0]);
      if (!url) return;
      t.images.push({ file: url, caption: '' });
      toast('Imagen agregada. Escribe su texto y guarda la sección.', 'ok');
      draw();
    });
    return h('div', {}, input, h('label', { for: id, class: 'btn btn--small' }, '+ Subir imagen (JPG, PNG o WebP, hasta 2 MB)'));
  }
  draw();
  return h('div', {}, h('h5', {}, '🖼️ Imágenes del catálogo (sin fotos de pacientes sin su consentimiento escrito)'), box);
}

function treatmentRow(t, i, items, specialists, draw) {
  const bind = (node, prop, parse = (v) => v) => { node.addEventListener('input', () => { t[prop] = parse(node.value); }); return node; };
  const active = check(t.active !== false);
  active.addEventListener('change', () => { t.active = active.checked; });
  const specialist = select(t.specialistName || '', [['', '— Sin especialista —'], ...specialists.map((s) => [s.name, s.name])]);
  specialist.addEventListener('change', () => { t.specialistName = specialist.value || null; });
  return h('div', { class: 'row' },
    h('div', { class: 'row__head' },
      h('strong', {}, `${i + 1}. ${t.name || 'Nuevo tratamiento'}`),
      h('label', { class: 'field--inline field' }, active, 'Activo'),
      orderButtons(items, i, draw, `el tratamiento ${t.name || i + 1}`)),
    h('div', { class: 'grid-2' },
      field('Nombre', bind(text(t.name, { maxlength: 80 }), 'name')),
      field('Precio "desde" (S/)', bind(number(t.priceFrom ?? '', { min: 0, step: 1 }), 'priceFrom', Number)),
      field('Duración (min)', bind(number(t.durationMin ?? 30, { min: 10, step: 5 }), 'durationMin', (v) => Math.round(Number(v)))),
      field('Financiamiento', bind(text(t.financing || '', { maxlength: 200 }), 'financing')),
      field('Especialista', specialist)),
    field('Cómo lo llaman los pacientes (separado por comas)', bind(text((t.synonyms || []).join(', ')), 'synonyms', csv),
      'Ej.: "brackets, frenillos, fierritos". Los errores de tipeo comunes ya se entienden solos.'),
    field('Descripción corta', bind(area(t.description || '', { rows: 2, maxlength: 300 }), 'description')),
    imagesEditor(t, draw));
}

export function treatmentsSection(c) {
  const specialists = (c.specialists || []).map((s) => ({ ...s, treatments: [...(s.treatments || [])] }));
  const items = c.treatments.map((t) => ({
    ...t, synonyms: [...(t.synonyms || [])], images: (t.images || []).map((img) => ({ ...img })),
    specialistName: specialists.find((s) => s.treatments.includes(t.key))?.name || null,
  }));
  const box = h('div', { class: 'rows' });
  const specialistsBox = h('div', { class: 'rows' });
  const draw = () => clear(box, items.map((t, i) => treatmentRow(t, i, items, specialists, draw)));
  const drawSpecialists = () => clear(specialistsBox, specialists.length ? specialists.map((s, i) => {
    const name = text(s.name, { maxlength: 60, placeholder: 'Dra. Nombre Apellido' });
    name.addEventListener('change', () => {
      for (const t of items) if (t.specialistName === s.name) t.specialistName = name.value.trim();
      s.name = name.value.trim();
      draw();
    });
    return h('div', { class: 'row row--compact' }, field(`Especialista ${i + 1}`, name),
      h('button', { type: 'button', class: 'btn btn--small btn--danger', onclick: () => { specialists.splice(i, 1); drawSpecialists(); draw(); } }, 'Quitar'));
  }) : h('p', { class: 'muted' }, 'Sin especialistas: el pase de cita no muestra un nombre. Nunca pongas un médico que no atiende aquí.'));
  draw();
  drawSpecialists();
  return section({
    id: 'treatments', title: '🦷 Tratamientos, precios, especialistas y catálogo',
    fields: ['treatments', 'specialists'],
    tryMessage: '¿cuánto cuestan los brackets?',
    body: [
      h('h4', {}, '👩‍⚕️ Especialistas'), specialistsBox,
      h('button', { type: 'button', class: 'btn btn--small', onclick: () => { specialists.push({ name: '', treatments: [] }); drawSpecialists(); } }, '+ Agregar especialista'),
      h('h4', {}, 'Tratamientos (en el orden en que la asistente los ofrece)'), box,
      h('button', {
        type: 'button', class: 'btn btn--small',
        onclick: () => {
          const name = window.prompt('Nombre del tratamiento nuevo');
          const key = slug(name);
          if (!key) return;
          if (items.some((t) => t.key === key)) { toast('Ya existe un tratamiento con ese nombre.', 'error'); return; }
          items.push({ key, name, priceFrom: 0, durationMin: 30, financing: '', synonyms: [name.toLowerCase()], active: true, images: [] });
          draw();
        },
      }, '+ Agregar tratamiento'),
    ],
    collect: () => ({
      treatments: items.map(({ description, specialistName: _s, images, ...t }) => ({
        ...t, ...(description ? { description } : {}),
        ...(images?.length ? { images: images.map((img) => ({ file: img.file, ...(img.caption?.trim() ? { caption: img.caption.trim() } : {}) })) } : {}),
      })),
      specialists: specialists.filter((s) => s.name.trim()).map((s) => ({
        name: s.name.trim(),
        treatments: items.filter((t) => t.specialistName === s.name).map((t) => t.key),
        ...(s.fictitious ? { fictitious: true } : {}),
      })),
    }),
  });
}
