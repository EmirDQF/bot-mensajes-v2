// Conversaciones reales: se cargan desde /api/panel/conversations tras iniciar sesión.
const conversationData = [];

// Marca de la clínica activa (config/clinics/<id>.js) servida por /api/clinic.
async function loadClinicBranding() {
  try {
    const res = await fetch('/api/clinic');
    if (!res.ok) return;
    const info = await res.json();
    const logo = document.getElementById('brandLogo');
    const name = document.getElementById('brandName');
    if (logo && info.logoUrl) { logo.src = info.logoUrl; logo.alt = info.name; }
    if (name) name.textContent = info.name;
    document.title = `Panel · ${info.name}`;
  } catch (error) {
    console.warn('No se pudo cargar la marca de la clínica', error);
  }
}
loadClinicBranding();

let selectedConversationId = conversationData[0]?.id ?? null;
let pollTimer = null;

const conversationListEl = document.getElementById('conversationList');
const conversationCountEl = document.getElementById('conversationCount');
const searchInputEl = document.getElementById('searchInput');
const chatTitleEl = document.getElementById('chatTitle');
const chatPhoneEl = document.getElementById('chatPhone');
const chatMessagesEl = document.getElementById('chatMessages');
const headerAvatarEl = document.getElementById('headerAvatar');
const lightboxEl = document.getElementById('lightbox');
const lightboxImageEl = document.getElementById('lightboxImage');
const interveneButtonEl = document.getElementById('interveneButton');

function formatDateTime(value) {
  if (!value && value !== 0) return 'Ahora';

  let date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    const asNumber = Number(value);
    if (!Number.isNaN(asNumber)) {
      date = new Date(asNumber);
    }
  }

  if (Number.isNaN(date.getTime())) {
    return 'Ahora';
  }

  const sameDay = date.toDateString() === new Date().toDateString();

  if (sameDay) {
    return new Intl.DateTimeFormat('es-PE', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  }

  return new Intl.DateTimeFormat('es-PE', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

// Mismas etiquetas que acepta el bot: [ENVIAR_FOTO: x] y [ENVIAR_IMAGEN: x] (con o sin "_").
const PHOTO_TAG = /\[\s*(?:ENVIAR[_ ]?(?:FOTO|IMAGEN)|FOTO|IMAGEN)\s*:\s*[^\]]+\]/gi;

function toImageSrc(value) {
  const src = String(value || '');
  if (!src) return null;
  return /^https?:\/\//i.test(src) || src.startsWith('/') ? src : `/media/${src}`;
}

function buildMessageMarkup(message) {
  const isBot = message.sender === 'bot';
  const rowClass = isBot ? 'message-row--bot' : 'message-row--patient';
  // El servidor ya resuelve las etiquetas a message.image; aquí solo se limpian del texto.
  const imageSrc = toImageSrc(message.image);
  const cleanedText = (message.text || '').replace(PHOTO_TAG, '').trim();

  const textMarkup = cleanedText
    ? `<p class="message-text">${escapeHtml(cleanedText).replace(/\n/g, '<br>')}</p>`
    : '';

  const imageMarkup = imageSrc
    ? `<img class="message-image" src="${escapeHtml(imageSrc)}" alt="Imagen del chat" data-image="${escapeHtml(imageSrc)}" />`
    : '';

  return `
    <div class="message-row ${rowClass}">
      <div class="message-bubble">
        ${textMarkup || ''}
        ${imageMarkup || ''}
        <div class="message-meta">${formatDateTime(message.timestamp)}</div>
      </div>
    </div>
  `;
}

function escapeHtml(value = '') {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getConversationById(id) {
  return conversationData.find((conversation) => conversation.id === id) ?? conversationData[0];
}

function renderConversationList() {
  const query = searchInputEl.value.trim().toLowerCase();
  const filtered = conversationData.filter((conversation) => {
    const haystack = `${conversation.name} ${conversation.phone}`.toLowerCase();
    return haystack.includes(query);
  });

  conversationCountEl.textContent = `${filtered.length} ${filtered.length === 1 ? 'conversación' : 'conversaciones'}`;

  conversationListEl.innerHTML = filtered.map((conversation) => {
    const lastMessage = conversation.messages[conversation.messages.length - 1];
    const snippet = lastMessage?.image
      ? 'Imagen compartida'
      : (lastMessage?.text || 'Sin mensajes');
    const timeLabel = formatDateTime(conversation.lastSeen || lastMessage?.timestamp || Date.now());
    const activeClass = conversation.id === selectedConversationId ? 'is-active' : '';

    return `
      <article class="conversation-item ${activeClass}" data-conversation-id="${conversation.id}" tabindex="0">
        <div class="avatar">${conversation.avatar}</div>
        <div class="conversation-item__main">
          <h3>${escapeHtml(conversation.name)}${conversation.waitingHuman ? ' <span class="badge badge--human">Espera humano</span>' : ''}</h3>
          <div class="conversation-item__meta">
            <p class="conversation-item__snippet">${escapeHtml(snippet)}</p>
          </div>
        </div>
        <div class="conversation-item__time">${escapeHtml(timeLabel)}</div>
      </article>
    `;
  }).join('');

  conversationListEl.querySelectorAll('.conversation-item').forEach((item) => {
    item.addEventListener('click', () => selectConversation(item.dataset.conversationId));
    item.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        selectConversation(item.dataset.conversationId);
      }
    });
  });
}

