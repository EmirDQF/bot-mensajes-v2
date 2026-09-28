import api from './api.js';
import {
  $, $$, h, clear, safeUrl, timeLabel, formatPhone, initials, loading, empty, failure, toast,
} from './dom.js';

// Bandeja en vivo: lista (se reordena con cada evento), chat con burbujas paciente/bot/recepción,
// estados de entrega, "Bot escribiendo…", respuestas rápidas y ventana de 24 h de WhatsApp.

const FILTERS = [
  ['all', 'Todos'], ['unread', 'Sin leer'], ['urgent', '🚨 Urgencias'], ['requests', '📅 Solicitudes'], ['paused', '👤 Bot en pausa'],
];
const SCORE = { caliente: '🔥', tibio: '🌤️', frio: '❄️' };
const SCORE_LABEL = { caliente: 'caliente', tibio: 'tibio', frio: 'frío' };
const SENDER_LABEL = { patient: 'Paciente', bot: '🤖 Asistente', reception: '👤 Recepción' };
const TICKS = { sent: '✓', delivered: '✓✓', read: '✓✓' };
const TAG_LABEL = { en_tratamiento: 'En tratamiento', vip: 'VIP', precio_sensible: 'Sensible al precio', no_contactar: 'No contactar' };

const state = {
  list: [], filter: 'all', q: '', selected: null, messages: [], window: null, paused: false,
  templates: [], typing: new Set(), quickReplies: [], loadingList: false, profileOpen: false, profile: null,
};
let ctx = {};
let refreshTimer = null;

export function initInbox(context) {
  ctx = context;
  state.quickReplies = context.clinic?.quickReplies || [];
  clear($('#inboxFilters'), FILTERS.map(([key, label]) => h('button', {
    type: 'button', class: `chip${key === state.filter ? ' is-active' : ''}`, 'aria-pressed': String(key === state.filter), dataset: { filter: key },
    onclick: () => { state.filter = key; $$('#inboxFilters .chip').forEach((b) => { const on = b.dataset.filter === key; b.classList.toggle('is-active', on); b.setAttribute('aria-pressed', String(on)); }); loadList(); },
  }, label)));
  let searchTimer = null;
  $('#inboxSearch').addEventListener('input', (event) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.q = event.target.value.trim(); loadList(); }, 250);
  });
  $('#composer').addEventListener('submit', (event) => { event.preventDefault(); sendText(); });
  $('#composerText').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendText(); }
  });
  $('#btnIntervene').addEventListener('click', () => setBot(true));
  $('#btnBackToBot').addEventListener('click', () => setBot(false));
  $('#btnBackToList').addEventListener('click', () => document.body.classList.remove('show-chat'));
  $('#btnProfile').addEventListener('click', () => toggleProfile(!state.profileOpen));
  document.addEventListener('visibilitychange', () => { if (!document.hidden && state.selected) markRead(state.selected); });
  renderQuickReplies();
  loadList();
}

export function setQuickReplies(list) {
  state.quickReplies = Array.isArray(list) ? list : [];
  renderQuickReplies();
}

// ---------- Lista ----------
export async function loadList() {
  const box = $('#inboxList');
  if (!state.list.length) clear(box, loading('Cargando conversaciones…'));
  try {
    const params = new URLSearchParams({ filter: state.filter, q: state.q });
    state.list = await api(`/conversations?${params}`);
    renderList();
  } catch (error) {
    clear(box, failure(error.message));
  }
}

function scheduleListRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(loadList, 400);
}

// withAgent: incluye 🤖/👤 (en el encabezado del chat ya lo dice el estado del bot).
function badges(c, { withAgent = true } = {}) {
  return [
    c.isTest ? h('span', { class: 'badge badge--test', title: 'Conversación del Probador' }, 'prueba') : null,
    c.urgent ? h('span', { class: 'badge badge--urgent', title: 'Urgencia: el bot está en pausa' }, '🚨 Urgencia') : null,
    c.afterHours ? h('span', { class: 'badge badge--night', title: 'Escribió con la clínica cerrada' }, '🌙') : null,
    c.request ? h('span', { class: 'badge badge--request', title: `Solicitud de cita (${c.request.status})` }, '📅') : null,
    withAgent ? h('span', { class: `badge ${c.paused ? 'badge--human' : 'badge--bot'}`, title: c.paused ? 'Atiende recepción' : 'Atiende el asistente' }, c.paused ? '👤' : '🤖') : null,
    c.leadScore ? h('span', { class: `badge badge--score badge--${c.leadScore}`, title: c.leadScoreReason || 'Lead score' }, `${SCORE[c.leadScore] || ''} ${SCORE_LABEL[c.leadScore] || c.leadScore}`) : null,
  ];
}

