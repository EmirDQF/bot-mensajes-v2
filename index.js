import express from 'express';
import webhookRouter from './routes/webhook.js';
import fs from 'fs/promises';
import path from 'path';
import errorHandler from './middleware/errorHandler.js';

const app = express();

app.use((req, res, next) => {
  console.log(`[HTTP INCOMING] ${new Date().toISOString()} ${req.method} ${req.originalUrl}`);
  next();
});

app.use('/webhook', (req, res, next) => {
  const ts = new Date().toISOString();
  console.log(`[${ts}] WEBHOOK INBOUND ${req.method} ${req.originalUrl}`);
  if (req.query && Object.keys(req.query).length) {
    console.log(`[${ts}] WEBHOOK QUERY`, JSON.stringify(req.query, null, 2));
  }
  next();
});

app.use('/webhook', express.raw({ type: 'application/json' }));

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

app.listen(port, () => {
  console.log(`Express server listening on http://localhost:${port}`);
});

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

// Configure Cloud API webhook routes (if WHATSAPP_TOKEN/etc are set)
app.use('/', webhookRouter);

// Mount centralized error handler at the end of middleware chain
app.use(errorHandler);

// No longer using Baileys socket — Cloud API uses webhooks + HTTP calls.
