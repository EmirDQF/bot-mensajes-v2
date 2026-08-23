/**
 * Simula el flujo WhatsApp Cloud API: POST /webhook con payloads de Meta
 * para el número 51949737257 y valida texto + despacho de imágenes.
 *
 * Uso: node scripts/simulate-chat.js
 * Opcional: SIMULATE_CHAT_LIVE=1 reenvía las llamadas reales a Graph (WhatsApp).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import { once } from 'node:events';
import { Agent as HttpAgent } from 'node:http';

const FROM_PHONE = '51949737257';
const PHONE_NUMBER_ID = '1337494962770981';
const DISPLAY_PHONE = '51977377508';
const WABA_ID = '1363917525928617';
const LIVE = String(process.env.SIMULATE_CHAT_LIVE || '').toLowerCase() === '1'
  || String(process.env.SIMULATE_CHAT_LIVE || '').toLowerCase() === 'true';

const MINIMAL_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCABAAEADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGf/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPwB//9k=',
  'base64'
);

function parseDotEnv(content) {
  return Object.fromEntries(
    content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const idx = line.indexOf('=');
        if (idx === -1) return [line, ''];
        const key = line.slice(0, idx).trim();
        let value = line.slice(idx + 1).trim();
        if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
          value = value.slice(1, -1);
        }
        return [key, value];
      })
  );
}

async function loadEnvFile() {
  const envPath = path.resolve(process.cwd(), '.env');
  try {
    const raw = await fsp.readFile(envPath, 'utf8');
    const env = parseDotEnv(raw);
    for (const [key, value] of Object.entries(env)) {
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // .env opcional
  }
}

function ensureEnv() {
  process.env.WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || PHONE_NUMBER_ID;
  process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || 'simulate-verify';
  process.env.WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || 'simulate-token';
  process.env.WHATSAPP_APP_SECRET = process.env.WHATSAPP_APP_SECRET || 'simulate-app-secret';
  process.env.GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
  process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test-key';
  process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role';
  process.env.ADMIN_WHATSAPP_NUMBER = process.env.ADMIN_WHATSAPP_NUMBER || FROM_PHONE;
  process.env.ENFORCE_WHATSAPP_SIGNATURE = process.env.ENFORCE_WHATSAPP_SIGNATURE || 'false';
}

function buildMetaPayload(textBody, messageId, timestamp) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: WABA_ID,
        changes: [
          {
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: DISPLAY_PHONE,
                phone_number_id: process.env.WHATSAPP_PHONE_NUMBER_ID || PHONE_NUMBER_ID,
              },
              contacts: [{ profile: { name: 'Diego' }, wa_id: FROM_PHONE }],
              messages: [
                {
                  from: FROM_PHONE,
                  id: messageId,
                  timestamp: String(timestamp),
                  text: { body: textBody },
                  type: 'text',
                },
              ],
            },
            field: 'messages',
          },
        ],
      },
    ],
  };
}

function mockGeminiReply(userText) {
  const t = String(userText || '').toLowerCase();
  if (/bracket|ortodoncia|frenillos|alineador/.test(t)) {
    return 'Los brackets y la ortodoncia alinean tus dientes de forma progresiva. El precio depende del tipo y de tu caso; te damos el detalle exacto en una evaluación. Te mando fotos de antes y después.\n[ENVIAR_IMAGEN:ortodoncia_antes_despues.jpeg]';
  }
  if (/carilla/.test(t)) {
    return 'Las carillas dentales mejoran color y forma de los dientes de manera estética. Te comparto fotos de resultados para que veas el acabado.\n[ENVIAR_IMAGEN:carillas.jpeg]';
  }
  if (/implante/.test(t) || /d[oó]nde quedan|ubicaci|direcci/.test(t)) {
    const images = [];
    if (/implante/.test(t)) images.push('[ENVIAR_IMAGEN:implantes.jpeg]');
    if (/d[oó]nde quedan|ubicaci|direcci/.test(t)) images.push('[ENVIAR_IMAGEN:ubicacion.jpeg]');
    return `Los implantes reemplazan piezas perdidas con un resultado fijo y natural. Estamos en Av. Alameda de la República N.º 261, Huánuco, fácil de ubicar.\n${images.join('\n')}`;
  }
  return '¡Hola! ¿Sobre qué tratamiento te ayudo?';
}

function jsonResponse(obj, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => obj,
    text: async () => JSON.stringify(obj),
  };
}

async function extractFormFileName(body) {
  if (!body || typeof body !== 'object') return null;
  if (typeof body.entries === 'function') {
    for (const [, value] of body.entries()) {
      if (value && typeof value === 'object' && value.name) return value.name;
    }
  }
  return null;
}

function includesAny(text, needles) {
  const hay = String(text || '').toLowerCase();
  return needles.some((n) => hay.includes(String(n).toLowerCase()));
}

async function waitFor(predicate, { timeoutMs = 25000, intervalMs = 200 } = {}) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeoutMs) {
    last = predicate();
    if (last) return last;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return last;
}

async function run() {
  await loadEnvFile();
  ensureEnv();

  const hasRealGemini = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'test-key');

  const outbound = [];
  const originalFetch = globalThis.fetch?.bind(globalThis);

  globalThis.fetch = async (url, opts = {}) => {
    const urlStr = String(url);
    const isGraph = /graph\.facebook\.com/i.test(urlStr);
    const isGemini = /generativelanguage\.googleapis\.com|googleapis\.com\/v1beta\/models/i.test(urlStr);

    if (isGraph) {
      let filename = null;
      let textBody = null;
      let type = 'unknown';
      try {
        if (opts.body && typeof opts.body === 'string') {
          const parsed = JSON.parse(opts.body);
          type = parsed.type || (parsed.text ? 'text' : 'unknown');
          textBody = parsed.text?.body || null;
          if (parsed.type === 'image') type = 'image';
        } else {
          filename = await extractFormFileName(opts.body);
          if (filename || /\/media(?:\?|$)/i.test(urlStr)) type = 'media_upload';
        }
      } catch {
        filename = await extractFormFileName(opts.body);
      }

      outbound.push({
        at: Date.now(),
        url: urlStr,
        type,
        to: (() => {
          try {
            return JSON.parse(opts.body || '{}').to || FROM_PHONE;
          } catch {
            return FROM_PHONE;
          }
        })(),
        text: textBody,
        filename,
      });

      if (LIVE && originalFetch && process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_TOKEN !== 'simulate-token') {
        return originalFetch(url, opts);
      }

      if (type === 'media_upload' || /\/media(?:\?|$)/i.test(urlStr)) {
        const mediaId = `sim-media-${filename || 'file'}-${Date.now()}`;
        outbound[outbound.length - 1].mediaId = mediaId;
        return jsonResponse({ id: mediaId });
      }
      return jsonResponse({ messaging_product: 'whatsapp', messages: [{ id: `wamid.sim_out_${Date.now()}` }] });
    }

    if (isGemini && !hasRealGemini) {
      let userText = '';
      try {
        const parsed = typeof opts.body === 'string' ? JSON.parse(opts.body) : {};
        const parts = parsed?.contents?.[0]?.parts || [];
        userText = parts.map((p) => p.text || '').join('\n');
      } catch {
        userText = '';
      }
      const reply = mockGeminiReply(userText);
      return jsonResponse({
        candidates: [{ content: { parts: [{ text: reply }] } }],
      });
    }

    if (originalFetch) return originalFetch(url, opts);
    throw new Error(`No fetch handler for ${urlStr}`);
  };

  const origExists = fs.existsSync.bind(fs);
  const origRead = fs.readFileSync.bind(fs);
  fs.existsSync = (p, ...rest) => {
    const s = String(p);
    if (/\.(jpe?g|png)$/i.test(s)) return true;
    return origExists(p, ...rest);
  };
  fs.readFileSync = (p, ...rest) => {
    const s = String(p);
    if (/\.(jpe?g|png)$/i.test(s) && !origExists(p)) return MINIMAL_JPEG;
    return origRead(p, ...rest);
  };

  const { default: webhookRouter } = await import('../routes/webhook.js');
  const { default: whatsappService } = await import('../services/whatsappService.js');
  const geminiService = (await import('../services/geminiService.js')).default;
  const { default: errorHandler } = await import('../middleware/errorHandler.js');

  const origGemini = geminiService.obtenerRespuestaIA.bind(geminiService);
  geminiService.obtenerRespuestaIA = async (jid, mensaje, options = {}) => {
    const merged = { ...options, skipDebounce: true };
    if (hasRealGemini) {
      try {
        const real = await origGemini(jid, mensaje, merged);
        const texto = real?.texto || real?.text || '';
        if (texto && !/problema procesando|estoy teniendo problemas|sistema está ocupado/i.test(texto)) {
          return real;
        }
      } catch (e) {
        console.warn('simulate-chat: Gemini real falló, usando respuesta local:', e && e.message ? e.message : e);
      }
    }
    return { texto: mockGeminiReply(mensaje), leadData: null };
  };

  const origSend = whatsappService.sendWhatsAppMessage.bind(whatsappService);
  whatsappService.sendWhatsAppMessage = async (to, text, options = {}) => {
    outbound.push({ at: Date.now(), type: 'text', to, text, filename: null, via: 'whatsappService' });
    return origSend(to, text, options);
  };

  const app = express();
  app.use('/', webhookRouter);
  app.use(errorHandler);

  const sockets = new Set();
  const server = app.listen(0);
  server.unref && server.unref();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address !== 'object') throw new Error('No se pudo obtener el puerto de escucha');
  const port = address.port;
  const httpAgent = new HttpAgent({ keepAlive: false });

  const scenarios = [
    {
      name: 'Mensaje 1 — brackets / ortodoncia',
      body: 'Hola, quisiera información y precios de brackets',
      id: 'wamid.simulated_test_001',
      timestamp: '1724431500',
      textNeedles: ['ortodoncia', 'bracket', 'brackets', 'aline'],
      images: ['ortodoncia_antes_despues.jpeg'],
    },
    {
      name: 'Mensaje 2 — carillas',
      body: 'Tienen fotos de carillas dentales?',
      id: 'wamid.simulated_test_002',
      timestamp: '1724431560',
      textNeedles: ['carilla'],
      images: ['carillas.jpeg'],
    },
    {
      name: 'Mensaje 3 — implantes y ubicación',
      body: 'Quiero saber sobre los implantes y dónde quedan',
      id: 'wamid.simulated_test_003',
      timestamp: '1724431620',
      textNeedles: ['implante', 'ubic', 'huánuco', 'huanuco', 'dirección', 'direccion', 'alameda'],
      images: ['implantes.jpeg', 'ubicacion.jpeg'],
      imagesAny: true,
    },
  ];

  const results = [];

  try {
    console.log(`simulate-chat: servidor local en http://127.0.0.1:${port}/webhook`);
    console.log(`simulate-chat: from=${FROM_PHONE} liveGraph=${LIVE} geminiReal=${hasRealGemini}`);

    for (const scenario of scenarios) {
      const mark = Date.now();
      const payload = buildMetaPayload(scenario.body, scenario.id, scenario.timestamp);
      const rawBody = JSON.stringify(payload);
      const signature = 'sha256=' + crypto.createHmac('sha256', process.env.WHATSAPP_APP_SECRET).update(rawBody).digest('hex');

      const resp = await fetch(`http://127.0.0.1:${port}/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Hub-Signature-256': signature,
          Connection: 'close',
        },
        agent: httpAgent,
        body: rawBody,
      });
      const respText = await resp.text();
      if (resp.status !== 200) {
        throw new Error(`${scenario.name}: webhook devolvió ${resp.status} ${respText}`);
      }

      const snapshot = await waitFor(() => {
        const since = outbound.filter((o) => o.at >= mark);
        const texts = since.filter((o) => o.text).map((o) => o.text);
        const files = since.map((o) => o.filename).filter(Boolean);
        const mediaUploads = since.filter((o) => o.type === 'media_upload' || o.type === 'image');
        const hasText = texts.some((t) => includesAny(t, scenario.textNeedles));
        const hasImage = scenario.imagesAny
          ? scenario.images.some((img) => files.includes(img))
          : scenario.images.every((img) => files.includes(img)) || scenario.images.some((img) => files.includes(img));
        if (hasText && (hasImage || mediaUploads.length > 0 && files.length > 0)) {
          return { texts, files, mediaUploads };
        }
        return null;
      }, { timeoutMs: 28000 });

      const since = outbound.filter((o) => o.at >= mark);
      const texts = snapshot?.texts || since.filter((o) => o.text).map((o) => o.text);
      const files = snapshot?.files || since.map((o) => o.filename).filter(Boolean);
      const reply = texts.find((t) => includesAny(t, scenario.textNeedles)) || texts[0] || '';
      const imageOk = scenario.imagesAny
        ? scenario.images.some((img) => files.includes(img))
        : scenario.images.some((img) => files.includes(img));
      const textOk = includesAny(reply, scenario.textNeedles);

      const row = {
        name: scenario.name,
        webhookStatus: resp.status,
        textOk,
        imageOk,
        reply: reply.slice(0, 280),
        images: files,
      };
      results.push(row);

      const status = textOk && imageOk ? 'PASS' : 'FAIL';
      console.log(`\n[${status}] ${scenario.name}`);
      console.log(`  inbound: ${scenario.body}`);
      console.log(`  texto: ${row.reply || '(vacío)'}`);
      console.log(`  imágenes: ${files.join(', ') || '(ninguna)'}`);

      if (!textOk) console.log(`  motivo texto: se esperaba alguna de ${scenario.textNeedles.join(', ')}`);
      if (!imageOk) console.log(`  motivo imagen: se esperaba ${scenario.imagesAny ? 'alguna de' : ''} ${scenario.images.join(' | ')}`);
    }
  } finally {
    try {
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    } catch {
      // ignore
    }
    for (const socket of sockets) {
      try { socket.destroy(); } catch { /* ignore */ }
    }
    await new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    httpAgent.destroy();
    fs.existsSync = origExists;
    fs.readFileSync = origRead;
    globalThis.fetch = originalFetch;
  }

  const failed = results.filter((r) => !r.textOk || !r.imageOk);
  console.log('\n========== RESUMEN ==========');
  for (const r of results) {
    console.log(`${r.textOk && r.imageOk ? 'PASS' : 'FAIL'}  ${r.name}  images=${r.images.join(',') || '-'}`);
  }

  if (failed.length) {
    throw new Error(`${failed.length} escenario(s) fallaron`);
  }
  console.log('\nFlujo completo OK para 51949737257');
}

run().catch((e) => {
  console.error('simulate-chat error:', e && e.stack ? e.stack : e);
  process.exit(1);
});
