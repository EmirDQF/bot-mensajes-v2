import express from 'express';
import webhookRouter from './routes/webhook.js';
import fs from 'fs/promises';
import path from 'path';
import errorHandler from './middleware/errorHandler.js';

const app = express();
const baseUrl = process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_BASE_URL || 'https://bot-mensajes-dental.onrender.com';
const chatAuditLog = [];
globalThis.chatAuditLog = chatAuditLog;

app.use('/images', express.static(path.join(process.cwd(), 'LUMINZU')));
app.use('/public', express.static(path.join(process.cwd(), 'LUMINZU')));
app.locals.baseUrl = baseUrl.replace(/\/$/, '');

app.use((req, res, next) => {
  const now = new Date().toISOString();
  console.log(`[${now}] [HTTP INCOMING] ${req.method} ${req.originalUrl}`);
  console.log(`[${now}] [HTTP HEADERS]`, JSON.stringify(req.headers, null, 2));
  if (req.body && Object.keys(req.body).length) {
    console.log(`[${now}] [HTTP BODY]`, JSON.stringify(req.body, null, 2));
  }
  next();
});

app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; }, limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

app.use('/webhook', (req, res, next) => {
  const ts = new Date().toISOString();
  console.log(`[${ts}] WEBHOOK INBOUND ${req.method} ${req.originalUrl}`);
  if (req.query && Object.keys(req.query).length) {
    console.log(`[${ts}] WEBHOOK QUERY`, JSON.stringify(req.query, null, 2));
  }
  next();
});

app.use('/webhook', webhookRouter);

// Limpieza de archivos temporales huérfanos relacionados con leads.
// Esto elimina archivos como leads.json.tmp o leads.test.json.tmp que podrían haber quedado si el proceso
// se cayó mientras se escribía el archivo temporal. Se ejecuta al inicio y no bloquea el arranque en caso de error.
(async function cleanupTmpFiles() {
  try {
    const cwd = process.cwd();
    const files = await fs.readdir(cwd);
    for (const f of files) {
      if (/^leads(\.test)?\.json\.tmp$/.test(f)) {
        const p = path.resolve(cwd, f);
        await fs.rm(p, { force: true });
        console.log(`🧹 Removed orphan tmp file: ${p}`);
      }
    }
  } catch (e) {
    console.warn('Error cleaning tmp files at startup:', e && e.message ? e.message : e);
  }
})();
const port = process.env.PORT || 3000;

// Validaciones ligeras de variables de entorno para evitar que PM2 entre en crash loop silencioso
const requiredLike = ['GEMINI_MODEL', 'ADMIN_WHATSAPP_NUMBER', 'WHATSAPP_WEBHOOK_VERIFY_TOKEN'];
for (const v of requiredLike) {
  if (!process.env[v]) {
    console.warn(`Advertencia: la variable de entorno ${v} no está definida. El proceso seguirá, pero algunas funciones pueden no estar disponibles.`);
  }
}
if (!process.env.GEMINI_API_KEY) {
  console.warn('Advertencia crítica: GEMINI_API_KEY no está definida. Las llamadas a Gemini fallarán hasta que se configure. Evitando crash para que PM2 no entre en loop de reintentos.');
}
if (!process.env.WHATSAPP_TOKEN || !process.env.WHATSAPP_PHONE_NUMBER_ID) {
  console.warn('Advertencia: WHATSAPP_TOKEN o WHATSAPP_PHONE_NUMBER_ID no están definidas. El servidor arrancará, pero el envío de mensajes de WhatsApp no funcionará hasta que se configuren.');
}
if (!process.env.WHATSAPP_APP_SECRET) {
  console.warn('Advertencia: WHATSAPP_APP_SECRET no está definida. El webhook aceptará solicitudes sin verificar la firma.');
}

console.log('[ENV DEBUG] PHONE_NUMBER_ID set:', Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.PHONE_NUMBER_ID));
console.log('[ENV DEBUG] WHATSAPP_TOKEN set:', Boolean(process.env.WHATSAPP_TOKEN));
console.log('[ENV DEBUG] VERIFY_TOKEN set:', Boolean(process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || process.env.VERIFY_TOKEN));
console.log('[ENV DEBUG] PORT set:', Boolean(process.env.PORT));

