import config from '../config/env.js';
import geminiService from '../services/geminiService.js';
import leadService from '../services/leadService.js';
import notificationService from '../services/notificationService.js';
import whatsappService from '../services/whatsappService.js';
import forwardToDashboard from '../src/dashboardForwarder.js';
import { getGeminiClient } from '../src/geminiClient.js';
import { createClient } from '@supabase/supabase-js';

// Helper: upsert a message into chat_sessions.history
let supabaseClient = null;
const chatSessionHistoryCache = new Map();
const processedMessageIds = new Set();
const PROCESSED_IDS_TTL_MS = 5 * 60 * 1000;

const BASE_URL = (process.env.RENDER_EXTERNAL_URL || 'https://bot-reumatologia-cqpharma.onrender.com').replace(/\/+$/, '');

// Se elimina CATALOGO_LUMINZU local porque el servicio ya devuelve la URL de imagen

async function getSupabaseClient() {
  if (supabaseClient) return supabaseClient;
  const rawUrl = config.supabase?.url || process.env.SUPABASE_URL;
  const key = config.supabase?.serviceRoleKey || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE;
  if (!rawUrl || !key) return null;
  supabaseClient = createClient(rawUrl, key);
  return supabaseClient;
}

async function hardResetUserSession(phone) {
  try {
    const rawDigits = String(phone || '').replace(/\D/g, '');
    const shortPhone = rawDigits.length >= 9 ? rawDigits.slice(-9) : rawDigits;
    const client = await getSupabaseClient();

    const jid = `${rawDigits}@s.whatsapp.net`;
    if (geminiService.resetSession) {
      geminiService.resetSession(jid);
      geminiService.resetSession(`${shortPhone}@s.whatsapp.net`);
    }
    chatSessionHistoryCache.delete(rawDigits);
    chatSessionHistoryCache.delete(shortPhone);

    if (client) {
      await Promise.allSettled([
        client.from('leads').delete().or(`telefono.ilike.%${shortPhone}%,telefono.eq.${shortPhone},telefono.eq.${rawDigits}`),
        client.from('chat_sessions').delete().or(`id.eq.${rawDigits},id.eq.${shortPhone}`),
        client.from('conversations').delete().or(`contact_name.ilike.%${shortPhone}%`),
        client.from('messages').delete().or(`sender.ilike.%${shortPhone}%`)
      ]);
    }
    console.log(`[RESET TOTAL] Lead y sesiones eliminadas para: ${shortPhone} (${rawDigits})`);
    return true;
  } catch (err) {
    console.error('Error en hardResetUserSession:', err?.message || err);
    return false;
  }
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

    if (upsertErr) {
      console.warn('persistToSupabaseConversation upsert failed:', upsertErr);
      return null;
    }

    const { error: insertErr } = await supabase.from('messages').insert({
      conversation_id: normalizedId,
      contact_number: phone,
      sender,
      text: text || null,
      media_url: mediaUrl || null,
      media_type: mediaUrl ? 'image' : 'text',
      created_at: ts
    });

    if (insertErr) {
      console.warn('persistToSupabaseConversation insert failed:', insertErr);
      return null;
    }

    return true;
  } catch (e) {
    console.warn('persistToSupabaseConversation failed:', e && e.message ? e.message : e);
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
      if (exErr) {
        const msg = String(exErr.message || '').toLowerCase();
        if (msg.includes('does not exist') || msg.includes('relation') || msg.includes('not found')) return null;
        console.warn('persistToChatSessions read error', exErr);
        return null;
      }
      if (existing && existing.history) {
        history = Array.isArray(existing.history) ? existing.history : JSON.parse(existing.history || '[]');
      }
      chatSessionHistoryCache.set(sessionId, history);
    }

    history.push(entry);
    chatSessionHistoryCache.set(sessionId, history);

    const upsertPayload = { id: sessionId, history, updated_at: new Date().toISOString() };
    const { error: upErr } = await client.from('chat_sessions').upsert([upsertPayload], { onConflict: 'id' });
    if (upErr) {
      const msg = String(upErr.message || '').toLowerCase();
      if (msg.includes('does not exist') || msg.includes('relation') || msg.includes('not found')) return null;
      console.warn('persistToChatSessions upsert error', upErr);
    }
    return true;
  } catch (e) {
    console.warn('persistToChatSessions failed', e && e.message ? e.message : e);
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
    const body = {
      conversation_id: String(conversation_id || '').trim(),
      contact_name: contact_name || null,
      sender,
      type: type || 'text',
      content: content || null,
      media_url: media_url || null,
      timestamp: timestamp || new Date().toISOString(),
    };

    const res = await fetch(`${panelBaseUrl}/api/hook`, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res || !res.ok) {
      const text = res && typeof res.text === 'function' ? await res.text() : '';
      console.warn('Panel hook failed:', res && res.status ? res.status : 'unknown', text || '');
    }
  } catch (e) {
    console.warn('notifyMonitorPanel failed (non-blocking):', e && e.message ? e.message : e);
  }
}

