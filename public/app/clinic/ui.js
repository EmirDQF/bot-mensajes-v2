import api from '../api.js';
import { h, clear, toast } from '../dom.js';

// Piezas comunes del panel "Mi clínica": campos, tarjeta de sección (Guardar / Probar / Restaurar), fotos y vistas
// previas. `ctx` guarda la configuración cargada y la función que vuelve a dibujar la pestaña.

export const ctx = { snap: null, render: () => {} };

export const DAYS = [['mon', 'Lunes'], ['tue', 'Martes'], ['wed', 'Miércoles'], ['thu', 'Jueves'], ['fri', 'Viernes'], ['sat', 'Sábado'], ['sun', 'Domingo']];
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
export const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
export const lines = (value) => String(value || '').split('\n').map((l) => l.trim()).filter(Boolean);
export const csv = (value) => String(value || '').split(',').map((l) => l.trim()).filter(Boolean);
export const slug = (value) => String(value || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);

export function field(label, input, hint = '') {
  return h('label', { class: 'field' }, h('span', {}, label), input, hint ? h('small', {}, hint) : null);
}
export const text = (value, attrs = {}) => h('input', { type: 'text', value: value ?? '', ...attrs });
export const number = (value, attrs = {}) => h('input', { type: 'number', inputmode: 'decimal', value: value ?? '', ...attrs });
export const area = (value, attrs = {}) => { const node = h('textarea', attrs); node.value = value ?? ''; return node; };
export const select = (value, options) => {
  const node = h('select', {}, options.map(([v, label]) => h('option', { value: v }, label)));
  node.value = value;
  return node;
};
export const check = (checked) => { const node = h('input', { type: 'checkbox' }); node.checked = Boolean(checked); return node; };
export const numOrNull = (input) => (String(input.value).trim() === '' ? null : Number(input.value));

const isOverridden = (fields) => fields.some((f) => f in (ctx.snap.overrides || {}));

export function goToTester(message) {
  try { sessionStorage.setItem('tester.suggestion', message || ''); } catch { /* sin almacenamiento */ }
  document.querySelector('#tabs [data-view="tester"]')?.click();
}

// Tarjeta de sección con Guardar / Probar / Restaurar. Si el servidor rechaza, muestra exactamente qué corregir.
export function section({ id, title, fields, body, collect, tryMessage, open = false }) {
  const errors = h('ul', { class: 'error-list', role: 'alert' });
  const status = h('span', { class: 'muted' }, isOverridden(fields) ? '✏️ Cambiado desde el panel' : 'Valores base');
  async function save({ thenTry = false } = {}) {
    clear(errors);
    try {
      ctx.snap = await api('/settings', { method: 'PUT', body: { changes: collect() } });
      toast('Cambios guardados. La asistente ya responde con ellos.', 'ok');
      ctx.render(id);
      if (thenTry) goToTester(tryMessage);
    } catch (error) {
      clear(errors, (error.body?.errors || [error.message]).map((e) => h('li', {}, e)));
      toast(error.message, 'error');
    }
  }
  async function reset() {
    if (!window.confirm(`¿Restaurar "${title}" a los valores base? Se perderán los cambios de esta sección.`)) return;
    try {
      ctx.snap = await api('/settings/reset', { method: 'POST', body: { fields } });
      toast('Valores base restaurados.', 'ok');
      ctx.render(id);
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
        tryMessage ? h('button', { type: 'button', class: 'btn', onclick: () => save({ thenTry: true }), title: 'Guarda y abre el Probador con un mensaje de ejemplo' }, '🧪 Probar') : null,
        h('button', { type: 'button', class: 'btn btn--ghost', onclick: reset, disabled: !isOverridden(fields) }, '↩️ Restaurar valores base'),
        status)));
}

// Sube una foto (JPG, PNG o WebP de hasta 2 MB; el servidor valida los bytes) y devuelve su URL.
export async function uploadPhoto(file) {
  if (!file) return null;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { toast('Solo fotos JPG, PNG o WebP.', 'error'); return null; }
  if (file.size > MAX_PHOTO_BYTES) { toast('La foto pesa más de 2 MB. Redúcela e intenta de nuevo.', 'error'); return null; }
  try {
    const { url } = await api('/settings/photo', { method: 'POST', body: file, raw: true, headers: { 'Content-Type': file.type } });
    return url;
  } catch (error) {
    toast(error.message, 'error');
    return null;
  }
}

// Ruta para mostrar una foto en el panel: URL https / del demo tal cual; un archivo, desde /media/<id>/.
export function mediaSrc(value) {
  if (!value) return '';
  if (/^https:\/\//.test(value) || value.startsWith('/demo-media/')) return value;
  return `/media/${ctx.snap.effective.id}/${value}`;
}

// Foto con vista previa y botón para cambiarla.
export function photoPicker(id, value, onChange, label = 'foto') {
  const img = h('img', { src: mediaSrc(value), alt: `Foto: ${label}`, hidden: !value });
  const input = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', class: 'sr-only', id: `photo-${id}` });
  input.addEventListener('change', async () => {
    const url = await uploadPhoto(input.files[0]);
    if (url) { img.src = mediaSrc(url); img.hidden = false; onChange(url); toast('Foto subida. Guarda la sección para usarla.', 'ok'); }
  });
  return h('div', { class: 'row__photo' }, img, input, h('label', { for: `photo-${id}`, class: 'btn btn--small' }, value ? 'Cambiar' : 'Subir'));
}

// Vista previa en vivo (sin guardar) de la tarjeta del pack o de un pase de ejemplo.
export function livePreview(kind, getDraft, alt) {
  const img = h('img', { alt, class: 'live-preview__img', hidden: true });
  const note = h('p', { class: 'muted' }, 'Toca "Actualizar vista previa" para ver cómo queda.');
  let url = null;
  async function refresh() {
    try {
      const res = await fetch('/api/panel/settings/preview', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, draft: getDraft() }),
      });
      if (!res.ok) { note.textContent = (await res.json().catch(() => ({}))).error || 'No se pudo generar la vista previa.'; img.hidden = true; return; }
      if (url) URL.revokeObjectURL(url);
      url = URL.createObjectURL(await res.blob());
      img.src = url;
      img.hidden = false;
      note.textContent = 'Vista previa con lo que escribiste (todavía sin guardar).';
    } catch {
      note.textContent = 'No se pudo generar la vista previa.';
    }
  }
  return h('div', { class: 'live-preview' }, img, note,
    h('button', { type: 'button', class: 'btn btn--small', onclick: refresh }, '🔄 Actualizar vista previa'));
}

// Botones ↑ ↓ 🗑 para listas ordenables.
export function orderButtons(list, index, redraw, label) {
  const move = (delta) => {
    const target = index + delta;
    if (target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target], list[index]];
    redraw();
  };
  return h('div', { class: 'order-buttons' },
    h('button', { type: 'button', class: 'btn btn--small', onclick: () => move(-1), disabled: index === 0, 'aria-label': `Subir ${label}` }, '↑'),
    h('button', { type: 'button', class: 'btn btn--small', onclick: () => move(1), disabled: index === list.length - 1, 'aria-label': `Bajar ${label}` }, '↓'),
    h('button', {
      type: 'button', class: 'btn btn--small btn--danger', 'aria-label': `Borrar ${label}`,
      onclick: () => { if (window.confirm(`¿Borrar ${label}?`)) { list.splice(index, 1); redraw(); } },
    }, '🗑'));
}