function renderList() {
  const box = $('#inboxList');
  $('#inboxCount').textContent = `${state.list.length} ${state.list.length === 1 ? 'conversación' : 'conversaciones'}`;
  if (!state.list.length) {
    clear(box, empty(state.q || state.filter !== 'all' ? 'Nada con este filtro.' : 'Aún no hay conversaciones.',
      state.q || state.filter !== 'all' ? 'Prueba con "Todos" o borra la búsqueda.' : 'Cuando un paciente escriba al WhatsApp de la clínica, aparecerá aquí al instante.'));
    return;
  }
  clear(box, state.list.map((c) => h('button', {
    type: 'button',
    class: `conv${c.phone === state.selected ? ' is-active' : ''}${c.unread ? ' is-unread' : ''}${c.urgent ? ' is-urgent' : ''}`,
    'aria-current': c.phone === state.selected ? 'true' : null,
    onclick: () => openChat(c.phone),
  },
  h('span', { class: 'avatar', 'aria-hidden': 'true' }, initials(c.name, c.phone)),
  h('span', { class: 'conv__main' },
    h('span', { class: 'conv__top' },
      h('span', { class: 'conv__name' }, c.name || formatPhone(c.phone)),
      h('span', { class: 'conv__time' }, timeLabel(c.lastMessageAt))),
    h('span', { class: 'conv__preview' }, state.typing.has(c.phone) ? 'escribiendo…' : c.lastMessage),
    h('span', { class: 'conv__badges' }, badges(c))),
  c.unread ? h('span', { class: 'conv__unread', 'aria-label': `${c.unread} sin leer` }, String(c.unread)) : null)));
}

// ---------- Chat ----------
export async function openChat(phone) {
  state.selected = phone;
  state.messages = [];
  document.body.classList.add('show-chat');
  $('#chatEmpty').hidden = true;
  $('#chat').hidden = false;
  renderHeader();
  clear($('#chatMessages'), loading('Cargando mensajes…'));
  renderList();
  if (state.profileOpen) loadProfile();
  await loadChat();
  markRead(phone);
  $('#composerText').focus({ preventScroll: true });
  ctx.onOpenChat?.(phone);
}

async function loadChat({ since = null } = {}) {
  const phone = state.selected;
  if (!phone) return;
  try {
    const data = await api(`/conversations/${phone}/messages${since ? `?since=${encodeURIComponent(since)}` : ''}`);
    if (phone !== state.selected) return;
    state.window = data.window;
    state.paused = data.paused;
    state.templates = data.templates || [];
    if (since) data.messages.forEach(upsertMessage);
    else state.messages = data.messages;
    renderHeader();
    renderMessages();
    renderComposer();
  } catch (error) {
    clear($('#chatMessages'), failure(error.message));
  }
}

async function markRead(phone, { force = false } = {}) {
  const item = state.list.find((c) => c.phone === phone);
  if (item && !item.unread && !force) return;
  try {
    await api(`/conversations/${phone}/read`, { method: 'POST' });
    if (item) { item.unread = 0; renderList(); }
  } catch { /* no es crítico */ }
}

function current() {
  return state.list.find((c) => c.phone === state.selected) || { phone: state.selected };
}

function renderHeader() {
  const c = current();
  $('#chatName').textContent = c.name || formatPhone(c.phone);
  $('#chatPhone').textContent = c.name ? formatPhone(c.phone) : '';
  $('#chatAvatar').textContent = initials(c.name, c.phone);
  clear($('#chatBadges'), badges(c, { withAgent: false }));
  $('#chatBotState').textContent = state.paused ? '👤 Atiende recepción: el bot está en pausa' : '🤖 Atiende el asistente';
  $('#chatBotState').className = `bot-state ${state.paused ? 'is-paused' : 'is-active'}`;
  $('#btnIntervene').hidden = state.paused;
  $('#btnBackToBot').hidden = !state.paused;
}

