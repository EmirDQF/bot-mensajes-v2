import express from 'express';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import webhookRouter from './routes/webhook.js';
import panelRouter from './routes/panel.js';
import jobsRouter, { requireCronSecret } from './routes/jobs.js';
import config from './config/env.js';
import errorHandler from './middleware/errorHandler.js';
import clinic, { publicClinicInfo } from './config/clinic.config.js';

// Arma la aplicación Express sin escuchar un puerto (index.js la levanta; los tests la usan directo).

let defaultSupabase = null;
function getDefaultSupabase() {
  if (defaultSupabase) return defaultSupabase;
  if (!config.supabase.url || !config.supabase.serviceRoleKey) return null;
  defaultSupabase = createClient(config.supabase.url, config.supabase.serviceRoleKey);
  return defaultSupabase;
}

function requirePanelAuth(req, res, next) {
  const username = process.env.PANEL_USER;
  const password = process.env.PANEL_PASSWORD;
  const [scheme, encoded] = (req.headers.authorization || '').split(' ');

  if (!username || !password) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Panel Clinica"');
    return res.status(503).json({ error: 'Panel no configurado. Define PANEL_USER y PANEL_PASSWORD en Render o tu .env.' });
  }
  if (scheme !== 'Basic' || !encoded) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Panel Clinica"');
    return res.status(401).send('Acceso requerido');
  }
  const decoded = Buffer.from(encoded, 'base64').toString('utf8');
  const separatorIndex = decoded.indexOf(':');
  const providedUser = separatorIndex >= 0 ? decoded.slice(0, separatorIndex) : '';
  const providedPass = separatorIndex >= 0 ? decoded.slice(separatorIndex + 1) : '';
  if (providedUser !== username || providedPass !== password) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Panel Clinica"');
    return res.status(401).send('Credenciales inválidas');
  }
  return next();
}

export function createApp({ getSupabase = getDefaultSupabase } = {}) {
  const app = express();

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

  const publicDir = path.join(process.cwd(), 'public');
  app.use('/media', express.static(path.join(process.cwd(), 'media')));
  app.use(express.static(publicDir));

  // Marca pública de la clínica activa para el panel (sin teléfonos).
  app.get('/api/clinic', (req, res) => {
    res.json(publicClinicInfo());
  });

  app.get('/panel', requirePanelAuth, (req, res) => {
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
