import api from '../api.js';
import { h, clear, loading, failure, toast } from '../dom.js';
import { ctx, goToTester } from './ui.js';

// Mi clínica → "Configuración completa: X de Y" (qué falta para conectar pacientes reales), teléfonos de solo
// lectura e historial de cambios con "Deshacer el último cambio".

const ACTIONS = { cambio: 'Cambio', restaurar: 'Restauró la base', deshacer: 'Deshizo un cambio' };

export function readinessCard() {
  const r = ctx.snap.readiness;
  if (!r) return null;
  const goTo = (section) => {
    const card = document.querySelector(`#cfg-${section}`);
    if (card) { card.open = true; card.scrollIntoView({ block: 'start' }); }
  };
  return h('section', { class: `card readiness${r.complete ? ' readiness--ok' : ''}`, 'aria-labelledby': 'readinessTitle' },
    h('div', { class: 'card__body' },
      h('h3', { id: 'readinessTitle' }, r.complete ? `✅ Configuración completa: ${r.done} de ${r.total}` : `Configuración completa: ${r.done} de ${r.total}`),
      h('progress', { max: r.total, value: r.done, 'aria-label': `${r.done} de ${r.total} listos` }),
      r.complete
        ? h('p', {}, 'Todo listo para conectar pacientes reales.')
        : h('div', {},
          h('p', {}, 'Falta para conectar pacientes reales:'),
          h('ul', { class: 'readiness__list' }, r.missing.map((item) => h('li', {},
            item.label,
            item.section === 'env' ? h('small', { class: 'muted' }, ' — se configura en Render → Environment')
              : item.section ? h('button', { type: 'button', class: 'btn btn--small btn--ghost', onclick: () => goTo(item.section) }, 'Completar') : null)))),
      h('button', { type: 'button', class: 'btn', onclick: () => goToTester('hola') }, '🧪 Probar en el Probador')));
}

export function phonesCard() {
  return h('details', { class: 'card' }, h('summary', {}, '📱 Teléfonos (solo lectura)'),
    h('div', { class: 'card__body' },
      h('p', { class: 'muted' }, 'Por seguridad los teléfonos no se editan aquí: se cambian en Render → Environment.'),
      Object.entries(ctx.snap.phones || {}).map(([name, value]) => h('p', {}, h('strong', {}, name), ': ', h('span', { class: 'readonly' }, value || 'sin definir')))));
}

export function historyCard() {
  const box = h('div', {}, h('p', { class: 'muted' }, 'Ábrelo para ver quién cambió qué y cuándo.'));
  const undo = h('button', {
    type: 'button', class: 'btn',
    onclick: async () => {
      if (!window.confirm('¿Deshacer el último cambio guardado? Vuelve a los valores que había antes.')) return;
      try {
        ctx.snap = await api('/settings/undo', { method: 'POST', body: {} });
        toast('Listo: se deshizo el último cambio.', 'ok');
        ctx.render('history');
      } catch (error) {
        toast(error.message, 'error');
      }
    },
  }, '↶ Deshacer el último cambio');
  const card = h('details', { class: 'card', id: 'cfg-history' }, h('summary', {}, '🕑 Historial de cambios'), h('div', { class: 'card__body' }, undo, box));
  card.addEventListener('toggle', async () => {
    if (!card.open) return;
    clear(box, loading('Cargando historial…'));
    try {
      const rows = await api('/settings/audit?limit=50');
      clear(box, rows.length ? h('table', { class: 'report-table' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Cuándo'), h('th', {}, 'Quién'), h('th', {}, 'Qué'), h('th', {}, 'Acción'))),
        h('tbody', {}, rows.map((r) => h('tr', {},
          h('td', {}, new Date(r.changed_at).toLocaleString('es-PE')), h('td', {}, r.changed_by || '—'), h('td', {}, r.field),
          h('td', {}, ACTIONS[r.action] || 'Cambio')))))
        : h('p', { class: 'muted' }, 'Todavía no hay cambios.'));
    } catch (error) {
      clear(box, failure(error.message));
    }
  });
  return card;
}
