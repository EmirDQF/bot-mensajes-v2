require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const bodyParser = require('body-parser');
const { Server } = require('socket.io');
const db = require('./db');

const app = express();
// Configure CORS: in production set CORS_ORIGIN to the frontend URL (e.g. https://<frontend>.onrender.com)
const corsOrigin = process.env.CORS_ORIGIN || '*';
app.use(cors({ origin: corsOrigin }));
app.use(bodyParser.json({ limit: '5mb' }));

// Basic auth middleware for all /api routes
function basicAuth(req, res, next){
  // Only protect /api/* routes
  if (!req.path.startsWith('/api/')) return next();
  const user = process.env.PANEL_USER;
  const pass = process.env.PANEL_PASSWORD;
  if (!user || !pass) {
    console.warn('PANEL_USER or PANEL_PASSWORD not set — /api routes are unprotected');
    return next();
  }
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Monitor Panel"');
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const creds = Buffer.from(auth.split(' ')[1], 'base64').toString();
  const [u, p] = creds.split(':');
  if (u === user && p === pass) return next();
  res.setHeader('WWW-Authenticate', 'Basic realm="Monitor Panel"');
  return res.status(401).json({ error: 'Unauthorized' });
}

app.use(basicAuth);


const port = process.env.PORT || 3001;
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

// Socket.IO authentication: expect handshake auth { username, password }
io.use((socket, next) => {
  const user = process.env.PANEL_USER;
  const pass = process.env.PANEL_PASSWORD;
  if (!user || !pass) {
    // no credentials set — allow connection but warn
    console.warn('PANEL_USER/PANEL_PASSWORD not set — allowing socket connections without auth');
    return next();
  }
  const auth = socket.handshake.auth || {};
  const u = auth.username || auth.user || null;
  const p = auth.password || auth.pass || null;
  if (u === user && p === pass) return next();
  const err = new Error('Unauthorized');
  err.data = { status: 401 };
  return next(err);
});


// init DB (in-memory by default)
(async () => { await db.init(); })();

// When db emits message_saved, broadcast to sockets
db.emitter.on('message_saved', (message) => {
  // Emit an event with the new message
  io.emit('message', message);
  // Also emit an update for conversation list
  io.emit('conversation:update', { conversation_id: message.conversation_id, last_message_at: message.created_at, preview: message.type === 'image' ? '📷 Image' : (message.content || '') });
});

// Public endpoints
app.get('/api/conversations', async (req, res) => {
  const convs = await db.getConversations();
  res.json(convs);
});

app.get('/api/conversations/:id/messages', async (req, res) => {
  const id = req.params.id;
  const msgs = await db.getMessages(id, 1000);
  res.json(msgs);
});

app.get('/api/search', async (req, res) => {
  const q = req.query.q || '';
  const results = await db.searchConversations(q);
  res.json(results);
});

// Webhook / forwarder endpoint
// Accepts normalized messages and saves+emits them
app.post('/api/hook', async (req, res) => {
  const body = req.body;
  // Expected normalized payload shape documented in README
  if (!body || !body.conversation_id || !body.sender) {
    return res.status(400).json({ error: 'Invalid payload. Require conversation_id and sender.' });
  }

  const msg = {
    conversation_id: body.conversation_id,
    contact_name: body.contact_name,
    sender: body.sender, // 'user' or 'bot'
    type: body.type || 'text',
    content: body.content || null,
    media_url: body.media_url || null,
    timestamp: body.timestamp || new Date().toISOString()
  };

  const saved = await db.saveMessage(msg);
  return res.json({ ok: true, message: saved });
});

// Basic-auth protected admin test route (optional)
app.get('/api/ping', (req, res) => res.json({ ok: true, now: new Date().toISOString() }));

// Socket.IO: optional namespace/rooms can be implemented later
io.on('connection', (socket) => {
  console.log('socket connected', socket.id);
  socket.on('join:conversation', (conversation_id) => {
    socket.join(`conv:${conversation_id}`);
  });
  socket.on('leave:conversation', (conversation_id) => {
    socket.leave(`conv:${conversation_id}`);
  });
});

server.listen(port, () => {
  console.log(`Monitor panel backend listening on ${port}`);
});
