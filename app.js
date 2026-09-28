import express from 'express';
import path from 'path';
import webhookRouter from './routes/webhook.js';
import panelRouter from './routes/panel.js';
import jobsRouter, { requireCronSecret } from './routes/jobs.js';
import { getSupabase as getDefaultSupabase } from './services/supabaseClient.js';
import errorHandler from './middleware/errorHandler.js';
import clinic, { publicClinicInfo } from './config/clinic.config.js';

// Arma la aplicación Express sin escuchar un puerto (index.js la levanta; los tests la usan directo).

// Cabeceras de seguridad del panel: sin iframes de otros sitios, sin scripts externos ni inline.
const PANEL_CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self'", "img-src 'self' data: blob: https:",
  "media-src 'self' blob:", "connect-src 'self'", "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'",
].join('; ');

function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  if (req.path === '/panel' || req.path.startsWith('/panel/') || req.path === '/panel.html') res.setHeader('Content-Security-Policy', PANEL_CSP);
  next();
}

export function createApp({ getSupabase = getDefaultSupabase } = {}) {
  const app = express();
  // Render (y cualquier proxy) termina el TLS: la IP real del cliente viene en X-Forwarded-For.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // Health primero: sin auth, sin CORS y antes de cualquier middleware del webhook.
  // cron-job.org lo llama cada 10 min para que Render no duerma el servicio.
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
  });

  // Chequeo profundo (con CRON_SECRET): un select liviano a Supabase. Mantiene activo el proyecto
  // gratuito (se pausa tras una semana sin actividad) y detecta caídas de la base de datos.
  app.get('/health/deep', requireCronSecret, async (req, res) => {
    const started = Date.now();
    try {
      const client = await getSupabase();
      if (!client) return res.status(503).json({ status: 'error', supabase: 'SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY no definidas' });
      const { error } = await client.from('conversations').select('conversation_id').limit(1);
      if (error) throw error;
      return res.json({ status: 'ok', supabase: 'ok', clinic: clinic.id, ms: Date.now() - started });
    } catch (error) {
      console.error('[Health] Supabase no responde:', error?.message || error);
      return res.status(503).json({ status: 'error', supabase: error?.message || 'sin respuesta' });
    }
  });

  app.use(securityHeaders);
  const publicDir = path.join(process.cwd(), 'public');
  app.use('/media', express.static(path.join(process.cwd(), 'media')));
  // Modo demo: fotos subidas en Configuración, guardadas en el Supabase en memoria.
  app.get('/demo-media/*file', async (req, res) => {
    const file = (await getSupabase())?.files?.get([].concat(req.params.file).join('/'));
    if (!file) return res.status(404).json({ error: 'Archivo no encontrado' });
    return res.type(file.contentType || 'application/octet-stream').send(file.buffer);
  });
  app.use(express.static(publicDir));

  // Marca pública de la clínica activa para el panel (sin teléfonos).
  app.get('/api/clinic', (req, res) => {
    res.json(publicClinicInfo());
  });

  // La página no tiene datos: pide iniciar sesión y todo lo demás va por /api/panel (con auth).
  app.get('/panel', (req, res) => {
    res.sendFile(path.join(publicDir, 'panel.html'));
  });

  app.get('/', (req, res) => {
    res.send('Bot Dental Operativo 24/7 🚀');
  });

  // API del panel de recepción (con usuario y contraseña).
  app.use('/api/panel', panelRouter);

  // Tareas programadas (recordatorios, resumen diario, seguimiento, reporte semanal) con CRON_SECRET.
  app.use('/jobs', jobsRouter);

  // Webhook de WhatsApp Cloud API: responde 200 a Meta antes de procesar.
  app.use('/', webhookRouter);

  app.use(errorHandler);
  return app;
}

export default createApp;
