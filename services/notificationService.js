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

  // Basic validation guard: ensure phone and name and distrito appear valid
  const phone = lead.telefono || lead.phone || '';
  const onlyDigits = String(phone).replace(/\D/g, '');
  if (!/^9\d{8}$/.test(onlyDigits)) {
    console.warn('notificationService: telefono inválido para notificar admin:', phone);
    return false;
  }
  const nombre = lead.nombre || '';
  if (!nombre || /^camila\b/i.test(nombre)) {
    console.warn('notificationService: nombre inválido para notificar admin:', nombre);
    return false;
  }
  const distrito = lead.distrito || '';
  if (!distrito || /\b(qué|que|cual|cuál|a este número|dónde|donde)\b/i.test(distrito)) {
    console.warn('notificationService: distrito inválido para notificar admin:', distrito);
    return false;
  }

  // Prefer clinic's admin number when provided in options
  const adminFromOptions = options.clinic && options.clinic.admin_whatsapp_number ? String(options.clinic.admin_whatsapp_number) : null;
  const raw = adminFromOptions || process.env.ADMIN_WHATSAPP_NUMBER || config.admin?.phone;
  const adminDigits = raw ? raw.replace(/\D/g, '') : null;
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