function upsertMessage(message) {
  const i = state.messages.findIndex((m) => (message.id && m.id === message.id) || (message.wamid && m.wamid === message.wamid));
  if (i >= 0) state.messages[i] = { ...state.messages[i], ...message };
  else state.messages.push(message);
}

function mediaNode(m) {
  const url = safeUrl(m.mediaUrl);
  if (!url) return null;
  if (m.type === 'image' || m.type === 'sticker') {
    return h('button', { type: 'button', class: 'bubble__media', onclick: () => openLightbox(url), 'aria-label': 'Ver foto en grande' },
      h('img', { src: url, alt: m.type === 'sticker' ? 'Sticker' : 'Foto', loading: 'lazy', class: m.type === 'sticker' ? 'is-sticker' : '' }));
  }
  if (m.type === 'audio') return h('audio', { controls: true, preload: 'none', src: url, class: 'bubble__audio' });
  if (m.type === 'video') return h('video', { controls: true, preload: 'none', src: url, class: 'bubble__video' });
  return h('a', { href: url, class: 'bubble__doc', download: 'archivo-del-paciente' }, '📄 Descargar archivo');
}

function messageNode(m) {
  const outgoing = m.sender !== 'patient';
  const tick = outgoing && m.status
    ? m.status === 'failed'
      ? h('span', { class: 'tick tick--failed', title: m.error || 'No se entregó' }, '❌')
      : h('span', { class: `tick${m.status === 'read' ? ' tick--read' : ''}`, title: { sent: 'Enviado', delivered: 'Entregado', read: 'Leído' }[m.status] }, TICKS[m.status])
    : null;
  return h('div', { class: `msg msg--${m.sender}` },
    h('div', { class: 'bubble' },
      outgoing ? h('span', { class: 'bubble__who' }, SENDER_LABEL[m.sender]) : null,
      mediaNode(m),
      m.text ? h('p', { class: 'bubble__text' }, m.text) : null,
      h('span', { class: 'bubble__meta' }, m.isTest ? h('span', { class: 'badge badge--test' }, 'prueba') : null, timeLabel(m.at), tick),
      m.status === 'failed' && m.error ? h('p', { class: 'bubble__error', role: 'note' }, `❌ ${m.error}`) : null));
}

function renderMessages() {
  const box = $('#chatMessages');
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
  if (!state.messages.length) {
    clear(box, empty('Sin mensajes todavía.'));
  } else {
    clear(box, state.messages.map(messageNode));
  }
  if (nearBottom || !box.dataset.ready) box.scrollTop = box.scrollHeight;
  box.dataset.ready = '1';
  $('#typingIndicator').hidden = !state.typing.has(state.selected) || state.paused;
}

function renderQuickReplies() {
  const box = $('#quickReplies');
  if (!box) return;
  clear(box, state.quickReplies.map((text) => h('button', {
    type: 'button', class: 'chip chip--quick', title: text,
    onclick: () => { const input = $('#composerText'); input.value = text; input.focus(); },
  }, text.length > 38 ? `${text.slice(0, 36)}…` : text)));
  box.hidden = !state.quickReplies.length;
}

function renderComposer() {
  const open = state.window?.open !== false;
  $('#composer').hidden = !open;
  $('#quickReplies').hidden = !open || !state.quickReplies.length;
  const notice = $('#windowNotice');
  notice.hidden = open;
  if (!open) {
    clear(notice,
      h('p', { class: 'window-notice__text' }, '⏰ Pasaron más de 24 h desde el último mensaje del paciente. WhatsApp solo permite enviar una plantilla aprobada; cuando el paciente responda, podrás escribirle libremente.'),
      state.templates.map((t) => h('button', { type: 'button', class: 'btn btn--primary', onclick: () => sendTemplate(t.key) }, `📨 ${t.label}`)),
      state.templates.length ? h('p', { class: 'window-notice__hint' }, state.templates[0].preview) : null);
  }
}

