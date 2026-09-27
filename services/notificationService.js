import activeClinic, { getReceptionPhone } from '../config/clinic.config.js';
import whatsappService from './whatsappService.js';
import { markAsNotified, releaseNotificationClaim, tryClaimNotification } from './leadService.js';

// Alertas a recepción (RECEPTION_ALERT_PHONE) cuando un lead deja nombre, distrito y horario.
// El teléfono de destino sale solo de la variable de entorno: nunca de la base de datos ni del código.

const maskPhone = (digits) => (digits ? `***${String(digits).slice(-4)}` : 'NONE');

function buildWhatsappLink(phone) {
  if (!phone || typeof phone !== 'string') return 'N/A';
  const normalized = phone.replace(/\D/g, '').replace(/^51/, '');
  return normalized ? `https://wa.me/51${normalized}` : 'N/A';
}

// El nombre de la asistente no es un nombre de paciente (Gemini a veces lo devuelve como "nombre").
function isAssistantName(name) {
  const bot = String(activeClinic.botName || '').trim().toLowerCase();
  return Boolean(bot) && String(name || '').trim().toLowerCase().startsWith(bot);
}

export async function notifyAdminNewLead(lead, options = {}) {
  if (!lead || lead.notified_at) return false;

  const phone = lead.telefono || lead.phone || '';
  if (!/^9\d{8}$/.test(String(phone).replace(/\D/g, ''))) {
    console.warn('notificationService: teléfono inválido para notificar a recepción');
    return false;
  }
  const nombre = lead.nombre || '';
  if (!nombre || isAssistantName(nombre)) {
    console.warn('notificationService: nombre inválido para notificar a recepción');
    return false;
  }
  const distrito = lead.distrito || '';
  if (!distrito || /\b(qué|que|cual|cuál|a este número|dónde|donde)\b/i.test(distrito)) {
    console.warn('notificationService: distrito inválido para notificar a recepción');
    return false;
  }

  const adminDigits = getReceptionPhone();
  if (!adminDigits) {
    console.warn('notificationService: RECEPTION_ALERT_PHONE no está configurada. No se envió la alerta a recepción.');
    return false;
  }

  const sendWhatsAppMessage = options.whatsappService?.sendWhatsAppMessage || whatsappService.sendWhatsAppMessage;

  // Reclamo atómico (notified_at IS NULL → ahora) para no avisar dos veces el mismo lead.
  let claimedLead = null;
  let claimFailed = false;
  if (lead.id) {
    try {
      claimedLead = await tryClaimNotification(lead.id);
    } catch (e) {
      claimFailed = true;
      console.warn('notificationService: no se pudo reclamar la notificación', e?.message || e);
    }
    if (!claimedLead) {
      if (claimFailed && typeof options.leadService?.markAsNotified === 'function') {
        claimedLead = { id: lead.id };
      } else {
        console.warn('notificationService: la notificación ya fue enviada o no se pudo reclamar', lead.id);
        return false;
      }
    }
  }

  const alertMessage = [
    '--------------------------------─────',
    '🚨 ¡NUEVO PACIENTE AGENDADO!',
    `👤 Nombre: ${lead.nombre || 'N/A'}`,
    `📞 Teléfono: ${buildWhatsappLink(phone)}`,
    `📍 Distrito: ${lead.distrito || 'N/A'}`,
    `🗓️ Cita: ${lead.fecha_hora_texto || lead.fechaHoraTexto || lead.fechaHora || 'N/A'}`,
    '--------------------------------─────',
  ].join('\n');

  try {
    await sendWhatsAppMessage(adminDigits, alertMessage, {});
    console.log('[Notificación] Alerta enviada a recepción', maskPhone(adminDigits));
    if (claimFailed && typeof options.leadService?.markAsNotified === 'function') {
      try {
        await options.leadService.markAsNotified(claimedLead?.id || lead.id);
      } catch (e) {
        console.warn('notificationService: markAsNotified de respaldo falló', e?.message || e);
      }
    }
  } catch (e) {
    console.error('[Notificación] No se pudo avisar a recepción:', e?.message || e);
    // Se libera el reclamo para que el próximo intento pueda avisar.
    if (claimedLead?.id && !claimFailed) {
      try {
        await releaseNotificationClaim(claimedLead.id);
      } catch (err) {
        console.error('notificationService: no se pudo liberar notified_at', err?.message || err);
      }
    }
    return false;
  }
  return true;
}

export async function notifyAdminUpdatedLead(lead, previousFechaIso = null, options = {}) {
  if (!lead || !lead.id) return false;
  const phone = lead.telefono || lead.phone || '';
  if (!/^9\d{8}$/.test(String(phone).replace(/\D/g, ''))) return false;
  const nombre = lead.nombre || '';
  if (!nombre || isAssistantName(nombre)) return false;

  const adminDigits = getReceptionPhone();
  if (!adminDigits) return false;

  const sendWhatsAppMessage = options.whatsappService?.sendWhatsAppMessage || whatsappService.sendWhatsAppMessage;
  const markNotified = options.leadService?.markAsNotified || markAsNotified;
  const previousText = previousFechaIso || lead.previous_fecha_hora_texto || null;
  const currentText = lead.fecha_hora_texto || lead.fechaHoraTexto || lead.fechaHora || null;

  const alertMessage = [
    '--------------------------------─────',
    '⚠️ ACTUALIZACIÓN DE CITA',
    `👤 Nombre: ${lead.nombre || 'N/A'}`,
    `📞 Teléfono: ${buildWhatsappLink(phone)}`,
    `📍 Distrito: ${lead.distrito || 'N/A'}`,
    `🔁 Cambió de: ${previousText || 'N/A'}`,
    `🗓️ A: ${currentText || 'N/A'}`,
    '--------------------------------─────',
  ].join('\n');

  await sendWhatsAppMessage(adminDigits, alertMessage, {});
  try {
    await markNotified(lead.id);
  } catch (e) {
    console.error('notificationService: no se pudo marcar el lead como notificado', e?.message || e);
  }
  return true;
}

export default { notifyAdminNewLead, notifyAdminUpdatedLead };
