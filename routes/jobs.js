import crypto from 'crypto';
import express from 'express';
import defaultJobs from '../services/jobsService.js';
import defaultReport from '../services/reportService.js';

// Endpoints para un cron externo (Render Cron Job, cron-job.org…). Requieren el header
// "x-cron-secret: <CRON_SECRET>" (o "Authorization: Bearer <CRON_SECRET>").

export function requireCronSecret(req, res, next) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(503).json({ error: 'CRON_SECRET no está configurado' });
  const provided = String(req.get('x-cron-secret') || String(req.get('authorization') || '').replace(/^Bearer\s+/i, '') || '');
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: 'No autorizado' });
  return next();
}

export function createJobsRouter(jobs = defaultJobs, report = defaultReport) {
  const router = express.Router();
  const run = (name, task) => async (req, res) => {
    try {
      const result = await task(req);
      console.log(`[Jobs] ${name}:`, JSON.stringify(result));
      res.json({ ok: true, job: name, result });
    } catch (error) {
      console.error(`[Jobs] ${name} falló:`, error?.message || error);
      res.status(error?.status || 500).json({ ok: false, job: name, error: error?.message || 'Error interno' });
    }
  };
  router.post('/reminders', requireCronSecret, run('reminders', () => jobs.runReminders()));
  router.post('/daily-summary', requireCronSecret, run('daily-summary', () => jobs.runDailySummary()));
  router.post('/follow-ups', requireCronSecret, run('follow-ups', () => jobs.runFollowUps()));
  // Lunes 8:00 a. m. (Lima): reporte de los 7 días anteriores al dueño, con la línea de la garantía.
  // Opcional: ?from=AAAA-MM-DD&to=AAAA-MM-DD (por ejemplo, la semana de garantía desde la instalación).
  router.post('/weekly-report', requireCronSecret, run('weekly-report', async (req) => {
    const { sent, channel, report: data } = await report.runWeeklyReport({ from: req.query.from, to: req.query.to });
    return { sent, channel, from: data.from, to: data.to, guarantee: data.guarantee };
  }));
  return router;
}

export default createJobsRouter();
