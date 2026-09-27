import api from './api.js';
import {
  $, $$, h, clear, loading, empty, failure, toast, formatMs, soles, formatPhone,
} from './dom.js';

// Agenda, Métricas y Reporte del panel.

const STATUS_LABELS = {
  pendiente: 'Pendiente', confirmada: 'Confirmada', reprogramada: 'Reprogramada', cancelada: 'Cancelada', asistio: 'Asistió', no_asistio: 'No asistió',
};
const STATUS_ACTIONS = [['confirmada', 'Confirmar'], ['asistio', 'Asistió'], ['no_asistio', 'No asistió'], ['cancelada', 'Cancelar']];
let agendaDay = 'today';

export function initViews() {
  $$('#agendaDays button').forEach((btn) => btn.addEventListener('click', () => {
    agendaDay = btn.dataset.day;
    $$('#agendaDays button').forEach((b) => { b.classList.toggle('is-active', b === btn); b.setAttribute('aria-pressed', String(b === btn)); });
    loadAgenda();
  }));
  $('#metricsDays').addEventListener('change', loadMetrics);
  $('#reportRun').addEventListener('click', loadReport);
  $('#reportPrint').addEventListener('click', () => window.print());
}

// ---------- Agenda ----------
export async function loadAgenda() {
  const box = $('#agendaList');
  clear(box, loading('Cargando agenda…'));
  try {
    const agenda = await api(`/agenda?day=${agendaDay}`);
    $('#agendaLabel').textContent = agenda.label;
    if (!agenda.appointments.length) {
      clear(box, empty('No hay citas para este día.', 'Las solicitudes que registre el asistente aparecen aquí para que recepción las confirme.'));
      return;
    }
    clear(box, agenda.appointments.map((a) => h('article', { class: `agenda-card status--${a.status}` },
      h('div', { class: 'agenda-card__time' }, a.timeLabel),
      h('div', { class: 'agenda-card__main' },
        h('h3', {}, a.patientName, ' ', h('span', { class: `badge badge--${a.status}` }, STATUS_LABELS[a.status] || a.status),
          a.isTest ? h('span', { class: 'badge badge--test' }, 'prueba') : null,
          a.afterHours ? h('span', { class: 'badge badge--night', title: 'Solicitada con la clínica cerrada' }, '🌙') : null),
        h('p', {}, `${a.treatment} · `, h('a', { href: `https://wa.me/${a.phone}`, target: '_blank', rel: 'noopener' }, formatPhone(a.phone))),
        h('p', { class: 'muted' }, a.ad ? `📣 ${a.ad}` : '', a.reminderSent ? ' · 🔔 recordatorio enviado' : '')),
      h('div', { class: 'agenda-card__actions' }, STATUS_ACTIONS.map(([status, label]) => h('button', {
        type: 'button', class: `btn btn--small status-btn--${status}`, disabled: a.status === status,
        onclick: async (event) => {
          event.currentTarget.disabled = true;
          try {
            await api(`/appointments/${encodeURIComponent(a.id)}/status`, { method: 'POST', body: { status } });
            toast(`Cita marcada como "${STATUS_LABELS[status]}".`, 'ok');
            loadAgenda();
          } catch (error) {
            toast(`No se pudo actualizar la cita: ${error.message}`, 'error');
            loadAgenda();
          }
        },
      }, label))))));
  } catch (error) {
    clear(box, failure(error.message));
  }
}

function tile(label, value, hint, extra = '') {
  return h('div', { class: `metric-tile ${extra}` },
    h('span', { class: 'metric-tile__label' }, label),
    h('strong', { class: 'metric-tile__value' }, String(value)),
    h('span', { class: 'metric-tile__hint' }, hint));
}

