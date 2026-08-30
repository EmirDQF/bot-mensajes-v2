import config from '../config/env.js';
import geminiService from '../services/geminiService.js';
import leadService from '../services/leadService.js';
import notificationService from '../services/notificationService.js';
import whatsappService from '../services/whatsappService.js';
import forwardToDashboard from '../src/dashboardForwarder.js';
import { getGeminiClient } from '../src/geminiClient.js';
import { createClient } from '@supabase/supabase-js';

// Base URL pública del servicio en Render
const BASE_URL = (process.env.RENDER_EXTERNAL_URL || 'https://bot-reumatologia-cqpharma.onrender.com').replace(/\/+$/, '');

// Catálogo de 18 imágenes en la carpeta LUMINZU servida en /media
const CATALOGO_18_FOTOS = {
  // Ortodoncia y casos
  ortodoncia: `${BASE_URL}/media/bracketsmuestra.jpeg`,
  ortodoncia_1: `${BASE_URL}/media/ortodoncia_antes_1.jpeg`,
  ortodoncia_2: `${BASE_URL}/media/ortodoncia_antes_2.jpeg`,
  ortodoncia_3: `${BASE_URL}/media/ortodoncia_antes_3.jpeg`,
  ortodoncia_4: `${BASE_URL}/media/ortodoncia_antes_4.jpeg`,
  ortodoncia_5: `${BASE_URL}/media/ortodoncia_antes_5.jpeg`,
  brackets: `${BASE_URL}/media/bracketsmuestra.jpeg`,
  frenillos: `${BASE_URL}/media/bracketsmuestra.jpeg`,

  // Tratamientos estéticos y generales
  blanqueamiento: `${BASE_URL}/media/blanqueamiento.jpeg`,
  carillas: `${BASE_URL}/media/carillas.jpeg`,
  estetica: `${BASE_URL}/media/carillas.jpeg`,
  chequeo: `${BASE_URL}/media/chequeo.jpeg`,
  endodoncia: `${BASE_URL}/media/endodoncia.jpeg`,
  conducto: `${BASE_URL}/media/endodoncia.jpeg`,
  implantes: `${BASE_URL}/media/implantes.jpeg`,
  implante: `${BASE_URL}/media/implantes.jpeg`,
  odontopediatria: `${BASE_URL}/media/odontopediatria.jpeg`,
  ninos: `${BASE_URL}/media/odontopediatria.jpeg`,
  protesis: `${BASE_URL}/media/protesis.jpeg`,
  restauracion: `${BASE_URL}/media/restauracion_resina.jpeg`,
  resina: `${BASE_URL}/media/restauracion_resina.jpeg`,
  tratamientos: `${BASE_URL}/media/tratamientos.jpeg`,

  // Institucionales y promociones
  limpieza: `${BASE_URL}/media/kit_preventivo.jpeg`,
  kit_preventivo: `${BASE_URL}/media/kit_preventivo.jpeg`,
  preventivo: `${BASE_URL}/media/kit_preventivo.jpeg`,
  fachada: `${BASE_URL}/media/fachada.jpeg`,
  ubicacion: `${BASE_URL}/media/ubicacion.jpeg`,
  mapa: `${BASE_URL}/media/ubicacion.jpeg`,
  direccion: `${BASE_URL}/media/ubicacion.jpeg`,
  promo: `${BASE_URL}/media/promo_consulta.jpeg`,
  consulta: `${BASE_URL}/media/promo_consulta.jpeg`,
  logo: `${BASE_URL}/media/logo.jpeg`
};

let supabaseClient = null;
const chatSessionHistoryCache = new Map();

async function getSupabaseClient() {
  if (supabaseClient) return supabaseClient;
  const rawUrl = config.supabase?.url || process.env.SUPABASE_URL;
  const key = config.supabase?.serviceRoleKey || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE;
  if (!rawUrl || !key) return null;
  supabaseClient = createClient(rawUrl, key);
  return supabaseClient;
}

