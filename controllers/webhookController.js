import geminiService from '../services/geminiService.js';
import leadService from '../services/leadService.js';
import notificationService from '../services/notificationService.js';
import whatsappService, { sendTypingIndicator } from '../services/whatsappService.js';
import { getGeminiClient, getGeminiFallbackClients } from '../src/geminiClient.js';
import activeClinic, { bookingModeOf, findTreatment, specialistFor } from '../config/clinic.config.js';
import appointmentService, {
  OutsideHoursError, SlotTakenError, isWithinWorkingHours, localParts, parseRequestedDay, slotLabel,
} from '../services/appointmentService.js';
import handoffService, { detectHandoff, patientHandoffReply } from '../services/handoffService.js';
import conversationMetrics from '../services/conversationMetrics.js';
import messageDedup from '../services/messageDedup.js';
import { now as clockNow } from '../services/clock.js';
import inboxService from '../services/inboxService.js';
import liveEvents from '../services/liveEvents.js';
import { fetchMetaMedia } from '../services/metaMedia.js';
import clinicSettings from '../services/clinicSettings.js';
import leadInsights, { enforceNoDiagnosis, matchRecommendation } from '../services/recommendationService.js';
import { extractPhotoTags, inferPhotoKeyFromMessage } from '../services/mediaTags.js';
import { catalogKeysForMessage, imagesForKeys, wantsEvaluationPack } from '../services/catalog.js';
import { expandColloquial } from '../config/colloquial.js';
import { extractPlainText, stripInstructionTags } from '../services/replyText.js';
import { createSerialQueue } from '../services/serialQueue.js';
import { createExpiringMap } from '../services/expiringMap.js';
import { describeError } from '../services/safeLog.js';
import { aiFallbackReply, createNoAiAlert, createReceptionQuestionAlert, formatSlotList } from '../services/aiFallback.js';
import { sendClinicLocation, wantsLocation } from '../services/clinicLocation.js';
import { quickAnswer } from '../services/quickAnswers.js';
import { guardPrices } from '../services/priceGuard.js';
import {
  adReferrals, chatSessionHistoryCache, dataDeletionFilters, deletePatientRows, digitsOf, getAdReferral, getBotNotes,
  recordBotReply, recordInbox, sanitizeReferral, sendReply,
} from './conversationStore.js';
import {
  AUDIO_TOO_LONG_REPLY, DEFAULT_AFTER_HOURS_NOTICE, GREETING_ONLY, UNSUPPORTED_REPLIES, afterHoursNotice, buildWelcomeCaption, forgetWelcome,
  greetFirstContact, hasPreviousConversation, takeAfterHoursNotice,
} from './firstContact.js';
import { forgetSentMedia, sendEvaluationPack, sendImages } from './mediaReplies.js';
import { sendWithSlotPicker } from '../services/slotButtons.js';
import { confirmedBookingText, sendAppointmentPass } from './bookingReplies.js';
import { interestOf, notifyDoctor } from '../services/doctorAlert.js';
import contactPreferences, { detectMinor, detectOptOut } from '../services/contactPreferences.js';
import { answersFollowUp } from '../services/followUpService.js';
import marketingConsent from './marketingConsent.js';
import audioTranscriber, { audioTranscriptionEnabled } from '../services/audioTranscription.js';
import { DATA_DELETION_REPLY, OPT_OUT_CONFIRMATION } from '../config/legalTexts.js';

export { aiFallbackReply, formatSlotList };
export { sanitizeReferral, dataDeletionFilters };
export { DEFAULT_AFTER_HOURS_NOTICE, GREETING_ONLY, afterHoursNotice, buildWelcomeCaption, takeAfterHoursNotice };

async function hardResetUserSession(phone) {
  try {
    const rawDigits = digitsOf(phone);
    const shortPhone = rawDigits.length >= 9 ? rawDigits.slice(-9) : rawDigits;
    if (geminiService.resetSession) {
      geminiService.resetSession(`${rawDigits}@s.whatsapp.net`);
      geminiService.resetSession(`${shortPhone}@s.whatsapp.net`);
    }
    chatSessionHistoryCache.delete(rawDigits);
    chatSessionHistoryCache.delete(shortPhone);
    forgetWelcome(rawDigits);
    forgetSentMedia(rawDigits);
    await deletePatientRows(rawDigits);
    console.log(`[Privacidad] Datos del paciente eliminados (***${rawDigits.slice(-4)})`);
    return true;
  } catch (err) {
    console.error('Error en hardResetUserSession:', describeError(err));
    return false;
  }
}

// Tipos de mensaje del paciente con archivo en Meta (se ven en el panel por el proxy autenticado).
const MEDIA_TYPES = ['image', 'audio', 'video', 'document', 'sticker'];

