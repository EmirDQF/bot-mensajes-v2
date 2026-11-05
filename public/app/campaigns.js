import api from './api.js';
import { $, h, clear, loading, failure, empty, toast } from './dom.js';

// Pestaña 📣 Campañas (solo el dueño): promociones a pacientes anteriores. Solo llegan a quien dio permiso de
// promociones, nunca a menores ni a quien pidió no recibir mensajes, máximo una cada 14 días por paciente.
// Antes de programar se ven los destinatarios, el costo estimado de Meta y el mensaje, y se confirma por escrito.

const STATUS = { programada: '🕒 Programada', enviando: '📤 Enviando', terminada: '✅ Terminada', pausada: '⏸️ Pausada', cancelada: '✖️ Cancelada' };
const EXCLUDED = {
  sin_opt_in: 'sin permiso de promociones', opt_out: 'pidieron no recibir mensajes', menor_de_edad: 'menores de edad',
  promocion_reciente: 'recibieron una promoción hace menos de 14 días', interno: 'números de la clínica', prueba: 'números de prueba',
};
let data = null;

const field = (label, input, hint = '') => h('label', { class: 'field' }, h('span', {}, label), input, hint ? h('small', {}, hint) : null);
const money = (amount, currency) => (amount == null ? '—' : `${currency === 'PEN' ? 'S/' : 'US$'} ${Number(amount).toFixed(2)}`);

export async function loadCampaigns() {
  const root = $('#view-campaigns');
  clear(root, loading('Cargando campañas…'));
  try {
    data = await api('/campaigns');
    render();
  } catch (error) {
    clear(root, failure(error.message));
  }
}

function priceCard() {
  const amount = h('input', { type: 'number', min: 0, max: 5, step: '0.0001', value: data.marketingPrice?.amount ?? '', inputmode: 'decimal' });
  const currency = h('select', {}, h('option', { value: 'USD' }, 'US$'), h('option', { value: 'PEN' }, 'S/'));
  currency.value = data.marketingPrice?.currency || 'USD';
  const save = async () => {
    try {
      await api('/settings', { method: 'PUT', body: { changes: { marketingPrice: amount.value === '' ? null : { amount: Number(amount.value), currency: currency.value } } } });
      toast('Tarifa guardada.', 'ok');
      loadCampaigns();
    } catch (error) { toast(error.body?.errors?.join(' · ') || error.message, 'error'); }
  };
  return h('details', { class: 'card', open: !data.marketingPrice || null }, h('summary', {}, '💲 Tarifa de Meta por mensaje de marketing'),
    h('div', { class: 'card__body' },
      h('p', { class: 'muted' }, 'Verifica la tarifa vigente para Perú en la página de precios de WhatsApp Business de Meta y escríbela aquí: el costo estimado de cada campaña se calcula con este valor.'),
      h('div', { class: 'grid-2' }, field('Tarifa por mensaje', amount), field('Moneda', currency)),
      h('button', { type: 'button', class: 'btn', onclick: save }, 'Guardar tarifa')));
}