// ---------- Métricas ----------
export async function loadMetrics() {
  const tiles = $('#metricsTiles');
  const byAd = $('#metricsByAd');
  clear(tiles, loading('Calculando métricas…'));
  clear(byAd);
  try {
    const days = Number($('#metricsDays').value) || 30;
    const m = await api(`/metrics?days=${days}`);
    clear(tiles,
      tile('🌙 Citas fuera de horario', m.afterHoursAppointments ?? 0, 'solicitadas con la clínica cerrada', 'metric-tile--night'),
      tile('⚡ Primera respuesta', formatMs(m.avgFirstResponseMs), 'promedio en conversaciones nuevas'),
      tile('💰 Valor potencial', soles(m.potentialValue || 0), 'precio "desde" × citas no canceladas'),
      tile('🎯 Garantía', `${m.guarantee?.confirmed ?? 0}/${m.guarantee?.target ?? 2}`, m.guarantee?.met ? '✅ cumplida (últimos 7 días)' : '⏳ confirmadas en los últimos 7 días', m.guarantee?.met ? 'metric-tile--ok' : ''),
      tile('Leads', m.leads, 'personas que escribieron'),
      tile('Citas creadas', m.appointments, 'por el asistente'),
      tile('Tasa de agendamiento', `${m.bookingRate}%`, 'leads que pidieron cita'),
      tile('No asistieron', m.noShows, `${m.noShowRate}% de las citas cerradas`));
    const max = Math.max(1, ...m.byAd.map((row) => row.count));
    clear(byAd, m.byAd.length
      ? m.byAd.map((row) => h('div', { class: 'ad-row' },
        h('span', { class: 'ad-row__name' }, row.ad),
        h('span', { class: 'ad-row__bar', role: 'img', 'aria-label': `${row.count} citas` }, h('span', { style: `width:${Math.round((row.count / max) * 100)}%` })),
        h('strong', {}, String(row.count))))
      : empty('Aún no hay citas en este periodo.'));
  } catch (error) {
    clear(tiles, failure(error.message));
  }
}

// ---------- Reporte (semana de garantía) ----------
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export async function loadReport() {
  const sheet = $('#reportSheet');
  const fromEl = $('#reportFrom');
  const toEl = $('#reportTo');
  if (!fromEl.value || !toEl.value) {
    const to = new Date();
    to.setDate(to.getDate() - 1);
    const from = new Date(to);
    from.setDate(from.getDate() - 6);
    fromEl.value = iso(from);
    toEl.value = iso(to);
  }
  clear(sheet, loading('Generando reporte…'));
  try {
    const r = await api(`/report?from=${encodeURIComponent(fromEl.value)}&to=${encodeURIComponent(toEl.value)}`);
    clear(sheet,
      h('h2', {}, r.clinic.name),
      h('p', { class: 'muted' }, `Reporte del ${r.label}`),
      h('div', { class: `report-guarantee ${r.guarantee.met ? 'is-met' : 'is-pending'}` }, `🎯 ${r.guarantee.line}`),
      h('div', { class: 'metrics-tiles' },
        tile('Conversaciones', r.conversations, `🌙 ${r.conversationsAfterHours} fuera de horario`),
        tile('Primera respuesta', formatMs(r.avgFirstResponseMs), r.firstResponseSamples ? `promedio de ${r.firstResponseSamples} conversaciones nuevas` : 'se mide desde la migración 20260927'),
        tile('Citas solicitadas', r.requested, `🌙 ${r.requestedAfterHours} con la clínica cerrada`),
        tile('Confirmadas', r.confirmed, 'por recepción o por el paciente'),
        tile('Asistieron', r.attended, `🚫 ${r.noShows} no asistieron`),
        tile('Reprogramadas', r.rescheduled, `en vez de cancelarse · ❌ ${r.cancelled} canceladas`),
        tile('Urgencias derivadas', r.urgencies ?? 'sin datos', 'pasadas a recepción de inmediato'),
        tile('Valor potencial', soles(r.potentialValue), 'precio "desde" × citas no canceladas')),
      h('h3', { class: 'section-title' }, 'Citas por anuncio'),
      r.byAd.length
        ? h('table', { class: 'report-table' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Anuncio'), h('th', { class: 'num' }, 'Solicitadas'), h('th', { class: 'num' }, 'Confirmadas'))),
          h('tbody', {}, r.byAd.map((row) => h('tr', {}, h('td', {}, row.ad), h('td', { class: 'num' }, String(row.requested)), h('td', { class: 'num' }, String(row.confirmed))))))
        : empty('Aún no hay citas en este periodo.'),
      h('p', { class: 'report-note' }, 'Datos medidos por el asistente en la base de datos de la clínica. "Confirmadas" cuenta las citas que recepción marcó como confirmadas o asistidas, o que el paciente confirmó al recordatorio. "Fuera de horario" usa el horario de atención configurado.'));
  } catch (error) {
    clear(sheet, failure(error.message));
  }
}
