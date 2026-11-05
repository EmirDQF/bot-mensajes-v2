import activeClinic from '../config/clinic.config.js';
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

// Solo datos guardados en la cita y en la configuración de la clínica.
export function confirmedBookingText(appointment, clinic = activeClinic) {
  const name = firstName(appointment.patient_name);
  const lines = [
    `¡Listo${name ? `, ${name}` : ''}! 🎉 Tu cita quedó *confirmada*:`,
    '',
    `🗓️ ${capitalize(formatDateEs(appointment.appointment_date))} — ${formatTimeEs(appointment.appointment_time)}`,
    `🦷 ${appointment.treatment || 'Evaluación'}`,
    ...(appointment.specialist ? [`👩‍⚕️ ${appointment.specialist}`] : []),
    `📍 ${clinic.address}`,
    `🔖 Código: *${appointment.code}*`,
    '',
    'Te enviamos tu pase de cita 👆 y te recordaremos por aquí antes de tu cita. Si no puedes asistir, escribe "reprogramar".',
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
