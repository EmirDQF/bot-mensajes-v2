import express from 'express';
import './src/envLoader.js';
import webhookRouter from './routes/webhook.js';
import fs from 'fs/promises';
import path from 'path';
import errorHandler from './middleware/errorHandler.js';

const app = express();

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

app.listen(port, () => {
  console.log(`Express server listening on http://localhost:${port}`);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Promise Rejection:', reason);
});

// Configure Cloud API webhook routes (if WHATSAPP_TOKEN/etc are set)
app.use('/', webhookRouter);

// Mount centralized error handler at the end of middleware chain
app.use(errorHandler);

// No longer using Baileys socket — Cloud API uses webhooks + HTTP calls.