// Guarda la solicitud de cita de la Fase B en `appointments` y avisa a recepción. Nunca lanza:
// el paciente siempre recibe su respuesta y los fallos quedan en el log con [Appointments].
// Devuelve { status: 'saved', appointment } | { status: 'slot_taken', alternatives } | { status: 'error' }.
async function persistAgendaPayload(payload, context = {}) {
  if (!payload || typeof payload !== 'object') return { status: 'error' };
  try {
    const request = {
      senderPhone: context.phone,
      patientName: payload.nombre || null,
      treatment: payload.tratamiento || payload.motivo || null,
      appointmentDate: payload.fecha,
      appointmentTime: payload.hora,
      source: context.source || 'whatsapp',
      adReferral: context.adReferral || null,
    };
    // Confirmación directa: el bot reserva el horario (atómico) y la cita nace confirmada con su código.
    const appointment = bookingModeOf(activeClinic) === 'confirmacion_directa'
      ? await appointmentService.reserveSlot({ ...request, specialist: specialistFor(findTreatment(request.treatment || '')?.key)?.name || null })
      : await appointmentService.saveAppointment(request);
    // Ficha para recepción y, si hay DOCTOR_ALERT_PHONE, para el doctor (sin diagnósticos ni texto libre).
    const interest = interestOf(appointment, context.summary || []);
    await appointmentService.notifyReception(appointment, { summary: context.summary || null, interest });
    await notifyDoctor(appointment, { interest });
    return { status: 'saved', appointment };
  } catch (error) {
    if (error instanceof SlotTakenError) {
      const outsideHours = error instanceof OutsideHoursError;
      let alternatives = [];
      try {
        // Fuera de horario (p. ej. "a las 11 p. m.") se ofrecen los más cercanos desde ahora.
        alternatives = await appointmentService.findNextSlots(payload.tratamiento || null, outsideHours ? {} : { fromDate: payload.fecha });
      } catch (slotError) {
        console.error('[Appointments] No se pudieron calcular horarios alternativos:', describeError(slotError));
      }
      return { status: 'slot_taken', reason: outsideHours ? 'outside_hours' : 'taken', alternatives };
    }
    console.error('[Appointments] No se pudo guardar la cita:', describeError(error));
    return { status: 'error' };
  }
}

// Si Gemini falla, el paciente recibe los horarios o un aviso y recepción una alerta (services/aiFallback.js).
const alertReceptionNoAI = createNoAiAlert();
// La asistente no tenía el dato ([CONSULTAR_RECEPCION]): recepción responde la pregunta.
const alertReceptionQuestion = createReceptionQuestionAlert();

const BOOKING_INTENT = /\b(citas?|agendar|agendo|agenda|reservar|reserva|separar|turnos?|horarios?|disponibilidad|atenderme|evaluaci[oó]n)\b/i;
const CANCEL_INTENT = /^\s*cancelar(?:\s+mi)?(?:\s+cita)?\s*[.!]*\s*$|\bcancel\w*\b[^.?!]*\bcita\b|\bcita\b[^.?!]*\bcancel\w*\b|\bya no (?:voy a )?(?:ir|asistir|podr[eé] ir)\b/i;
const RESCHEDULE_INTENT = /^\s*reprogramar(?:\s+mi)?(?:\s+cita)?\s*[.!]*\s*$|\b(?:cambiar|reprogramar|mover|postergar|cambio de)\b[^.?!]*\b(?:cita|hora|horario|d[ií]a)\b/i;
export const DATA_DELETION = /^\s*(?:por\s+favor\s+)?(?:borra|borrar|elimina|eliminar)\s+(?:todos\s+)?(?:mis|los)\s+datos(?:\s+personales)?\s*(?:por\s+favor)?\s*[.!]*\s*$/i;
const REMINDER_CONFIRM = /^\s*(?:1|1️⃣|confirmo|confirmar|confirmado|s[ií],?\s*confirmo)\s*[.!]*\s*$/i;
// "Reagendar" / "Reprogramar": botón del recordatorio (interactivo o de la plantilla) o respuesta escrita.
const REMINDER_RESCHEDULE = /^\s*(?:2|2️⃣|reprogramar|reagendar)\s*[.!]*\s*$/i;
const RESCHEDULE_TTL_MS = 30 * 60 * 1000;
// Cierra una frase sin duplicar el punto de "p. m.".
const sentence = (text) => (/[.!?]$/.test(text) ? text : `${text}.`);
// Consultas de precio o de un tratamiento: de noche se aprovechan para ofrecer horarios "en caliente".
const PRICE_INTENT = /\b(?:precio|precios|cu[aá]nto|cuesta|costo|cuotas?|inicial|promo(?:ci[oó]n)?|campa[nñ]a|descuento)\b/i;
const pendingReschedules = createExpiringMap({ ttlMs: RESCHEDULE_TTL_MS });
// Lo agrega formatSlotList: el mensaje trae horarios para elegir.
const SLOT_LIST_MARK = 'Horarios disponibles:';

