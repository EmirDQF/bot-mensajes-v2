import { getPublicBaseUrl } from '../config/clinic.config.js';

// Ficha corta del paciente para el doctor o recepción. Solo datos de la cita y nombres de tratamientos de la
// configuración: nunca síntomas, diagnósticos ni el texto libre del paciente.

const digits = (phone) => String(phone || '').replace(/\D/g, '');

// Enlace que abre la conversación en el panel (pide iniciar sesión; no expone datos por sí mismo).
export const conversationLink = (phone) => `${getPublicBaseUrl()}/panel#chat=${digits(phone)}`;

const hoursText = (h) => `${h} h`;

// "programado (48 h y 2 h antes)", "enviado ✅", "el paciente confirmó ✅"…
export function reminderStatusText(appointment, { firstHours, secondHours }) {
  if (appointment.reminder_reply === 'confirmo') return 'el paciente confirmó su asistencia ✅';
  if (appointment.reminder_reply === 'reprogramar') return 'el paciente pidió reprogramar 🔁';
  if (appointment.reminder_2h_sent_at) return `enviados (${[firstHours, secondHours].filter(Boolean).map(hoursText).join(' y ')} antes) ✅`;
  if (appointment.reminder_24h_sent_at) return `enviado el de ${hoursText(firstHours)}; falta el de ${hoursText(secondHours)}`;
  const planned = [firstHours, secondHours].filter(Boolean);
  return planned.length ? `programado (${planned.map(hoursText).join(' y ')} antes) ✅` : 'sin recordatorio (desactivado en Configuración)';
}

// Líneas de la ficha. `when` ya viene formateado ("jueves, 5 de noviembre a las 4:30 p. m.").
export function patientCardLines({ appointment, interest = [], when, hours }) {
  return [
    `👤 Paciente: ${appointment.patient_name || 'Sin nombre'}`,
    `🦷 Interés: ${interest.length ? interest.join(' + ') : appointment.treatment || 'Evaluación'}`,
    `📅 Cita: ${when}${appointment.code ? ` (${appointment.code})` : ''}`,
    ...(appointment.specialist ? [`👩‍⚕️ Especialista: ${appointment.specialist}`] : []),
    `🔔 Recordatorio: ${reminderStatusText(appointment, hours)}`,
    `💬 Conversación: ${conversationLink(appointment.sender_phone)}`,
  ];
}

export default { conversationLink, reminderStatusText, patientCardLines };
