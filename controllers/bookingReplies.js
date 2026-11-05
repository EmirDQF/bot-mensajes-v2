import activeClinic, { reminderHours } from '../config/clinic.config.js';
import whatsappService from '../services/whatsappService.js';
import { formatDateEs, formatTimeEs } from '../services/appointmentService.js';
import { appointmentPassPng, canHavePass } from '../services/cards/appointmentPass.js';
import { describeError } from '../services/safeLog.js';
import { recordInbox } from './conversationStore.js';

// Respuesta cuando el bot CONFIRMA la cita (bookingMode = "confirmacion_directa") y envío del pase de cita.
// En modo "solicitud" nada de esto se usa: la respuesta dice "solicitud … Recepción te la confirmará".

const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';
const capitalize = (text) => String(text || '').charAt(0).toUpperCase() + String(text || '').slice(1);

// Ruta del panel (con sesión) que genera el pase desde la fila de la cita. No es pública.
export const passPreviewPath = (appointment) => `/api/panel/appointments/${encodeURIComponent(appointment.id)}/pass.png`;

// "48 h y 2 h antes de tu cita" según la configuración (o null si los recordatorios están apagados).
function reminderPhrase(clinic) {
  const hours = Object.values(reminderHours(clinic)).filter(Boolean);
  return hours.length ? `te recordaremos por aquí ${hours.map((h) => `${h} h`).join(' y ')} antes de tu cita.` : null;
}

// Solo datos guardados en la cita y en la configuración, con el formato del video de referencia (bloques con
// emojis y negritas de WhatsApp). cardSentTo: a quién se le envió DE VERDAD la ficha ('doctor' | 'recepcion' | null);
// sin envío, la línea no aparece.
export function confirmedBookingText(appointment, clinic = activeClinic, { cardSentTo = null } = {}) {
  const name = firstName(appointment.patient_name);
  const reminder = reminderPhrase(clinic);
  const cardLine = cardSentTo === 'doctor'
    ? '✅ Además, ya le enviamos tu ficha a tu especialista para que te espere listo.'
    : cardSentTo === 'recepcion' ? '✅ Además, ya le enviamos tu ficha a recepción para que te espere listo.' : null;
  const lines = [
    `¡Listo${name ? `, ${name}` : ''}! 🎉 Tu cita de evaluación ya quedó *100% confirmada*:`,
    '',
    `🗓️ *Día:* ${capitalize(formatDateEs(appointment.appointment_date))} — ${formatTimeEs(appointment.appointment_time)}`,
    ...(appointment.treatment ? [`🦷 *Tratamiento:* ${appointment.treatment}`] : []),
    ...(appointment.specialist ? [`👩‍⚕️ *Especialista:* ${appointment.specialist}`] : []),
    `📍 *Dirección:* ${clinic.address}`,
    `🔖 *Código:* ${appointment.code}`,
    ...(reminder ? ['', `🔔 *Para tu tranquilidad:* ${reminder}`] : []),
    ...(cardLine ? ['', cardLine] : []),
    '',
    'Te enviamos tu pase de cita 👆 Si no puedes asistir, escribe "reprogramar".',
  ];
  return lines.join('\n');
}

// Envía el pase de cita (PNG). Nunca lanza: si falla, el paciente ya tiene la confirmación en texto.
export async function sendAppointmentPass(to, appointment, { whatsapp = whatsappService, clinic = activeClinic } = {}) {
  if (!canHavePass(appointment)) return false;
  try {
    const png = appointmentPassPng(appointment, clinic);
    const caption = `Tu pase de cita · ${appointment.code}`;
    const previewUrl = passPreviewPath(appointment);
    const result = await whatsapp.sendImageBuffer(to, png, { caption, previewUrl });
    void recordInbox({ phone: to, sender: 'bot', type: 'image', text: caption, mediaUrl: previewUrl, wamid: result?.messages?.[0]?.id || null });
    return true;
  } catch (error) {
    console.error('[Citas] No se pudo enviar el pase de cita:', describeError(error));
    return false;
  }
}

export default { confirmedBookingText, sendAppointmentPass, passPreviewPath };
