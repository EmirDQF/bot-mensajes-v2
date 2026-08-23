import express from 'express';
import { getConversations, getMessages, toggleBot } from '../controllers/panelController.js';
import { sendMessage } from '../controllers/panelSend.js';

const router = express.Router();
router.use(express.json());

function requirePanelAuth(req, res, next) {
  const username = process.env.PANEL_USER || process.env.PANEL_USERNAME;
  const password = process.env.PANEL_PASSWORD || process.env.PANEL_PASS;

  const authHeader = req.headers.authorization || '';
  const [scheme, encoded] = authHeader.split(' ');

  if (!username || !password) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Panel Clinica"');
    return res.status(503).json({ error: 'Panel no configurado. Define PANEL_USER y PANEL_PASSWORD en .env.' });
  }

  if (scheme !== 'Basic' || !encoded) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Panel Clinica"');
    return res.status(401).send('Acceso requerido');
  }

  let decoded;
  try {
    decoded = Buffer.from(encoded, 'base64').toString('utf8');
  } catch (error) {
    decoded = '';
  }

  const separatorIndex = decoded.indexOf(':');
  const providedUser = separatorIndex >= 0 ? decoded.slice(0, separatorIndex) : '';
  const providedPass = separatorIndex >= 0 ? decoded.slice(separatorIndex + 1) : '';

  if (providedUser !== username || providedPass !== password) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Panel Clinica"');
    return res.status(401).send('Credenciales inválidas');
  }

  return next();
}

// All panel API routes require basic auth
router.get('/conversations', requirePanelAuth, getConversations);
router.get('/messages/:phone', requirePanelAuth, getMessages);
router.post('/toggle-bot/:phone', requirePanelAuth, toggleBot);
router.post('/send-message', requirePanelAuth, sendMessage);

export default router;