async function notifyDashboardReply(phone, text, mediaUrl = null, wamid = null) {
  const dashboardUrl = (process.env.PANEL_BACKEND_URL || 'https://whatsapp-dashboard-z9jm.onrender.com').replace(/\/+$/, '');
  try {
    const response = await fetch(`${dashboardUrl}/api/bot-reply`, {
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

    if (!response.ok) {
      const responseText = typeof response.text === 'function' ? await response.text() : '';
      console.warn('Dashboard bot reply sync failed:', response.status, responseText);
    }
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
          if (parsed[key] !== undefined && parsed[key] !== null) {
            if (typeof parsed[key] === 'string' && parsed[key].trim().length > 0) {
              return parsed[key].trim();
            }
            if (typeof parsed[key] === 'object') {
              const nested = extractPlainText(parsed[key]);
              if (nested && nested.trim().length > 0) {
                return nested.trim();
              }
            }
          }
        }

        if (Array.isArray(parsed)) {
          const arrayText = parsed.map((item) => extractPlainText(item)).filter(Boolean).join(' ');
          if (arrayText) return arrayText;
        }

        if (typeof parsed === 'object') {
          const traversed = Object.values(parsed)
            .map((value) => extractPlainText(value))
            .filter(Boolean)
            .join(' ')
            .trim();
          if (traversed) return traversed;
        }
      }
    } catch (e) {
      const malformedPrefixMatch = cleaned.match(/^\s*\{\s*"(?:content|respuesta|response|texto|text|message)"\s*:\s*"?(.*)$/i);
      if (malformedPrefixMatch && malformedPrefixMatch[1]) {
        return malformedPrefixMatch[1].replace(/\}?\s*$/,'').replace(/^"/, '').trim();
      }
      const match = cleaned.match(/"(?:content|respuesta|response|texto|text|message)"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/i);
      if (match && match[1]) return match[1].trim();
    }
  }

  return cleaned;
}

function extractInstructionTags(text) {
  const imageMatches = [...String(text || '').matchAll(/\[ENVIAR[_ ]?IMAGEN:([^\]]+)\]/gi)]
    .map((m) => m[1].trim())
    .filter(Boolean);
  const agendaMatches = [...String(text || '').matchAll(/\[AGENDAR_CITA:(\{.*?\})\]/gi)].map((m) => m[1].trim()).filter(Boolean);
  return { imageFiles: [...new Set(imageMatches)], agendaPayloads: agendaMatches };
}

