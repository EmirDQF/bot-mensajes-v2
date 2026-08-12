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
  // allow callers to pass a lead object without ready_to_notify flag (DB may be source of truth)
  if (!lead || lead.notified_at) return false;

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
  let adminDigits = raw ? String(raw).replace(/\D/g, '') : null;

  // Normalize to Peru country code: if 9 digits assume local and prefix 51
  if (adminDigits && adminDigits.length === 9) {
    adminDigits = '51' + adminDigits;
  }
  // If starts with +51 or 51 already, ensure no plus and correct length
  if (adminDigits && adminDigits.startsWith('+')) adminDigits = adminDigits.replace(/\D/g, '');

  // Ensure we have full E.164-like without plus (country code included)
  if (adminDigits && adminDigits.length === 11 && adminDigits.startsWith('51')) {
    // good
  }

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

  // If lead has an id, attempt to atomically claim the notification (set notified_at) to prevent duplicates
  let claimedLead = null;
  let claimFailed = false;
  if (lead.id) {
    try {
      const { tryClaimNotification } = await import('./leadService.js');
      if (typeof tryClaimNotification === 'function') {
        claimedLead = await tryClaimNotification(lead.id);
      }
    } catch (e) {
      claimFailed = true;
      console.warn('notificationService: could not perform atomic claim for notification', e && e.message ? e.message : e);
      // fall back if caller provided a markAsNotified function to record notification
    }

    if (!claimedLead) {
      if (claimFailed && options.leadService && typeof options.leadService.markAsNotified === 'function') {
        // proceed but note that we couldn't claim atomically; we'll call provided markAsNotified after successful send
        claimedLead = { id: lead.id };
      } else {
        // someone else already claimed or claim failed and no fallback: skip sending
        console.warn('notificationService: notification already claimed or could not claim for lead id', lead.id);
        return false;
      }
    }
  }

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
 
  try {
    const sendResult = await sendWhatsAppMessage(adminDigits, alertMessage, {});
    console.log('[NOTIFICACION EXITO]: Alerta enviada a', adminDigits);

    // If atomic claim wasn't available but caller provided a fallback markAsNotified, call it to record the notification.
    if (claimFailed && options.leadService && typeof options.leadService.markAsNotified === 'function') {
      try {
        await options.leadService.markAsNotified(claimedLead?.id || lead.id);
      } catch (e) {
        console.warn('notificationService: fallback markAsNotified failed', e && e.message ? e.message : e);
      }
    }

  } catch (e) {
    console.error('[WHATSAPP ADMIN NOTIFY ERROR]:', e?.response?.data || e?.message || e);
    console.error('[CRITICAL DB/NOTIFY ERROR]: notificationService failed to send admin WhatsApp message', e && e.message ? e.message : e);
    // If we previously claimed the notification but failed to send, attempt to rollback notified_at by setting it back to null (best-effort)
    if (claimedLead && claimedLead.id) {
      try {
        const { markAsNotified } = await import('./leadService.js');
        // markAsNotified will set notified_at to now; to rollback we directly unset via Supabase client using a dynamic update
        const { getSupabaseClient } = await import('./leadService.js');
        const client = getSupabaseClient();
        if (client) {
          await client.from('leads').update({ notified_at: null, updated_at: new Date().toISOString() }).eq('id', claimedLead.id);
        }
      } catch (err) {
        console.error('notificationService: failed to rollback notified_at after send failure', err && err.message ? err.message : err);
      }
    }
    return false;
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
