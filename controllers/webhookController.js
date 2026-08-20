import config from '../config/env.js';
import geminiService from '../services/geminiService.js';
import * as leadService from '../services/leadService.js';
import { getSupabaseClient } from '../services/leadService.js';
import notificationService from '../services/notificationService.js';
import whatsappService from '../services/whatsappService.js';
import chatwootService from '../services/chatwootService.js';
import * as calendarService from '../services/calendarService.js';
import antiCollision from '../services/antiCollision.js';
import { getGeminiClient } from '../src/geminiClient.js';

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
        const supabase = getSupabaseClient();
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
      // If this is a Chatwoot outgoing message (human agent sent a reply), mark conversation as intervened and pause Gemini
      const messageType = message?.message_type || message?.messageType || null;
      if (messageType && String(messageType).toLowerCase() === 'outgoing') {
        try {
          const pauseId = contactDigits || (conversation?.id ? `cw-${conversation.id}` : null);
          if (pauseId) geminiService.pauseSessionById(pauseId);
        } catch (e) {
          console.error('webhookController: failed to pause session for outgoing chatwoot message', e && e.message ? e.message : e);
        }
        if (!res.headersSent) return res.status(200).json({ ok: true, reason: 'human_outgoing' });
        return;
      }

      // If conversation is assigned to a human agent and open, skip bot
      const convStatus = conversation?.status || (p?.conversation?.status);
      const assigneeId = conversation?.meta?.assignee_id || conversation?.assignee_id || null;

      // If conversation was resolved, resume AI for future messages
      if (convStatus === 'resolved') {
        try {
          const resumeId = contactDigits || (conversation?.id ? `cw-${conversation.id}` : null);
          if (resumeId) geminiService.resumeSessionById(resumeId);
        } catch (e) {
          console.error('webhookController: failed to resume session for resolved conversation', e && e.message ? e.message : e);
        }
        if (!res.headersSent) return res.status(200).json({ ok: true, reason: 'conversation_resolved' });
        return;
      }

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
                    maxOutputTokens: 4096,
        skipLeadPersistence: Boolean(isAdminSender)
      });
      let texto = 'Disculpa, hubo un problema procesando tu mensaje.';
      let leadData = null;
      try {
        const result = await geminiPromise;
              console.log('🤖 [Gemini Raw Output]:', result && (result.texto || result.text || result));
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

        // Extract SEND_IMAGE and BOOK_APPOINTMENT tags (flexible parsing) and remove them from visible texto
        try {
          const originalTexto = String(texto || '');
          const appt = whatsappService.parseBookAppointmentTag(originalTexto);
          const imageKey = whatsappService.parseSendImageTag(originalTexto);

                  // Diagnostic logs for extracted tags and admin target
                  console.log('📅 [BOOK_APPOINTMENT Detectado]:', appt);
                  console.log('🖼️ [SEND_IMAGE Detectado]:', imageKey);
                  console.log('📲 [Notificando Admin a]:', process.env.ADMIN_NOTIFICATION_PHONE || process.env.ADMIN_WHATSAPP_NUMBER || config.admin?.phone);

                  // Remove both tags from visible texto (order-insensitive)
                  if (appt) texto = whatsappService.stripBookAppointmentTag(String(texto || ''));
                  if (imageKey) texto = whatsappService.stripSendImageTag(String(texto || ''));

                  // If imageKey present, send image to user immediately (do not rely on Chatwoot for media)
                  if (imageKey && contactDigits) {
                    try {
                      await whatsappService.sendWhatsAppImageMessage(contactDigits, imageKey, '', { fetchImpl: globalThis.fetch });
                    } catch (err) {
                      console.error('webhookController: failed to send image via WhatsApp API', err && err.message ? err.message : err);
                    }
                  }

          if (appt) {
            const bookingResult = await (async () => {
              try {
                const rawAdminPhone = process.env.ADMIN_NOTIFICATION_PHONE || process.env.ADMIN_WHATSAPP_NUMBER || '51949737257';
                let adminPhone = rawAdminPhone ? String(rawAdminPhone).replace(/\D/g, '') : '';
                if (adminPhone.length === 9) adminPhone = '51' + adminPhone;

                const slotKey = String(appt.datetime || '').trim();
                const acquired = antiCollision.acquireSlot(slotKey, 60 * 1000);
                if (!acquired) {
                  console.warn('webhookController: slot already locked locally, skipping duplicate calendar insertion for', slotKey);
                  try {
                    const warnMsg = `⚠️ *INTENTO DUPLICADO DE RESERVA*\n\nSe detectó un intento concurrente de agendar la misma fecha/hora: ${slotKey}. Por favor revisar.`;
                    if (adminPhone) await whatsappService.sendWhatsAppMessage(adminPhone, warnMsg, {});
                  } catch (warnErr) {
                    console.error('webhookController: failed to notify admin about duplicate booking attempt', warnErr && warnErr.message ? warnErr.message : warnErr);
                  }
                  return { success: false, reason: 'duplicate_slot' };
                }

                const alertMsg = `🚨 *NUEVA CITA AGENDADA* 🗓️\n\n👤 *Paciente:* ${appt.name}\n📱 *Teléfono:* ${appt.phone}\n🦷 *Tratamiento:* ${appt.service || 'Evaluación General'}\n📅 *Fecha:* ${appt.datetime}\n📍 *Sede:* Huánuco`;

                try {
                  if (adminPhone) await whatsappService.sendWhatsAppMessage(adminPhone, alertMsg, {});
                  console.log('✅ [Admin Alert] Alerta enviada a WhatsApp:', adminPhone);
                } catch (warnErr) {
                  console.error('❌ [Admin Alert Error]:', warnErr && warnErr.message ? warnErr.message : warnErr);
                }

                try {
                  const duration = (appt.type === 'LLAMADA_5MIN') ? 10 : 30;
                  const available = await calendarService.checkSlotAvailable(appt.datetime, duration);
                  if (!available) {
                    console.warn('webhookController: detected conflict or credential issue in Google Calendar for', appt.datetime);
                    try {
                      const conflictMsg = `⚠️ *CONFLICTO EN CALENDARIO*\n\nEl horario ${appt.datetime} ya aparece ocupado en Google Calendar o la credencial no está activa. No se creó un evento duplicado.`;
                      if (adminPhone) await whatsappService.sendWhatsAppMessage(adminPhone, conflictMsg, {});
                    } catch (notifyErr) {
                      console.error('webhookController: failed to notify admin about calendar conflict', notifyErr && notifyErr.message ? notifyErr.message : notifyErr);
                    }
                    return { success: false, reason: 'calendar_unavailable' };
                  }
                } catch (checkErr) {
                  console.error('webhookController: error checking slot availability', checkErr && checkErr.message ? checkErr.message : checkErr);
                  return { success: false, reason: 'calendar_check_failed' };
                }

                try {
                  await calendarService.createCalendarEvent({
                    patientName: appt.name,
                    phone: appt.phone,
                    service: appt.service || 'Ortodoncia',
                    startDateTime: new Date(appt.datetime).toISOString(),
                    durationMinutes: 45,
                    notes: 'Agendado automáticamente por BotDental'
                  });
                  console.log('✅ [Google Calendar] Cita agendada correctamente');
                  return { success: true };
                } catch (calErr) {
                  console.error('❌ [Calendar Insert Error]:', calErr && calErr.message ? calErr.message : calErr);
                  try {
                    const fixMsg = `🚨 *ERROR EN CALENDARIO*\n\nNo se pudo crear la cita en Google Calendar. Requiere revisión manual del token/credenciales de Google. Paciente: ${appt.name}. Horario: ${appt.datetime}.`;
                    if (adminPhone) await whatsappService.sendWhatsAppMessage(adminPhone, fixMsg, {});
                  } catch (notifyErr) {
                    console.error('webhookController: failed to notify admin about failed calendar insert', notifyErr && notifyErr.message ? notifyErr.message : notifyErr);
                  }
                  return { success: false, reason: 'calendar_insert_failed' };
                } finally {
                  try { antiCollision.releaseSlot(slotKey); } catch (e) { /* ignore */ }
                }
              } catch (err) {
                console.error('❌ [Appointment Background Error]:', err && err.message ? err.message : err);
                return { success: false, reason: 'booking_exception' };
              }
            })();

            if (!bookingResult.success) {
              texto = 'Gracias por tu interés. Estoy revisando tu solicitud de cita y te confirmaré la disponibilidad lo antes posible.';
            }
          }
        } catch (e) {
          console.warn('webhookController: error extracting SEND_IMAGE/BOOK_APPOINTMENT tags', e && e.message ? e.message : e);
        }

        if (accountId && convId && apiToken) {
          await chatwootService.sendMessageToConversation(accountId, convId, apiToken, texto);
        } else {
          // fallback: if we have contact phone and whatsapp service, send directly
          if (contactDigits) await whatsappService.sendWhatsAppMessage(contactDigits, texto, {});
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
        const geminiPromise = geminiService.obtenerRespuestaIA(jid, messageText, { client: geminiClient, maxRetries: 1, maxOutputTokens: 2048 });
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
            const client = getSupabaseClient();
            const { data } = await client.from('clinics').select('*').eq('waba_phone_number_id', phoneNumberId).maybeSingle();
            clinic = data || null;
          } catch (e) {
            console.error('webhookController: error looking up clinic by waba_phone_number_id', e && e.message ? e.message : e);
          }
        }
 
        let texto = 'Disculpa, hubo un problema procesando tu mensaje.';
        let leadData = null;
        let skipResponse = false;
        try {
          const result = await Promise.race([geminiPromise, timeoutPromise]);
          if (result) {
            if (result.skipResponse) {
              skipResponse = true;
            } else {
              texto = result.texto || result.text || (typeof result === 'string' ? result : texto);
              leadData = result.leadData || null;
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
              if (!(typeof result !== 'undefined' && result && result.skipLeadPersistence)) {
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
              }
            }
          } catch (e) {
            console.error('webhookController: error saving lead', e && e.message ? e.message : e);
          }
        }

        // Send message to user (best-effort). Failures are logged but do not affect response to Meta.
        try {
          // === SANITIZACIÓN DEFENSIVA EN CONTROLADOR DE WEBHOOK ===
          // First, extract and remove BOOK_APPOINTMENT tag if present so it is not shown to the patient,
          // and process scheduling in background (no AI calls).
          try {
            const bookRegex = /\[BOOK_APPOINTMENT:\s*({[\s\S]*?})\s*\]/i;
            const m = bookRegex.exec(texto || '');
            if (m && m[1]) {
              try {
                const appt = JSON.parse(m[1]);
                // remove tag from visible texto
                texto = String(texto).replace(m[0], '').trim();

                // Background: create event and notify admin
                (async () => {
                  try {
                    const defaultAdmin = '51949737257';
                    const rawAdminPhone = process.env.ADMIN_NOTIFICATION_PHONE || process.env.ADMIN_WHATSAPP_NUMBER || defaultAdmin;
                    let adminPhoneNorm = rawAdminPhone ? String(rawAdminPhone).replace(/\D/g, '') : '';
                    if (adminPhoneNorm.length === 9) adminPhoneNorm = '51' + adminPhoneNorm;

                    const modalityLabel = (appt && appt.type && String(appt.type).toUpperCase() === 'LLAMADA_5MIN') ? 'Llamada de Asesoría 5 min' : 'Cita Presencial';
                    const readableDate = (() => {
                      try {
                        const d = new Date(appt.datetime);
                        if (isNaN(d.getTime())) return appt.datetime || 'Sin fecha legible';
                        return d.toLocaleString('es-PE', { timeZone: 'America/Lima' });
                      } catch (e) { return appt.datetime || ''; }
                    })();

                    const alertMessage = `🚨 *NUEVO REGISTRO EN LUMINZU DENT* 🗓️\n\n👤 *Paciente:* ${appt.name}\n📱 *Teléfono:* ${appt.phone}\n🦷 *Motivo / Tratamiento:* ${appt.service || 'Evaluación General'}\n📅 *Fecha y Hora solicitada:* ${readableDate}\n📌 *Modalidad:* ${modalityLabel}\n📍 *Sede:* Av. Alameda de la República 286, Huánuco\n\nℹ️ *Acción requerida:* Si el paciente agendó fuera de horario comercial (noche/madrugada), realizar la llamada de 5 minutos a primera hora de la mañana para coordinar detalles.`;

                    try {
                      try {
                        await whatsappService.sendWhatsAppMessage(adminPhoneNorm, alertMessage, {});
                      } catch (warnErr) {
                        console.error('webhookController: failed to send admin WhatsApp alert', warnErr && warnErr.message ? warnErr.message : warnErr);
                      }

                      const start = appt.datetime;
                      const startDate = new Date(start);
                      const isCall = appt && appt.type && String(appt.type).toUpperCase() === 'LLAMADA_5MIN';
                      const eventSummary = isCall ? `📞 Asesoría 5min: ${appt.name} - ${appt.service || 'Evaluación'}` : `🦷 Cita Presencial: ${appt.name} - ${appt.service || 'Evaluación'}`;

                      try {
                        const created = await calendarService.createCalendarEvent({
                          patientName: appt.name,
                          phone: appt.phone,
                          service: appt.service || 'Ortodoncia',
                          startDateTime: startDate.toISOString(),
                          durationMinutes: 45,
                          notes: isCall ? 'Llamada de asesoría 5 min' : 'Agendado automáticamente por BotDental'
                        });
                        if (created) {
                          try {
                            await notificationService.notifyAdminAppointment({ patientName: appt.name, patientPhone: appt.phone, serviceName: appt.service, dateTime: startDate.toISOString() }, { whatsappService });
                          } catch (err) {
                            console.error('webhookController: notifyAdminAppointment failed', err && err.message ? err.message : err);
                          }
                        }
                      } catch (err) {
                        console.error('❌ [Calendar Insert Error]:', err && err.message ? err.message : err);
                      }

                      // If presencial, send fachada image to patient (await to avoid race conditions)
                      try {
                        if (!isCall) {
                          let contactDigits = appt && appt.phone ? String(appt.phone).replace(/\D/g, '') : '';
                          if (contactDigits.length === 9) contactDigits = '51' + contactDigits;
                          if (contactDigits) {
                            await whatsappService.sendWhatsAppImageMessage(contactDigits, 'fachada', '', { fetchImpl: globalThis.fetch });
                          }
                        }
                      } catch (imgErr) {
                        console.error('webhookController: failed to send fachada image', imgErr && imgErr.message ? imgErr.message : imgErr);
                      }

                    } catch (err) {
                      console.error('webhookController: BOOK_APPOINTMENT calendar insertion failed', err && err.message ? err.message : err);
                    }
                  } catch (err) {
                    console.error('❌ [Appointment Background Error]:', err && err.message ? err.message : err);
                  }
                })();

              } catch (err) {
                console.warn('webhookController: failed to parse BOOK_APPOINTMENT JSON', err && err.message ? err.message : err);
              }
            }
          } catch (e) {
            console.warn('webhookController: error extracting BOOK_APPOINTMENT tag', e && e.message ? e.message : e);
          }

          let textoFinal = extractPlainText(texto);
 
          textoFinal = geminiService.sanitizeModelTextOutput(textoFinal);
          // Ensure admin-only alert text is never forwarded to the patient.
          textoFinal = textoFinal.replace(/🚨\s*¡NUEVO PACIENTE AGENDADO![\s\S]*$/gi, '').trim();

          // === MEDIA tag processing: detect [MEDIA:clave] tags, strip them from visible text,
          // and dispatch images immediately after sending the explanatory text to the patient.
          const mediaRegex = /\[MEDIA:\s*([a-z0-9_\-]+)\]/ig;
          const mediaKeys = [];
          let mm;
          while ((mm = mediaRegex.exec(textoFinal)) !== null) {
            if (mm[1]) mediaKeys.push(mm[1].toLowerCase());
          }
          // remove media tags from textoFinal
          if (mediaKeys.length > 0) {
            textoFinal = textoFinal.replace(mediaRegex, '').trim();
          }

          // Defensive placeholder cleanup before sending to user
          // Use shared clinicName declared earlier (already contains env/default fallback); prefer clinic.name when available
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

          textoFinal = textoFinal.replace(/\[NOMBRE_CLINICA\]/g, clinicName);
          if (patientName) {
            textoFinal = textoFinal.replace(/\[NOMBRE_PACIENTE\]/g, patientName);
          } else {
            textoFinal = textoFinal.replace(/\[NOMBRE_PACIENTE\]/g, 'estimado/a paciente');
          }

          if (textoFinal && textoFinal.length > 0 && !skipResponse) {
            // First, send the explanatory text to the patient
            try {
              await whatsappService.sendWhatsAppMessage(from, textoFinal, {});
            } catch (sendErr) {
              console.error('webhookController: failed to send text to patient', sendErr && sendErr.message ? sendErr.message : sendErr);
            }

            // Then, dispatch any MEDIA images that the prompt requested (in order). Use await to preserve order.
            if (Array.isArray(mediaKeys) && mediaKeys.length > 0) {
              try {
                // derive numeric contact digits from "from"
                let contactDigits = String(from || '').replace(/\D/g, '');
                if (contactDigits.length === 9) contactDigits = '51' + contactDigits;
                for (const mk of mediaKeys) {
                  try {
                    const resolved = whatsappService.resolveImageAssetKey ? whatsappService.resolveImageAssetKey(mk) : null;
                    const keyToSend = resolved || mk;
                    if (contactDigits) {
                      await whatsappService.sendWhatsAppImageMessage(contactDigits, keyToSend, '', { fetchImpl: globalThis.fetch });
                    } else {
                      // fallback: try sending using the raw 'from' identifier
                      await whatsappService.sendWhatsAppImageMessage(from, keyToSend, '', { fetchImpl: globalThis.fetch });
                    }
                  } catch (imgErr) {
                    console.error('webhookController: failed to send media', mk, imgErr && imgErr.message ? imgErr.message : imgErr);
                  }
                }
              } catch (e) {
                console.error('webhookController: error dispatching media images', e && e.message ? e.message : e);
              }
            }
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