function stripInstructionTags(text) {
  return String(text || '')
    .replace(/\[ENVIAR[_ ]?IMAGEN:[^\]]+\]/gi, '')
    .replace(/\[AGENDAR_CITA:\{.*?\}\]/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function safeParseAgendaPayload(raw) {
  if (!raw || typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.warn('webhookController: invalid AGENDAR_CITA payload:', raw, e && e.message ? e.message : e);
    return null;
  }
}

async function persistAgendaPayload(payload, context = {}) {
  if (!payload || typeof payload !== 'object') return null;

  const rawUrl = config.supabase?.url || process.env.SUPABASE_URL;
  const key = config.supabase?.serviceRoleKey || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE;
  if (!rawUrl || !key) return null;

  const record = {
    nombre: payload.nombre || null,
    telefono: payload.telefono || context.phone || null,
    motivo: payload.motivo || null,
    fecha: payload.fecha || null,
    hora: payload.hora || null,
    clinic_id: context.clinicId || null,
    created_at: new Date().toISOString(),
    source: context.source || 'whatsapp',
  };

  try {
    const client = createClient(rawUrl, key);
    const attempts = [
      () => client.from('appointments').insert([record]).select(),
      () => client.from('calendar_events').insert([record]).select(),
      () => client.from('leads').insert([{ telefono: record.telefono, nombre: record.nombre, distrito: null, fecha_hora_texto: record.fecha ? `${record.fecha} ${record.hora || ''}`.trim() : null, fecha_hora_iso: null, created_at: record.created_at, clinic_id: record.clinic_id }]).select(),
    ];

    for (const attempt of attempts) {
      try {
        const { error } = await attempt();
        if (!error) return record;
        const msg = String(error.message || '').toLowerCase();
        if (!msg.includes('does not exist') && !msg.includes('relation') && !msg.includes('not found')) {
          throw error;
        }
      } catch (e) {
        const msg = String(e && e.message ? e.message : e).toLowerCase();
        if (msg.includes('does not exist') || msg.includes('relation') || msg.includes('not found')) {
          continue;
        }
        throw e;
      }
    }
  } catch (e) {
    console.warn('webhookController: AGENDAR_CITA storage failed but user message will continue:', e && e.message ? e.message : e);
  }

  return null;
}

// ============== CONTROLADOR PRINCIPAL ==============
export default async function webhookController(req, res, next) {
  try {
    let incomingPayload = req.parsedBody || req.body;
    if (Buffer.isBuffer(incomingPayload)) {
      try {
        incomingPayload = JSON.parse(incomingPayload.toString('utf8'));
      } catch (error) {
        incomingPayload = null;
      }
    }
    if (incomingPayload) {
      notifyDashboardIncoming(incomingPayload);
    }

    let payload = null;
    try {
      if (req.parsedBody) payload = req.parsedBody;
      else if (req.body) {
        if (req.body instanceof Buffer) {
          try { payload = JSON.parse(req.body.toString('utf8')); } catch (e) { payload = null; }
        } else {
          payload = req.body;
        }
      }
    } catch (e) {
      payload = null;
    }

    const value = payload?.entry?.[0]?.changes?.[0]?.value;
    const incomingMessages = Array.isArray(value?.messages) ? value.messages : [];
    if (!incomingMessages.length) {
      if (!res.headersSent) return res.status(200).json({ ok: true, reason: 'ignored_non_message' });
      return;
    }
    const firstMessage = incomingMessages[0];
    const msgId = firstMessage?.id;
    if (msgId) {
      if (processedMessageIds.has(msgId)) {
        if (!res.headersSent) return res.status(200).json({ ok: true, reason: 'duplicate_ignored' });
        return;
      }
      processedMessageIds.add(msgId);
      setTimeout(() => processedMessageIds.delete(msgId), PROCESSED_IDS_TTL_MS);
    }

    if (!firstMessage || firstMessage.from === 'status@broadcast' || firstMessage.type === 'system') {
      if (!res.headersSent) return res.status(200).json({ ok: true, reason: 'ignored_status_or_system' });
      return;
    }

    let clinicName = process.env.CLINIC_NAME_FALLBACK || 'nuestra clínica dental';
    const entry = payload?.entry?.[0];
    const change = entry?.changes?.[0];
    const payloadValue = change?.value || {};
    const message = payloadValue?.messages?.[0] || null;
    if (!message) {
      if (!res.headersSent) return res.status(200).json({ ok: true, reason: 'no_message' });
      return;
    }

    const rawFrom = message?.from || message?.from_user_id || payloadValue?.contacts?.[0]?.wa_id || payloadValue?.contacts?.[0]?.user_id || null;
    let from = rawFrom ? String(rawFrom).trim().replace(/^PE\./i, '') : null;
    from = from ? from.replace(/\D/g, '') : null;
    if (!from) {
      console.warn('webhookController: invalid from, skipping');
      if (!res.headersSent) return res.status(200).json({ ok: false, reason: 'invalid_from' });
      return;
    }

    let messageText = null;
    if (message?.type === 'text') {
      messageText = message?.text?.body?.trim();
    } else if (message?.type === 'button') {
      messageText = message?.button?.text?.trim();
    } else if (message?.type === 'interactive') {
      messageText = message?.interactive?.button_reply?.title?.trim() || message?.interactive?.list_reply?.title?.trim();
    } else {
      messageText = message?.text?.body?.trim() || null;
    }

    if (!messageText) {
      console.warn('webhookController: message text missing');
      if (!res.headersSent) return res.status(200).json({ ok: false, reason: 'no_text' });
      return;
    }

    if (!res || !res.headersSent) {
      try { res.status(200).json({ ok: true }); } catch (e) { /* safe no-op */ }
    }

    if (/^\/?(reset|reiniciar|borrar|clear)$/i.test(messageText.trim())) {
      await hardResetUserSession(from);
      const resetGreeting = '¡Hola! Bienvenido a LUMINZU Clínica Dental 🦷✨. ¿Con quién tengo el gusto y en qué tratamiento te gustaría consultar hoy? 😊';
      await whatsappService.sendWhatsAppMessage(from, resetGreeting, {});
      return;
    }

    const incomingType = message?.type === 'image' ? 'image' : 'text';
    const incomingMediaUrl = message?.type === 'image' && (message?.image?.link || message?.image?.url || null) ? (message.image.link || message.image.url) : null;
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

    if (!res || !res.headersSent) {
      try { return res.status(200).json({ ok: true }); } catch (e) { /* safe no-op */ }
    }

    // Continuar en segundo plano
    (async () => {
      try {
        const jid = `${from}@s.whatsapp.net`;

        const geminiClient = getGeminiClient();
        const geminiPromise = geminiService.obtenerRespuestaIA(jid, messageText, { client: geminiClient, maxRetries: 1, maxOutputTokens: 100 });
        const timeoutMs = 25_000;
        const timeoutPromise = new Promise((_, reject) => {
          const t = setTimeout(() => reject(new Error('gemini timeout')), timeoutMs);
          t.unref && t.unref();
        });

        const phoneNumberId = payloadValue?.metadata?.phone_number_id ? String(payloadValue.metadata.phone_number_id).trim() : (process.env.WHATSAPP_PHONE_NUMBER_ID ? String(process.env.WHATSAPP_PHONE_NUMBER_ID).trim() : null);
        let clinic = null;
        if (phoneNumberId) {
          try {
            let client = null;
            try {
              const mod = await import('../services/leadService.js');
              if (mod && typeof mod.getSupabaseClient === 'function') {
                client = mod.getSupabaseClient();
              }
            } catch (impErr) {
              try {
                const rawUrl = config.supabase?.url || process.env.SUPABASE_URL;
                const key = config.supabase?.serviceRoleKey || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE;
                if (rawUrl && key) client = createClient(rawUrl, key);
              } catch (cErr) {}
            }

            if (client) {
              const { data } = await client.from('clinics').select('*').eq('waba_phone_number_id', phoneNumberId).maybeSingle();
              clinic = data || null;
            } else {
              clinic = clinic || {
                id: null,
                name: 'LUMINZU',
                address: process.env.DIRECCION_CLINICA || 'Av. Alameda de la República N.º 261, Huánuco',
                chatwoot_inbox_id: null,
                chatwoot_account_id: null,
                chatwoot_api_token: process.env.CHATWOOT_API_TOKEN || null,
                waba_phone_number_id: phoneNumberId,
              };
            }
          } catch (e) {
            console.error('webhookController: error looking up clinic by waba_phone_number_id', e);
            clinic = clinic || {
              id: null,
              name: 'LUMINZU',
              address: process.env.DIRECCION_CLINICA || 'Av. Alameda de la República N.º 261, Huánuco',
              chatwoot_inbox_id: null,
              chatwoot_account_id: null,
              chatwoot_api_token: process.env.CHATWOOT_API_TOKEN || null,
              waba_phone_number_id: phoneNumberId,
            };
          }
        }

        let texto = 'Disculpa, hubo un problema procesando tu mensaje.';
        let leadData = null;
        let skipResponse = false;
        let imagenURL = null; // <-- Nueva variable para imagen
        let geminiResult = null;

        try {
          geminiResult = await Promise.race([geminiPromise, timeoutPromise]);
          if (geminiResult) {
            if (geminiResult.skipResponse) {
              skipResponse = true;
            } else {
              texto = geminiResult.texto || geminiResult.text || (typeof geminiResult === 'string' ? geminiResult : texto);
              leadData = geminiResult.leadData || null;
              imagenURL = geminiResult.imagenURL || null; // <-- Obtenemos la URL de imagen
            }
          }
        } catch (e) {
          console.error('webhookController: gemini call failed or timed out', e);
        }

        if (skipResponse) return;

        // Guardar lead si leadData existe
        let leadResult = null;
        if (leadData) {
          try {
            const telefonoKey = from || null;
            if (!telefonoKey) {
              console.warn('webhookController: no remitente phone available; skipping lead save');
            } else {
              const shouldConfirm = typeof messageText === 'string' && geminiService.isExplicitConfirmation(messageText);
              const shouldPersistLead = !(geminiResult && geminiResult.skipLeadPersistence);
              if (shouldPersistLead) {
                try {
                  leadResult = await leadService.saveLead({
                    telefono: telefonoKey,
                    nombre: leadData.nombre,
                    distrito: leadData.distrito,
                    fechaHoraISO: leadData.fechaHoraISO || leadData.fecha_hora_iso || null,
                    fechaHoraTexto: leadData.fechaHora || leadData.fecha_hora || null,
                    confirmed: shouldConfirm,
                    clinicId: clinic?.id || null,
                    clinic: clinic || null,
                  });
                } catch (dbErr) {
                  console.error('webhookController: leadService.saveLead failed', dbErr);
                }
              }
              if (shouldConfirm && leadResult && leadResult.lead) {
                try {
                  await notificationService.notifyAdminNewLead(leadResult.lead, { whatsappService, leadService, clinic });
                } catch (err) {
                  console.error('webhookController: forced admin notify after explicit confirmation failed', err);
                }
              }
            }
          } catch (e) {
            console.error('webhookController: error saving lead', e);
          }
        }

        // Enviar respuesta al usuario
        try {
          // Persistir mensaje entrante
          if (from && messageText) {
            await persistToChatSessions(from, { from: 'patient', text: String(messageText).trim(), phone: from, timestamp: new Date().toISOString() });
          }

          // Sanitizar texto final
          let textoFinal = extractPlainText(texto);
          textoFinal = geminiService.sanitizeModelTextOutput(textoFinal);
          textoFinal = textoFinal.replace(/🚨\s*¡NUEVO PACIENTE AGENDADO![\s\S]*$/gi, '').trim();

          // Limpiar etiquetas residuales (por si acaso)
          const textoLimpio = stripInstructionTags(textoFinal);
          const textoParaWhatsApp = textoLimpio;

          // Determinar imagen a enviar usando imagenURL del servicio
          let finalMediaUrl = imagenURL || null;

          if (finalMediaUrl) {
            const caption = textoParaWhatsApp || 'Te comparto esta imagen informativa de Clínica LUMINZU 🦷✨';
            try {
              const sendResult = await whatsappService.sendWhatsAppMessage(from, caption, {
                type: 'image',
                image: { link: finalMediaUrl },
                media: { link: finalMediaUrl },
                caption,
              });
              forwardToDashboard({ direction: 'outgoing', outgoing: { to: from, text: caption, mediaUrl: finalMediaUrl } });
              await notifyDashboardReply(from, caption, finalMediaUrl, sendResult?.messages?.[0]?.id || null);
            } catch (e) {
              console.error('Error enviando imagen:', e?.message || e);
              if (textoParaWhatsApp) await whatsappService.sendWhatsAppMessage(from, textoParaWhatsApp, {});
            }
          } else if (textoParaWhatsApp) {
            const sendResult = await whatsappService.sendWhatsAppMessage(from, textoParaWhatsApp, {});
            forwardToDashboard({ direction: 'outgoing', outgoing: { to: from, text: textoParaWhatsApp, mediaUrl: null } });
            await notifyDashboardReply(from, textoParaWhatsApp, null, sendResult?.messages?.[0]?.id || null);
          }

          // Notificar al panel de monitoreo
          await notifyMonitorPanel({
            conversation_id: from,
            contact_name: patientName || payloadValue?.contacts?.[0]?.profile?.name || null,
            sender: 'bot',
            type: finalMediaUrl ? 'image' : 'text',
            content: textoParaWhatsApp || null,
            media_url: finalMediaUrl,
            timestamp: new Date().toISOString(),
          });

          // Persistir respuesta del bot
          await persistToSupabaseConversation({
            conversationId: from,
            contactNumber: from,
            contactName: patientName || payloadValue?.contacts?.[0]?.profile?.name || from,
            sender: 'bot',
            text: textoParaWhatsApp || null,
            mediaUrl: finalMediaUrl,
            timestamp: new Date().toISOString()
          });

          await persistToChatSessions(from, {
            from: 'bot',
            text: textoParaWhatsApp || null,
            image: finalMediaUrl ? 'image_url' : null,
            phone: from,
            timestamp: new Date().toISOString()
          });

        } catch (e) {
          console.error('webhookController: failed sending message to user', e);
        }

        // Notificar admin si es necesario
        try {
          if (leadResult && leadResult.readyToNotify && leadResult.lead) {
            const adminNumber = process.env.ADMIN_WHATSAPP_NUMBER || config.admin?.phone || 'unknown';
            console.log('[NOTIFICACION ENVIADA A ADMIN]:', adminNumber);
            await notificationService.notifyAdminNewLead(leadResult.lead, { whatsappService, leadService, clinic });
          }
        } catch (e) {
          console.error('webhookController: error in admin notify flow', e);
        }
      } catch (err) {
        console.error('webhookController: unexpected background processing error', err);
      }
    })();

    return;
  } catch (err) {
    return next(err);
  }
}