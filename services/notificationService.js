import config from '../config/env.js';
import whatsappService from './whatsappService.js';
import { markAsNotified } from './leadService.js';

function getAdminPhoneDigits() {
  const raw = process.env.ADMIN_WHATSAPP_NUMBER || config.admin?.phone;
  if (!raw || typeof raw !== 'string') return null;
  const digits = raw.replace(/\D/g, '');
  return digits || null;
}

function buildWhatsappLink(phone) {
  if (!phone || typeof phone !== 'string') return 'N/A';
  const digits = phone.replace(/\D/g, '');
  const normalized = digits.replace(/^51/, '');
  return normalized ? `https://wa.me/51${normalized}` : 'N/A';
}

export async function notifyAdminNewLead(lead, options = {}) {
  if (!lead || !lead.ready_to_notify || lead.notified_at) return false;

  const adminDigits = getAdminPhoneDigits();
  if (!adminDigits) {
    console.warn('notificationService: ADMIN_WHATSAPP_NUMBER no está configurado. No se envió la notificación al administrador.');
    return false;
  }

  const sendWhatsAppMessage = options.whatsappService?.sendWhatsAppMessage || whatsappService.sendWhatsAppMessage;
  const markNotified = options.leadService?.markAsNotified || markAsNotified;

  const phoneLink = buildWhatsappLink(lead.telefono || lead.phone || '');
  const alertMessage = [
    '--------------------------------─────',
    '🚨 ¡NUEVO PACIENTE AGENDADO!',
    `👤 Nombre: ${lead.nombre || 'N/A'}`,
    `📞 Teléfono: ${phoneLink}`,
    `📍 Distrito: ${lead.distrito || 'N/A'}`,
    `🗓️ Cita: ${lead.fecha_hora_texto || lead.fechaHoraTexto || lead.fechaHora || 'N/A'}`,
    '--------------------------------─────',
  ].join('\n');
 
  await sendWhatsAppMessage(adminDigits, alertMessage, {});

  if (lead.id) {
    try {
      await markNotified(lead.id);
    } catch (e) {
      console.error('notificationService: failed to mark lead as notified', e && e.message ? e.message : e);
    }
  }

  return true;
}

export default { notifyAdminNewLead };