app.get('/', (req, res) => {
  res.send('Bot Dental Operativo 24/7 🚀');
});

// Health endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

app.get('/ping', (req, res) => {
  res.json({ ok: true, message: 'pong', timestamp: new Date().toISOString() });
});

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function requierePassword(req, res, next) {
  const auth = req.headers.authorization;
  const expected = 'Basic ' + Buffer.from(`doctor:${process.env.PANEL_PASSWORD}`).toString('base64');
  if (!process.env.PANEL_PASSWORD || auth !== expected) {
    res.set('WWW-Authenticate', 'Basic realm="Panel LUMINZU"');
    return res.status(401).send('Acceso restringido');
  }
  next();
}

function agruparPorPaciente(messagesLog) {
  const porPaciente = {};
  for (const m of messagesLog) {
    const numero = m?.numero || m?.phone || m?.telefono || '';
    const nombre = m?.nombre || m?.name || numero || 'Paciente';
    if (!porPaciente[numero]) {
      porPaciente[numero] = { numero, nombre, mensajes: [] };
    }
    porPaciente[numero].mensajes.push({
      mensaje: m?.mensaje || m?.userMessage || '',
      respuesta: m?.respuesta || m?.botReply || '',
      timestamp: m?.timestamp || new Date().toISOString(),
    });
  }
  return Object.values(porPaciente).sort((a, b) => {
    const ua = a.mensajes[a.mensajes.length - 1]?.timestamp || 0;
    const ub = b.mensajes[b.mensajes.length - 1]?.timestamp || 0;
    return new Date(ub) - new Date(ua);
  });
}

app.get('/panel/data', requierePassword, (req, res) => {
  const messagesLog = Array.isArray(globalThis.chatAuditLog) ? globalThis.chatAuditLog : [];
  res.json(agruparPorPaciente(messagesLog));
});

const PANEL_CONFIG = {
  clinicName: process.env.CLINIC_NAME || 'LUMINZU',
  doctorName: process.env.DOCTOR_NAME || 'Dr. Frank',
  doctorMessage: process.env.DOCTOR_INTERVENTION_MESSAGE || 'Hola soy el Dr. Frank',
  accentColor: process.env.PANEL_ACCENT_COLOR || '#25d366',
  accentDark: process.env.PANEL_ACCENT_DARK || '#0ea65a',
  bgColor: process.env.PANEL_BG_COLOR || '#0b1220',
  panelSurface: process.env.PANEL_SURFACE || '#111827',
  panelSurfaceAlt: process.env.PANEL_SURFACE_ALT || '#172033',
  bubbleIn: process.env.PANEL_BUBBLE_IN || '#1f2a37',
  bubbleOut: process.env.PANEL_BUBBLE_OUT || '#123524',
  panelTitle: process.env.PANEL_TITLE || 'Panel LUMINZU',
};

