import crypto from 'crypto';

// Acceso al panel con dos roles:
//   recepción → PANEL_USER / PANEL_PASSWORD: Bandeja, Agenda, Métricas y Reporte.
//   dueño     → PANEL_OWNER_USER / PANEL_OWNER_PASSWORD: todo lo anterior + Configuración y Probador.
// El navegador inicia sesión una vez (POST /api/panel/login) y recibe una cookie firmada, HttpOnly y
// SameSite=Strict (así también funciona el stream en vivo, que no puede mandar encabezados).
// Scripts y pruebas pueden usar Basic auth. Contraseñas comparadas en tiempo constante y
// máximo de intentos fallidos por IP.

export const SESSION_COOKIE = 'panel_session';
const SESSION_MS = 12 * 60 * 60 * 1000;
const MAX_FAILURES = Number(process.env.PANEL_MAX_LOGIN_FAILURES || 5);
const LOCK_MS = 15 * 60 * 1000;

function accounts(env = process.env) {
  const list = [];
  if (env.PANEL_OWNER_USER && env.PANEL_OWNER_PASSWORD) list.push({ role: 'owner', user: env.PANEL_OWNER_USER, password: env.PANEL_OWNER_PASSWORD });
  if (env.PANEL_USER && env.PANEL_PASSWORD) list.push({ role: 'reception', user: env.PANEL_USER, password: env.PANEL_PASSWORD });
  return list;
}

export const panelConfigured = (env = process.env) => accounts(env).length > 0;
export const ownerConfigured = (env = process.env) => accounts(env).some((a) => a.role === 'owner');

const digest = (value) => crypto.createHash('sha256').update(String(value ?? ''), 'utf8').digest();
const safeEqual = (a, b) => crypto.timingSafeEqual(digest(a), digest(b));

// Devuelve 'owner' | 'reception' | null. Revisa todas las cuentas para no filtrar cuál existe por el tiempo.
export function verifyCredentials(user, password, env = process.env) {
  let role = null;
  for (const account of accounts(env)) {
    const ok = safeEqual(user, account.user) & safeEqual(password, account.password);
    if (ok && !role) role = account.role;
  }
  return role;
}

// La firma depende de las contraseñas: si cambian, todas las sesiones abiertas se cierran.
function sessionKey(env = process.env) {
  const material = [env.PANEL_SESSION_SECRET, env.PANEL_PASSWORD, env.PANEL_OWNER_PASSWORD, env.CRON_SECRET].map((v) => v || '').join('|');
  return crypto.createHash('sha256').update(`panel-session|${material}`).digest();
}

const sign = (payload, env) => crypto.createHmac('sha256', sessionKey(env)).update(payload).digest('base64url');

export function createSessionToken({ role, user }, { env = process.env, now = Date.now() } = {}) {
  const payload = Buffer.from(JSON.stringify({ role, user, exp: now + SESSION_MS })).toString('base64url');
  return `${payload}.${sign(payload, env)}`;
}

export function readSessionToken(token, { env = process.env, now = Date.now() } = {}) {
  const [payload, signature] = String(token || '').split('.');
  if (!payload || !signature) return null;
  const expected = sign(payload, env);
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data?.role || !(data.exp > now)) return null;
    // La cuenta debe seguir existiendo (si se quitó PANEL_OWNER_*, la sesión de dueño deja de valer).
    return accounts(env).some((a) => a.role === data.role && a.user === data.user) ? { role: data.role, user: data.user } : null;
  } catch {
    return null;
  }
}

function readCookie(req, name) {
  const header = String(req.headers.cookie || '');
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

// ---------- Límite de intentos (en memoria, por IP) ----------
const failures = new Map();
const clientKey = (req) => req.ip || req.socket?.remoteAddress || 'desconocido';

export function loginLocked(req, now = Date.now()) {
  const entry = failures.get(clientKey(req));
  if (!entry) return 0;
  if (now - entry.first > LOCK_MS) { failures.delete(clientKey(req)); return 0; }
  return entry.count >= MAX_FAILURES ? Math.ceil((entry.first + LOCK_MS - now) / 1000) : 0;
}

function registerFailure(req, now = Date.now()) {
  const key = clientKey(req);
  const entry = failures.get(key);
  if (!entry || now - entry.first > LOCK_MS) failures.set(key, { count: 1, first: now });
  else entry.count += 1;
  if (failures.size > 5000) failures.delete(failures.keys().next().value);
}

export function resetLoginFailures() { failures.clear(); }

function basicCredentials(req) {
  const [scheme, encoded] = String(req.headers.authorization || '').split(' ');
  if (scheme !== 'Basic' || !encoded) return null;
  const decoded = Buffer.from(encoded, 'base64').toString('utf8');
  const i = decoded.indexOf(':');
  return i >= 0 ? { user: decoded.slice(0, i), password: decoded.slice(i + 1) } : null;
}

// Sesión de la request (cookie o Basic). null si no hay credenciales válidas.
export function sessionFor(req) {
  const fromCookie = readSessionToken(readCookie(req, SESSION_COOKIE));
  if (fromCookie) return fromCookie;
  const basic = basicCredentials(req);
  if (!basic) return null;
  const role = verifyCredentials(basic.user, basic.password);
  if (!role) registerFailure(req);
  return role ? { role, user: basic.user } : null;
}

// requirePanel() → recepción o dueño · requirePanel('owner') → solo el dueño.
export function requirePanel(required = 'reception') {
  return (req, res, next) => {
    if (!panelConfigured()) {
      return res.status(503).json({ error: 'Panel no configurado. Define PANEL_USER y PANEL_PASSWORD (y PANEL_OWNER_USER / PANEL_OWNER_PASSWORD para el dueño).' });
    }
    const wait = loginLocked(req);
    if (wait) {
      res.setHeader('Retry-After', String(wait));
      return res.status(429).json({ error: `Demasiados intentos fallidos. Espera ${Math.ceil(wait / 60)} min.` });
    }
    const session = sessionFor(req);
    if (!session) return res.status(401).json({ error: 'Inicia sesión para continuar.' });
    if (required === 'owner' && session.role !== 'owner') {
      return res.status(403).json({ error: 'Solo el dueño de la clínica puede usar esta sección.' });
    }
    req.panelSession = session;
    return next();
  };
}

const cookieFlags = () => `HttpOnly; SameSite=Strict; Path=/${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;

export function login(req, res) {
  if (!panelConfigured()) return res.status(503).json({ error: 'Panel no configurado. Define PANEL_USER y PANEL_PASSWORD.' });
  const wait = loginLocked(req);
  if (wait) {
    res.setHeader('Retry-After', String(wait));
    return res.status(429).json({ error: `Demasiados intentos fallidos. Espera ${Math.ceil(wait / 60)} min.` });
  }
  const user = String(req.body?.user || '');
  const password = String(req.body?.password || '');
  const role = user && password ? verifyCredentials(user, password) : null;
  if (!role) {
    registerFailure(req);
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
  }
  failures.delete(clientKey(req));
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${createSessionToken({ role, user })}; Max-Age=${SESSION_MS / 1000}; ${cookieFlags()}`);
  return res.json({ role, user, ownerAvailable: ownerConfigured() });
}

export function logout(req, res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Max-Age=0; ${cookieFlags()}`);
  return res.json({ ok: true });
}

export default requirePanel;