function newCampaignCard() {
  const name = h('input', { type: 'text', maxlength: 80, placeholder: 'Blanqueamiento noviembre' });
  const promotion = h('select', {}, data.promotions.length
    ? data.promotions.map((p) => h('option', { value: p.index, disabled: !p.active || null }, `${p.title}${p.validUntil ? ` (hasta ${p.validUntil})` : ''}${p.active ? '' : ' — no vigente'}`))
    : h('option', { value: '' }, 'Primero crea una promoción en Mi clínica → Promociones'));
  const type = h('select', {}, Object.entries(data.segmentTypes).map(([key, label]) => h('option', { value: key }, label)));
  const treatment = h('select', {}, data.treatments.map((t) => h('option', { value: t.key }, t.name)));
  const days = h('input', { type: 'number', min: 1, max: 365, value: 60, inputmode: 'numeric' });
  const months = h('input', { type: 'number', min: 1, max: 36, value: 6, inputmode: 'numeric' });
  const when = h('input', { type: 'datetime-local' });
  const treatmentField = field('Tratamiento por el que preguntaron', treatment);
  const daysField = field('En los últimos (días)', days);
  const monthsField = field('Hace más de (meses)', months);
  const sync = () => {
    treatmentField.hidden = type.value !== 'pregunto_no_agendo';
    daysField.hidden = type.value === 'asistio_hace';
    monthsField.hidden = type.value !== 'asistio_hace';
  };
  type.addEventListener('change', sync);
  sync();
  const segment = () => (type.value === 'pregunto_no_agendo' ? { type: type.value, treatmentKey: treatment.value, days: Number(days.value) }
    : type.value === 'asistio_hace' ? { type: type.value, months: Number(months.value) } : { type: type.value, days: Number(days.value) });
  const result = h('div', { class: 'campaign-preview', 'aria-live': 'polite' });
  const confirmation = h('input', { type: 'text', autocomplete: 'off', placeholder: data.confirmWord });
  const createBtn = h('button', { type: 'button', class: 'btn btn--primary', disabled: true }, 'Programar envío');
  const scheduledDate = () => (when.value ? when.value.slice(0, 10) : undefined);

  async function preview() {
    clear(result, loading('Calculando destinatarios…'));
    createBtn.disabled = true;
    try {
      const p = await api('/campaigns/preview', { method: 'POST', body: { segment: segment(), promotionIndex: Number(promotion.value), scheduledDate: scheduledDate() } });
      const excluded = Object.entries(p.excluded || {}).map(([k, n]) => `${n} ${EXCLUDED[k] || k}`);
      clear(result,
        h('p', {}, h('strong', {}, p.recipients === 1 ? '1 destinatario elegible' : `${p.recipients} destinatarios elegibles`), ` de ${p.segmentSize} en el segmento.`),
        excluded.length ? h('p', { class: 'muted' }, `No reciben: ${excluded.join(' · ')}.`) : null,
        h('p', {}, 'Costo estimado de Meta: ', h('strong', {}, p.estimate.cost == null ? 'configura la tarifa arriba' : `${money(p.estimate.cost, p.estimate.currency)} (${p.recipients} × ${money(p.estimate.price, p.estimate.currency)})`)),
        h('p', { class: 'field' }, h('span', {}, `Vista previa (plantilla ${p.template}):`)),
        h('div', { class: 'preview' }, p.message));
      createBtn.disabled = !(p.recipients > 0 && p.estimate.cost != null);
    } catch (error) {
      clear(result, failure(error.body?.errors?.join(' · ') || error.message));
    }
  }

  createBtn.addEventListener('click', async () => {
    try {
      await api('/campaigns', {
        method: 'POST',
        body: {
          name: name.value, segment: segment(), promotionIndex: Number(promotion.value),
          scheduledAt: when.value ? new Date(when.value).toISOString() : undefined, confirmation: confirmation.value,
        },
      });
      toast('Campaña programada. El envío sale por lotes de 9:00 a 20:00.', 'ok');
      loadCampaigns();
    } catch (error) {
      toast(error.body?.errors?.join(' · ') || error.message, 'error');
    }
  });

  return h('section', { class: 'card' }, h('div', { class: 'card__body' },
    h('h3', {}, 'Nueva campaña'),
    h('div', { class: 'grid-2' }, field('Nombre', name), field('Promoción', promotion)),
    h('div', { class: 'grid-3' }, field('Segmento', type), treatmentField, daysField, monthsField),
    field('Enviar desde', when, 'Vacío = ahora. Solo se envía de 9:00 a 20:00.'),
    h('button', { type: 'button', class: 'btn', onclick: preview }, '🔎 Ver destinatarios, costo y mensaje'),
    result,
    field(`Para confirmar, escribe ${data.confirmWord}`, confirmation, 'Confirmas que estos pacientes dieron su permiso y que la promoción es real.'),
    createBtn));
}

function campaignRow(c) {
  const reportBox = h('div', {});
  const showReport = async () => {
    clear(reportBox, loading('Midiendo…'));
    try {
      const r = await api(`/campaigns/${c.id}/report`);
      clear(reportBox, h('p', {}, `Enviados ${r.sent} · Entregados ${r.delivered} · Leídos ${r.read} · Respondieron ${r.replies} · Citas generadas ${r.appointments}`
        + `${r.failed ? ` · Fallidos ${r.failed}` : ''}${r.skipped ? ` · Omitidos por Meta ${r.skipped}` : ''}`));
    } catch (error) { clear(reportBox, failure(error.message)); }
  };
  const cancel = async () => {
    if (!window.confirm(`¿Cancelar la campaña "${c.name}"?`)) return;
    try { await api(`/campaigns/${c.id}/cancel`, { method: 'POST', body: {} }); loadCampaigns(); } catch (error) { toast(error.message, 'error'); }
  };
  return h('div', { class: 'row' },
    h('div', { class: 'row__head' }, h('strong', {}, c.name), h('span', { class: 'badge' }, STATUS[c.status] || c.status)),
    h('p', { class: 'muted' }, `${new Date(c.scheduled_at).toLocaleString('es-PE')} · ${c.estimated_recipients ?? 0} destinatarios estimados · costo estimado ${money(c.estimated_cost, c.currency)}`),
    c.status_reason ? h('p', { class: 'hint hint--warn' }, c.status_reason) : null,
    h('p', {}, c.promotion_text),
    h('div', { class: 'toolbar' },
      h('button', { type: 'button', class: 'btn btn--small', onclick: showReport }, '📊 Reporte'),
      ['programada', 'enviando', 'pausada'].includes(c.status) ? h('button', { type: 'button', class: 'btn btn--small btn--danger', onclick: cancel }, 'Cancelar') : null),
    reportBox);
}

function render() {
  clear($('#view-campaigns'), h('div', { class: 'config' },
    h('p', { class: 'muted' }, 'Las promociones solo llegan a pacientes que aceptaron recibirlas (el bot pregunta una sola vez, después de agendar), con la plantilla de marketing aprobada y la opción de darse de baja en cada mensaje.'),
    priceCard(),
    newCampaignCard(),
    h('section', { class: 'card' }, h('div', { class: 'card__body' }, h('h3', {}, 'Campañas'),
      data.campaigns.length ? h('div', { class: 'rows' }, data.campaigns.map(campaignRow)) : empty('Todavía no hay campañas.')))));
}
