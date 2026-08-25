const params = new URLSearchParams(window.location.search);
const supabaseUrl = window.SUPABASE_URL || params.get('url') || 'https://YOUR_PROJECT_REF.supabase.co';
const supabaseAnonKey = window.SUPABASE_ANON_KEY || params.get('key') || 'YOUR_ANON_KEY';

const contactListEl = document.getElementById('contactList');
const messagesContainerEl = document.getElementById('messagesContainer');
const selectedContactLabelEl = document.getElementById('selectedContactLabel');
const selectedContactMetaEl = document.getElementById('selectedContactMeta');

const supabase = window.supabase.createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: false },
  realtime: { params: { eventsPerSecond: 10 } },
});

let selectedContact = null;
const contactGroups = new Map();

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function normalizeMessage(message) {
  return {
    id: message.id,
    conversation_id: message.conversation_id ?? null,
    contact_number: String(message.contact_number ?? '').trim() || 'Sin número',
    sender: message.sender || 'user',
    text: message.text ?? '',
  };
}

function sortMessages(messages) {
  return [...messages].sort((a, b) => Number(a.id) - Number(b.id));
}

function upsertMessage(message) {
  const normalized = normalizeMessage(message);
  const key = normalized.contact_number;
  const current = contactGroups.get(key) ?? [];
  const exists = current.some((item) => item.id === normalized.id);

  if (!exists) {
    contactGroups.set(key, sortMessages([...current, normalized]));
  }

  if (!selectedContact) {
    selectedContact = key;
  }

  renderContacts();
  if (selectedContact === key) {
    renderMessagesForContact(key);
  }
}

function renderContacts() {
  const entries = [...contactGroups.entries()].sort((a, b) => {
    const lastA = a[1][a[1].length - 1];
    const lastB = b[1][b[1].length - 1];
    return Number(lastB?.id ?? 0) - Number(lastA?.id ?? 0);
  });

  if (!entries.length) {
    contactListEl.innerHTML = `
      <div class="mt-6 rounded-2xl border border-dashed border-slate-700 bg-slate-800/40 p-4 text-sm text-slate-400">
        No hay conversaciones aún.
      </div>
    `;
    return;
  }

  contactListEl.innerHTML = entries
    .map(([contactNumber, messages]) => {
      const lastMessage = messages[messages.length - 1];
      const previewText = lastMessage?.text ?? 'Mensaje sin texto';
      const isSelected = selectedContact === contactNumber;

      return `
        <button
          type="button"
          data-contact="${escapeHtml(contactNumber)}"
          class="flex w-full items-center gap-3 rounded-2xl border px-3 py-3 text-left transition ${
            isSelected ? 'border-emerald-500/50 bg-slate-800' : 'border-transparent bg-slate-900/40 hover:border-slate-700 hover:bg-slate-800/50'
          }"
        >
          <div class="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-sm font-bold text-white">
            ${escapeHtml(String(contactNumber).slice(-2) || 'N')}
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-center justify-between gap-2">
              <span class="truncate text-sm font-semibold text-slate-100">${escapeHtml(contactNumber)}</span>
            </div>
            <p class="mt-1 truncate text-xs text-slate-400">${escapeHtml(previewText)}</p>
          </div>
        </button>
      `;
    })
    .join('');

  contactListEl.querySelectorAll('button[data-contact]').forEach((button) => {
    button.addEventListener('click', () => {
      selectedContact = button.dataset.contact;
      renderContacts();
      renderMessagesForContact(selectedContact);
    });
  });
}

function renderMessagesForContact(contactNumber) {
  const messages = (contactGroups.get(contactNumber) ?? []).slice().sort((a, b) => Number(a.id) - Number(b.id));

  selectedContactLabelEl.textContent = contactNumber;
  selectedContactMetaEl.textContent = messages.length
    ? `${messages.length} mensaje${messages.length === 1 ? '' : 's'}`
    : 'Sin mensajes';

  if (!messages.length) {
    messagesContainerEl.innerHTML = `
      <div class="mt-8 rounded-2xl border border-dashed border-slate-700 bg-slate-900/40 p-6 text-center text-sm text-slate-400">
        Aún no hay mensajes para esta conversación.
      </div>
    `;
    return;
  }

  messagesContainerEl.innerHTML = messages
    .map((message) => {
      const isUser = message.sender === 'user';
      const text = message.text ?? 'Mensaje sin texto';

      return `
        <div class="flex ${isUser ? 'justify-start' : 'justify-end'}">
          <div class="message-bubble max-w-[72%] rounded-2xl px-4 py-3 shadow-lg ${
            isUser ? 'border border-slate-700 bg-slate-800 text-slate-100' : 'bg-emerald-500 text-white'
          }">
            <div class="text-[10px] font-medium uppercase tracking-[0.18em] ${isUser ? 'text-slate-300' : 'text-emerald-100'}">
              ${isUser ? 'Usuario' : 'Bot'}
            </div>
            <div class="mt-2 text-sm leading-relaxed whitespace-pre-wrap">${escapeHtml(text)}</div>
          </div>
        </div>
      `;
    })
    .join('');

  requestAnimationFrame(() => {
    messagesContainerEl.scrollTop = messagesContainerEl.scrollHeight;
  });
}

async function loadInitialMessages() {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .order('id', { ascending: true });

  if (error) {
    console.error('Error loading messages:', error);
    messagesContainerEl.innerHTML = `
      <div class="mt-8 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-6 text-center text-sm text-rose-200">
        No se pudieron cargar los mensajes. Revisa la URL y la clave anónima de Supabase.
      </div>
    `;
    return;
  }

  (data || []).forEach((message) => upsertMessage(message));

  if (!selectedContact && contactGroups.size) {
    selectedContact = [...contactGroups.keys()][0];
  }

  if (selectedContact) {
    renderContacts();
    renderMessagesForContact(selectedContact);
  }
}

function subscribeToRealtime() {
  const channel = supabase.channel('realtime:messages');

  channel.on(
    'postgres_changes',
    { event: 'INSERT', schema: 'public', table: 'messages' },
    (payload) => {
      const message = payload.new;
      if (!message) return;
      upsertMessage(message);
    },
  );

  channel.subscribe((status) => {
    if (status !== 'SUBSCRIBED') {
      console.warn('Realtime subscription status:', status);
    }
  });
}

function init() {
  if (!supabaseUrl || supabaseUrl.includes('YOUR_PROJECT_REF') || !supabaseAnonKey || supabaseAnonKey.includes('YOUR_ANON_KEY')) {
    messagesContainerEl.innerHTML = `
      <div class="mt-8 rounded-2xl border border-yellow-500/30 bg-yellow-500/10 p-6 text-sm text-yellow-100">
        Configura <strong>window.SUPABASE_URL</strong> y <strong>window.SUPABASE_ANON_KEY</strong> antes de abrir esta vista.
      </div>
    `;
    selectedContactLabelEl.textContent = 'Configura Supabase';
    selectedContactMetaEl.textContent = 'Falta la configuración del cliente';
    return;
  }

  loadInitialMessages();
  subscribeToRealtime();
}

init();