// Guarda "confirmo" / "reprogramar" en la cita (ficha del doctor y métricas). Nunca bloquea la respuesta.
async function saveReminderReply(appointments, appointment, reply) {
  try {
    return await appointments.updateStatus(appointment.id, appointment.status, reply);
  } catch (error) {
    console.warn('[Appointments] No se pudo guardar la respuesta al recordatorio:', describeError(error));
    return null;
  }
}

// "cancelar" / "cambiar mi cita": encuentra la próxima cita, ofrece horarios y actualiza el estado.
// Devuelve el texto a responder, o null para que la conversación siga con Gemini.
export async function handleAppointmentCommands(from, messageText, { appointments = appointmentService, gemini = geminiService } = {}) {
  try {
    const active = pendingReschedules.get(from);
    const chosen = active && gemini.pickOfferedSlot(messageText, active.slots);
    if (chosen) {
      pendingReschedules.delete(from);
      try {
        const updated = await appointments.reschedule(active.appointment.id, {
          appointmentDate: chosen.date, appointmentTime: chosen.time, durationMin: active.appointment.duration_min,
        });
        await appointments.notifyReception(updated, { event: 'reprogramada' });
        return `¡Listo! Tu solicitud de cambio quedó registrada para el ${chosen.label} en ${activeClinic.address}. Recepción te la confirmará.`;
      } catch (error) {
        if (!(error instanceof SlotTakenError)) throw error;
        const slots = await appointments.findNextSlots(active.appointment.treatment);
        pendingReschedules.set(from, { appointment: active.appointment, slots, at: Date.now() });
        return `¡Uy! Ese horario se acaba de ocupar 😅.${formatSlotList(slots)}`;
      }
    }

    // Respuesta a un recordatorio: "1" confirma, "2" reprograma (solo si no está eligiendo horarios nuevos).
    const reminderAnswer = gemini.getOfferedSlots(from) ? null
      : REMINDER_CONFIRM.test(messageText) ? 'confirm'
        : REMINDER_RESCHEDULE.test(messageText) ? 'reschedule' : null;
    const wantsCancel = CANCEL_INTENT.test(messageText);
    let wantsReschedule = !wantsCancel && RESCHEDULE_INTENT.test(messageText);
    if (!wantsCancel && !wantsReschedule && !reminderAnswer) return null;
    const appointment = await appointments.findUpcomingByPhone(from);
    if (!appointment) return null;
    const current = slotLabel({ date: appointment.appointment_date, time: appointment.appointment_time });

    if (reminderAnswer && !wantsCancel && !wantsReschedule) {
      if (!appointment.reminder_24h_sent_at && !appointment.reminder_2h_sent_at) return null;
      const reply = { reminder_reply: reminderAnswer === 'confirm' ? 'confirmo' : 'reprogramar', reminder_reply_at: new Date().toISOString() };
      if (reminderAnswer === 'confirm') {
        // "Confirmo" al recordatorio: confirma la asistencia (también si el bot ya había confirmado la cita).
        const confirmed = appointment.status !== 'confirmada'
          ? await appointments.confirm(appointment.id, reply)
          : await saveReminderReply(appointments, appointment, reply);
        const updated = { ...appointment, ...(confirmed || {}), ...reply, status: 'confirmada' };
        await appointments.notifyReception(updated, { event: 'confirmada' });
        await notifyDoctor(updated, { event: 'confirmada', interest: interestOf(updated) });
        return `¡Gracias! Tu cita del ${current} quedó confirmada ✅. Te esperamos en ${activeClinic.address}.`;
      }
      await saveReminderReply(appointments, appointment, reply);
      wantsReschedule = true;
    }

    if (wantsCancel) {
      await appointments.updateStatus(appointment.id, 'cancelada');
      await appointments.notifyReception(appointment, { event: 'cancelada' });
      return `Listo, cancelamos tu cita del ${sentence(current)} Cuando quieras volver a agendar, escríbeme "quiero una cita" 😊`;
    }

    const slots = await appointments.findNextSlots(appointment.treatment);
    if (!slots.length) {
      await appointments.notifyReception(appointment, { event: 'reprogramada' });
      return `Tu cita actual es el ${sentence(current)} No encuentro horarios libres en los próximos días; recepción te escribirá para coordinar.`;
    }
    pendingReschedules.set(from, { appointment, slots, at: Date.now() });
    return `Claro 😊 Tu cita actual es el ${sentence(current)} Elige el nuevo horario:${formatSlotList(slots)}`;
  } catch (error) {
    console.error('[Appointments] Error al cancelar o reprogramar:', describeError(error));
    return null;
  }
}

