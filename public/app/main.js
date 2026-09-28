import api from './api.js';
import { $, $$, h, clear, toast } from './dom.js';
import { connectLive } from './live.js';
import { initInbox, handleLiveEvent, resync, setQuickReplies } from './inbox.js';
import { initViews, loadAgenda, loadMetrics, loadReport } from './views.js';

// Panel de la clínica: inicio de sesión, pestañas según el rol, conexión en vivo y alertas.

const VIEWS = {
  inbox: { label: 'Bandeja' },
  agenda: { label: 'Agenda', load: loadAgenda },
  metrics: { label: 'Métricas', load: loadMetrics },
  report: { label: 'Reporte', load: loadReport },
  config: { label: 'Configuración', owner: true, load: () => import('./config.js').then((m) => m.loadConfig(session)) },
  tester: { label: 'Probador', owner: true, load: () => import('./tester.js').then((m) => m.loadTester(session)) },
};
const LIVE_LABEL = { live: 'En vivo', reconnecting: 'Reconectando…', polling: 'Sin conexión en vivo: actualizando cada 5 s' };
const ALERTS_KEY = 'panel.alerts';

let session = null;
let live = null;
let started = false;

function readAlertsPref() {
  try { return localStorage.getItem(ALERTS_KEY) !== 'off'; } catch { return true; }
}

function saveAlertsPref(on) {
  try { localStorage.setItem(ALERTS_KEY, on ? 'on' : 'off'); } catch { /* sin almacenamiento local */ }
}

// ---------- Sesión ----------
async function showLogin(message = '') {
  live?.close();
  live = null;
  $('#app').hidden = true;
  $('#login').hidden = false;
  $('#loginError').textContent = message;
  $('#loginUser').focus();
}

async function login(event) {
  event.preventDefault();
  const button = $('#loginSubmit');
  button.disabled = true;
  $('#loginError').textContent = '';
  try {
    await api('/login', { method: 'POST', body: { user: $('#loginUser').value.trim(), password: $('#loginPass').value } });
    $('#loginPass').value = '';
    await start();
  } catch (error) {
    $('#loginError').textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function logout() {
  await api('/logout', { method: 'POST' }).catch(() => {});
  window.location.reload();
}

function applyBranding(clinic) {
  if (!clinic) return;
  document.title = `Panel · ${clinic.name}`;
  $('#brandName').textContent = clinic.name;
  const logo = $('#brandLogo');
  if (clinic.logoUrl) { logo.src = clinic.logoUrl; logo.alt = `Logo de ${clinic.name}`; logo.hidden = false; }
  const colors = clinic.colors || {};
  if (/^#[0-9a-f]{6}$/i.test(colors.primary || '')) document.documentElement.style.setProperty('--brand', colors.primary);
  if (/^#[0-9a-f]{6}$/i.test(colors.accent || '')) document.documentElement.style.setProperty('--brand-accent', colors.accent);
}

// ---------- Pestañas ----------
function buildTabs() {
  clear($('#tabs'), Object.entries(VIEWS)
    .filter(([, view]) => !view.owner || session.role === 'owner')
    .map(([key, view]) => h('button', {
      type: 'button', role: 'tab', id: `tab-${key}`, class: 'tab', 'aria-controls': `view-${key}`, 'aria-selected': 'false', dataset: { view: key },
      onclick: () => showView(key),
    }, { inbox: '💬 ', agenda: '📅 ', metrics: '📊 ', report: '📈 ', config: '⚙️ ', tester: '🧪 ' }[key], view.label)));
}

function showView(key) {
  const view = VIEWS[key];
  if (!view || (view.owner && session.role !== 'owner')) return;
  $$('#tabs .tab').forEach((tab) => {
    const on = tab.dataset.view === key;
    tab.classList.toggle('is-active', on);
    tab.setAttribute('aria-selected', String(on));
    tab.tabIndex = on ? 0 : -1;
  });
  $$('.view').forEach((section) => { section.hidden = section.id !== `view-${key}`; });
  document.body.dataset.view = key;
  try { history.replaceState(null, '', `#${key}`); } catch { /* sin historial */ }
  view.load?.();
}

// ---------- Alertas (sonido + notificación del navegador) ----------
let audioCtx = null;
function beep(urgent) {
  try {
    audioCtx ||= new AudioContext();
    const notes = urgent ? [880, 660, 880] : [660, 880];
    notes.forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.15, audioCtx.currentTime + i * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + i * 0.18 + 0.16);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(audioCtx.currentTime + i * 0.18);
      osc.stop(audioCtx.currentTime + i * 0.18 + 0.17);
    });
  } catch { /* el navegador bloqueó el audio */ }
}

function alertUser(title, body, urgent = false) {
  if (!$('#alertsToggle').checked) return;
  beep(urgent);
  if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
    try { new Notification(title, { body, tag: urgent ? 'urgencia' : 'solicitud' }); } catch { /* sin notificaciones */ }
  }
  toast(`${title}: ${body}`, urgent ? 'error' : 'ok');
}

