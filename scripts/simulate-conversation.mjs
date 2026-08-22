#!/usr/bin/env node
import express from 'express';
import fetch from 'node-fetch';
import config from '../config/env.js';

// Simulador ligero que stubea Gemini y Calendar y expone /webhook localmente
const PORT = process.env.SIMULATOR_PORT || 4000;

// Sesiones en memoria para mantener contexto entre mensajes (por "remoteJid")
const sessions = new Map();

function getSession(jid) {
  const id = jid.split('@')[0];
  if (!sessions.has(id)) sessions.set(id, []);
  return sessions.get(id);
}

// Stub de obtenerRespuestaIA: utiliza historial para dar respuestas coherentes
async function obtenerRespuestaIA(jid, mensajeUsuario) {
  const history = getSession(jid);
  history.push({ role: 'user', text: mensajeUsuario });

  // Respuestas simples basadas en el contenido del mensaje
  const lower = mensajeUsuario.toLowerCase();
  let texto = '';
  let leadResult = null;

  if (/servicios|horari|qué servicios/i.test(mensajeUsuario)) {
    const clinic = config.clinicProfile || {};
    texto = `Ofrecemos limpieza dental, blanqueamiento, extracción y ortodoncia. Horarios: ${clinic.hours || 'Lunes a Sábado 9:00-19:00'}. Dirección: ${clinic.address || '📍 Av. Alameda de la República 286 - Huánuco'}`;
  } else if (/agend(ar|o)|cita|limpieza/i.test(lower) && /4:00|4 pm|4pm|4:00 pm/.test(lower)) {
    // Simular creación de cita en Calendar
    const nameMatch = mensajeUsuario.match(/me llamo\s+([A-Za-zÁÉÍÓÚáéíóúñÑ\s]+)/i);
    const nombre = nameMatch ? nameMatch[1].trim() : 'Cliente';
    const phoneMatch = mensajeUsuario.match(/(\+?\d{7,15})/);
    const telefono = phoneMatch ? phoneMatch[1] : null;

    // Simulamos evento creado en Calendar
    leadResult = {
      created: true,
      nombre,
      telefono,
      fecha: (new Date()).toISOString(),
      doctor: 'Dr. Juan Pérez',
      location: config.clinicProfile?.address || 'Av. Alameda de la República 286 - Huánuco'
    };

    texto = `¡Perfecto ${nombre}! Tu limpieza dental quedó agendada para hoy a las 4:00 PM. Te atenderá ${leadResult.doctor}. Dirección: ${leadResult.location}`;
  } else if (/confirm(a|ar)|doctor|direcci/i.test(lower)) {
    texto = `Te atenderá ${config.clinicProfile?.doctorName || 'nuestro equipo'}. La dirección es: ${config.clinicProfile?.address || '📍 Av. Alameda de la República 286 - Huánuco'}`;
  } else {
    texto = 'Disculpa, no entendí tu solicitud. ¿Puedes reformularla, por favor?';
  }

  history.push({ role: 'bot', text: texto });
  // Mantener max 8 mensajes
  if (history.length > 16) history.splice(0, history.length - 16);

  return { texto, leadResult };
}

// Stub de whatsappService.sendWhatsAppMessage
async function sendWhatsAppMessage(to, text) {
  console.log(`>> [WHATSAPP SEND] to=${to} text=${text}`);
  return { ok: true };
}

// Handler que imita la lógica esencial del webhook real (extrae mensaje y llama al stubbed IA y whatsapp)
async function processWebhookPayload(payload) {
  console.log('\n=== PROCESSING PAYLOAD ===');
  console.log(JSON.stringify(payload, null, 2));

  const entry = payload.entry?.[0];
  const changes = entry?.changes?.[0];
  const message = changes?.value?.messages?.[0];

  if (!message) {
    console.log('No message found in payload.');
    return;
  }

  const from = String(message.from || '').replace(/\D/g, '');
  const text = message?.text?.body || '';

  console.log(`[SIM] Incoming message from ${from}: ${text}`);

  const remoteJid = `${from}@s.whatsapp.net`;
  const { texto, leadResult } = await obtenerRespuestaIA(remoteJid, text);
  await sendWhatsAppMessage(from, texto);

  console.log('LeadResult (if any):', leadResult);
}

// Construir payload WhatsApp Cloud API simple
function buildWhatsappPayload(from, text) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'test-entry',
        changes: [
          {
            value: {
              messaging_product: 'whatsapp',
              metadata: { phone_number_id: '12345' },
              messages: [
                {
                  from: String(from),
                  id: 'wamid.test.1',
                  timestamp: Math.floor(Date.now() / 1000).toString(),
                  text: { body: text }
                }
              ]
            }
          }
        ]
      }
    ]
  };
}

async function runScenario() {
  // Mensaje 1
  const from = '51912345678';
  const msg1 = 'Hola, buenos días. ¿Qué servicios dentales ofrecen y cuáles son sus horarios?';
  await processWebhookPayload(buildWhatsappPayload(from, msg1));

  // Mensaje 2
  const msg2 = 'Quiero agendar una limpieza dental para hoy a las 4:00 pm, me llamo Diego Quispe.';
  await processWebhookPayload(buildWhatsappPayload(from, msg2));

  // Mensaje 3
  const msg3 = '¿Me confirmas qué doctor me atenderá y la dirección de la clínica?';
  await processWebhookPayload(buildWhatsappPayload(from, msg3));
}

// Montar servidor local para simular POST HTTP a /webhook y comprobar status 200
async function startServerAndRun() {
  const app = express();
  app.use(express.json());

  app.post('/webhook', async (req, res) => {
    try {
      // Imitamos la respuesta temprana a Meta
      res.status(200).send('EVENT_RECEIVED');
      // Procesamos asíncronamente
      processWebhookPayload(req.body).catch((e) => console.error('Processing error:', e));
    } catch (e) {
      console.error('Webhook route error:', e);
      if (!res.headersSent) res.status(500).send('ERROR');
    }
  });

  const server = app.listen(PORT, async () => {
    console.log(`Simulator webhook listening on http://localhost:${PORT}/webhook`);

    // Ejecutar el escenario localmente (llamando directamente al handler)
    console.log('\n--- Ejecutando escenario en memoria (llamadas directas a handler) ---');
    await runScenario();

    // Luego probar la ruta HTTP local con un POST simulado
    console.log('\n--- Enviando POST HTTP simulado a /webhook ---');
    const payload = buildWhatsappPayload('51912345678', 'Simulación HTTP: Hola, quisiera info sobre horarios.');
    try {
      const resp = await fetch(`http://localhost:${PORT}/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      console.log('HTTP POST status:', resp.status);
      const text = await resp.text();
      console.log('HTTP POST response body:', text);
    } catch (e) {
      console.error('Error enviando POST HTTP:', e);
    }

    console.log('\n--- Simulación completada. Cerrando servidor en 1s ---');
    setTimeout(() => server.close(() => process.exit(0)), 1000);
  });
}

startServerAndRun().catch((e) => { console.error('Simulator fatal error:', e); process.exit(1); });