const messageBuffers = new Map();
const BUFFER_WAIT_MS = 2000;
// Dos colas por paciente: la de entrada (cada mensaje en orden de llegada, antes del debounce) y la de
// respuesta (un lote a la vez, sin llamadas a Gemini superpuestas). Un fallo no detiene lo que sigue.
const intakeQueue = createSerialQueue({
  onError: (error) => console.error('webhookController: background processing error', describeError(error)),
});
const userProcessingQueue = createSerialQueue({
  onError: (error) => console.error('webhookController: batch failed', describeError(error)),
});
async function downloadIncomingImage(mediaId) {
  const { contentType, buffer } = await fetchMetaMedia(mediaId);
  return { mimeType: contentType, base64Data: buffer.toString('base64') };
}

// "Leído" + "escribiendo…" al instante (una sola llamada a Meta), sin hacer esperar la respuesta.
// sendTypingIndicator nunca lanza: un fallo queda en el log con el motivo de Meta.
function showTyping(messageId) {
  if (!messageId) return;
  void sendTypingIndicator(messageId);
}

// Urgencia clínica o pedido de hablar con una persona: se responde, se pausa el bot y se avisa a recepción.
async function replyHandoff(from, messageText, handoffReason, context = {}) {
  const firstContactUrgent = Boolean(context.firstContactUrgent);
  // Sangrado de encías sin señales de alarma: además de pasar a una persona, se recomienda la evaluación.
  const handoffText = patientHandoffReply(handoffReason, { text: messageText, recommendation: matchRecommendation(messageText) });
  const reply = firstContactUrgent ? `${handoffText}\n\n${activeClinic.privacyNotice}` : handoffText;
  const sent = await sendReply(from, messageText, reply);
  if (sent && firstContactUrgent) {
    // La fila de conversations ya existe: el mensaje entrante se guardó en la bandeja al llegar.
    void conversationMetrics.recordFirstContact({ phone: from, firstMessageAt: context.sentAt, respondedAt: clockNow() });
  }
  await handoffService.handoff({ phone: from, reason: handoffReason, message: messageText, contactName: context.contactName });
}

// Si pide cita, se le ofrecen 3 horarios libres concretos en vez de preguntarle "¿qué día?".
// Fuera de horario también ante una consulta de precio o tratamiento: la cita se asegura en caliente.
async function planSlotOffer(messageText, jid, current, afterHours) {
  const intentText = expandColloquial(messageText);
  const alreadyChoosing = geminiService.pickOfferedSlot(messageText, geminiService.getOfferedSlots(jid));
  const hotLead = afterHours && !geminiService.getOfferedSlots(jid)
    && Boolean(findTreatment(messageText) || PRICE_INTENT.test(intentText));
  // Lo que cuenta el paciente ("tengo los dientes chuecos") → evaluación recomendada + precio "desde" + 3 horarios.
  const recommendation = alreadyChoosing ? null : matchRecommendation(messageText);
  let offeredSlots = null;
  if ((BOOKING_INTENT.test(intentText) || hotLead || recommendation) && !alreadyChoosing && !geminiService.isSessionBooked(jid)) {
    try {
      const fromDate = parseRequestedDay(messageText, localParts(activeClinic.timezone, current).date);
      const treatmentKey = findTreatment(messageText)?.key || recommendation?.treatment?.key || null;
      offeredSlots = await appointmentService.findNextSlots(treatmentKey, fromDate ? { fromDate } : {});
    } catch (error) {
      console.error('[Appointments] No se pudieron calcular horarios libres:', describeError(error));
    }
  }
  return { offeredSlots, alreadyChoosing, recommendation };
}

// Gemini sin respuesta utilizable. Primero, una respuesta sin IA con los datos de la clínica (precio, ubicación,
// horario, campaña o pagos); si la pregunta no es de esas, horarios o aviso al paciente y alerta a recepción.
async function replyWithoutAI(from, messageText, offeredSlots, recommendation, current) {
  const today = localParts(activeClinic.timezone, current).date;
  // El catálogo y el pack salen de la configuración: se envían aunque la IA no responda.
  await sendVisuals(from, messageText, { today, catalog: imagesForKeys(catalogKeysForMessage(messageText)), showPack: wantsEvaluationPack(messageText) });
  const quick = recommendation ? null : quickAnswer(expandColloquial(messageText), { clinic: activeClinic, today });
  console.error(`[Gemini] Sin respuesta utilizable; se envía ${quick ? `la respuesta sin IA (${quick.kinds.join(', ')})` : 'la respuesta de respaldo'}`);
  let fallback = quick ? `${quick.text}${formatSlotList(offeredSlots)}` : aiFallbackReply(offeredSlots, recommendation);
  if (takeAfterHoursNotice(from, current)) fallback = `${afterHoursNotice()}\n\n${fallback}`;
  await sendReply(from, messageText, fallback, undefined, { slots: offeredSlots });
  if (!quick) await alertReceptionNoAI(from, messageText);
}

