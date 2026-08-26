// ============================================================
// SERVICIO 1/2: BOT (webhook.js)
// Recibe el webhook de Meta WhatsApp Cloud API, genera respuesta
// con Gemini, envía texto/foto al cliente, y sincroniza todo con
// el servicio del panel (dashboard.js).
//
// Reemplaza tu webhook.js actual por este. Si tenías lógica propia
// de Google Calendar o un prompt de Gemini específico, pégalo en
// las secciones marcadas con "TODO" antes de hacer deploy.
// ============================================================

const express = require('express');
const app = express();
app.use(express.json({ limit: '10mb' }));

// ---------- Variables de entorno ----------
const {
  PORT = 10000,
  VERIFY_TOKEN,                 // el mismo que pusiste en Meta > Configuración > Webhook
  WHATSAPP_TOKEN,                // token permanente/temporal de la app de Meta
  PHONE_NUMBER_ID,               // ID del número de WhatsApp Business
  GEMINI_API_KEY,
  GEMINI_MODEL = 'gemini-2.0-flash',
  CLINIC_NAME_FALLBACK = 'LUMINZU Clínica Dental',
  PANEL_BACKEND_URL,             // URL pública del servicio dashboard.js
  SHARED_SECRET,                 // mismo valor exacto en ambos servicios
} = process.env;

for (const [name, val] of Object.entries({ VERIFY_TOKEN, WHATSAPP_TOKEN, PHONE_NUMBER_ID, GEMINI_API_KEY })) {
  if (!val) console.error(`FALTA la variable de entorno ${name} — este servicio no va a funcionar bien sin ella.`);
}

// ---------- 1) Verificación del webhook (Meta hace este GET una sola vez) ----------
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// ---------- 2) Dedupe de eventos de Meta (arregla las respuestas duplicadas) ----------
// Meta puede reenviar el mismo evento de webhook más de una vez. Sin esto,
// el bot procesa el mismo mensaje del cliente dos veces y responde dos veces.
const processedMessageIds = new Set();
function yaProcesado(waMessageId) {
  if (!waMessageId) return false;
  if (processedMessageIds.has(waMessageId)) return true;
  processedMessageIds.add(waMessageId);
  if (processedMessageIds.size > 5000) {
    processedMessageIds.delete(processedMessageIds.values().next().value);
  }
  return false;
}
// NOTA: este Set vive en memoria y se vacía si Render reinicia el servicio
// (plan free duerme tras 15 min sin tráfico). Para blindarlo del todo, guarda
// wa_id en una tabla propia con índice único, igual que hace supabase_schema.sql
// del lado del panel.

// ---------- 3) Sincronización con el panel (fire-and-forget) ----------
function forwardToDashboard(rawBody) {
  if (!PANEL_BACKEND_URL) return;
  fetch(`${PANEL_BACKEND_URL}/api/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rawBody),
  }).catch(err => console.error('Dashboard sync error (webhook):', err.message));
}

function notifyBotReply(phone, text, mediaUrl = null, wamid = null, sender = 'bot') {
  if (!PANEL_BACKEND_URL) return;
  fetch(`${PANEL_BACKEND_URL}/api/bot-reply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: String(phone).replace(/\D/g, ''), text, mediaUrl, wamid, sender }),
  }).catch(err => console.error('Dashboard sync error (bot-reply):', err.message));
}

// ---------- 4) Envío a Meta Graph API (texto e imagen) ----------
// IMPORTANTE sobre fotos: Meta necesita una URL PÚBLICA https accesible desde
// internet, o un media_id ya subido a Meta. Si tus fotos de tratamientos viven
// en tu propio servidor, deben estar servidas en una ruta pública (ej. una
// carpeta /public en este mismo servicio, o en un bucket). No sirven rutas
// locales de tu computadora.
async function sendWhatsAppText(phone, text) {
  const r = await fetch(`https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: phone, type: 'text', text: { body: text } }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error?.message || 'Error enviando texto');
  return data?.messages?.[0]?.id || null;
}

async function sendWhatsAppImage(phone, imageUrl, caption = '') {
  const r = await fetch(`https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: phone, type: 'image', image: { link: imageUrl, caption } }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error?.message || 'Error enviando imagen');
  return data?.messages?.[0]?.id || null;
}

