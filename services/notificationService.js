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

  // Log resolved admin source for debugging (clinic vs env)
  try {
    const source = adminFromOptions ? 'clinic' : (process.env.ADMIN_WHATSAPP_NUMBER ? 'env' : (config.admin?.phone ? 'config' : 'unknown'));
    console.log(`[NOTIFICATION] Resolved admin WhatsApp number: ${adminDigits || 'NONE'} (source: ${source})`);
  } catch (e) {
    // ignore logging failures
  }

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

export async function notifyAdminUpdatedLead(lead, previousFechaIso = null, options = {}) {
  if (!lead || !lead.id) return false;

  // Basic guards similar to notifyAdminNewLead
  const phone = lead.telefono || lead.phone || '';
  const onlyDigits = String(phone).replace(/\D/g, '');
  if (!/^9\d{8}$/.test(onlyDigits)) return false;
  const nombre = lead.nombre || '';
  if (!nombre || /^camila\b/i.test(nombre)) return false;

  const adminFromOptions = options.clinic && options.clinic.admin_whatsapp_number ? String(options.clinic.admin_whatsapp_number) : null;
  const raw = adminFromOptions || process.env.ADMIN_WHATSAPP_NUMBER || config.admin?.phone;
  const adminDigits = raw ? raw.replace(/\D/g, '') : null;
  if (!adminDigits) return false;

  const sendWhatsAppMessage = options.whatsappService?.sendWhatsAppMessage || whatsappService.sendWhatsAppMessage;
  const markNotified = options.leadService?.markAsNotified || markAsNotified;

  // Format previous and current fecha text if available
  const previousText = previousFechaIso || lead.previous_fecha_hora_texto || null;
  const currentText = lead.fecha_hora_texto || lead.fechaHoraTexto || lead.fechaHora || null;

  const alertMessage = [
    '--------------------------------─────',
    '⚠️ ACTUALIZACIÓN DE CITA',
    `👤 Nombre: ${lead.nombre || 'N/A'}`,
    `📞 Teléfono: ${buildWhatsappLink(lead.telefono || lead.phone || '')}`,
    `📍 Distrito: ${lead.distrito || 'N/A'}`,
    `🔁 Cambió de: ${previousText || 'N/A'}`,
    `🗓️ A: ${currentText || 'N/A'}`,
    '--------------------------------─────',
  ].join('\n');

  await sendWhatsAppMessage(adminDigits, alertMessage, {});

  // Update notified_at to reflect the latest notification
  if (lead.id) {
    try {
      await markNotified(lead.id);
    } catch (e) {
      console.error('notificationService: failed to mark lead as notified after update', e && e.message ? e.message : e);
    }
  }

  return true;
}

export default { notifyAdminNewLead, notifyAdminUpdatedLead };