async function saveLeadFromReply(from, messageText, geminiResult) {
  if (!geminiResult.leadData || geminiResult.skipLeadPersistence) return null;
  try {
    return await leadService.saveLead({
      telefono: from, nombre: geminiResult.leadData.nombre, distrito: geminiResult.leadData.distrito,
      fechaHoraISO: geminiResult.leadData.fechaHoraISO, fechaHoraTexto: geminiResult.leadData.fechaHora,
      confirmed: geminiService.isExplicitConfirmation(messageText), clinicId: activeClinic.id, clinic: activeClinic,
    });
  } catch (error) {
    console.error('[Supabase] Error al persistir conversación:', describeError(error));
    return null;
  }
}

// La lista de horarios ya dice "Toca el horario que prefieras 👇": se quita la pregunta repetida del modelo
// ("¿Qué día y hora te acomodan?", "Toca el que prefieras 👇").
export function withoutSlotQuestion(text) {
  const lines = String(text || '').split('\n').map((line) => line.split(/(?<=[.!?👇])\s+/u)
    .filter((part) => !/^¿[^?]*\b(?:d[ií]as?|horas?|horarios?)\b[^?]*\?$|^toca\b/iu.test(part.trim()))
    .join(' '));
  const kept = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return kept || String(text || '').trim();
}

// Fase B: nombre + tratamiento + horario → se guarda la cita y se avisa a recepción. Si el horario ya no
// sirve, el texto cambia por las alternativas. Devuelve { text, appointmentOutcome }.
async function applyAppointmentRequest(from, jid, geminiResult, text, offeredSlots) {
  if (!geminiResult.appointmentRequest) {
    return { text: offeredSlots?.length ? `${withoutSlotQuestion(text)}${formatSlotList(offeredSlots)}`.trim() : text, appointmentOutcome: null, slots: offeredSlots };
  }
  const appointmentOutcome = await persistAgendaPayload(geminiResult.appointmentRequest, {
    phone: from, adReferral: await getAdReferral(from), summary: geminiService.conversationSummary(jid),
  });
  if (appointmentOutcome.status === 'saved' && appointmentOutcome.appointment?.status === 'confirmada' && appointmentOutcome.appointment.code) {
    return { text: confirmedBookingText(appointmentOutcome.appointment), appointmentOutcome, slots: null };
  }
  if (appointmentOutcome.status !== 'slot_taken') return { text, appointmentOutcome, slots: null };
  geminiService.releaseBooking(jid);
  geminiService.setOfferedSlots(jid, appointmentOutcome.alternatives);
  const why = appointmentOutcome.reason === 'outside_hours'
    ? `Ese horario está fuera de nuestra atención (${activeClinic.workingHoursText}).`
    : '¡Uy! Ese horario se acaba de ocupar 😅.';
  const alternativesText = appointmentOutcome.alternatives.length
    ? `${why} Te propongo estos:${formatSlotList(appointmentOutcome.alternatives)}`
    : `${why} Recepción te escribirá para coordinar otro.`;
  return { text: alternativesText, appointmentOutcome, slots: appointmentOutcome.alternatives };
}

// Texto final de Gemini: sin etiquetas, sin diagnóstico, con las fotos pedidas o deducidas del mensaje.
// catalog: imágenes de los tratamientos que preguntó (van antes del texto); photos: el resto (después).
function buildBotReply(geminiResult, messageText, recommendation) {
  // Las etiquetas de foto se leen del texto crudo: sanitizeModelTextOutput borra los "_" y [ENVIAR_IMAGEN].
  const { keys: requestedMediaKeys } = extractPhotoTags(geminiResult.rawTexto || geminiResult.texto);
  const botReplyText = geminiService.sanitizeModelTextOutput(extractPlainText(extractPhotoTags(geminiResult.texto).cleaned));
  // Freno final: si el modelo diagnostica o receta, se envía la recomendación segura de la clínica.
  const safeReply = enforceNoDiagnosis(stripInstructionTags(botReplyText), recommendation);
  if (safeReply.replaced) console.warn('[Gemini] Respuesta con diagnóstico reemplazada por la recomendación de evaluación');
  // Freno final: ninguna cifra "S/ …" que no esté en la configuración (p. ej. "S/ 1,50" en vez de "S/ 150").
  const today = localParts(activeClinic.timezone, clockNow()).date;
  const priced = guardPrices(safeReply.text, {
    clinic: activeClinic, today, fallback: quickAnswer(expandColloquial(messageText), { clinic: activeClinic, today })?.text || null,
  });
  if (priced.replaced) console.warn(`[Gemini] Se quitó un precio que no está en la configuración (${priced.invented.length})`);
  const inferredKey = inferPhotoKeyFromMessage(messageText);
  const mediaKeys = inferredKey && !requestedMediaKeys.includes(inferredKey) ? [...requestedMediaKeys, inferredKey] : requestedMediaKeys;
  const catalog = imagesForKeys(catalogKeysForMessage(messageText));
  const photos = imagesForKeys(mediaKeys).filter((item) => !catalog.some((c) => c.url === item.url));
  return { text: priced.text, catalog, photos };
}