const PANEL_HTML = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${PANEL_CONFIG.panelTitle}</title>
  <style>
    :root {
      --bg: ${PANEL_CONFIG.bgColor};
      --surface: ${PANEL_CONFIG.panelSurface};
      --surface-alt: ${PANEL_CONFIG.panelSurfaceAlt};
      --border: rgba(148, 163, 184, 0.22);
      --text: #e5edf8;
      --muted: #94a3b8;
      --accent: ${PANEL_CONFIG.accentColor};
      --accent-strong: ${PANEL_CONFIG.accentDark};
      --bubble-in: ${PANEL_CONFIG.bubbleIn};
      --bubble-out: ${PANEL_CONFIG.bubbleOut};
      --shadow: 0 20px 45px rgba(15, 23, 42, 0.35);
    }
    * { box-sizing:border-box; margin:0; padding:0; }
    body {
      font-family:-apple-system,"Segoe UI",Roboto,sans-serif;
      background:radial-gradient(circle at top, rgba(37, 211, 102, 0.15), transparent 30%), var(--bg);
      color:var(--text); height:100vh; overflow:hidden;
    }
    .app { display:flex; height:100vh; }
    .sidebar {
      width:360px; flex-shrink:0; background:rgba(15, 23, 42, 0.72); border-right:1px solid var(--border);
      display:flex; flex-direction:column; backdrop-filter: blur(12px);
    }
    .sidebar-header {
      padding:18px 16px; border-bottom:1px solid var(--border); display:flex; justify-content:space-between; align-items:center;
      background:linear-gradient(180deg, rgba(18, 30, 48, 0.8), rgba(15, 23, 42, 0.4));
    }
    .sidebar-header h1 { font-size:17px; font-weight:800; letter-spacing:0.04em; }
    .sidebar-header span {
      font-size:11px; color:var(--muted); background:rgba(148, 163, 184, 0.08); border:1px solid var(--border);
      border-radius:999px; padding:5px 9px; min-width:90px; text-align:center;
    }
    .lista-chats { flex:1; overflow-y:auto; padding:8px; }
    .item-chat {
      display:flex; gap:12px; padding:12px 12px; cursor:pointer; border-radius:14px; border:1px solid transparent;
      transition:all .2s ease; margin-bottom:8px;
    }
    .item-chat:hover { background:rgba(148, 163, 184, 0.06); border-color:var(--border); }
    .item-chat.activo { background:linear-gradient(180deg, rgba(37,211,102,0.14), rgba(15,23,42,0.2)); border-color:rgba(37,211,102,0.25); }
    .avatar {
      width:42px; height:42px; border-radius:50%; background:linear-gradient(135deg, var(--accent), var(--accent-strong));
      color:#06210f; display:flex; align-items:center; justify-content:center; font-weight:800; flex-shrink:0; box-shadow:var(--shadow);
    }
    .item-info { flex:1; min-width:0; }
    .item-top { display:flex; justify-content:space-between; gap:8px; align-items:center; }
    .item-nombre { font-weight:700; font-size:14px; }
    .item-hora { font-size:11px; color:var(--muted); flex-shrink:0; }
    .item-preview { margin-top:4px; font-size:13px; color:var(--muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .vacio-lista { padding:20px; color:var(--muted); font-size:13px; text-align:center; }
    .chat-area { flex:1; display:flex; flex-direction:column; }
    .chat-vacio {
      flex:1; display:flex; align-items:center; justify-content:center; color:var(--muted); background:linear-gradient(180deg, rgba(15,23,42,0.35), rgba(15,23,42,0.1));
    }
    .chat-abierto { flex:1; display:none; flex-direction:column; }
    .chat-header {
      display:flex; align-items:center; gap:12px; padding:12px 16px; border-bottom:1px solid var(--border);
      background:rgba(17, 24, 39, 0.9); box-shadow:0 8px 16px rgba(15,23,42,0.15);
    }
    .btn-volver { display:none; background:none; border:none; color:var(--text); font-size:20px; cursor:pointer; }
    .chat-info h2 { font-size:15px; }
    .chat-info span { font-size:12px; color:var(--muted); }
    .btn-intervenir {
      margin-left:auto; background:linear-gradient(135deg, var(--accent), var(--accent-strong)); color:#06210f; text-decoration:none;
      font-weight:700; font-size:13px; padding:9px 14px; border-radius:10px; box-shadow:0 10px 20px rgba(37,211,102,0.35);
    }
    .chat-mensajes { flex:1; overflow-y:auto; padding:18px 18px 24px; display:flex; flex-direction:column; gap:12px; }
    .burbuja {
      max-width:72%; padding:10px 12px; border-radius:16px; font-size:14px; line-height:1.5; box-shadow:0 10px 18px rgba(15,23,42,0.12);
    }
    .burbuja.paciente { align-self:flex-start; background:var(--bubble-in); border-bottom-left-radius:6px; }
    .burbuja.bot { align-self:flex-end; background:var(--bubble-out); border-bottom-right-radius:6px; }
    .burbuja p { white-space:pre-wrap; word-break:break-word; }
    .burbuja .hora { display:block; font-size:10px; color:var(--muted); margin-top:5px; }
    @media (max-width:768px) {
      .sidebar { width:100%; }
      .chat-area { display:none; }
      body.mostrando-chat .sidebar { display:none; }
      body.mostrando-chat .chat-area { display:flex; }
      .btn-volver { display:block; }
    }
  </style>
</head>
<body>
  <div class="app">
    <aside class="sidebar">
      <div class="sidebar-header"><h1>${PANEL_CONFIG.clinicName.toUpperCase()}</h1><span id="contador"></span></div>
      <div class="lista-chats" id="lista-chats"></div>
    </aside>
    <main class="chat-area">
      <div class="chat-vacio" id="chat-vacio"><p>Selecciona una conversación para ver los mensajes</p></div>
      <div class="chat-abierto" id="chat-abierto">
        <div class="chat-header">
          <button class="btn-volver" id="btn-volver">←</button>
          <div class="avatar" id="chat-avatar"></div>
          <div class="chat-info"><h2 id="chat-nombre"></h2><span id="chat-numero"></span></div>
          <a class="btn-intervenir" id="btn-intervenir" target="_blank" rel="noopener">Intervenir</a>
        </div>
        <div class="chat-mensajes" id="chat-mensajes"></div>
      </div>
    </main>
  </div>
  <script>
    const PANEL_BRAND = ${JSON.stringify(PANEL_CONFIG.clinicName)};
    const DOCTOR_NAME = ${JSON.stringify(PANEL_CONFIG.doctorName)};
    const TEXTO_INTERVENCION = encodeURIComponent(${JSON.stringify(PANEL_CONFIG.doctorMessage)});
    let pacientes = [];
    let chatSeleccionado = null;

    async function cargarDatos() {
      try {
        const res = await fetch('/panel/data');
        if (!res.ok) return;
        pacientes = await res.json();
        renderSidebar();
        if (chatSeleccionado) {
          const actual = pacientes.find(p => p.numero === chatSeleccionado);
          if (actual) renderChat(actual);
        }
      } catch (e) { console.error('Error cargando panel:', e); }
    }

    function renderSidebar() {
      document.getElementById('contador').textContent = pacientes.length + ' conversaciones';
      const cont = document.getElementById('lista-chats');
      if (pacientes.length === 0) {
        cont.innerHTML = '<p class="vacio-lista">Aún no hay conversaciones</p>';
        return;
      }
      cont.innerHTML = pacientes.map(function (p) {
        const ultimo = p.mensajes[p.mensajes.length - 1];
        const activo = p.numero === chatSeleccionado ? ' activo' : '';
        const preview = ultimo ? ultimo.mensaje : 'Sin mensajes aún';
        return '<div class="item-chat' + activo + '" data-numero="' + escapeHtml(p.numero) + '">' +
          '<div class="avatar">' + inicial(p.nombre) + '</div>' +
          '<div class="item-info">' +
            '<div class="item-top"><span class="item-nombre">' + escapeHtml(p.nombre) + '</span><span class="item-hora">' + formatearHora(ultimo && ultimo.timestamp) + '</span></div>' +
            '<div class="item-preview">' + escapeHtml(preview) + '</div>' +
          '</div></div>';
      }).join('');
      cont.querySelectorAll('.item-chat').forEach(function (el) {
        el.addEventListener('click', function () {
          abrirChat(el.getAttribute('data-numero'));
        });
      });
    }

    function abrirChat(numero) {
      chatSeleccionado = numero;
      document.body.classList.add('mostrando-chat');
      const p = pacientes.find(p => p.numero === numero);
      if (p) renderChat(p);
      renderSidebar();
    }

    function renderChat(p) {
      document.getElementById('chat-vacio').style.display = 'none';
      document.getElementById('chat-abierto').style.display = 'flex';
      document.getElementById('chat-avatar').textContent = inicial(p.nombre);
      document.getElementById('chat-nombre').textContent = p.nombre;
      document.getElementById('chat-numero').textContent = p.numero;
      document.getElementById('btn-intervenir').href = 'https://wa.me/' + p.numero.replace(/[^0-9]/g, '') + '?text=' + TEXTO_INTERVENCION;
      document.getElementById('btn-intervenir').setAttribute('title', 'Intervenir con ' + DOCTOR_NAME);
      const cont = document.getElementById('chat-mensajes');
      cont.innerHTML = p.mensajes.map(m =>
        '<div class="burbuja paciente"><p>' + escapeHtml(m.mensaje || '') + '</p><span class="hora">' + formatearHora(m.timestamp) + '</span></div>' +
        '<div class="burbuja bot"><p>' + escapeHtml(m.respuesta || '') + '</p><span class="hora">' + formatearHora(m.timestamp) + '</span></div>'
      ).join('');
      cont.scrollTop = cont.scrollHeight;
    }

    document.getElementById('btn-volver').onclick = function () {
      document.body.classList.remove('mostrando-chat');
    };

    function inicial(nombre) { return (nombre || '?').charAt(0).toUpperCase(); }
    function formatearHora(ts) {
      if (!ts) return '';
      return new Date(ts).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
    }
    function escapeHtml(str) {
      return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    document.title = PANEL_BRAND + ' | Panel';
    cargarDatos();
    setInterval(cargarDatos, 4000);
  </script>
</body>
</html>`;

app.get('/panel', requierePassword, (req, res) => {
  res.send(PANEL_HTML);
});

// One-time endpoint to restore WABA subscription from production (use with caution).
// Optional protection: set RESTORE_WABA_KEY in env and call /api/restore-waba?key=<RESTORE_WABA_KEY>
app.get('/api/restore-waba', async (req, res) => {
  try {
    const secret = process.env.RESTORE_WABA_KEY;
    if (secret && req.query.key !== secret) {
      return res.status(403).json({ error: 'Forbidden - invalid key' });
    }

    const wabaId = process.env.WABA_ID || '1363917525928617';
    const token = process.env.WHATSAPP_TOKEN;
    if (!token) {
      console.error('[RESTORE WABA] Missing WHATSAPP_TOKEN');
      return res.status(500).json({ error: 'WHATSAPP_TOKEN not set' });
    }

    console.log(`[RESTORE WABA] Triggering subscription POST for WABA ${wabaId}`);
    const postRes = await fetch(`https://graph.facebook.com/v20.0/${wabaId}/subscribed_apps`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    });
    const postText = await postRes.text();
    let postJson = null;
    try { postJson = JSON.parse(postText); } catch (e) { postJson = postText; }
    console.log('[RESTORE WABA POST]:', postRes.status, postJson);

    console.log('[RESTORE WABA] Verifying subscription with GET');
    const getRes = await fetch(`https://graph.facebook.com/v20.0/${wabaId}/subscribed_apps`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` }
    });
    const getText = await getRes.text();
    let getJson = null;
    try { getJson = JSON.parse(getText); } catch (e) { getJson = getText; }
    console.log('[RESTORE WABA GET]:', getRes.status, getJson);

    return res.status(200).json({ post: postJson, get: getJson });
  } catch (error) {
    console.error('[RESTORE WABA ERROR]:', error && error.message ? error.message : error);
    return res.status(500).json({ error: error && error.message ? error.message : String(error) });
  }
});

// One-time endpoint to register a Phone Number ID with Meta Cloud API (use with caution).
// Optional protection: set REGISTER_PHONE_KEY in env and call /api/register-phone?key=<REGISTER_PHONE_KEY>
app.get('/api/register-phone', async (req, res) => {
  try {
    const secret = process.env.REGISTER_PHONE_KEY;
    if (secret && req.query.key !== secret) {
      return res.status(403).json({ error: 'Forbidden - invalid key' });
    }

    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID || '1337494962770981';
    const token = process.env.WHATSAPP_TOKEN;
    if (!token) {
      console.error('[REGISTER PHONE] Missing WHATSAPP_TOKEN');
      return res.status(500).json({ error: 'WHATSAPP_TOKEN not set' });
    }

    const pin = process.env.WHATSAPP_REGISTER_PIN; // optional

    console.log(`[REGISTER PHONE] Triggering register POST for phone ${phoneId}`);
    const postRes = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/register`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ messaging_product: 'whatsapp', ...(pin ? { pin } : {}) })
    });
    const postText = await postRes.text();
    let postJson = null;
    try { postJson = JSON.parse(postText); } catch (e) { postJson = postText; }
    console.log('[REGISTER PHONE POST]:', postRes.status, postJson);

    console.log('[REGISTER PHONE] Fetching phone status with GET');
    const getRes = await fetch(`https://graph.facebook.com/v20.0/${phoneId}?fields=verified_name,code_verification_status,status`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` }
    });
    const getText = await getRes.text();
    let getJson = null;
    try { getJson = JSON.parse(getText); } catch (e) { getJson = getText; }
    console.log('[REGISTER PHONE GET]:', getRes.status, getJson);

    return res.status(200).json({ post: postJson, get: getJson });
  } catch (error) {
    console.error('[REGISTER PHONE ERROR]:', error && error.message ? error.message : error);
    return res.status(500).json({ error: error && error.message ? error.message : String(error) });
  }
});

function listRegisteredRoutes() {
  try {
    const routes = [];
    const stack = app._router && Array.isArray(app._router.stack) ? app._router.stack : [];

    for (const middleware of stack) {
      if (!middleware) continue;

      if (middleware.route) {
        const methods = Object.keys(middleware.route.methods || {}).join(',').toUpperCase();
        routes.push(`${methods} ${middleware.route.path}`);
        continue;
      }

      if (middleware.name === 'router' && middleware.handle && Array.isArray(middleware.handle.stack)) {
        for (const handler of middleware.handle.stack) {
          if (handler && handler.route) {
            const methods = Object.keys(handler.route.methods || {}).join(',').toUpperCase();
            routes.push(`${methods} ${handler.route.path}`);
          }
        }
      }
    }

    if (routes.length) {
      console.log('[ROUTES REGISTERED]:\n' + routes.join('\n'));
    } else {
      console.log('[ROUTES REGISTERED]: no routes found');
    }
  } catch (e) {
    console.warn('Could not list routes:', e && e.message ? e.message : e);
  }
}

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Promise Rejection:', reason);
});

// One-time endpoint to restore WABA subscription from production (use with caution).
// Optional protection: set RESTORE_WABA_KEY in env and call /api/restore-waba?key=<RESTORE_WABA_KEY>
app.get('/api/restore-waba', async (req, res) => {
  try {
    const secret = process.env.RESTORE_WABA_KEY;
    if (secret && req.query.key !== secret) {
      return res.status(403).json({ error: 'Forbidden - invalid key' });
    }

    const wabaId = process.env.WABA_ID || '1363917525928617';
    const token = process.env.WHATSAPP_TOKEN;
    if (!token) {
      console.error('[RESTORE WABA] Missing WHATSAPP_TOKEN');
      return res.status(500).json({ error: 'WHATSAPP_TOKEN not set' });
    }

    console.log(`[RESTORE WABA] Triggering subscription POST for WABA ${wabaId}`);
    const postRes = await fetch(`https://graph.facebook.com/v20.0/${wabaId}/subscribed_apps`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    });
    const postText = await postRes.text();
    let postJson = null;
    try { postJson = JSON.parse(postText); } catch (e) { postJson = postText; }
    console.log('[RESTORE WABA POST]:', postRes.status, postJson);

    console.log('[RESTORE WABA] Verifying subscription with GET');
    const getRes = await fetch(`https://graph.facebook.com/v20.0/${wabaId}/subscribed_apps`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` }
    });
    const getText = await getRes.text();
    let getJson = null;
    try { getJson = JSON.parse(getText); } catch (e) { getJson = getText; }
    console.log('[RESTORE WABA GET]:', getRes.status, getJson);

    return res.status(200).json({ post: postJson, get: getJson });
  } catch (error) {
    console.error('[RESTORE WABA ERROR]:', error && error.message ? error.message : error);
    return res.status(500).json({ error: error && error.message ? error.message : String(error) });
  }
});

app.use('/webhook', webhookRouter);
app.get('/', (req, res) => {
  res.send('BotDental Lima API is running');
});

// Mount centralized error handler at the end of middleware chain
app.use(errorHandler);

app.listen(port, () => {
  console.log(`Express server listening on port ${port}`);
  if (app._router && app._router.stack) {
    const routes = app._router.stack
      .filter((r) => r && r.route)
      .map((r) => `${Object.keys(r.route.methods).join(',').toUpperCase()} ${r.route.path}`);
    console.log('[ROUTES REGISTERED]:', routes);
  }
});
