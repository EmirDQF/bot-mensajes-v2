import express from 'express';
import { getAgenda, setAppointmentStatus, getMetrics, getReport, getSession } from '../controllers/panelController.js';
import inbox from '../controllers/inboxController.js';
import settings from '../controllers/settingsController.js';
import { login, logout, requirePanel } from '../middleware/panelAuth.js';

// API del panel. Recepción (PANEL_USER) y dueño (PANEL_OWNER_USER) ven la bandeja, la agenda,
// las métricas y el reporte; Configuración y Probador son solo del dueño (requirePanel('owner')).

const router = express.Router();
const owner = requirePanel('owner');

// Fotos (solo el dueño): el cuerpo es la imagen tal cual (máx. 2 MB); se valida por sus bytes.
// Va antes del filtro de JSON: un formulario de otro sitio no puede mandar image/* sin CORS.
router.post('/settings/photo', owner, express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '2mb' }), settings.photo);

router.use(express.json({ limit: '300kb' }));

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
router.get('/conversations/:phone/profile', panel, inbox.profile);
router.put('/conversations/:phone/profile', panel, inbox.saveProfile);
router.get('/media/:mediaId', panel, inbox.media);

// Agenda, métricas y reporte
router.get('/agenda', panel, getAgenda);
router.post('/appointments/:id/status', panel, setAppointmentStatus);
router.get('/metrics', panel, getMetrics);
router.get('/report', panel, getReport);

// Configuración (solo el dueño)
router.get('/settings', owner, settings.get);
router.put('/settings', owner, settings.save);
router.post('/settings/reset', owner, settings.reset);
router.get('/settings/audit', owner, settings.audit);

export default router;