async function persistToSupabaseConversation({ conversationId, contactNumber, contactName, sender, text, mediaUrl, timestamp }) {
  const supabase = await getSupabaseClient();
  if (!supabase || !conversationId) return null;

  const normalizedId = String(conversationId).trim();
  const phone = contactNumber || normalizedId;
  const ts = timestamp || new Date().toISOString();
  const lastMessage = text && String(text).trim().length ? String(text).trim() : (mediaUrl ? '[Imagen]' : 'Mensaje');

  try {
    const { error: upsertErr } = await supabase.from('conversations').upsert({
      conversation_id: normalizedId,
      contact_number: phone,
      contact_name: contactName || phone,
      last_message: lastMessage,
      last_message_at: ts,
      created_at: ts
    }, { onConflict: 'conversation_id' });

    if (upsertErr) console.warn('persistToSupabaseConversation upsert failed:', upsertErr);

    const { error: insertErr } = await supabase.from('messages').insert({
      conversation_id: normalizedId,
      contact_number: phone,
      sender,
      text: text || null,
      media_url: mediaUrl || null,
      media_type: mediaUrl ? 'image' : 'text',
      created_at: ts
    });

    if (insertErr) console.warn('persistToSupabaseConversation insert failed:', insertErr);
    return true;
  } catch (e) {
    console.warn('persistToSupabaseConversation failed:', e?.message || e);
    return null;
  }
}

async function persistToChatSessions(sessionIdentifier, entry) {
  try {
    const client = await getSupabaseClient();
    if (!client) return null;

    const sessionId = String(sessionIdentifier || '').replace(/\D/g, '') || String(sessionIdentifier || '');
    const cached = chatSessionHistoryCache.get(sessionId);
    let history = Array.isArray(cached) ? [...cached] : [];

    if (!cached) {
      let { data: existing, error: exErr } = await client.from('chat_sessions').select('id, history').eq('id', sessionId).maybeSingle();
      if (!exErr && existing && existing.history) {
        history = Array.isArray(existing.history) ? existing.history : JSON.parse(existing.history || '[]');
      }
      chatSessionHistoryCache.set(sessionId, history);
    }

    history.push(entry);
    chatSessionHistoryCache.set(sessionId, history);

    await client.from('chat_sessions').upsert([{ id: sessionId, history, updated_at: new Date().toISOString() }], { onConflict: 'id' });
    return true;
  } catch (e) {
    console.warn('persistToChatSessions failed:', e?.message || e);
    return null;
  }
}

async function notifyMonitorPanel({ conversation_id, contact_name, sender, type, content, media_url, timestamp }) {
  const panelBaseUrl = (process.env.PANEL_BACKEND_URL || 'https://whatsapp-dashboard-z9jm.onrender.com').replace(/\/+$/, '');
  const username = process.env.PANEL_USER || process.env.PANEL_USERNAME;
  const password = process.env.PANEL_PASSWORD || process.env.PANEL_PASS;
  if (!panelBaseUrl || !username || !password) return;

  try {
    const authHeader = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
    await fetch(`${panelBaseUrl}/api/hook`, {
      method: 'POST',
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversation_id: String(conversation_id || '').trim(),
        contact_name: contact_name || null,
        sender,
        type: type || 'text',
        content: content || null,
        media_url: media_url || null,
        timestamp: timestamp || new Date().toISOString(),
      }),
    });
  } catch (e) {
    console.warn('notifyMonitorPanel failed:', e?.message || e);
  }
}

