import api from './api.js';
import { $, h, clear, toast, imageSrc, timeLabel, waText } from './dom.js';

// 🧪 Probador (solo el dueño): escribe como si fueras un paciente. Pasa por el MISMO flujo que WhatsApp
// (debounce de 2 s, Gemini, agenda y alertas), pero nada sale a Meta. Todo queda marcado "prueba"
// en la Bandeja y la Agenda, y se borra con "Borrar pruebas".

const SESSION_KEY = 'tester.session';
const SCENARIOS = [
  { label: '🖼️ Catálogo', text: 'Hola! Quiero mejorar mi sonrisa, ¿me dan info de ortodoncia o carillas por favor?' },
  { label: '📋 Requisitos y precio', text: '¿Qué necesito llevar, qué días tienen espacio, cuánto cuesta empezar y cómo agendo?' },
  { label: '🗣️ Muy informal', text: 'info de los frenillos precio pls' },
  { label: '🌙 Ráfaga nocturna', clock: 'night', burst: ['hola', 'vi su anuncio de brackets', 'cuánto es la inicial'] },
  { label: '🦷 Dientes chuecos', text: 'Hola, tengo los dientes chuecos, qué me recomiendan?' },
  { label: '💍 Boda en un mes', text: 'Me caso en un mes y quiero una sonrisa bonita' },
  { label: '💸 "Está caro"', text: 'uy está caro' },
  { label: '🚨 Dolor fuerte', text: 'tengo un dolor muy fuerte en la muela' },
  { label: '🤖 ¿Eres un robot?', text: '¿eres un robot?' },
];

// Modo video (npm run demo:video → /panel?video=1#tester): hora 10:30 p. m., perfil "Carlos Mendoza" y el guion
// del video de referencia paso a paso. En el paso del horario se toca un botón (como en el celular).
const VIDEO_MODE = new URLSearchParams(window.location.search).has('video');
// Solo el nombre (como un perfil de WhatsApp real): el bot le pide el nombre completo, igual que en el video.
const VIDEO_PROFILE = 'Carlos';
export const VIDEO_SCRIPT = [
  'Hola! Vi su anuncio en Instagram y me interesa mucho. Quiero mejorar mi sonrisa, ¿me dan información de ortodoncia o carillas por favor?',
  'Qué buenas fotos! Me llaman la atención los brackets de zafiro y quizás carillas al final. Pero tengo dudas: ¿tengo que llevar radiografías o algo especial? ¿Qué necesito, qué días tienen espacio, cuánto cuesta empezar y cómo agendo?',
  null, // toca un horario
  'Mi nombre completo es Carlos Mendoza.',
  '¡Genial, muchas gracias! Me encantó que me mandaran las fotos de los brackets y carillas 🙌 Nos vemos.',
];

const state = { session: 1, clock: VIDEO_MODE ? 'night' : 'now', messages: [], log: [], built: false, videoStep: 0 };
let session = null;

const randomSession = () => Math.floor(Math.random() * 9000) + 1000;

function readSession() {
  try { return Number(sessionStorage.getItem(SESSION_KEY)) || randomSession(); } catch { return randomSession(); }
}

function saveSession() {
  try { sessionStorage.setItem(SESSION_KEY, String(state.session)); } catch { /* sin almacenamiento */ }
}

function takeSuggestion() {
  try {
    const text = sessionStorage.getItem('tester.suggestion');
    sessionStorage.removeItem('tester.suggestion');
    return text || '';
  } catch { return ''; }
}

export function loadTester(current) {
  session = current;
  if (!state.built) build();
  const suggestion = takeSuggestion();
  if (suggestion) {
    $('#testerText').value = suggestion;
    $('#testerText').focus();
    toast('Cambio guardado. Envía este mensaje para ver cómo responde ahora la asistente.', 'ok');
  }
}

