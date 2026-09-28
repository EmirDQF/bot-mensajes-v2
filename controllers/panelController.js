import { publicClinicInfo } from '../config/clinic.config.js';
import panelData from '../services/panelDataService.js';
import reportService from '../services/reportService.js';
import { ownerConfigured } from '../middleware/panelAuth.js';
import clinicSettings from '../services/clinicSettings.js';
import systemAlerts from '../services/systemAlerts.js';

// Agenda, métricas, reporte y sesión del panel (la bandeja en vivo está en inboxController.js).

// GET /api/panel/session — quién inició sesión y la marca de la clínica.
export async function getSession(req, res) {
  await clinicSettings.ensureFresh();
  res.json({ authenticated: true, ...req.panelSession, ownerAvailable: ownerConfigured(), clinic: publicClinicInfo(), alerts: systemAlerts.active() });
}

const sendPanelError = (res, e, fallback) => {
  console.error(`[Panel] ${fallback}:`, e && e.message ? e.message : e);
  if (e?.status === 400) return res.status(400).json({ error: e.message });
  const message = String(e?.message || '');
  const missingTable = message.match(/table '?public\.(\w+)'?|relation "?(?:public\.)?(\w+)"? does not exist/i);
  if (missingTable) {
    const table = missingTable[1] || missingTable[2];
    const migration = table === 'follow_ups' ? '20260926_create_follow_ups.sql' : '20260925_create_appointments.sql';
    return res.status(503).json({ error: `${fallback}: falta la tabla "${table}". Ejecuta migrations/${migration} en Supabase.` });
  }
  if (/Supabase no configurado/i.test(message)) return res.status(503).json({ error: `${fallback}: ${message}` });
  return res.status(500).json({ error: fallback });
};

// GET /api/panel/agenda?day=today|tomorrow|YYYY-MM-DD
export async function getAgenda(req, res) {
  try {
    return res.json(await panelData.getAgenda(String(req.query.day || 'today')));
  } catch (e) {
    return sendPanelError(res, e, 'No se pudo cargar la agenda');
  }
}

// POST /api/panel/appointments/:id/status  { status: 'confirmada'|'asistio'|'no_asistio'|'cancelada' }
export async function setAppointmentStatus(req, res) {
  try {
    const updated = await panelData.setAppointmentStatus(String(req.params.id), String(req.body?.status || ''));
    return res.json({ id: updated?.id || req.params.id, status: updated?.status || req.body?.status });
  } catch (e) {
    return sendPanelError(res, e, 'No se pudo actualizar la cita');
  }
}

// GET /api/panel/metrics?days=30
// GET /api/panel/report?from=AAAA-MM-DD&to=AAAA-MM-DD — reporte imprimible (semana de garantía).
export async function getReport(req, res) {
  try {
    return res.json(await reportService.buildReport({ from: req.query.from, to: req.query.to }));
  } catch (e) {
    if (e?.status === 400) return res.status(400).json({ error: e.message });
    return sendPanelError(res, e, 'No se pudo generar el reporte');
  }
}

export async function getMetrics(req, res) {
  try {
    return res.json(await panelData.getMetrics(req.query.days));
  } catch (e) {
    return sendPanelError(res, e, 'No se pudieron calcular las métricas');
  }
}
