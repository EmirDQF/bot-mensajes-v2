// Utilidades del panel. Todo el DOM se arma con h(): los textos van como textContent, nunca como
// HTML, así un mensaje de un paciente con "<script>" se muestra tal cual y no se ejecuta.

export function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    // CSSOM en vez del atributo style: la CSP del panel no permite estilos en línea.
    else if (key === 'style') node.style.cssText = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'text') node.textContent = value;
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }
  append(node, children);
  return node;
}

function append(node, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function clear(node, ...children) {
  node.replaceChildren();
  append(node, children);
  return node;
}

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

// Solo URLs del mismo servidor o https (evita javascript: y data: en enlaces).
export function safeUrl(value) {
  const url = String(value || '');
  if (url.startsWith('/') && !url.startsWith('//')) return url;
  return /^https:\/\//i.test(url) ? url : null;
}

const TZ = 'America/Lima';
export function timeLabel(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const today = new Date();
  const sameDay = date.toLocaleDateString('es-PE', { timeZone: TZ }) === today.toLocaleDateString('es-PE', { timeZone: TZ });
  return new Intl.DateTimeFormat('es-PE', {
    timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true, ...(sameDay ? {} : { day: '2-digit', month: 'short' }),
  }).format(date);
}

export function formatPhone(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('51')) return `+51 ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}`;
  return d ? `+${d}` : '';
}

export function initials(name, phone) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (words.length) return words.slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return String(phone || '').slice(-2) || '?';
}

export function soles(value) {
  return `S/ ${Math.round(Number(value) || 0).toLocaleString('es-PE')}`;
}

export function formatMs(ms) {
  if (ms === null || ms === undefined) return 'sin datos';
  if (ms < 60000) return `${Math.max(1, Math.round(ms / 1000))} s`;
  if (ms < 3600000) return `${Math.round(ms / 60000)} min`;
  return `${(ms / 3600000).toFixed(1)} h`;
}

// Estados de carga, vacío y error reutilizables.
export const loading = (text = 'Cargando…') => h('p', { class: 'state state--loading', role: 'status' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), text);
export const empty = (title, hint = '') => h('div', { class: 'state state--empty' }, h('p', { class: 'state__title', text: title }), hint ? h('p', { class: 'state__hint', text: hint }) : null);
export const failure = (message) => h('p', { class: 'state state--error', role: 'alert' }, `⚠️ ${message}`);

let toastTimer = null;
export function toast(message, kind = 'info') {
  const box = $('#toast');
  if (!box) return;
  box.className = `toast toast--${kind} is-visible`;
  box.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.remove('is-visible'), 4500);
}