function initAlerts() {
  const toggle = $('#alertsToggle');
  toggle.checked = readAlertsPref();
  toggle.addEventListener('change', () => {
    saveAlertsPref(toggle.checked);
    if (toggle.checked && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission();
  });
}

function onLiveEvent(type, data) {
  // El Probador escucha los eventos en vivo sin acoplarse a la bandeja.
  window.dispatchEvent(new CustomEvent('panel:live', { detail: { type, data } }));
  if (type === 'tester') return;
  handleLiveEvent(type, data);
  if (type === 'settings') refreshClinic();
  if (type === 'handoff' && data.reason === 'urgencia') alertUser('🚨 Urgencia', `${data.contactName || data.phone}: ${data.message || 'requiere atención inmediata'}`, true);
  else if (type === 'handoff') alertUser('🙋 Pide hablar con una persona', data.contactName || data.phone);
  else if (type === 'appointment' && data.event === 'nueva') alertUser('📅 Nueva solicitud de cita', `${data.appointment?.patient_name || data.phone} · ${data.appointment?.treatment || 'evaluación'}`);
  if (type === 'appointment' && document.body.dataset.view === 'agenda') loadAgenda();
}

function setLiveStatus(status) {
  const pill = $('#liveStatus');
  pill.dataset.status = status;
  $('#liveStatusText').textContent = LIVE_LABEL[status] || status;
}

// La configuración cambió (en esta u otra pantalla): marca, colores y respuestas rápidas al día.
async function refreshClinic() {
  try {
    const fresh = await api('/session');
    session.clinic = fresh.clinic;
    applyBranding(fresh.clinic);
    setQuickReplies(fresh.clinic?.quickReplies);
  } catch { /* se reintenta con el próximo cambio */ }
}

// ---------- Arranque ----------
async function start() {
  try {
    session = await api('/session');
    if (!session.authenticated) return showLogin();
  } catch (error) {
    if (error.status === 401) return showLogin();
    return showLogin(error.message);
  }
  $('#login').hidden = true;
  $('#app').hidden = false;
  $('#sessionRole').textContent = session.role === 'owner' ? 'Dueño' : 'Recepción';
  applyBranding(session.clinic);
  buildTabs();
  if (!started) {
    started = true;
    initAlerts();
    initViews();
    initInbox({ clinic: session.clinic });
    $('#logoutBtn').addEventListener('click', logout);
    $('#lightboxClose').addEventListener('click', () => { $('#lightbox').hidden = true; });
    $('#lightbox').addEventListener('click', (event) => { if (event.target.id === 'lightbox') $('#lightbox').hidden = true; });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') $('#lightbox').hidden = true; });
    $('#tabs').addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      const tabs = $$('#tabs .tab');
      const i = tabs.indexOf(document.activeElement);
      const next = tabs[(i + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
      next.focus();
      next.click();
    });
  }
  live?.close();
  live = connectLive({ onEvent: onLiveEvent, onStatus: setLiveStatus, onResync: resync });
  const initial = window.location.hash.slice(1);
  showView(VIEWS[initial] && (!VIEWS[initial].owner || session.role === 'owner') ? initial : 'inbox');
  return undefined;
}

window.addEventListener('panel:unauthorized', () => showLogin('Tu sesión terminó. Vuelve a ingresar.'));
$('#loginForm').addEventListener('submit', login);
start();
