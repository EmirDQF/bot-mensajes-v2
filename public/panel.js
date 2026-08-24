const conversationData = [
  {
    id: 'emir-ia',
    name: 'Emir | Automatizaciones IA | Bots',
    phone: '+51 949 973 257',
    formattedPhone: '+51 949 973 257',
    avatar: 'E',
    status: 'Bot activo',
    lastSeen: Date.now() - 1000 * 60 * 3,
    messages: [
      {
        sender: 'patient',
        text: '¿Dónde están ubicados exactamente y cómo hago para llegar?',
        timestamp: Date.now() - 1000 * 60 * 50,
      },
      {
        sender: 'bot',
        text: 'Nos encontramos en la Av. Alameda de la República N° 261, aquí en Huánuco. Te comparto el croquis para que llegues sin problemas. ✨',
        timestamp: Date.now() - 1000 * 60 * 46,
      },
      {
        sender: 'patient',
        text: 'QUE TIPOS DE SERVICIOS OFRECEN',
        timestamp: Date.now() - 1000 * 60 * 42,
      },
      {
        sender: 'bot',
        text: '¡Hola! 🤍 En LUMINZU realizamos:\n• Ortodoncia (brackets tradicionales y para niños)\n• Limpieza dental y kit preventivo\n• Carillas dentales y diseño de sonrisa\n• Implantes dentales\n• Prótesis dental\n• Endodoncia\n• Odontopediatría\n\n¿Cuál de ellos te interesa para darte más detalles o mostrarte fotos? ✨',
        timestamp: Date.now() - 1000 * 60 * 30,
      },
      {
        sender: 'patient',
        text: '¿Me puedes mostrar una foto de su consultorio o cómo es la fachada?',
        timestamp: Date.now() - 1000 * 60 * 17,
      },
      {
        sender: 'bot',
        text: '¡Claro que sí! Aquí te comparto la fachada de la clínica para que la reconozcas al llegar mañana. ✨',
        timestamp: Date.now() - 1000 * 60 * 8,
      },
      {
        sender: 'bot',
        image: 'fachada.jpeg',
        timestamp: Date.now() - 1000 * 60 * 7,
      },
      {
        sender: 'patient',
        text: 'Perfecto, gracias.',
        timestamp: Date.now() - 1000 * 60 * 2,
      },
    ],
  },
];

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

function extractImageFromText(text = '') {
  const match = text.match(/\[ENVIAR_IMAGEN:\s*([^\]]+)\]/i);
  if (!match) return null;
  return match[1].trim();
}

function buildMessageMarkup(message) {
  const isBot = message.sender === 'bot';
  const rowClass = isBot ? 'message-row--bot' : 'message-row--patient';
  const imageName = message.image || extractImageFromText(message.text || '');
  const cleanedText = imageName ? (message.text || '').replace(new RegExp(`\\[ENVIAR_IMAGEN:\\s*${imageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]`, 'i'), '').trim() : (message.text || '');

  const textMarkup = cleanedText
    ? `<p class="message-text">${escapeHtml(cleanedText).replace(/\n/g, '<br>')}</p>`
    : '';

  const imageMarkup = imageName
    ? `<img class="message-image" src="/LUMINZU/${imageName}" alt="Imagen del chat" data-image="/LUMINZU/${imageName}" />`
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
          <h3>${escapeHtml(conversation.name)}</h3>
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
  if (!window.__panelAuth) {
    const val = prompt('Introduce credenciales para el panel (user:pass)');
    if (!val) return null;
    window.__panelAuth = 'Basic ' + btoa(val);
  }
  return window.__panelAuth;
}

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
        lastSeen: c.timestamp ? (Number(String(c.timestamp).length > 10 ? c.timestamp : c.timestamp * 1000) ) : Date.now(),
        messages: []
      });
    }
    renderConversationList();
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
      image: (m.image && String(m.image).startsWith('/LUMINZU/')) ? String(m.image).replace(/^\/LUMINZU\//,'') : (m.image ? String(m.image) : null),
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

interveneButtonEl.addEventListener('click', () => {
  const isIntervened = interveneButtonEl.classList.toggle('is-active');
  interveneButtonEl.textContent = isIntervened ? 'Bot pausado' : 'Intervenir';
  interveneButtonEl.style.background = isIntervened ? 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)' : 'linear-gradient(135deg, #10b981 0%, #0f766e 100%)';
  const statusText = document.querySelector('.bot-status');
  statusText.innerHTML = isIntervened
    ? '<span class="bot-status__dot" style="background:#f59e0b; box-shadow: 0 0 10px rgba(245, 158, 11, 0.75);"></span> Intervención manual'
    : '<span class="bot-status__dot"></span> Bot activo';
});

lightboxEl.addEventListener('click', (event) => {
  if (event.target === lightboxEl || event.target.classList.contains('lightbox__close')) {
    lightboxEl.classList.remove('is-open');
    lightboxEl.setAttribute('aria-hidden', 'true');
  }
});

searchInputEl.addEventListener('input', renderConversationList);

selectConversation(selectedConversationId);
renderConversationList();
startPolling();
