import api from './api.js';
import { $, h, clear, loading, failure, toast } from './dom.js';
import { ctx, goToTester } from './clinic/ui.js';
import { dataSection, hoursSection } from './clinic/basics.js';
import { treatmentsSection } from './clinic/treatments.js';
import {
  faqSection, listSection, packSection, paymentsSection, promotionsSection, rulesSection,
} from './clinic/offers.js';
import { assistantSection } from './clinic/assistant.js';
import { historyCard, phonesCard, readinessCard } from './clinic/status.js';

// Pestaña 🏥 Mi clínica (solo el dueño): todo lo que dice y ofrece la asistente, sin código ni redeploy.
// Cada sección guarda (con validación: si falta algo, dice qué), restaura sus valores base o se prueba en el
// Probador. Las secciones viven en public/app/clinic/.

export async function loadConfig() {
  const root = $('#view-config');
  clear(root, loading('Cargando la configuración de tu clínica…'));
  try {
    ctx.snap = await api('/settings');
    ctx.render = render;
    render();
  } catch (error) {
    clear(root, failure(error.message));
  }
}

function render(openId = null) {
  const c = ctx.snap.effective;
  const meta = ctx.snap.meta || {};
  const cards = [
    readinessCard(),
    dataSection(c), hoursSection(c), treatmentsSection(c), packSection(c), promotionsSection(c), paymentsSection(c),
    faqSection(c), assistantSection(c), rulesSection(c),
    listSection({ id: 'quick', title: '⚡ Respuestas rápidas de recepción', fieldName: 'quickReplies', value: c.quickReplies, hint: 'Aparecen como botones debajo del chat en la Bandeja.' }),
    listSection({ id: 'forbidden', title: '🚫 Frases prohibidas', fieldName: 'forbiddenPhrases', value: c.forbiddenPhrases, hint: 'La asistente nunca las escribe. Ej.: "garantizado", "sin dolor".', tryMessage: '¿el tratamiento es garantizado?' }),
    phonesCard(), historyCard(),
  ];
  clear($('#view-config'), h('div', { class: 'config' },
    h('div', { class: 'config__bar' },
      h('strong', {}, `Mi clínica: ${c.name}`),
      h('span', { class: 'config__status' }, meta.updatedAt ? `Último cambio: ${new Date(meta.updatedAt).toLocaleString('es-PE')} por ${meta.updatedBy || '—'}` : 'Usando los valores base del archivo de la clínica'),
      h('button', { type: 'button', class: 'btn', onclick: () => goToTester('hola') }, '🧪 Probar'),
      h('button', {
        type: 'button', class: 'btn btn--ghost',
        onclick: async () => {
          if (!window.confirm('¿Restaurar TODA la configuración a los valores base?')) return;
          ctx.snap = await api('/settings/reset', { method: 'POST', body: { fields: 'all' } }).catch((error) => { toast(error.message, 'error'); return ctx.snap; });
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