// "no", "stop", "no me escriban"…: se guarda como opt-out (con fecha) y no recibe más seguimientos ni promociones.
// Un pedido explícito, o un "no" que responde a un seguimiento, se confirma y no pasa a la IA. Un "no" suelto
// en medio de la conversación (p. ej. "¿alguna otra duda?" → "no") se registra y la conversación sigue.
// Quien dice ser menor de edad queda marcado: nunca recibe seguimiento comercial. true si ya se respondió.
async function handleOptOut(from, messageText) {
  if (detectMinor(messageText)) await contactPreferences.markMinor(from);
  const optOut = detectOptOut(messageText);
  if (!optOut) return false;
  await contactPreferences.optOut(from, 'paciente');
  if (optOut !== 'explicit' && !(await answersFollowUp(from))) return false;
  await sendReply(from, messageText, OPT_OUT_CONFIRMATION);
  return true;
}

// Como una recepcionista: primero el catálogo del tratamiento y la tarjeta del pack (una vez cada uno),
// después la respuesta con los horarios.
async function sendVisuals(from, messageText, { today, catalog, showPack }) {
  await sendImages(from, catalog);
  if (showPack) await sendEvaluationPack(from, messageText, today);
}

async function processBatch(from, buffer) {
  // Configuración del panel al día (sin consultas si se revisó hace menos de 5 min).
  await clinicSettings.ensureFresh();
  const messageText = buffer.parts.filter((part) => part.type === 'text').map((part) => part.content).join('\n');
  const jid = `${from}@s.whatsapp.net`;
  showTyping(buffer.context?.messageId);
  // Pase a humano activo: el mensaje ya quedó guardado (al llegar), pero el bot no responde.
  if (await handoffService.isPaused(from)) return;

  const handoffReason = detectHandoff(messageText);
  if (handoffReason) return replyHandoff(from, messageText, handoffReason, buffer.context);
  // Respuesta a "¿quieres recibir promociones?" (Sí/No): se guarda y no pasa a la IA.
  const consentReply = await marketingConsent.handleAnswer(from, messageText);
  if (consentReply) {
    await sendReply(from, messageText, consentReply);
    return;
  }
  if (await handleOptOut(from, messageText)) return;

  // Cancelar / reprogramar / responder un recordatorio se resuelve sin Gemini.
  const commandReply = await handleAppointmentCommands(from, messageText);
  if (commandReply) {
    // Reprogramar: los horarios nuevos también van como botones.
    const slots = commandReply.includes(SLOT_LIST_MARK) ? pendingReschedules.get(from)?.slots || null : null;
    await sendReply(from, messageText, commandReply, undefined, { slots });
    return;
  }

  const current = clockNow();
  const today = localParts(activeClinic.timezone, current).date;
  const afterHours = !isWithinWorkingHours(activeClinic, current);
  const { offeredSlots, alreadyChoosing, recommendation } = await planSlotOffer(messageText, jid, current, afterHours);

  let geminiResult;
  try {
    geminiResult = await geminiService.obtenerRespuestaIA(jid, messageText, {
      client: getGeminiClient(), fallbackClients: getGeminiFallbackClients(), maxRetries: 1, messageParts: buffer.parts,
      profileName: buffer.context?.profileName ?? null,
      availableSlots: offeredSlots, afterHours, welcomed: Boolean(buffer.context?.welcomed),
      recommendation, botNotes: await getBotNotes(from), adReferral: await getAdReferral(from),
    });
  } catch (error) {
    console.error('[Gemini] Error al generar respuesta:', describeError(error));
    geminiResult = null;
  }
  if (!geminiResult || geminiResult.skipResponse || !geminiResult.texto) {
    await replyWithoutAI(from, messageText, offeredSlots, recommendation, current);
    return;
  }

  const { text: replyText, catalog, photos } = buildBotReply(geminiResult, messageText, recommendation);
  const leadResult = await saveLeadFromReply(from, messageText, geminiResult);
  const { text: appointmentText, appointmentOutcome, slots } = await applyAppointmentRequest(from, jid, geminiResult, replyText, offeredSlots);
  let textoParaWhatsApp = appointmentText;
  if (textoParaWhatsApp && takeAfterHoursNotice(from, current)) {
    textoParaWhatsApp = `${afterHoursNotice()}\n\n${textoParaWhatsApp}`;
  }

  const justBooked = appointmentOutcome?.status === 'saved';
  await sendVisuals(from, messageText, {
    today, catalog: justBooked ? [] : catalog,
    showPack: !justBooked && !alreadyChoosing && !geminiService.isSessionBooked(jid) && wantsEvaluationPack(messageText),
  });

  // Cita confirmada por el bot: primero el pase de cita (imagen), luego la confirmación en texto.
  if (justBooked) await sendAppointmentPass(from, appointmentOutcome.appointment);

  let sendResult;
  try {
    if (textoParaWhatsApp) sendResult = await sendWithSlotPicker(from, textoParaWhatsApp, slots);
  } catch (error) {
    console.error('webhookController: failed sending message to user', describeError(error));
    return;
  }
  // Primero se registra el texto ya enviado: si después falla una foto, la bandeja igual lo muestra.
  await recordBotReply(from, messageText, textoParaWhatsApp, sendResult);
  await sendImages(from, photos);
  // "¿Dónde quedan?" o solicitud registrada: mensaje de ubicación (si la clínica tiene coordenadas).
  if (wantsLocation(messageText) || appointmentOutcome?.status === 'saved') await sendClinicLocation(from);
  // Después de agendar, una sola vez: permiso para promociones (opt-in de marketing).
  if (justBooked) await marketingConsent.askAfterBooking(from);
  if (geminiResult.askReception) await alertReceptionQuestion(from, messageText);
  // Lead score de la bandeja (nunca lanza).
  void leadInsights.observe(from, {
    text: messageText, treatment: findTreatment(messageText)?.name || recommendation?.treatment?.name || null,
    recommendation: recommendation?.rule?.id || null, requested: appointmentOutcome?.status === 'saved', choseSlot: Boolean(alreadyChoosing),
  });
  // Si ya se avisó a recepción por la cita, no se duplica la alerta de lead.
  if (leadResult?.readyToNotify && leadResult.lead && appointmentOutcome?.status !== 'saved') {
    try { await notificationService.notifyAdminNewLead(leadResult.lead, { whatsappService, leadService }); }
    catch (error) { console.error('webhookController: error in admin notify flow', describeError(error)); }
  }
}

