import crypto from 'node:crypto';
import fs from 'fs/promises';
import path from 'path';
import express from 'express';
import { once } from 'node:events';
import { Agent as HttpAgent } from 'node:http';

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
        if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
        if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
        return [key, value];
      })
  );
}

async function loadEnvFile() {
  const envPath = path.resolve(process.cwd(), '.env');
  try {
    const raw = await fs.readFile(envPath, 'utf8');
    const env = parseDotEnv(raw);
    Object.entries(env).forEach(([key, value]) => {
      if (!process.env[key]) process.env[key] = value;
    });
  } catch (err) {
    // ignore missing .env
  }
}

function requireEnv(key) {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is required for the smoke test`);
  return value;
}

async function run() {
  console.log('Running smoke test...');
  await loadEnvFile();

  process.env.LEADS_TEST_FILE = process.env.LEADS_TEST_FILE || 'leads.test.json';
  process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test-key';
  process.env.GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';

  const required = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'WHATSAPP_WEBHOOK_VERIFY_TOKEN',
    'WHATSAPP_APP_SECRET',
    'WHATSAPP_PHONE_NUMBER_ID',
    'ADMIN_WHATSAPP_NUMBER',
  ];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  const { default: webhookRouter } = await import('../routes/webhook.js');
  const { default: whatsappService } = await import('../services/whatsappService.js');
  const { default: errorHandler } = await import('../middleware/errorHandler.js');
  const leadService = await import('../services/leadService.js');

  // Stub outbound WhatsApp calls for smoke test
  whatsappService.sendWhatsAppMessage = async () => ({ ok: true });

  const app = express();
  app.use(express.json());
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
  if (!address || typeof address !== 'object') throw new Error('Unable to determine listening port');
  const port = address.port;

  const httpAgent = new HttpAgent({ keepAlive: false });
  const testPhone = '999888777';
  const fakePayload = {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'fake-entry',
        changes: [
          {
            value: {
              messaging_product: 'whatsapp',
              metadata: { phone_number_id: process.env.WHATSAPP_PHONE_NUMBER_ID },
              contacts: [{ profile: { name: 'Lead Test' }, wa_id: '51' + testPhone }],
              messages: [
                {
                  from: '51' + testPhone,
                  id: 'msg1',
                  timestamp: `${Math.floor(Date.now() / 1000)}`,
                  text: { body: `Quiero agendar, me llamo Lead Test, mi número es ${testPhone}, vivo en Miraflores, puedo el jueves a las 3pm` },
                  type: 'text',
                },
              ],
            },
          },
        ],
      },
    ],
  };

  try {
    const challenge = 'test-challenge-42';
    const challengeResp = await fetch(`http://127.0.0.1:${port}/webhook?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN)}&hub.challenge=${encodeURIComponent(challenge)}`, {
      headers: { Connection: 'close' },
      agent: httpAgent,
    });
    const challengeBody = await challengeResp.text();
    console.log('GET /webhook response', challengeResp.status, challengeBody);

    const rawBody = JSON.stringify(fakePayload);
    const signature = 'sha256=' + crypto.createHmac('sha256', process.env.WHATSAPP_APP_SECRET).update(rawBody).digest('hex');
    const webhookResp = await fetch(`http://127.0.0.1:${port}/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': signature,
        Connection: 'close',
      },
      agent: httpAgent,
      body: rawBody,
    });
    const webhookText = await webhookResp.text();
    console.log('POST /webhook response', webhookResp.status, webhookText);

    const maxWaitMs = 10000;
    const intervalMs = 500;
    let waited = 0;
    let savedLead = null;
    while (waited < maxWaitMs) {
      savedLead = await leadService.getByPhone(testPhone);
      if (savedLead) break;
      await new Promise((r) => setTimeout(r, intervalMs));
      waited += intervalMs;
    }

    if (!savedLead) {
      throw new Error(`FAIL: lead no encontrado en Supabase real para teléfono ${testPhone}`);
    }

    console.log('PASS: lead encontrado en Supabase real:');
    console.log(JSON.stringify(savedLead, null, 2));
    console.log('Smoke test completed successfully. Verifique en Supabase la fila con telefono:', testPhone);
  } finally {
    try {
      if (typeof server.closeAllConnections === 'function') {
        server.closeAllConnections();
      }
    } catch (e) {
      // ignore if not supported
    }
    for (const socket of sockets) {
      try {
        socket.destroy();
      } catch (e) {
        // ignore socket destroy errors during cleanup
      }
    }
    await new Promise((resolve, reject) => {
      server.close((err) => {
        if (err) return reject(err);
        resolve();
      });
    });
    httpAgent.destroy();
  }
}

run().catch((e) => {
  console.error('Smoke test error', e && e.stack ? e.stack : e);
  process.exit(1);
});