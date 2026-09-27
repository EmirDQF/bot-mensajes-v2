import express from 'express';
import { getAgenda, setAppointmentStatus, getMetrics, getReport, getSession } from '../controllers/panelController.js';
import inbox from '../controllers/inboxController.js';
import { login, logout, requirePanel } from '../middleware/panelAuth.js';

// API del panel. Recepción (PANEL_USER) y dueño (PANEL_OWNER_USER) ven la bandeja, la agenda,
// las métricas y el reporte; Configuración y Probador son solo del dueño (requirePanel('owner')).

const router = express.Router();
router.use(express.json({ limit: '100kb' }));

// Las escrituras solo aceptan JSON: un formulario de otro sitio no puede enviarlo (defensa CSRF,
// además de la cookie SameSite=Strict).
router.use((req, res, next) => {
  const hasBody = Number(req.headers['content-length'] || 0) > 0 || req.headers['transfer-encoding'];
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && hasBody && !req.is('application/json')) {
    return res.status(415).json({ error: 'Envía JSON' });
  }
  return next();
});

router.post('/login', login);
router.post('/logout', logout);

const panel = requirePanel();
router.get('/session', panel, getSession);

// Bandeja en vivo
router.get('/stream', panel, inbox.stream);
router.get('/conversations', panel, inbox.list);
router.get('/conversations/:phone/messages', panel, inbox.messages);
router.post('/conversations/:phone/messages', panel, inbox.send);
router.post('/conversations/:phone/read', panel, inbox.read);
router.post('/conversations/:phone/bot', panel, inbox.setBot);
router.get('/media/:mediaId', panel, inbox.media);

// Agenda, métricas y reporte
router.get('/agenda', panel, getAgenda);
router.post('/appointments/:id/status', panel, setAppointmentStatus);
router.get('/metrics', panel, getMetrics);
router.get('/report', panel, getReport);

export default router;