async function notifyDashboardReply(phone, text, mediaUrl = null, wamid = null) {
  const dashboardUrl = (process.env.PANEL_BACKEND_URL || 'https://whatsapp-dashboard-z9jm.onrender.com').replace(/\/+$/, '');
  try {
    await fetch(`${dashboardUrl}/api/bot-reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: String(phone).replace(/\D/g, ''),
        text: text || '',
        type: mediaUrl ? 'image' : 'text',
        mediaUrl: mediaUrl || null,
        wamid: wamid || `bot_${Date.now()}`,
      }),
    });
  } catch (err) {
    console.error('Error sincronizando respuesta con el dashboard:', err?.message || err);
  }
}

function notifyDashboardIncoming(payload) {
  const dashboardUrl = (process.env.PANEL_BACKEND_URL || 'https://whatsapp-dashboard-z9jm.onrender.com').replace(/\/+$/, '');
  fetch(`${dashboardUrl}/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch((err) => {
    console.warn('Error sincronizando mensaje entrante con el dashboard:', err?.message || err);
  });
}

function extractPlainText(input) {
  let cleaned = typeof input === 'string' ? input : JSON.stringify(input);
  cleaned = cleaned.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();

  if ((cleaned.startsWith('{') && cleaned.endsWith('}')) || (cleaned.startsWith('[') && cleaned.endsWith(']'))) {
    try {
      const parsed = JSON.parse(cleaned);
      if (parsed) {
        const possibleKeys = ['content', 'respuesta', 'response', 'texto', 'text', 'message'];
        for (const key of possibleKeys) {
          if (parsed[key] && typeof parsed[key] === 'string' && parsed[key].trim().length > 0) {
            return parsed[key].trim();
          }
        }
      }
    } catch {
      const match = cleaned.match(/"(?:content|respuesta|response|texto|text|message)"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/i);
      if (match && match[1]) return match[1].trim();
    }
  }
  return cleaned;
}

export default async function webhookController(req, res, next) {
  try {
    let incomingPayload = req.parsedBody || req.body;
    if (Buffer.isBuffer(incomingPayload)) {
      try { incomingPayload = JSON.parse(incomingPayload.toString('utf8')); } catch { incomingPayload = null; }
    }
    if (incomingPayload) notifyDashboardIncoming(incomingPayload);

    let payload = incomingPayload;
    const value = payload?.entry?.[0]?.changes?.[0]?.value;
    const incomingMessages = Array.isArray(value?.messages) ? value.messages : [];
    if (!incomingMessages.length) {
      if (!res.headersSent) return res.status(200).json({ ok: true, reason: 'ignored_non_message' });
      return;
    }

    const firstMessage = incomingMessages[0];
    if (!firstMessage || firstMessage.from === 'status@broadcast' || firstMessage.type === 'system') {
      if (!res.headersSent) return res.status(200).json({ ok: true, reason: 'ignored_status_or_system' });
      return;
    }

    const payloadValue = payload?.entry?.[0]?.changes?.[0]?.value || {};
    const message = payloadValue?.messages?.[0] || null;
    if (!message) {
      if (!res.headersSent) return res.status(200).json({ ok: true, reason: 'no_message' });
      return;
    }

    const rawFrom = message?.from || message?.from_user_id || payloadValue?.contacts?.[0]?.wa_id || null;
    let from = rawFrom ? String(rawFrom).trim().replace(/^PE\./i, '').replace(/\D/g, '') : null;
    if (!from) {
      if (!res.headersSent) return res.status(200).json({ ok: false, reason: 'invalid_from' });
      return;
    }

    let messageText = message?.type === 'text' ? message?.text?.body?.trim()
      : message?.type === 'button' ? message?.button?.text?.trim()
      : message?.type === 'interactive' ? (message?.interactive?.button_reply?.title?.trim() || message?.interactive?.list_reply?.title?.trim())
      : message?.text?.body?.trim() || null;

    if (!messageText) {
      if (!res.headersSent) return res.status(200).json({ ok: false, reason: 'no_text' });
      return;
    }

    const incomingType = message?.type === 'image' ? 'image' : 'text';
    const incomingMediaUrl = message?.type === 'image' ? (message?.image?.link || message?.image?.url || null) : null;

    await notifyMonitorPanel({
      conversation_id: from,
      contact_name: payloadValue?.contacts?.[0]?.profile?.name || null,
      sender: 'user',
      type: incomingType,
      content: messageText || null,
      media_url: incomingMediaUrl,
      timestamp: new Date().toISOString(),
    });

    await persistToSupabaseConversation({
      conversationId: from,
      contactNumber: from,
      contactName: payloadValue?.contacts?.[0]?.profile?.name || from,
      sender: 'user',
      text: messageText,
      mediaUrl: incomingMediaUrl,
      timestamp: new Date().toISOString()
    });

    // Responder HTTP 200 de inmediato a Meta para evitar reintentos duplicados
    if (!res.headersSent) {
      res.status(200).json({ ok: true });
    }

    // Procesamiento en background
    (async () => {
      try {
        const jid = `${from}@s.whatsapp.net`;
        const geminiClient = getGeminiClient();
        const geminiPromise = geminiService.obtenerRespuestaIA(jid, messageText, { client: geminiClient, maxRetries: 1, maxOutputTokens: 250 });
        
        const timeoutPromise = new Promise((_, reject) => {
          const t = setTimeout(() => reject(new Error('gemini timeout')), 25000);
          t.unref?.();
        });

        let texto = 'Disculpa, hubo un problema procesando tu mensaje.';
        let leadData = null;
        let skipResponse = false;
        let geminiResult = null;

        try {
          geminiResult = await Promise.race([geminiPromise, timeoutPromise]);
          if (geminiResult) {
            if (geminiResult.skipResponse) {
              skipResponse = true;
            } else {
              texto = geminiResult.texto || geminiResult.text || (typeof geminiResult === 'string' ? geminiResult : texto);
              leadData = geminiResult.leadData || null;
            }
          }
        } catch (e) {
          console.error('webhookController: error en llamada a Gemini:', e?.message || e);
        }

        if (skipResponse) return;

        // Persistir mensaje del paciente en sesión
        await persistToChatSessions(from, { from: 'patient', text: String(messageText).trim(), phone: from, timestamp: new Date().toISOString() });

        // Sanitización y parseo de tags de imágenes [ENVIARIMAGEN:...] o [ENVIAR_IMAGEN:...]
        let rawBotText = extractPlainText(texto);
        rawBotText = geminiService.sanitizeModelTextOutput(rawBotText);

        const imageTagMatch = rawBotText.match(/\[(?:ENVIARIMAGEN|ENVIAR_IMAGEN):([a-zA-Z0-9_-]+)\]/i);
        let tagKey = null;
        let finalMediaUrl = null;

        if (imageTagMatch) {
          tagKey = imageTagMatch[1].toLowerCase().replace(/\.(jpeg|jpg|png)$/i, '');
          finalMediaUrl = CATALOGO_18_FOTOS[tagKey] || null;
        }

        // Limpiar la etiqueta del texto para que no sea visible al usuario
        let cleanReplyText = rawBotText
          .replace(/\[(?:ENVIARIMAGEN|ENVIAR_IMAGEN):[^\]]+\]/gi, '')
          .replace(/\[AGENDAR_CITA:\{.*?\}\]/gi, '')
          .replace(/\s{2,}/g, ' ')
          .trim();

        // 1. Enviar imagen con pie de foto o solo texto según corresponda
        if (finalMediaUrl) {
          try {
            const caption = cleanReplyText || 'Te comparto la imagen informativa de Clínica LUMINZU 🦷✨';
            const sendResult = await whatsappService.sendWhatsAppMessage(from, caption, {
              type: 'image',
              media: { link: finalMediaUrl },
              caption: caption
            });
            forwardToDashboard({ direction: 'outgoing', outgoing: { to: from, text: caption, mediaUrl: finalMediaUrl } });
            await notifyDashboardReply(from, caption, finalMediaUrl, sendResult?.messages?.[0]?.id || null);
          } catch (e) {
            console.error('Error enviando imagen por WhatsApp API:', e?.message || e);
            if (cleanReplyText) await whatsappService.sendWhatsAppMessage(from, cleanReplyText, {});
          }
        } else if (cleanReplyText) {
          const sendResult = await whatsappService.sendWhatsAppMessage(from, cleanReplyText, {});
          forwardToDashboard({ direction: 'outgoing', outgoing: { to: from, text: cleanReplyText, mediaUrl: null } });
          await notifyDashboardReply(from, cleanReplyText, null, sendResult?.messages?.[0]?.id || null);
        }

        // 2. Notificar monitor y persistir
        await notifyMonitorPanel({
          conversation_id: from,
          contact_name: payloadValue?.contacts?.[0]?.profile?.name || null,
          sender: 'bot',
          type: finalMediaUrl ? 'image' : 'text',
          content: cleanReplyText || null,
          media_url: finalMediaUrl,
          timestamp: new Date().toISOString(),
        });

        await persistToSupabaseConversation({
          conversationId: from,
          contactNumber: from,
          contactName: payloadValue?.contacts?.[0]?.profile?.name || from,
          sender: 'bot',
          text: cleanReplyText || null,
          mediaUrl: finalMediaUrl,
          timestamp: new Date().toISOString()
        });

        await persistToChatSessions(from, {
          from: 'bot',
          text: cleanReplyText || null,
          image: tagKey ? `${tagKey}.jpeg` : null,
          phone: from,
          timestamp: new Date().toISOString()
        });

      } catch (err) {
        console.error('webhookController: error en ejecución de background:', err?.message || err);
      }
    })();

    return;
  } catch (err) {
    return next(err);
  }
}