function build() {
  state.built = true;
  state.session = readSession();
  saveSession();
  const clinicName = session?.clinic?.name || 'la clínica';
  const botName = session?.clinic?.botName || 'La asistente';
  const clockButton = (key, label) => h('button', {
    type: 'button', class: key === state.clock ? 'is-active' : '', 'aria-pressed': String(key === state.clock), dataset: { clock: key },
    onclick: () => setClock(key),
  }, label);

  clear($('#view-tester'),
    h('div', { class: 'tester' },
      h('section', { class: 'tester__phone', 'aria-label': 'Chat de prueba' },
        h('header', { class: 'tester__bar' },
          h('span', { class: 'avatar', 'aria-hidden': 'true' }, '🧪'),
          h('div', {},
            h('strong', {}, `${botName} · ${clinicName}`),
            h('p', { class: 'tester__sub', id: 'testerStatus', role: 'status' }, 'Escribe como si fueras un paciente'))),
        h('div', { id: 'testerNotice', class: 'tester__notice', hidden: true, role: 'status' }),
        h('div', { id: 'testerChat', class: 'tester__chat', 'aria-live': 'polite' }),
        h('p', { id: 'testerTyping', class: 'typing', hidden: true },
          h('span', { class: 'typing__dots', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')), ` ${botName} está escribiendo…`),
        h('form', { class: 'composer', onsubmit: (event) => { event.preventDefault(); sendTyped(); } },
          h('label', { for: 'testerText', class: 'sr-only' }, 'Mensaje de prueba'),
          h('textarea', {
            id: 'testerText', rows: '1', maxlength: '1000', placeholder: 'Escribe como paciente… (Enter envía)',
            onkeydown: (event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendTyped(); } },
          }),
          h('button', { type: 'submit', class: 'btn btn--primary' }, 'Enviar'))),
      h('aside', { class: 'tester__side', 'aria-label': 'Controles del Probador' },
        h('h2', { class: 'tester__title' }, '🧪 Probador'),
        h('p', { class: 'muted' }, 'El mismo flujo que WhatsApp, con la asistente real, pero sin enviar nada a Meta. Todo aparece en vivo en la Bandeja y la Agenda con la etiqueta "prueba".'),
        h('div', { class: 'field' }, h('span', {}, 'Hora del bot'),
          h('div', { id: 'testerClock', class: 'segmented', role: 'group', 'aria-label': 'Hora simulada' },
            clockButton('now', 'Ahora'), clockButton('night', '🌙 10:30 p. m.'))),
        VIDEO_MODE ? h('div', { class: 'field' }, h('span', {}, '🎬 Guion del video'),
          h('button', { type: 'button', id: 'testerVideoNext', class: 'btn btn--primary', onclick: nextVideoLine }, videoLabel())) : null,
        h('div', { class: 'field' }, h('span', {}, 'Escenarios'),
          h('div', { class: 'chips' }, SCENARIOS.map((s) => h('button', { type: 'button', class: 'chip', onclick: () => runScenario(s) }, s.label)))),
        h('div', { class: 'tester__actions' },
          h('button', { type: 'button', class: 'btn', onclick: newConversation }, '➕ Nueva conversación'),
          h('button', { type: 'button', class: 'btn btn--danger', onclick: resetTests }, '🗑️ Borrar pruebas')),
        h('h3', { class: 'section-title' }, 'Lo que hizo el sistema'),
        h('ol', { id: 'testerLog', class: 'tester__log', 'aria-live': 'polite' }))));

  window.addEventListener('panel:live', (event) => onLive(event.detail.type, event.detail.data));
  renderChat();
  renderLog();
}

function videoLabel() {
  const step = state.videoStep;
  if (step >= VIDEO_SCRIPT.length) return '✅ Guion terminado';
  return VIDEO_SCRIPT[step] === null ? `Paso ${step + 1}/${VIDEO_SCRIPT.length}: toca un horario 👆` : `Siguiente línea (${step + 1}/${VIDEO_SCRIPT.length})`;
}

// Escribe la siguiente línea en la caja (Enter la envía), o salta el paso de tocar un horario.
function nextVideoLine() {
  const line = VIDEO_SCRIPT[state.videoStep];
  if (state.videoStep >= VIDEO_SCRIPT.length) return;
  state.videoStep += 1;
  if (line) {
    const input = $('#testerText');
    input.value = line;
    input.focus();
  }
  $('#testerVideoNext').textContent = videoLabel();
}

function setClock(key) {
  state.clock = key;
  document.querySelectorAll('#testerClock button').forEach((b) => {
    const on = b.dataset.clock === key;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-pressed', String(on));
  });
}

// Mismo número que arma el servidor (services/testContext.js: prefijo 5100000, nunca es un celular real).
const phone = () => `5100000${String(state.session).padStart(4, '0').slice(-4)}`;

function addLog(text) {
  state.log.unshift({ text, at: new Date().toISOString() });
  state.log = state.log.slice(0, 30);
  renderLog();
}

function renderLog() {
  const box = $('#testerLog');
  if (!box) return;
  clear(box, state.log.length
    ? state.log.map((item) => h('li', {}, h('span', { class: 'muted' }, timeLabel(item.at)), ' ', item.text))
    : h('li', { class: 'muted' }, 'Aún nada. Envía un mensaje o elige un escenario.'));
}

// Botones de WhatsApp (hasta 3) o lista de horarios: al tocar uno se envía su texto, como en el celular.
function buttonsNode(m) {
  if (!m.buttons?.length) return null;
  const isList = m.buttonsKind === 'list';
  return h('div', { class: `tester__buttons${isList ? ' tester__buttons--list' : ''}`, role: 'group', 'aria-label': 'Opciones del mensaje' },
    isList ? h('span', { class: 'muted' }, '📋 Lista: elige una opción') : null,
    ...m.buttons.map((title) => h('button', { type: 'button', class: 'tester__button', onclick: () => send(title, { fromButton: true }) }, /\d:\d\d/.test(title) ? `📅 ${title}` : title)));
}

function renderChat() {
  const box = $('#testerChat');
  if (!box) return;
  clear(box, state.messages.length
    ? state.messages.map((m) => h('div', { class: `msg tester__msg tester__msg--${m.from}` },
      h('div', { class: 'bubble' },
        h('span', { class: 'bubble__who' }, m.from === 'bot' ? '🤖 Asistente' : '🧑 Tú (paciente)'),
        m.media && imageSrc(m.media) ? h('img', { src: imageSrc(m.media), alt: 'Foto enviada por la asistente', class: 'tester__img', loading: 'lazy' }) : null,
        m.text ? h('p', { class: 'bubble__text' }, waText(m.text)) : null,
        h('span', { class: 'bubble__meta' }, timeLabel(m.at))),
      buttonsNode(m)))
    : h('div', { class: 'state state--empty' },
      h('p', { class: 'state__title' }, 'Conversación de prueba vacía'),
      h('p', { class: 'state__hint' }, 'Tip: prueba la "Ráfaga nocturna": tres mensajes seguidos a las 10:30 p. m. se responden una sola vez.')));
  box.scrollTop = box.scrollHeight;
}

function setWaiting(on) {
  $('#testerTyping').hidden = !on;
  $('#testerStatus').textContent = on ? 'Esperando la respuesta (2 s de espera + asistente)…' : 'Escribe como si fueras un paciente';
}

async function send(text, { fromButton = false } = {}) {
  state.messages.push({ from: 'patient', text, fromButton, at: new Date().toISOString() });
  renderChat();
  setWaiting(true);
  try {
    const body = { text, session: state.session, clock: state.clock, ...(VIDEO_MODE ? { profileName: VIDEO_PROFILE } : {}) };
    await api('/tester/message', { method: 'POST', body });
    // Tocar un horario en el paso del guion que lo pide cuenta como hecho.
    if (VIDEO_MODE && VIDEO_SCRIPT[state.videoStep] === null && state.messages.at(-1)?.fromButton) nextVideoLine();
  } catch (error) {
    setWaiting(false);
    toast(error.message, 'error');
  }
}

function sendTyped() {
  const input = $('#testerText');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  send(text);
}

async function runScenario(scenario) {
  if (scenario.clock) setClock(scenario.clock);
  if (!scenario.burst) {
    send(scenario.text);
    return;
  }
  addLog(`Ráfaga de ${scenario.burst.length} mensajes: la espera de 2 s los junta en una sola respuesta.`);
  for (const text of scenario.burst) {
    await send(text);
    await new Promise((resolve) => setTimeout(resolve, 450));
  }
}

function newConversation() {
  state.session = randomSession();
  saveSession();
  state.messages = [];
  state.log = [];
  state.noticeShown = false;
  state.videoStep = 0;
  if ($('#testerVideoNext')) $('#testerVideoNext').textContent = videoLabel();
  if ($('#testerNotice')) $('#testerNotice').hidden = true;
  setWaiting(false);
  renderChat();
  renderLog();
  toast('Nueva conversación: la asistente te verá como un paciente nuevo.', 'ok');
}

async function resetTests() {
  if (!window.confirm('¿Borrar todas las conversaciones y citas de prueba? Las de pacientes reales no se tocan.')) return;
  try {
    const result = await api('/tester/reset', { method: 'POST', body: { session: state.session } });
    state.messages = [];
    state.log = [];
    renderChat();
    renderLog();
    toast(`Pruebas borradas: ${result.conversations} conversaciones y ${result.appointments} citas.`, 'ok');
  } catch (error) {
    toast(error.message, 'error');
  }
}

// Notificación de WhatsApp sobre el celular (como la alerta al doctor del video). Queda hasta cerrarla.
function showNotice(who, data) {
  const box = $('#testerNotice');
  if (!box || !data.text) return;
  state.noticeShown = true;
  clear(box,
    h('div', { class: 'tester__notice-head' },
      h('span', { class: 'tester__notice-app' }, `WhatsApp · ${who} (…${String(data.to).slice(-4)})`),
      h('button', { type: 'button', class: 'tester__notice-close', 'aria-label': 'Cerrar notificación', onclick: () => { box.hidden = true; } }, '×')),
    h('p', { class: 'tester__notice-text' }, waText(data.text)));
  box.hidden = false;
}

function onLive(type, data) {
  if (!data || data.phone !== phone()) return;
  if (type === 'tester') {
    if (data.done) {
      setWaiting(false);
    } else if (data.toPatient) {
      state.messages.push({
        from: 'bot', text: data.template ? `📨 Plantilla ${data.template}` : data.text, media: data.media,
        buttons: data.buttons || null, buttonsKind: data.buttonsKind || null, at: new Date().toISOString(),
      });
      renderChat();
    } else {
      addLog(`📲 Alerta por WhatsApp a …${String(data.to).slice(-4)}: ${String(data.text || '').split('\n')[0].slice(0, 90)}`);
      // La ficha del doctor manda; sin ella, la primera alerta a recepción.
      if (/ALERTA AL DOCTOR/.test(data.text || '')) showNotice('Doctor', data);
      else if (!state.noticeShown) showNotice('Recepción', data);
    }
  } else if (type === 'appointment' && data.event === 'nueva') {
    addLog('📅 Solicitud de cita registrada en la Agenda (marcada "prueba").');
  } else if (type === 'handoff') {
    addLog(data.reason === 'urgencia' ? '🚨 Urgencia: el bot se pausó y avisó a recepción.' : '🙋 Pidió hablar con una persona: el bot se pausó.');
  } else if (type === 'conversation' && data.leadScore) {
    addLog(`Lead score: ${{ caliente: '🔥', tibio: '🌤️', frio: '❄️' }[data.leadScore] || ''} ${{ caliente: 'caliente', tibio: 'tibio', frio: 'frío' }[data.leadScore] || data.leadScore} — ${data.leadScoreReason || ''}`);
  }
}