async function addMessageToBuffer(from, part, context) {
  const current = messageBuffers.get(from) || { parts: [], timer: null, lastActivity: 0, context };
  current.parts.push(part);
  current.lastActivity = Date.now();
  current.context = context;
  if (current.timer) clearTimeout(current.timer);
  // "Bot escribiendo…" en la bandeja mientras corre el debounce y se genera la respuesta.
  if (!context.botPaused) liveEvents.publish('typing', { phone: from, typing: true });
  current.timer = setTimeout(() => {
    messageBuffers.delete(from);
    current.timer = null;
    userProcessingQueue.enqueue(from, () => processBatch(from, current))
      .finally(() => liveEvents.publish('typing', { phone: from, typing: false }));
  }, BUFFER_WAIT_MS);
  messageBuffers.set(from, current);
}

// Espera a que termine todo lo pendiente de un paciente (recepción, debounce y respuesta).
// Lo usan scripts/simulate-conversations.js y los tests; el flujo normal no lo necesita.
export async function waitForIdle(from) {
  const id = digitsOf(from);
  for (;;) {
    const pending = intakeQueue.pending(id) || (messageBuffers.has(id) ? new Promise((r) => setTimeout(r, 50)) : null)
      || userProcessingQueue.pending(id);
    if (!pending) return;
    await pending.catch(() => {});
  }
}

// Texto, respuesta a botón de plantilla ("Confirmo" / "Reprogramar") o pie de foto.
function incomingText(message) {
  if (message.type === 'text') return message.text?.body?.trim();
  if (message.type === 'button') return message.button?.text?.trim();
  if (message.type === 'interactive') return (message.interactive?.button_reply?.title || message.interactive?.list_reply?.title)?.trim();
  return message.image?.caption?.trim();
}

// "reset" (pruebas) o "borrar mis datos" (derecho de supresión, Ley 29733). true si se atendió.
async function handleResetCommand(from, message, text) {
  const wantsDataDeletion = DATA_DELETION.test(text || '');
  if (message.type !== 'text' || !(/^\/?(reset|reiniciar|borrar|clear)$/i.test(text || '') || wantsDataDeletion)) return false;
  const pending = messageBuffers.get(from);
  if (pending?.timer) clearTimeout(pending.timer);
  messageBuffers.delete(from);
  await hardResetUserSession(from);
  // Derecho de supresión (Ley 29733) anunciado en el aviso de privacidad de la bienvenida.
  if (wantsDataDeletion) {
    try {
      await whatsappService.sendTextMessage(from, DATA_DELETION_REPLY);
    } catch (error) {
      console.error('[WhatsApp] No se pudo confirmar la eliminación de datos:', describeError(error));
    }
  }
  return true;
}

