import express from 'express';
import crypto from 'crypto';
import { obtenerRespuestaIA } from './gemini.js';
import { saveLead } from './leads.js';

// Cloud API sender using fetch (Node 18+/global fetch)
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const WHATSAPP_APP_SECRET = process.env.WHATSAPP_APP_SECRET;
const WHATSAPP_API_VERSION = process.env.WHATSAPP_API_VERSION || 'v17.0';

// Rate limiting shared with previous design
const OUTGOING_MSGS_PER_MINUTE = parseInt(process.env.OUTGOING_MSGS_PER_MINUTE, 10) || 20;
const outgoingTimestamps = [];
const allowedIncomingJids = new Set(); // store as '51987654321@s.whatsapp.net'

function cleanupOldTimestamps() {
  const now = Date.now();
  while (outgoingTimestamps.length && outgoingTimestamps[0] <= now - 60_000) {
    outgoingTimestamps.shift();
  }
}

function getRandomDelayMs() {
  // similar jitter as prior implementation
  const base = 2000;
  const variability = Math.floor(Math.random() * 2000);
  const jitter = Math.floor(Math.random() * 500);
  return base + variability + jitter;
}

async function sendWhatsAppMessage(toPhone, text) {
  // toPhone: string like '51987654321' (international without plus)
  cleanupOldTimestamps();
  if (outgoingTimestamps.length >= OUTGOING_MSGS_PER_MINUTE) {
    console.warn(`⚠️ Outgoing rate limit reached (${OUTGOING_MSGS_PER_MINUTE}/min). Dropping message to ${toPhone}.`);
    return null;
  }

  // Delay a bit to mimic human
  await new Promise((r) => setTimeout(r, getRandomDelayMs()));

  const url = `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const body = {
    messaging_product: 'whatsapp',
    to: toPhone,
    text: { body: text },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
    },
    body: JSON.stringify(body),
  });

  outgoingTimestamps.push(Date.now());
  if (!res.ok) {
    const txt = await res.text();
    console.error('❌ Error sending message via Cloud API:', res.status, txt);
    throw new Error(`WhatsApp API error ${res.status}`);
  }

  return res.json();
}

// Verify X-Hub-Signature-256 header matches HMAC-SHA256 of raw body using app secret
function verifySignature(rawBody, signatureHeader) {
  if (!WHATSAPP_APP_SECRET) {
    // If no app secret set, skip verification but warn in logs
    console.warn('WHATSAPP_APP_SECRET not set; skipping webhook signature verification');
    return true;
  }
  if (!signatureHeader) return false;
  const expected = crypto.createHmac('sha256', WHATSAPP_APP_SECRET).update(rawBody).digest('hex');
  // header format: sha256=hex
  const [, sig] = signatureHeader.split('=');
  return sig === expected;
}

// Process Cloud API webhook payload (body is parsed JSON object). This function is exported for smoke-tests.
export async function processWebhookEvent(body, rawBodyBuf, headers) {
  // Verify signature
  const signatureHeader = headers['x-hub-signature-256'] || headers['X-Hub-Signature-256'];
  const raw = rawBodyBuf ? rawBodyBuf.toString('utf8') : JSON.stringify(body);
  if (!verifySignature(raw, signatureHeader)) {
    console.warn('Webhook signature verification failed. Ignoring payload.');
    return { ok: false, reason: 'signature_failed' };
  }

  // The Cloud API sends an 'entry' array with changes -> value -> messages
  const entries = body.entry || [];
  for (const entry of entries) {
    const changes = entry.changes || [];
    for (const change of changes) {
      const value = change.value || {};
      const messages = value.messages || [];
      for (const msg of messages) {
        // msg.from contains sender phone number (string), msg.type may be 'text'
        const from = msg.from; // e.g., '51987654321'
        const remoteJid = `${from}@s.whatsapp.net`;
        // register allowed incoming
        allowedIncomingJids.add(remoteJid);

        let text = null;
        if (msg.type === 'text' && msg.text && msg.text.body) text = msg.text.body.trim();
        else if (msg.type === 'button' && msg.button && msg.button.text) text = msg.button.text.trim();
        // you can extend to handle other types (image captions, etc.)

        if (!text) continue;

        console.log(`📩 Received message from ${from}: ${text}`);

        try {
          const { texto: respuesta, leadResult } = await obtenerRespuestaIA(remoteJid, text);

          // send response back to user
          await sendWhatsAppMessage(from, respuesta);

          if (leadResult?.readyToNotify && leadResult.lead) {
            // send confirmation message based on lead
            const lead = leadResult.lead;
            let confirmMsg = '';
            if (lead.fechaHoraConfirmada && lead.fechaHoraISO) {
              const fecha = new Date(lead.fechaHoraISO);
              const fechaStr = fecha.toLocaleString('es-PE', { timeZone: 'America/Lima', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
              confirmMsg = `¡Perfecto ${lead.nombre || ''}! Quedaste agendado para el ${fechaStr} en ${lead.distrito || 'N/A'}. Te confirmaremos por este medio. 😊`;
            } else {
              const fechaText = lead.fechaHoraTexto || 'la fecha indicada';
              confirmMsg = `Gracias ${lead.nombre || ''}. He registrado tu solicitud para ${fechaText} en ${lead.distrito || 'N/A'}. ¿Puedes confirmar que esa fecha y hora te viene bien?`;
            }

            await sendWhatsAppMessage(from, confirmMsg);

            // notify admin (use ADMIN_WHATSAPP_NUMBER env var)
            const adminPhoneRaw = process.env.ADMIN_WHATSAPP_NUMBER;
            if (adminPhoneRaw) {
              // normalize admin phone to digits only (no +)
              const adminDigits = adminPhoneRaw.replace(/\D/g, '');
              const fechaDisplay = lead.fechaHoraISO ? new Date(lead.fechaHoraISO).toLocaleString('es-PE', { timeZone: 'America/Lima', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : (lead.fechaHoraTexto || 'N/A');
              const alertMessage = `🚨 ¡NUEVO PACIENTE AGENDADO!\n👤 Nombre: ${lead.nombre || 'N/A'}\n📞 Teléfono: ${lead.telefono || lead.telefonoOriginal || 'N/A'}\n📍 Distrito: ${lead.distrito || 'N/A'}\n🗓️ Fecha/Hora: ${fechaDisplay}`;
              try {
                await sendWhatsAppMessage(adminDigits, alertMessage);
                console.log(`✅ Notificación enviada al administrador: ${adminDigits}`);
              } catch (e) {
                console.error('Error notificando admin via Cloud API:', e?.message || e);
              }
            }
          }
        } catch (e) {
          console.error('Error procesando mensaje entrante:', e?.message || e);
        }
      }
    }
  }

  return { ok: true };
}

// Setup Express routes on the provided app
export default function setupWhatsAppRoutes(app) {
  // GET /webhook for challenge verification
  app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    const expected = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
    if (mode === 'subscribe' && token === expected) {
      console.log('✅ Webhook verified');
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Forbidden');
  });

  // POST /webhook receives raw body to verify signature
  app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const rawBody = req.body; // Buffer
    let parsed = null;
    try {
      parsed = JSON.parse(rawBody.toString('utf8'));
    } catch (e) {
      console.warn('Invalid JSON in webhook');
      return res.sendStatus(400);
    }

    try {
      await processWebhookEvent(parsed, rawBody, req.headers);
      return res.sendStatus(200);
    } catch (e) {
      console.error('Error handling webhook:', e?.message || e);
      return res.sendStatus(500);
    }
  });
}
