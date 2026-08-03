import config from '../config/env.js';
import geminiService from '../services/geminiService.js';
import leadService from '../services/leadService.js';
import whatsappService from '../services/whatsappService.js';
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
    // Prefer parsedBody attached by verifySignature middleware
    const payload = req.parsedBody || (req.body ? (req.body instanceof Buffer ? JSON.parse(req.body.toString('utf8')) : req.body) : null);

    const entry = payload?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value || {};
    const message = value?.messages?.[0] || null;

    if (!message) {
      // nothing to process
      return res.status(200).json({ ok: true, reason: 'no_message' });
    }

    const rawFrom = message?.from || message?.from_user_id || value?.contacts?.[0]?.wa_id || value?.contacts?.[0]?.user_id || null;
    let from = rawFrom ? String(rawFrom).trim().replace(/^PE\./i, '') : null;
    from = from ? from.replace(/\D/g, '') : null;
    if (!from) {
      console.warn('webhookController: invalid from, skipping');
      return res.status(200).json({ ok: false, reason: 'invalid_from' });
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
      return res.status(200).json({ ok: false, reason: 'no_text' });
    }

    // At this point we have validated "from" and "messageText".
    // Respond immediately to Meta to avoid retries/duplication.
    res.status(200).json({ ok: true });

    // Continue processing in background without blocking the response.
    // Use an immediately-invoked async function and internal try/catch to avoid unhandled rejections.
    (async () => {
      try {
        const jid = `${from}@s.whatsapp.net`;

        // Apply a 15s timeout to the Gemini call (requirement).
        const geminiClient = getGeminiClient();
        const geminiPromise = geminiService.obtenerRespuestaIA(jid, messageText, { client: geminiClient });
        const timeoutMs = 15_000;
        const timeoutPromise = new Promise((_, reject) => {
          const t = setTimeout(() => reject(new Error('gemini timeout')), timeoutMs);
          // ensure timer doesn't keep process alive
          t.unref && t.unref();
        });

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
          console.error('webhookController: gemini call failed or timed out', e && e.message ? e.message : e);
          // On failure, fallback message is already in texto
        }
 
        if (skipResponse) {
          return;
        }
 
        // Save lead if leadData present and has telefono
        let leadResult = null;
        if (leadData && leadData.telefono) {
          try {
            leadResult = await leadService.saveLead({
              telefono: leadData.telefono,
              nombre: leadData.nombre,
              distrito: leadData.distrito,
              fechaHoraISO: leadData.fechaHoraISO || leadData.fecha_hora_iso || null,
              fechaHoraTexto: leadData.fechaHora || leadData.fecha_hora || null,
            });
          } catch (e) {
            console.error('webhookController: error saving lead', e && e.message ? e.message : e);
          }
        }

        // Send message to user (best-effort). Failures are logged but do not affect response to Meta.
        try {
          // === SANITIZACIÓN DEFENSIVA EN CONTROLADOR DE WEBHOOK ===
          let textoFinal = extractPlainText(texto);

          textoFinal = geminiService.sanitizeModelTextOutput(textoFinal);

          if (textoFinal && textoFinal.length > 0 && !skipResponse) {
            await whatsappService.sendWhatsAppMessage(from, textoFinal, {});
          }
        } catch (e) {
          console.error('webhookController: failed sending message to user', e && e.message ? e.message : e);
        }

        // Notify admin if needed (best-effort)
        try {
          if (leadResult && leadResult.readyToNotify && leadResult.lead) {
            const adminPhoneRaw = process.env.ADMIN_WHATSAPP_NUMBER || config.admin?.phone;
            if (adminPhoneRaw) {
              const adminDigits = String(adminPhoneRaw).replace(/\D/g, '');
              const fechaDisplay = leadResult.lead.fecha_hora_texto || leadResult.lead.fechaHoraTexto || (leadResult.lead.fechaHoraISO ? new Date(leadResult.lead.fechaHoraISO).toLocaleString('es-PE', { timeZone: 'America/Lima', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'N/A');
              const alertMessage = `🚨 ¡NUEVO PACIENTE AGENDADO!\n👤 Nombre: ${leadResult.lead.nombre || 'N/A'}\n📞 Teléfono: ${leadResult.lead.telefono || leadResult.lead.telefonoOriginal || 'N/A'}\n📍 Distrito: ${leadResult.lead.distrito || 'N/A'}\n🗓️ Fecha/Hora: ${fechaDisplay}`;
              try {
                await whatsappService.sendWhatsAppMessage(adminDigits, alertMessage, {});
                console.log(`✅ Notificación enviada al administrador: ${adminDigits}`);
                // Mark lead as notified to avoid duplicate admin notifications
                try {
                  if (leadResult && leadResult.lead && leadResult.lead.id) {
                    await leadService.markAsNotified(leadResult.lead.id);
                    console.log(`Marked lead ${leadResult.lead.id} as notified`);
                  }
                } catch (markErr) {
                  console.error('webhookController: error marking lead as notified', markErr && markErr.message ? markErr.message : markErr);
                }
              } catch (e) {
                console.error('webhookController: error notifying admin', e && e.message ? e.message : e);
              }
            }
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