async function sendText() {
  const input = $('#composerText');
  const text = input.value.trim();
  if (!text || !state.selected) return;
  const button = $('#btnSend');
  button.disabled = true;
  try {
    const result = await api(`/conversations/${state.selected}/messages`, { method: 'POST', body: { text } });
    input.value = '';
    upsertMessage(result.message);
    state.paused = true;
    renderHeader();
    renderMessages();
  } catch (error) {
    if (error.body?.code === 'outside_window') {
      state.window = { open: false };
      state.templates = error.body.templates || [];
      renderComposer();
    }
    if (error.body?.message) { upsertMessage(error.body.message); renderMessages(); }
    toast(error.message, 'error');
  } finally {
    button.disabled = false;
  }
}

async function sendTemplate(key) {
  try {
    const result = await api(`/conversations/${state.selected}/messages`, { method: 'POST', body: { template: key } });
    upsertMessage(result.message);
    state.paused = true;
    renderHeader();
    renderMessages();
    toast('Plantilla enviada. Cuando el paciente responda, podrás escribirle.', 'ok');
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function setBot(paused) {
  try {
    await api(`/conversations/${state.selected}/bot`, { method: 'POST', body: { paused } });
    state.paused = paused;
    const item = state.list.find((c) => c.phone === state.selected);
    if (item) item.paused = paused;
    renderHeader();
    renderList();
    toast(paused ? 'Bot en pausa: ahora respondes tú.' : 'La conversación volvió al asistente.', 'ok');
  } catch (error) {
    toast(error.message, 'error');
  }
}

// ---------- Ficha del paciente ----------
function toggleProfile(open) {
  state.profileOpen = open;
  $('#profile').hidden = !open;
  $('#btnProfile').setAttribute('aria-expanded', String(open));
  if (open) loadProfile();
}

async function loadProfile() {
  const phone = state.selected;
  const box = $('#profile');
  if (!phone) return;
  clear(box, loading('Cargando ficha…'));
  try {
    const data = await api(`/conversations/${phone}/profile`);
    if (phone !== state.selected) return;
    state.profile = data;
    renderProfile();
  } catch (error) {
    clear(box, profileHead(), failure(error.message));
  }
}

function profileHead() {
  return h('div', { class: 'profile__head' }, h('h3', {}, 'Ficha del paciente'),
    h('button', { type: 'button', class: 'btn btn--ghost btn--small', 'aria-label': 'Cerrar ficha', onclick: () => { toggleProfile(false); $('#btnProfile').focus(); } }, '✕'));
}

function renderProfile() {
  const { profile: p, tags, treatments } = state.profile;
  const field = (label, input, hint) => h('div', { class: 'field' }, h('label', { for: input.id }, label), input, hint ? h('p', { class: 'profile__hint' }, hint) : null);
  const name = h('input', { type: 'text', id: 'profileName', maxlength: '80', value: p.nombre, autocomplete: 'off' });
  const treatment = h('input', { type: 'text', id: 'profileTreatment', maxlength: '80', value: p.treatmentInterest, list: 'profileTreatments', autocomplete: 'off' });
  const notes = h('textarea', { id: 'profileNotes', maxlength: '1000' }, p.notes);
  const botNotes = h('textarea', { id: 'profileBotNotes', maxlength: '500' }, p.botNotes);
  const form = h('form', { class: 'profile__form', onsubmit: (event) => { event.preventDefault(); saveProfile(form); } },
    field('Nombre', name),
    field('Tratamiento de interés', treatment),
    h('datalist', { id: 'profileTreatments' }, treatments.map((t) => h('option', { value: t }))),
    h('fieldset', { class: 'profile__tags' },
      h('legend', { class: 'sr-only' }, 'Etiquetas'),
      tags.map((tag) => h('label', {}, h('input', { type: 'checkbox', name: 'tag', value: tag, checked: p.tags.includes(tag) }), TAG_LABEL[tag] || tag))),
    h('p', { class: 'profile__hint' }, '"No contactar" detiene los mensajes de seguimiento automáticos.'),
    field('Notas internas', notes, 'Solo las ve el equipo.'),
    field('Notas para el bot', botNotes, 'El asistente las usa como contexto (ej.: "prefiere citas en la tarde"). No escribas datos clínicos.'),
    h('button', { type: 'submit', class: 'btn btn--primary btn--block' }, 'Guardar ficha'));
  clear($('#profile'),
    profileHead(),
    p.leadScore ? h('p', { class: 'profile__hint' }, h('span', { class: `badge badge--score badge--${p.leadScore}` }, `${SCORE[p.leadScore] || ''} ${SCORE_LABEL[p.leadScore] || p.leadScore}`), ' ', p.leadScoreReason || '') : null,
    form);
}

async function saveProfile(form) {
  const button = $('button[type="submit"]', form);
  button.disabled = true;
  const body = {
    nombre: $('#profileName', form).value,
    treatmentInterest: $('#profileTreatment', form).value,
    tags: $$('input[name="tag"]:checked', form).map((i) => i.value),
    notes: $('#profileNotes', form).value,
    botNotes: $('#profileBotNotes', form).value,
  };
  try {
    const data = await api(`/conversations/${state.selected}/profile`, { method: 'PUT', body });
    state.profile = { ...state.profile, profile: data.profile };
    const item = state.list.find((c) => c.phone === state.selected);
    if (item) { item.tags = data.profile.tags; if (data.profile.nombre) item.name = data.profile.nombre; }
    renderProfile();
    renderHeader();
    renderList();
    toast('Ficha guardada.', 'ok');
  } catch (error) {
    toast(error.message, 'error');
    button.disabled = false;
  }
}

function openLightbox(url) {
  const box = $('#lightbox');
  $('#lightboxImage').src = url;
  box.hidden = false;
  $('#lightboxClose').focus();
}

// ---------- Eventos en vivo ----------
export function handleLiveEvent(type, data) {
  const phone = data?.phone;
  if (type === 'message') {
    const item = state.list.find((c) => c.phone === phone);
    if (item && data.conversation) {
      item.lastMessage = data.conversation.lastMessage;
      item.lastMessageAt = data.conversation.lastMessageAt;
      if (data.conversation.name) item.name = item.name || data.conversation.name;
      if (data.message?.sender === 'patient' && phone !== state.selected) item.unread = (item.unread || 0) + 1;
      state.list = [item, ...state.list.filter((c) => c !== item)];
      state.list.sort((a, b) => Number(b.urgent) - Number(a.urgent));
      renderList();
    } else {
      scheduleListRefresh();
    }
    if (phone === state.selected && data.message) {
      upsertMessage(data.message);
      if (data.message.sender !== 'patient') state.typing.delete(phone);
      renderMessages();
      if (data.message.sender === 'patient') {
        state.window = { open: true };
        renderComposer();
        if (!document.hidden) markRead(phone, { force: true });
      }
    }
  } else if (type === 'status') {
    if (phone === state.selected) {
      const m = state.messages.find((x) => x.wamid === data.wamid);
      if (m) { m.status = data.status; m.error = data.error; renderMessages(); }
    }
  } else if (type === 'typing') {
    if (data.typing) state.typing.add(phone); else state.typing.delete(phone);
    if (phone === state.selected) $('#typingIndicator').hidden = !data.typing || state.paused;
    renderList();
  } else if (type === 'bot') {
    const item = state.list.find((c) => c.phone === phone);
    if (item) { item.paused = data.paused; item.urgent = data.paused && data.reason === 'urgencia'; }
    if (phone === state.selected) { state.paused = data.paused; renderHeader(); }
    renderList();
  } else if (type === 'handoff' || type === 'appointment' || type === 'conversation') {
    // Lead score nuevo en la ficha abierta.
    if (type === 'conversation' && phone === state.selected && data.leadScore && state.profile?.profile) {
      state.profile.profile.leadScore = data.leadScore;
      state.profile.profile.leadScoreReason = data.leadScoreReason;
      if (state.profileOpen) renderProfile();
    }
    scheduleListRefresh();
  }
}

// Tras reconectar o si el servidor pide "resync": lista completa y mensajes nuevos del chat abierto.
export function resync() {
  loadList();
  const last = state.messages.at(-1)?.at;
  if (state.selected) loadChat(last ? { since: last } : {});
}

export function selectedPhone() {
  return state.selected;
}