// Cola de entrada del paciente: bandeja, primer contacto y debounce, en orden de llegada.
async function intakeMessage(from, rawMessage, value, context) {
  // Audio con GEMINI_PAID_TIER=true: se transcribe y sigue como si lo hubiera escrito (mismas reglas de urgencia,
  // diagnóstico y opt-out). El audio no se guarda: en la bandeja queda "🎤 (transcripción) …".
  const heard = rawMessage.type === 'audio' && audioTranscriptionEnabled() ? await audioTranscriber.transcribe(rawMessage.audio) : null;
  const message = heard?.text ? { ...rawMessage, type: 'text', text: { body: heard.text } } : rawMessage;
  const text = incomingText(message);
  if (await handleResetCommand(from, message, text)) return;
  const firstContact = !(await hasPreviousConversation(from));
  // A la bandeja apenas llega (antes del debounce), con su foto, audio o documento si trae uno.
  const mediaType = MEDIA_TYPES.includes(message.type) ? message.type : null;
  await recordInbox({
    phone: from, sender: 'patient', text: heard?.text ? `🎤 (transcripción) ${heard.text}` : text || null, type: mediaType || 'text',
    // Con transcripción activada no se guarda ninguna referencia al audio.
    mediaId: mediaType && !heard ? message[mediaType]?.id || null : null, wamid: message.id || null,
    contactName: value?.contacts?.[0]?.profile?.name || null, at: context.sentAt,
  });
  context.botPaused = await handoffService.isPaused(from);
  if (firstContact && !(await greetFirstContact(from, message, text, context))) return;
  if (UNSUPPORTED_REPLIES[message.type]) {
    if (context.botPaused) return;
    const reply = heard?.reason === 'too_long' ? AUDIO_TOO_LONG_REPLY : UNSUPPORTED_REPLIES[message.type];
    await sendReply(from, `[${message.type}]`, reply, '[WhatsApp] No se pudo responder a un mensaje no soportado:');
    return;
  }
  if (message.type === 'image') {
    try {
      const media = await downloadIncomingImage(message.image?.id);
      await addMessageToBuffer(from, { type: 'image', ...media, caption: message.image?.caption ?? null }, context);
    } catch (error) {
      console.error('webhookController: image download failed', describeError(error));
    }
  } else if (text) {
    await addMessageToBuffer(from, { type: 'text', content: text }, context);
  }
}

// Un mensaje del webhook: deduplicación, anuncio de origen y a la cola de entrada del paciente.
async function receiveMessage(message, value) {
  // Meta reintenta si el 200 llega tarde (Render despertando): cada message.id se procesa una sola vez.
  if (await messageDedup.seen(message?.id)) return;
  if (!message || message.from === 'status@broadcast' || message.type === 'system') return;
  const from = digitsOf(message.from);
  if (!from) return;
  const referral = sanitizeReferral(message.referral);
  if (referral) {
    adReferrals.set(from, referral);
    void leadService.saveLeadAdReferral(from, referral)
      .catch((error) => console.error('[Leads] No se pudo guardar el anuncio de origen:', describeError(error)));
  }
  const receivedAt = clockNow();
  const sentAt = Number(message.timestamp) > 0 ? new Date(Number(message.timestamp) * 1000) : receivedAt;
  const context = {
    contactName: value?.contacts?.[0]?.profile?.name || from,
    // Nombre del perfil tal cual; geminiService lo usa solo si parece un nombre real.
    profileName: value?.contacts?.[0]?.profile?.name || null,
    phoneNumberId: value?.metadata?.phone_number_id || process.env.WHATSAPP_PHONE_NUMBER_ID || null,
    messageId: message.id || null,
    // Meta puede entregar tarde si Render estaba dormido: se mide desde la hora real del mensaje.
    sentAt: sentAt > receivedAt ? receivedAt : sentAt,
  };
  intakeQueue.enqueue(from, () => intakeMessage(from, message, value, context));
}

// Meta puede agrupar varios eventos en un mismo POST (varias entradas, cambios o mensajes):
// se devuelven todos, cada mensaje con su `value` (contactos y metadata del mismo cambio).
export function extractIncomingEvents(payload) {
  const messages = [];
  const statuses = [];
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  for (const entry of entries) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      const value = change?.value;
      if (Array.isArray(value?.statuses)) statuses.push(...value.statuses);
      if (Array.isArray(value?.messages)) messages.push(...value.messages.map((message) => ({ message, value })));
    }
  }
  return { messages, statuses };
}

// Buffering combines rapid text/image messages while the per-user queue prevents overlapping Gemini calls.
export default async function webhookController(req, res, next) {
  res.status(200).send('EVENT_RECEIVED');
  try {
    let payload = req.parsedBody || req.body;
    if (Buffer.isBuffer(payload)) payload = JSON.parse(payload.toString('utf8'));
    const { messages, statuses } = extractIncomingEvents(payload);
    // Estados de entrega (enviado, entregado, leído, fallido): se guardan y se ven en la bandeja.
    if (statuses.length > 0) {
      await inboxService.applyStatuses(statuses)
        .catch((error) => console.error('[Bandeja] No se pudo guardar el estado de entrega:', describeError(error)));
    }
    for (const { message, value } of messages) {
      try {
        await receiveMessage(message, value);
      } catch (error) {
        console.error('webhookController: background processing error', describeError(error));
      }
    }
  } catch (error) {
    console.error('webhookController: background processing error', describeError(error));
  }
}
