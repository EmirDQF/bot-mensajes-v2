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

app.get('/panel', (req, res) => {
  try {
    const log = Array.isArray(globalThis.chatAuditLog) ? globalThis.chatAuditLog : [];
    const cards = log.length
      ? log.map((entry) => {
          const name = escapeHtml(entry?.name || 'Paciente');
          const phone = escapeHtml(entry?.phone || '');
          const time = escapeHtml(entry?.timestamp || '');
          const patientMessage = escapeHtml(entry?.userMessage || '');
          const assistantReply = escapeHtml(entry?.botReply || '');
          const imageAttachment = entry?.imageAttachment ? escapeHtml(entry.imageAttachment) : null;
          const attachmentBadge = imageAttachment
            ? `<span class="attachment-tag">📎 Adjunto: ${imageAttachment}</span>`
            : '';

          return `
            <article class="conversation-card">
              <div class="conversation-header">
                <div>
                  <h2>${name}</h2>
                  <div class="meta-row">
                    <span>📞 ${phone || 'Sin teléfono'}</span>
                    <span>🕒 ${time || 'Ahora'}</span>
                  </div>
                </div>
                <a class="wa-button" href="https://wa.me/${encodeURIComponent(phone || '')}" target="_blank" rel="noopener noreferrer">📲 Intervenir en WhatsApp</a>
              </div>
              <div class="message-block patient">
                <div class="message-label">Paciente</div>
                <p>${patientMessage || 'Sin mensaje'}</p>
              </div>
              <div class="message-block bot">
                <div class="message-label">Asistente</div>
                <p>${assistantReply || 'Sin respuesta'}</p>
              </div>
              ${attachmentBadge ? `<div class="attachment-row">${attachmentBadge}</div>` : ''}
            </article>
          `;
        }).join('')
      : `<div class="empty-state">Esperando nuevas interacciones desde WhatsApp...</div>`;

    const html = `<!DOCTYPE html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="refresh" content="4" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Panel de administración</title>
    <style>
      :root {
        --bg: #111b21;
        --panel: #202c33;
        --panel-strong: #182229;
        --panel-bot: #005c4b;
        --accent: #00a884;
        --text: #e9edef;
        --muted: #8696a0;
        --border: rgba(255,255,255,0.08);
        --shadow: 0 18px 40px rgba(0,0,0,0.28);
      }
      * { box-sizing: border-box; }
      html, body { margin: 0; min-height: 100%; background: var(--bg); color: var(--text); font-family: Arial, sans-serif; }
      body {
        background:
          radial-gradient(circle at top, rgba(0, 168, 132, 0.14), transparent 18%),
          var(--bg);
      }
      .container {
        width: min(1100px, calc(100% - 24px));
        margin: 0 auto;
        padding: 24px 0 48px;
      }
      .topbar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        margin-bottom: 18px;
      }
      .topbar h1 {
        margin: 0;
        font-size: clamp(1.5rem, 3vw, 2.4rem);
        letter-spacing: -0.03em;
      }
      .ring {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        background: rgba(0, 168, 132, 0.14);
        border: 1px solid rgba(0, 168, 132, 0.32);
        color: var(--text);
        padding: 8px 12px;
        border-radius: 999px;
        font-size: 0.8rem;
      }
      .ring::before {
        content: '';
        width: 9px;
        height: 9px;
        border-radius: 50%;
        background: var(--accent);
        box-shadow: 0 0 16px rgba(0, 168, 132, 0.8);
      }
      .conversation-list {
        display: grid;
        gap: 18px;
      }
      .conversation-card {
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 18px;
        padding: 18px;
        box-shadow: var(--shadow);
      }
      .conversation-header {
        display: flex;
        gap: 14px;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: 14px;
      }
      .conversation-header h2 {
        margin: 0 0 8px;
        font-size: clamp(1.1rem, 2vw, 1.5rem);
      }
      .meta-row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 10px;
        color: var(--muted);
        font-size: 0.8rem;
      }
      .wa-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: var(--accent);
        color: #081b18;
        text-decoration: none;
        border-radius: 10px;
        padding: 11px 14px;
        font-weight: 700;
        font-size: 0.9rem;
        box-shadow: 0 10px 22px rgba(0, 168, 132, 0.25);
        white-space: nowrap;
      }
      .message-block {
        border-radius: 12px;
        padding: 14px 16px;
        margin-top: 12px;
      }
      .message-block.patient {
        background: var(--panel-strong);
        border: 1px solid rgba(255,255,255,0.04);
      }
      .message-block.bot {
        background: var(--panel-bot);
      }
      .message-label {
        font-size: 0.76rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        opacity: 0.8;
        margin-bottom: 8px;
      }
      .message-block p {
        margin: 0;
        line-height: 1.55;
        white-space: pre-wrap;
        word-break: break-word;
      }
      .attachment-row {
        margin-top: 12px;
      }
      .attachment-tag {
        display: inline-flex;
        padding: 7px 10px;
        border-radius: 999px;
        background: rgba(255,255,255,0.06);
        color: var(--text);
        border: 1px solid rgba(255,255,255,0.08);
        font-size: 0.78rem;
      }
      .empty-state {
        background: rgba(32, 44, 51, 0.86);
        border: 1px dashed rgba(0, 168, 132, 0.7);
        color: var(--text);
        border-radius: 16px;
        padding: 30px 18px;
        text-align: center;
        font-size: 1.05rem;
      }
      @media (max-width: 640px) {
        .conversation-header {
          flex-direction: column;
        }
        .wa-button {
          width: 100%;
        }
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="topbar">
        <h1>Panel de administración</h1>
        <span class="ring">En vivo</span>
      </div>
      <main class="conversation-list">
        ${cards}
      </main>
    </div>
  </body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(html);
  } catch (error) {
    console.error('[PANEL ERROR]', error && error.message ? error.message : error);
    return res.status(500).send('No se pudo renderizar el panel de administración.');
  }
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