// Envuelve texto + foto en un solo helper, y AVISA AL PANEL en ambos casos
// (esto es lo que faltaba: tu bot mandaba la foto a Meta pero nunca le decía
// al dashboard que existía ese mensaje).
async function replyToClient(phone, { text, imageUrl } = {}) {
  if (imageUrl) {
    const wamid = await sendWhatsAppImage(phone, imageUrl, text || '');
    notifyBotReply(phone, text || '', imageUrl, wamid, 'bot');
  } else if (text) {
    const wamid = await sendWhatsAppText(phone, text);
    notifyBotReply(phone, text, null, wamid, 'bot');
  }
}

// ---------- 5) TODO: fotos de tratamientos ----------
// Pon aquí las URLs públicas reales de tus fotos de ejemplo (brackets,
// carillas, limpieza, etc). Deben ser https accesibles desde afuera.
const TREATMENT_PHOTOS = {
  brackets: 'https://TU-DOMINIO-PUBLICO/fotos/brackets.jpg',
  carillas: 'https://TU-DOMINIO-PUBLICO/fotos/carillas.jpg',
  limpieza: 'https://TU-DOMINIO-PUBLICO/fotos/limpieza.jpg',
};

// ---------- 6) TODO: prompt de Gemini ----------
// Pega aquí el system prompt real de tu clínica (precios, tono, horarios,
// cómo agendar, etc). Este es un placeholder mínimo para que el bot funcione
// mientras lo completas.
const SYSTEM_PROMPT = `
Eres el asistente de WhatsApp de ${CLINIC_NAME_FALLBACK}.
Responde de forma breve, cálida y profesional en español.
Si el cliente pregunta por brackets, carillas o limpieza dental, ofrece
compartir una foto de ejemplo y pregunta si quiere agendar una cita.
// TODO: reemplaza este bloque con tus precios, horarios y reglas reales.
`.trim();

async function preguntarAGemini(historialTexto) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: historialTexto }] }],
    }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error?.message || 'Error llamando a Gemini');
  return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || 'Disculpa, ¿puedes repetir tu consulta?';
}

function detectaTratamiento(texto = '') {
  const t = texto.toLowerCase();
  if (t.includes('bracket')) return 'brackets';
  if (t.includes('carilla')) return 'carillas';
  if (t.includes('limpieza')) return 'limpieza';
  return null;
}

// ---------- 7) Webhook principal: mensajes entrantes ----------
app.post('/webhook', async (req, res) => {
  res.sendStatus(200); // responder rápido a Meta, procesar después
  const body = req.body;
  if (body.object !== 'whatsapp_business_account') return;

  forwardToDashboard(body); // copia cruda al panel, siempre

  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value;
      if (!value?.messages) continue;

      for (const msg of value.messages) {
        if (yaProcesado(msg.id)) continue; // <-- corta duplicados aquí

        const phone = msg.from;
        const textoEntrante = msg.text?.body || msg.caption || '';

        try {
          const tratamiento = detectaTratamiento(textoEntrante);

          if (tratamiento && TREATMENT_PHOTOS[tratamiento]) {
            const respuestaTexto = await preguntarAGemini(textoEntrante);
            await replyToClient(phone, { text: respuestaTexto, imageUrl: TREATMENT_PHOTOS[tratamiento] });
          } else {
            const respuestaTexto = await preguntarAGemini(textoEntrante);
            await replyToClient(phone, { text: respuestaTexto });
          }
        } catch (err) {
          console.error('Error procesando mensaje:', err.message);
        }
      }
    }
  }
});

// ---------- 8) Endpoint para envío manual desde el panel ----------
app.post('/api/agent-send', async (req, res) => {
  if (req.headers['x-internal-secret'] !== SHARED_SECRET) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  const { phone, text, imageUrl } = req.body;
  if (!phone || (!text && !imageUrl)) return res.status(400).json({ error: 'phone y (text o imageUrl) requeridos' });

  try {
    if (imageUrl) {
      const wamid = await sendWhatsAppImage(phone, imageUrl, text || '');
      notifyBotReply(phone, text || '', imageUrl, wamid, 'agent');
    } else {
      const wamid = await sendWhatsAppText(phone, text);
      notifyBotReply(phone, text, null, wamid, 'agent');
    }
    res.json({ success: true });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get('/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`Bot webhook escuchando en puerto ${PORT}`));  