function renderThread() {
  const conversation = getConversationById(selectedConversationId);
  if (!conversation) return;

  chatTitleEl.textContent = conversation.name;
  chatPhoneEl.textContent = conversation.formattedPhone || conversation.phone;
  headerAvatarEl.textContent = conversation.avatar;

  chatMessagesEl.innerHTML = conversation.messages.map(buildMessageMarkup).join('');

  chatMessagesEl.querySelectorAll('.message-image').forEach((image) => {
    image.addEventListener('click', () => {
      lightboxImageEl.src = image.dataset.image;
      lightboxEl.classList.add('is-open');
      lightboxEl.setAttribute('aria-hidden', 'false');
    });
  });

  scrollToBottom();
}

function scrollToBottom() {
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}

function selectConversation(conversationId) {
  selectedConversationId = conversationId;
  renderConversationList();
  renderThread();
  syncInterveneButton();
}

function addIncomingMessage() {
  const conversation = getConversationById(selectedConversationId);
  if (!conversation) return;

  const nextMessage = {
    sender: 'bot',
    text: '¡Perfecto! Te comparto más fotos de nuestros resultados para que puedas elegir la mejor opción. ✨',
    timestamp: Date.now(),
  };

  if (conversation.messages.at(-1)?.text === nextMessage.text) return;

  conversation.messages.push(nextMessage);
  conversation.lastSeen = nextMessage.timestamp;
  renderConversationList();
  renderThread();
}

function authHeader() {
  return window.__panelAuth || null;
}

function openLoginModal() {
  const modal = document.getElementById('loginModal');
  const userEl = document.getElementById('loginUser');
  const passEl = document.getElementById('loginPass');
  const submit = document.getElementById('loginSubmit');
  const cancel = document.getElementById('loginCancel');

  modal.setAttribute('aria-hidden', 'false');
  userEl.focus();

  function closeModal() {
    modal.setAttribute('aria-hidden', 'true');
    submit.removeEventListener('click', onSubmit);
    cancel.removeEventListener('click', onCancel);
    modal.removeEventListener('keydown', onKeydown);
  }

  function onSubmit() {
    const u = String(userEl.value || '').trim();
    const p = String(passEl.value || '').trim();
    if (!u || !p) {
      alert('Usuario y contraseña son requeridos');
      return;
    }
    window.__panelAuth = 'Basic ' + btoa(`${u}:${p}`);
    try { localStorage.setItem('panelAuth', window.__panelAuth); } catch (e) { console.warn('localStorage not available', e); }
    closeModal();
    // start polling now that we have credentials
    startPolling();
  }

  function onCancel() {
    closeModal();
  }

  function onKeydown(e) {
    if (e.key === 'Enter') onSubmit();
    if (e.key === 'Escape') onCancel();
  }

  submit.addEventListener('click', onSubmit);
  cancel.addEventListener('click', onCancel);
  modal.addEventListener('keydown', onKeydown);
}

