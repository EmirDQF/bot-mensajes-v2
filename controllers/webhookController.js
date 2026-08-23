import config from '../config/env.js';
import geminiService from '../services/geminiService.js';
import leadService from '../services/leadService.js';
import notificationService from '../services/notificationService.js';
import whatsappService from '../services/whatsappService.js';
import chatwootService from '../services/chatwootService.js';
import { getGeminiClient } from '../src/geminiClient.js';
import { enviarImagenWhatsapp } from '../src/whatsappMedia.js';
import { createClient } from '@supabase/supabase-js';

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
  const imageMatches = [...String(text || '').matchAll(/\[ENVIAR_IMAGEN:([^\]]+)\]/gi)].map((m) => m[1].trim()).filter(Boolean);
  const agendaMatches = [...String(text || '').matchAll(/\[AGENDAR_CITA:(\{.*?\})\]/gi)].map((m) => m[1].trim()).filter(Boolean);
  return { imageFiles: [...new Set(imageMatches)], agendaPayloads: agendaMatches };
}

function stripInstructionTags(text) {
  return String(text || '')
    .replace(/\[ENVIAR_IMAGEN:[^\]]+\]/gi, '')
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

// Fallback mapping: when the model doesn't include [ENVIAR_IMAGEN] tags, use keywords from the user's message
function mapKeywordsToImages(userText) {
  if (!userText || typeof userText !== 'string') return [];
  const t = userText.toLowerCase();
  const images = [];
  if (/bracket|ortodoncia|frenillos|brackets|alineador/i.test(t)) images.push('ortodoncia_antes_despues.jpeg');
  if (/carilla|carillas|carilla dental/i.test(t)) images.push('carillas.jpeg');
  if (/implante|implantes/i.test(t)) images.push('implantes.jpeg');
  if (/protesis|pr[oó]tesis|pr[oó]tesis dental/i.test(t)) images.push('protesis.jpeg');
  if (/endodoncia|conducto|tratamient[oó]n de conductos/i.test(t)) images.push('endodoncia.jpeg');
  if (/odontopediatr|niñ|niños|pediatr/i.test(t)) images.push('odontopediatria.jpeg');
  if (/fachada|consultorio|consultorio|clinica|clínica|instalaciones/i.test(t)) images.push('fachada.jpeg');
  if (/limpieza|profilaxis|kit preventivo|kit_preventivo|mantenimiento/i.test(t)) images.push('kit_preventivo.jpeg');
  if (/ubicaci|direcci|donde queda|direcci[oó]n|ubicacion/i.test(t)) images.push('ubicacion.jpeg');
  if (/promo|promoci[oó]n|oferta/i.test(t)) images.push('promo_consulta.jpeg');
  // Ensure uniqueness and limit to 3 images to avoid spamming
  return [...new Set(images)].slice(0, 3);
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

// Controller delgado que orquesta: Gemini -> lead -> WhatsApp -> admin notify
// IMPORTANT: respond 200 early to Meta, then continue processing asynchronously
export default async function webhookController(req, res, next) {
  try {
    // Prefer parsedBody attached by verifySignature middleware; parse defensively
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

    // Detect Chatwoot webhook (message_created)
    // Safe fallback for clinic name in case `clinic` is undefined in some webhook flows
    let clinicName = process.env.CLINIC_NAME_FALLBACK || 'nuestra clínica dental';
    if (payload?.event === 'message_created' && payload?.payload) {
      const p = payload.payload;
      const message = p?.message || p?.content || null;
      const conversation = p?.conversation || null;
      const inbox = p?.inbox || null;
      const contact = p?.sender || p?.contact || p?.sender_contact || p?.contact || null;

      // Build a simple identifier from contact phone if available
      const contactPhoneRaw = contact?.phone_number || contact?.phone || (p?.sender_contact?.phone_number) || null;
      const contactDigits = contactPhoneRaw ? String(contactPhoneRaw).replace(/\D/g, '') : null;

      // Lookup clinic by chatwoot_inbox_id or account
      const phoneNumberId = String(inbox?.id || payload?.account_id || '').trim();
      let clinic = null;
      try {
        const rawUrl = config.supabase?.url || process.env.SUPABASE_URL;
        const key = config.supabase?.serviceRoleKey || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE;
        const supabase = createClient(rawUrl, key);
        if (inbox?.id) {
          const { data } = await supabase.from('clinics').select('*').eq('chatwoot_inbox_id', inbox.id).maybeSingle();
          clinic = data || null;
        }
        if (!clinic && payload?.account_id) {
          const { data } = await supabase.from('clinics').select('*').eq('chatwoot_account_id', payload.account_id).maybeSingle();
          clinic = data || null;
        }
      } catch (e) {
        console.error('webhookController: error looking up clinic for chatwoot webhook', e && e.message ? e.message : e);
      }

      // Update clinicName from clinic if available
      clinicName = (typeof clinic !== 'undefined' && clinic?.name) || clinicName;
      // If conversation is assigned to a human agent and open, skip bot
      const convStatus = conversation?.status || (p?.conversation?.status);
      const assigneeId = conversation?.meta?.assignee_id || conversation?.assignee_id || null;
      if (convStatus === 'open' && assigneeId) {
        // Human in the loop — do not bot-respond
        if (!res.headersSent) return res.status(200).json({ ok: true, reason: 'human_assigned' });
        return;
      }

      // If user requests human or conversation unassigned, mark for human handover
      const text = (message && (message.content || message.body || message.message)) ? (message.content || message.body || message.message) : (p?.content || null);
      const wantsHuman = typeof text === 'string' && /asesor|humano|asesora|hablar con|asesor(a)?/i.test(text);
      if (wantsHuman || (!assigneeId && convStatus === 'open')) {
        try {
          const accountId = payload.account_id || payload?.account?.id || null;
          const convId = conversation?.id || p?.conversation?.id;
          const apiToken = (typeof clinic !== 'undefined' && clinic?.chatwoot_api_token) || process.env.CHATWOOT_API_TOKEN;
          if (accountId && convId) {
            await chatwootService.updateConversation(accountId, convId, apiToken, { status: 'open' });
            // add a tag or attribute indicating human handover
            // Chatwoot may support adding labels via separate endpoint; as fallback we set status 'open'
          }
        } catch (e) {
          console.error('webhookController: error updating chatwoot conversation for human handover', e && e.message ? e.message : e);
        }

        // Pause the bot for this contact's session in geminiService
        try {
          if (contactDigits) {
            geminiService.pauseSessionById(contactDigits);
          }
        } catch (e) {
          console.error('webhookController: failed to pause session', e && e.message ? e.message : e);
        }

        // Notify clinic admin via notificationService
        try {
          // Create a minimal lead object to notify admin that human handover requested
          const leadLike = { nombre: contact?.name || null, telefono: contactDigits || null, distrito: null, fecha_hora_texto: null };
          await notificationService.notifyAdminNewLead(leadLike, { whatsappService, leadService, clinic: (typeof clinic !== 'undefined' ? clinic : null) });
        } catch (e) {
          console.error('webhookController: error notifying admin about human handover', e && e.message ? e.message : e);
        }

        if (!res.headersSent) return res.status(200).json({ ok: true, reason: 'handover_requested' });
        return;
      }

      // Otherwise, treat as a regular incoming message and process through the bot
      // Map contact phone to jid style used by geminiService
      const jid = contactDigits ? `${contactDigits}@s.whatsapp.net` : (conversation?.id ? `cw-${conversation.id}` : null);

      // call geminiService to obtain reply; pass clinic config for system prompt
      const geminiClient = getGeminiClient();
      // Detect admin sender to avoid creating/updating leads or initiating scheduling flows for admin messages
      const ADMIN_WHATSAPP_NUMBER = (process.env.ADMIN_WHATSAPP_NUMBER || '').replace(/\D/g, '');
      const senderNumberNormalized = contactDigits ? String(contactDigits).replace(/\D/g, '') : (conversation?.id ? String(conversation.id).replace(/\D/g, '') : null);
      const isAdminSender = senderNumberNormalized && ADMIN_WHATSAPP_NUMBER && senderNumberNormalized === ADMIN_WHATSAPP_NUMBER;

      const geminiPromise = geminiService.obtenerRespuestaIA(jid, text || '', {
        client: geminiClient,
        clinic: (typeof clinic !== 'undefined' ? clinic : null),
        maxRetries: 1,
        maxOutputTokens: 100,
        skipLeadPersistence: Boolean(isAdminSender)
      });
      let texto = 'Disculpa, hubo un problema procesando tu mensaje.';
      let leadData = null;
      try {
        const result = await geminiPromise;
        if (result) {
          texto = result.texto || result.text || (typeof result === 'string' ? result : texto);
          leadData = result.leadData || null;
        }
      } catch (e) {
        console.error('webhookController: gemini call failed for chatwoot message', e && e.stack ? e.stack : e);
        if (e && e.response) console.error('[GEMINI RESPONSE]:', e.response);
      }

      // If leadData present, attempt to save lead using the contact's WhatsApp number as source-of-truth
      let leadResult = null;
      if (leadData) {
        try {
          const telefonoKey = contactDigits || null; // contactDigits is the remitente phone for Chatwoot events
          // If message came from admin, skip any DB lead creation/update and scheduling flows
          if (isAdminSender) {
            console.log('webhookController: message from admin detected; skipping lead save and scheduling for this sender');
          } else if (!telefonoKey) {
            console.warn('webhookController: no remitente phone found for chatwoot message; skipping lead save to avoid using model-extracted phone');
          } else {
            const shouldConfirm = typeof text === 'string' && geminiService.isExplicitConfirmation(text);
            leadResult = await leadService.saveLead({
              telefono: telefonoKey,
              nombre: leadData.nombre,
              distrito: leadData.distrito,
              fechaHoraISO: leadData.fechaHoraISO || leadData.fecha_hora_iso || null,
              fechaHoraTexto: leadData.fechaHora || leadData.fecha_hora || null,
              confirmed: true && shouldConfirm,
              clinicId: (typeof clinic !== 'undefined' && clinic?.id) || null,
              clinic: (typeof clinic !== 'undefined' ? clinic : null),
            });
            // If user explicitly confirmed, force an admin notify regardless
            if (shouldConfirm && leadResult && leadResult.lead) {
              try {
                await notificationService.notifyAdminNewLead(leadResult.lead, { whatsappService, leadService, clinic });
              } catch (err) {
                console.error('webhookController: forced admin notify after explicit confirmation failed', err && err.message ? err.message : err);
              }
            }
          }
        } catch (e) {
          console.error('webhookController: error saving lead from chatwoot message', e && e.message ? e.message : e);
        }
      }
 
      // Send response back via Chatwoot so it's recorded in inbox
      try {
        const accountId = (typeof clinic !== 'undefined' && clinic?.chatwoot_account_id) || payload.account_id || null;
        const convId = conversation?.id || p?.conversation?.id;
        const apiToken = (typeof clinic !== 'undefined' && clinic?.chatwoot_api_token) || process.env.CHATWOOT_API_TOKEN;
        // Clean any backslashes that Gemini may inject before extracting instruction tags
        const textoLimpioGemini = String(texto || '').replace(/\\/g, '');
        const cleanedTexto = stripInstructionTags(extractPlainText(texto));
        const { imageFiles: modelImageFiles, agendaPayloads } = extractInstructionTags(textoLimpioGemini);

        // Determine final image files: prefer model-provided tags, otherwise fallback based on user's message keywords
        const finalImageFiles = (Array.isArray(modelImageFiles) && modelImageFiles.length > 0)
          ? modelImageFiles
          : mapKeywordsToImages(text);

        for (const rawAgenda of agendaPayloads) {
          try {
            const parsed = safeParseAgendaPayload(rawAgenda);
            if (parsed) {
              await persistAgendaPayload(parsed, { clinicId: clinic?.id || null, phone: contactDigits || null, source: 'chatwoot' });
            }
          } catch (e) {
            console.error('webhookController: failed persisting AGENDAR_CITA from chatwoot reply', e && e.message ? e.message : e);
          }
        }

        // If the model failed and returned an unhelpful fallback text, replace with a friendly professional reply that includes patient name and clinic
        const fallbackRegex = /no pude procesar|hubo un problema procesando|disculpa,? no|no puedo procesar/i;
        let replyTextToSend = cleanedTexto;

        // Try to determine patient name: prefer leadData, then contact display name, then session history
        let patientName = (leadData && leadData.nombre) || contact?.name || null;
        if (!patientName) {
          try {
            const sessionForContact = (() => { try { return geminiService.getOrCreateSession((contactDigits || '') + '@s.whatsapp.net'); } catch (e) { return null; } })();
            if (sessionForContact && Array.isArray(sessionForContact.history)) {
              for (let i = sessionForContact.history.length - 1; i >= 0; i--) {
                const h = sessionForContact.history[i];
                if (h.role === 'user') {
                  const t = (h.parts || []).map(p => p.text || '').join(' ').trim();
                  const parsed = geminiService.extractLeadDataFromText ? geminiService.extractLeadDataFromText(t) : null;
                  if (parsed && parsed.nombre && geminiService.isValidName && geminiService.isValidName(parsed.nombre)) {
                    patientName = parsed.nombre;
                    break;
                  }
                }
              }
            }
          } catch (e) { patientName = patientName || null; }
        }

        const clinicDisplayName = (typeof clinic !== 'undefined' && clinic?.name) ? clinic.name : clinicName;

        if (fallbackRegex.test(replyTextToSend)) {
          const namePart = patientName ? `${patientName}, ` : '';
          replyTextToSend = `¡Hola ${patientName ? patientName : 'estimado/a paciente'}! Te comparto fotos de ejemplo de ${clinicDisplayName} para que puedas ver resultados. ¿Deseas que te ayude a agendar una cita?`;
        }

        // First send one image (if any) to the patient, then the text so the patient sees the photo immediately
        const imageToSend = (Array.isArray(finalImageFiles) && finalImageFiles.length) ? finalImageFiles[0] : null;
        if (imageToSend && contactDigits) {
          try {
            await enviarImagenWhatsapp(contactDigits, imageToSend);
          } catch (e) {
            console.error('webhookController: failed sending image via chatwoot fallback', imageToSend, e && e.message ? e.message : e);
          }
        }

        if (accountId && convId && apiToken) {
          await chatwootService.sendMessageToConversation(accountId, convId, apiToken, replyTextToSend);
        } else if (contactDigits) {
          if (replyTextToSend) await whatsappService.sendWhatsAppMessage(contactDigits, replyTextToSend, {});
        }
      } catch (e) {
        console.error('webhookController: failed to send reply via chatwoot/whatsapp', e && e.message ? e.message : e);
      }
 
      if (leadResult && leadResult.readyToNotify && leadResult.lead) {
        try {
          console.log('[NOTIFICACION] lead marked readyToNotify; notifying admin now');
          await notificationService.notifyAdminNewLead(leadResult.lead, { whatsappService, leadService, clinic });
        } catch (e) {
          console.error('webhookController: error notifying admin after lead save', e && e.message ? e.message : e);
        }
      }

      if (!res.headersSent) return res.status(200).json({ ok: true });
      return;
    }

    // Existing WhatsApp webhook handling follows unchanged
    const entry = payload?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value || {};
    const message = value?.messages?.[0] || null;

    if (!message) {
      // nothing to process
      if (!res.headersSent) return res.status(200).json({ ok: true, reason: 'no_message' });
      return;
    }

    const rawFrom = message?.from || message?.from_user_id || value?.contacts?.[0]?.wa_id || value?.contacts?.[0]?.user_id || null;
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

    // At this point we have validated "from" and "messageText".
    // Respond immediately to Meta to avoid retries/duplication.
    if (!res || !res.headersSent) {
      try { return res.status(200).json({ ok: true }); } catch (e) { /* safe no-op */ }
    }
    // If headers already sent, continue silently
    

    // Continue processing in background without blocking the response.
    // Use an immediately-invoked async function and internal try/catch to avoid unhandled rejections.
    (async () => {
      try {
        const jid = `${from}@s.whatsapp.net`;

        // Apply a 15s timeout to the Gemini call (requirement).
        const geminiClient = getGeminiClient();
        const geminiPromise = geminiService.obtenerRespuestaIA(jid, messageText, { client: geminiClient, maxRetries: 1, maxOutputTokens: 100 });
        const timeoutMs = 25_000;
        const timeoutPromise = new Promise((_, reject) => {
          const t = setTimeout(() => reject(new Error('gemini timeout')), timeoutMs);
          // ensure timer doesn't keep process alive
          t.unref && t.unref();
        });
 
        const phoneNumberId = value?.metadata?.phone_number_id ? String(value.metadata.phone_number_id).trim() : (process.env.WHATSAPP_PHONE_NUMBER_ID ? String(process.env.WHATSAPP_PHONE_NUMBER_ID).trim() : null);
        let clinic = null;
        if (phoneNumberId) {
          try {
            // Try to obtain a Supabase client from services/leadService.js to respect existing factory
            let client = null;
            try {
              const mod = await import('../services/leadService.js');
              if (mod && typeof mod.getSupabaseClient === 'function') {
                client = mod.getSupabaseClient();
              }
            } catch (impErr) {
              // Dynamic import failed or leadService not available in this context; fall back to creating a client from env if possible
              try {
                const rawUrl = config.supabase?.url || process.env.SUPABASE_URL;
                const key = config.supabase?.serviceRoleKey || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE;
                if (rawUrl && key) client = createClient(rawUrl, key);
              } catch (cErr) {
                // ignore and fallback below
              }
            }

            if (client) {
              const { data } = await client.from('clinics').select('*').eq('waba_phone_number_id', phoneNumberId).maybeSingle();
              clinic = data || null;
            } else {
              // Graceful fallback: provide a minimal default clinic object so processing continues
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
            console.error('webhookController: error looking up clinic by waba_phone_number_id', e && e.message ? e.message : e);
            // Fallback to default minimal clinic so bot response is not interrupted
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
        // Ensure gemini result is available outside try/catch scope to avoid ReferenceError when Promise.race throws
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
          console.error('webhookController: gemini call failed or timed out', e && e.stack ? e.stack : e);
          if (e && e.response) console.error('[GEMINI RESPONSE]:', e.response);
          // On failure, fallback message is already in texto
        }
  
        if (skipResponse) {
          return;
        }
  
        // Save lead if leadData is present. Use the remitente phone ('from') as the canonical source-of-truth for telefono.
        let leadResult = null;
        if (leadData) {
          try {
            const telefonoKey = from || null;
            if (!telefonoKey) {
              console.warn('webhookController: no remitente phone available in WhatsApp event; skipping lead save to avoid using model-extracted phone');
            } else {
              const shouldConfirm = typeof messageText === 'string' && geminiService.isExplicitConfirmation(messageText);
              // Only attempt persistence if the Gemini response did not request skipping lead persistence
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
                  // Log DB errors but do not let them interrupt message sending
                  console.error('webhookController: leadService.saveLead failed', dbErr && (dbErr.message || dbErr));
                }
              }
              // If user explicitly confirmed, force an admin notify regardless (best-effort)
              if (shouldConfirm && leadResult && leadResult.lead) {
                try {
                  await notificationService.notifyAdminNewLead(leadResult.lead, { whatsappService, leadService, clinic });
                } catch (err) {
                  console.error('webhookController: forced admin notify after explicit confirmation failed', err && err.message ? err.message : err);
                }
              }
            }
          } catch (e) {
            console.error('webhookController: error saving lead', e && e.message ? e.message : e);
          }
        }

        // Send message to user (best-effort). Failures are logged but do not affect response to Meta.
        try {
          // === SANITIZACIÓN DEFENSIVA EN CONTROLADOR DE WEBHOOK ===
          let textoFinal = extractPlainText(texto);

          textoFinal = geminiService.sanitizeModelTextOutput(textoFinal);
          // Ensure admin-only alert text is never forwarded to the patient.
          textoFinal = textoFinal.replace(/🚨\s*¡NUEVO PACIENTE AGENDADO![\s\S]*$/gi, '').trim();

          // Clean any backslashes that Gemini may inject before extracting instruction tags
          const textoLimpioGemini = String(textoFinal || '').replace(/\\/g, '');
          const { imageFiles: modelImageFiles, agendaPayloads } = extractInstructionTags(textoLimpioGemini);
          const sanitizedText = stripInstructionTags(textoLimpioGemini);

          // Determine final image files: prefer model-provided tags, otherwise fallback based on original user message
          const finalImageFiles = (Array.isArray(modelImageFiles) && modelImageFiles.length > 0)
            ? modelImageFiles
            : mapKeywordsToImages(messageText);

          // Handle AGENDAR_CITA payloads safely and without breaking the user response.
          for (const rawAgenda of agendaPayloads) {
            try {
              const parsed = safeParseAgendaPayload(rawAgenda);
              if (parsed) {
                console.log('[AGENDAR_CITA]', parsed);
                await persistAgendaPayload(parsed, { clinicId: clinic?.id || null, phone: from, source: 'whatsapp' });
              }
            } catch (e) {
              console.error('webhookController: failed parsing AGENDAR_CITA payload', e && e.message ? e.message : e);
            }
          }

          // Defensive placeholder cleanup before sending to user
          clinicName = (typeof clinic !== 'undefined' && clinic?.name) || clinicName;
          const session = (() => { try { return geminiService.getOrCreateSession(from + '@s.whatsapp.net'); } catch (e) { return null; } })();
          let patientName = null;
          try {
            if (session && Array.isArray(session.history)) {
              for (let i = session.history.length - 1; i >= 0; i--) {
                const h = session.history[i];
                if (h.role === 'user') {
                  const t = (h.parts || []).map(p => p.text || '').join(' ').trim();
                  const parsed = geminiService.extractLeadDataFromText ? geminiService.extractLeadDataFromText(t) : null;
                  if (parsed && parsed.nombre && geminiService.isValidName && geminiService.isValidName(parsed.nombre)) {
                    patientName = parsed.nombre;
                    break;
                  }
                }
              }
            }
          } catch (e) { patientName = null; }

          let finalTextForUser = sanitizedText.replace(/\[NOMBRE_CLINICA\]/g, clinicName);
          if (patientName) {
            finalTextForUser = finalTextForUser.replace(/\[NOMBRE_PACIENTE\]/g, patientName);
          } else {
            finalTextForUser = finalTextForUser.replace(/\[NOMBRE_PACIENTE\]/g, 'estimado/a paciente');
          }
          finalTextForUser = finalTextForUser.replace(/\s{2,}/g, ' ').trim();

          // If model returned an unhelpful fallback, substitute a friendly professional reply that includes name and clinic
          const fallbackRegex = /no pude procesar|hubo un problema procesando|disculpa,? no|no puedo procesar/i;
          let replyText = finalTextForUser;

          const clinicDisplayName = (typeof clinic !== 'undefined' && clinic?.name) ? clinic.name : clinicName;
          const namePart = patientName ? `${patientName}, ` : '';

          if (fallbackRegex.test(replyText)) {
            replyText = `¡Hola ${patientName ? patientName : 'estimado/a paciente'}! Te comparto fotos de ejemplo de ${clinicDisplayName} para que veas resultados. ¿Te gustaría que te ayude a agendar una cita?`;
          }

          // Send one image first (if any), then the reply text so the user sees the photo immediately
          const imageToSend = (Array.isArray(finalImageFiles) && finalImageFiles.length) ? finalImageFiles[0] : null;
          if (imageToSend) {
            try {
              await enviarImagenWhatsapp(from, imageToSend);
            } catch (e) {
              console.error('webhookController: failed sending image to patient', imageToSend, e && e.message ? e.message : e);
            }
          }

          if (replyText && replyText.length > 0 && !skipResponse) {
            await whatsappService.sendWhatsAppMessage(from, replyText, {});
          }
        } catch (e) {
          console.error('webhookController: failed sending message to user', e && e.message ? e.message : e);
        }

        // Notify admin if needed (best-effort)
        try {
          if (leadResult && leadResult.readyToNotify && leadResult.lead) {
            const adminNumber = process.env.ADMIN_WHATSAPP_NUMBER || config.admin?.phone || 'unknown';
            console.log('[NOTIFICACION ENVIADA A ADMIN]:', adminNumber);
            await notificationService.notifyAdminNewLead(leadResult.lead, { whatsappService, leadService, clinic });
          }
        } catch (e) {
          console.error('webhookController: error in admin notify flow', e && e.message ? e.message : e);
        }
      } catch (err) {
        // This catch is for the entire background processing block.
        console.error('webhookController: unexpected background processing error', err && err.message ? err.message : err);
      }
    })();

    // We already sent response to Meta; do not await background work.
    return;
  } catch (err) {
    // If we reach here before sending response, pass to centralized error handler
    return next(err);
  }
}