// Initialize auth from localStorage if present
function initAuthFromStorage() {
  try {
    const stored = localStorage.getItem('panelAuth');
    if (stored) {
      window.__panelAuth = stored;
      return true;
    }
  } catch (e) {
    // ignore
  }
  return false;
}

// Ensure login modal shows if not authenticated
window.addEventListener('load', () => {
  const had = initAuthFromStorage();
  if (!had) {
    openLoginModal();
  } else {
    // start polling immediately
    startPolling();
  }

  // Wire logout button
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      try { localStorage.removeItem('panelAuth'); } catch (e) { /* ignore */ }
      window.__panelAuth = null;
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      // clear data and UI
      conversationData.length = 0;
      renderConversationList();
      const chatMessagesEl = document.getElementById('chatMessages');
      if (chatMessagesEl) chatMessagesEl.innerHTML = '';
      // show login modal
      openLoginModal();
    });
  }
});

async function fetchConversationsFromApi() {
  try {
    const h = authHeader(); if (!h) return;
    const res = await fetch('/api/panel/conversations', { headers: { Authorization: h } });
    if (!res.ok) return;
    const list = await res.json();
    // map to local conversationData shape
    conversationData.length = 0;
    for (const c of list) {
      const phoneId = String(c.phone || '').replace(/\D/g, '') || String(c.phone || '');
      conversationData.push({
        id: phoneId,
        name: c.name || c.phone || phoneId,
        phone: c.phone || phoneId,
        formattedPhone: c.phone || phoneId,
        avatar: (c.name || c.phone || '').charAt(0).toUpperCase() || 'C',
        status: c.status || null,
        waitingHuman: Boolean(c.waitingHuman),
        lastSeen: c.timestamp ? (Number(String(c.timestamp).length > 10 ? c.timestamp : c.timestamp * 1000) ) : Date.now(),
        messages: []
      });
    }
    renderConversationList();
    syncInterveneButton();
    if (!selectedConversationId && conversationData.length) {
      selectedConversationId = conversationData[0].id;
      await fetchMessagesFromApi(selectedConversationId);
      renderConversationList();
      renderThread();
    }
  } catch (e) {
    console.error('fetchConversationsFromApi error', e);
  }
}

async function fetchMessagesFromApi(phone) {
  try {
    const h = authHeader(); if (!h) return;
    const res = await fetch(`/api/panel/messages/${encodeURIComponent(phone)}`, { headers: { Authorization: h } });
    if (!res.ok) return;
    const msgs = await res.json();
    const conv = conversationData.find((c) => String(c.phone).replace(/\D/g,'') === String(phone).replace(/\D/g,''));
    if (!conv) return;
    conv.messages = msgs.map((m) => ({
      sender: (m.from && String(m.from).toLowerCase().includes('bot')) || (m.from === 'panel') ? 'bot' : 'patient',
      text: m.text || null,
      image: (m.image && String(m.image).startsWith('/media/')) ? String(m.image).replace(/^\/media\//,'') : (m.image ? String(m.image) : null),
      timestamp: m.timestamp || null
    }));
    renderThread();
  } catch (e) {
    console.error('fetchMessagesFromApi error', e);
  }
}

function startPolling() {
  // immediate fetch then polling every 2.5s
  if (pollTimer) clearInterval(pollTimer);
  (async () => { await fetchConversationsFromApi(); if (selectedConversationId) await fetchMessagesFromApi(selectedConversationId); })();
  pollTimer = setInterval(async () => {
    await fetchConversationsFromApi();
    if (selectedConversationId) await fetchMessagesFromApi(selectedConversationId);
  }, 2500);
}

// "Intervenir" pausa de verdad el bot en la conversación (POST /api/panel/toggle-bot/:phone).
function syncInterveneButton() {
  const conversation = conversationData.find((c) => c.id === selectedConversationId);
  const paused = Boolean(conversation?.waitingHuman);
  interveneButtonEl.classList.toggle('is-active', paused);
  interveneButtonEl.textContent = paused ? 'Reactivar bot' : 'Intervenir';
  interveneButtonEl.style.background = paused ? 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)' : 'linear-gradient(135deg, #10b981 0%, #0f766e 100%)';
  const statusText = document.querySelector('.bot-status');
  statusText.innerHTML = paused
    ? '<span class="bot-status__dot" style="background:#f59e0b; box-shadow: 0 0 10px rgba(245, 158, 11, 0.75);"></span> Bot en pausa: responde tú'
    : '<span class="bot-status__dot"></span> Bot activo';
}

interveneButtonEl.addEventListener('click', async () => {
  const conversation = conversationData.find((c) => c.id === selectedConversationId);
  const h = authHeader();
  if (!conversation || !h) return;
  interveneButtonEl.disabled = true;
  try {
    const res = await fetch(`/api/panel/toggle-bot/${encodeURIComponent(conversation.id)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: h },
      body: JSON.stringify({ paused: !conversation.waitingHuman }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { botEnabled } = await res.json();
    conversation.waitingHuman = !botEnabled;
    renderConversationList();
    syncInterveneButton();
  } catch (error) {
    console.error('No se pudo cambiar el estado del bot', error);
    alert('No se pudo cambiar el estado del bot. Intenta de nuevo.');
  } finally {
    interveneButtonEl.disabled = false;
  }
});

lightboxEl.addEventListener('click', (event) => {
  if (event.target === lightboxEl || event.target.classList.contains('lightbox__close')) {
    lightboxEl.classList.remove('is-open');
    lightboxEl.setAttribute('aria-hidden', 'true');
  }
});

searchInputEl.addEventListener('input', renderConversationList);

// Wire send button and input
const messageInputEl = document.getElementById('messageInput');
const sendBtnEl = document.getElementById('sendBtn');
async function sendMessageToApi(phone, text) {
  try {
    const h = authHeader(); if (!h) return null;
    const res = await fetch('/api/panel/send-message', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: h }, body: JSON.stringify({ phone, text }) });
    const j = await res.json();
    if (!res.ok) { console.warn('send failed', j); return null; }
    return j;
  } catch (e) { console.error('sendMessageToApi error', e); return null; }
}

if (sendBtnEl && messageInputEl) {
  sendBtnEl.addEventListener('click', async () => {
    const text = String(messageInputEl.value || '').trim();
    if (!text) return;
    const phone = selectedConversationId || (conversationData[0] && conversationData[0].phone);
    if (!phone) return alert('Seleccione un chat');
    sendBtnEl.disabled = true;
    const result = await sendMessageToApi(phone, text);
    sendBtnEl.disabled = false;
    if (result) {
      messageInputEl.value = '';
      await fetchMessagesFromApi(phone);
    }
  });

  messageInputEl.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault(); sendBtnEl.click();
    }
  });
}

selectConversation(selectedConversationId);
renderConversationList();
startPolling();

// ---------- Vistas: Conversaciones / Agenda / Métricas ----------

const STATUS_LABELS = {
  pendiente: 'Pendiente',
  confirmada: 'Confirmada',
  reprogramada: 'Reprogramada',
  cancelada: 'Cancelada',
  asistio: 'Asistió',
  no_asistio: 'No asistió',
};
const STATUS_ACTIONS = [
  { status: 'confirmada', label: 'Confirmar' },
  { status: 'asistio', label: 'Asistió' },
  { status: 'no_asistio', label: 'No asistió' },
  { status: 'cancelada', label: 'Cancelar' },
];
let agendaDay = 'today';
let metricsDays = 30;

async function panelFetch(url, options = {}) {
  const h = authHeader();
  if (!h) { openLoginModal(); throw new Error('Sin sesión'); }
  const res = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', Authorization: h, ...(options.headers || {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

function showView(view) {
  document.querySelectorAll('.view-tab').forEach((tab) => {
    const active = tab.dataset.view === view;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  document.getElementById('chatView').hidden = view !== 'chat';
  document.getElementById('agendaView').hidden = view !== 'agenda';
  document.getElementById('metricsView').hidden = view !== 'metrics';
  document.getElementById('reportView').hidden = view !== 'report';
  if (view === 'agenda') loadAgenda();
  if (view === 'metrics') loadMetrics();
  if (view === 'report') loadReport();
}

// ---------- Reporte (semana de garantía / resultados para el dueño) ----------
const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function defaultReportRange() {
  const to = new Date();
  to.setDate(to.getDate() - 1);
  const from = new Date(to);
  from.setDate(from.getDate() - 6);
  return { from: isoDate(from), to: isoDate(to) };
}

function formatMs(ms) {
  if (ms === null || ms === undefined) return 'sin datos';
  if (ms < 60000) return `${Math.max(1, Math.round(ms / 1000))} s`;
  if (ms < 3600000) return `${Math.round(ms / 60000)} min`;
  return `${(ms / 3600000).toFixed(1)} h`;
}

async function loadReport() {
  const sheet = document.getElementById('reportSheet');
  const fromEl = document.getElementById('reportFrom');
  const toEl = document.getElementById('reportTo');
  if (!fromEl.value || !toEl.value) {
    const range = defaultReportRange();
    fromEl.value = range.from;
    toEl.value = range.to;
  }
  sheet.innerHTML = '<p class="muted">Generando reporte…</p>';
  try {
    const r = await panelFetch(`/api/panel/report?from=${encodeURIComponent(fromEl.value)}&to=${encodeURIComponent(toEl.value)}`);
    const soles = (n) => `S/ ${Math.round(n).toLocaleString('es-PE')}`;
    const tiles = [
      ['Conversaciones', r.conversations, `🌙 ${r.conversationsAfterHours} fuera de horario`],
      ['Primera respuesta', formatMs(r.avgFirstResponseMs), r.firstResponseSamples ? `promedio de ${r.firstResponseSamples} conversaciones nuevas` : 'se mide desde la migración 20260927'],
      ['Citas solicitadas', r.requested, `🌙 ${r.requestedAfterHours} con la clínica cerrada`],
      ['Confirmadas', r.confirmed, 'por recepción o por el paciente'],
      ['Asistieron', r.attended, `🚫 ${r.noShows} no asistieron`],
      ['Reprogramadas', r.rescheduled, `en vez de cancelarse · ❌ ${r.cancelled} canceladas`],
      ['Urgencias derivadas', r.urgencies ?? 'sin datos', 'pasadas a recepción de inmediato'],
      ['Valor potencial', soles(r.potentialValue), 'precio "desde" × citas no canceladas'],
    ];
    sheet.innerHTML = `
      <h2>${escapeHtml(r.clinic.name)}</h2>
      <p class="muted">Reporte del ${escapeHtml(r.label)}</p>
      <div class="report-guarantee ${r.guarantee.met ? 'is-met' : 'is-pending'}">🎯 ${escapeHtml(r.guarantee.line)}</div>
      <div class="metrics-tiles">${tiles.map(([label, value, hint]) => `
        <div class="metric-tile"><span class="metric-tile__label">${label}</span><strong class="metric-tile__value">${escapeHtml(String(value))}</strong><span class="metric-tile__hint">${escapeHtml(hint)}</span></div>`).join('')}</div>
      <h3 class="section-title">Citas por anuncio</h3>
      ${r.byAd.length ? `<table class="report-table"><thead><tr><th>Anuncio</th><th class="num">Solicitadas</th><th class="num">Confirmadas</th></tr></thead><tbody>
        ${r.byAd.map((row) => `<tr><td>${escapeHtml(row.ad)}</td><td class="num">${row.requested}</td><td class="num">${row.confirmed}</td></tr>`).join('')}
      </tbody></table>` : '<p class="muted">Aún no hay citas en este periodo.</p>'}
      <p class="report-note">Datos medidos por el asistente en la base de datos de la clínica. "Confirmadas" cuenta las citas que recepción
        marcó como confirmadas o asistidas, o que el paciente confirmó al recordatorio. "Fuera de horario" usa el horario de atención configurado.</p>`;
  } catch (error) {
    sheet.innerHTML = `<p class="muted">⚠️ ${escapeHtml(error.message)}</p>`;
  }
}

async function loadAgenda() {
  const listEl = document.getElementById('agendaList');
  const labelEl = document.getElementById('agendaLabel');
  listEl.innerHTML = '<p class="muted">Cargando agenda…</p>';
  try {
    const agenda = await panelFetch(`/api/panel/agenda?day=${agendaDay}`);
    labelEl.textContent = agenda.label;
    if (!agenda.appointments.length) {
      listEl.innerHTML = '<p class="muted">No hay citas para este día.</p>';
      return;
    }
    listEl.innerHTML = agenda.appointments.map((a) => `
      <article class="agenda-card status--${escapeHtml(a.status)}">
        <div class="agenda-card__time">${escapeHtml(a.timeLabel)}</div>
        <div class="agenda-card__main">
          <h3>${escapeHtml(a.patientName)} <span class="badge badge--${escapeHtml(a.status)}">${escapeHtml(STATUS_LABELS[a.status] || a.status)}</span></h3>
          <p>${escapeHtml(a.treatment)} · <a href="https://wa.me/${escapeHtml(a.phone)}" target="_blank" rel="noopener">+${escapeHtml(a.phone)}</a></p>
          <p class="muted">${a.ad ? `📣 ${escapeHtml(a.ad)}` : ''}${a.reminderSent ? ' · 🔔 recordatorio enviado' : ''}</p>
        </div>
        <div class="agenda-card__actions">
          ${STATUS_ACTIONS.map((action) => `<button type="button" class="status-btn status-btn--${action.status}" data-id="${escapeHtml(a.id)}" data-status="${action.status}" ${a.status === action.status ? 'disabled' : ''}>${action.label}</button>`).join('')}
        </div>
      </article>`).join('');
  } catch (error) {
    listEl.innerHTML = `<p class="muted">⚠️ ${escapeHtml(error.message)}</p>`;
  }
}

async function loadMetrics() {
  const tilesEl = document.getElementById('metricsTiles');
  const byAdEl = document.getElementById('metricsByAd');
  tilesEl.innerHTML = '<p class="muted">Calculando…</p>';
  byAdEl.innerHTML = '';
  try {
    const m = await panelFetch(`/api/panel/metrics?days=${metricsDays}`);
    const tiles = [
      ['Leads', m.leads, 'personas que escribieron'],
      ['Citas creadas', m.appointments, 'por el asistente'],
      ['Tasa de agendamiento', `${m.bookingRate}%`, 'leads que agendaron'],
      ['No-shows', m.noShows, `${m.noShowRate}% de las citas cerradas`],
    ];
    tilesEl.innerHTML = tiles.map(([label, value, hint]) => `
      <div class="metric-tile"><span class="metric-tile__label">${label}</span><strong class="metric-tile__value">${escapeHtml(String(value))}</strong><span class="metric-tile__hint">${hint}</span></div>`).join('');
    const max = Math.max(1, ...m.byAd.map((row) => row.count));
    byAdEl.innerHTML = m.byAd.length
      ? m.byAd.map((row) => `
        <div class="ad-row"><span class="ad-row__name">${escapeHtml(row.ad)}</span>
          <span class="ad-row__bar"><span style="width:${Math.round((row.count / max) * 100)}%"></span></span>
          <strong>${row.count}</strong></div>`).join('')
      : '<p class="muted">Aún no hay citas en este periodo.</p>';
  } catch (error) {
    tilesEl.innerHTML = `<p class="muted">⚠️ ${escapeHtml(error.message)}</p>`;
  }
}

document.querySelectorAll('.view-tab').forEach((tab) => tab.addEventListener('click', () => showView(tab.dataset.view)));
document.querySelectorAll('.day-btn').forEach((btn) => btn.addEventListener('click', () => {
  agendaDay = btn.dataset.day;
  document.querySelectorAll('.day-btn').forEach((b) => b.classList.toggle('is-active', b === btn));
  loadAgenda();
}));
document.getElementById('reportRun').addEventListener('click', loadReport);
document.getElementById('reportPrint').addEventListener('click', () => window.print());
document.getElementById('metricsDays').addEventListener('change', (event) => {
  metricsDays = Number(event.target.value) || 30;
  loadMetrics();
});
document.getElementById('agendaList').addEventListener('click', async (event) => {
  const btn = event.target.closest('.status-btn');
  if (!btn) return;
  btn.disabled = true;
  try {
    await panelFetch(`/api/panel/appointments/${encodeURIComponent(btn.dataset.id)}/status`, {
      method: 'POST', body: JSON.stringify({ status: btn.dataset.status }),
    });
    await loadAgenda();
  } catch (error) {
    btn.disabled = false;
    alert(`No se pudo actualizar la cita: ${error.message}`);
  }
});
