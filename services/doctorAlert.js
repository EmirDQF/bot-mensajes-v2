import activeClinic, { findTreatments, getDoctorPhone, getReceptionPhone, reminderHours } from '../config/clinic.config.js';
import TEMPLATES from '../config/whatsappTemplates.js';
import jobs from './jobsService.js';
import { slotLabel } from './appointmentService.js';
import { conversationLink, patientCardLines, reminderStatusText } from './patientCard.js';
import { describeError } from './safeLog.js';

// Alerta al doctor (DOCTOR_ALERT_PHONE) con la ficha corta de la cita: nueva cita y "el paciente confirmó".
// Dentro de la ventana de 24 h va como texto; fuera, con la plantilla de utilidad ficha_cita_doctor.
// Sin DOCTOR_ALERT_PHONE (o si es el mismo número de recepción) no se envía: recepción ya recibe la ficha.

const EVENTS = {
  nueva: (apt) => (apt.status === 'confirmada' && apt.confirmed_by === 'bot' ? 'Nueva cita confirmada' : 'Nueva solicitud de cita'),
  confirmada: () => 'El paciente confirmó su asistencia',
};

// Interés: solo nombres de tratamientos de la configuración mencionados en la cita o la conversación.
export function interestOf(appointment, texts = [], clinic = activeClinic) {
  const names = findTreatments([appointment.treatment, ...texts].filter(Boolean).join('\n')).map((t) => t.name);
  const unique = [...new Set(names)];
  return unique.length ? unique : [appointment.treatment || 'Evaluación'].filter(Boolean);
}

export function doctorCardText(appointment, { event = 'nueva', interest = [], clinic = activeClinic } = {}) {
  const when = slotLabel({ date: appointment.appointment_date, time: appointment.appointment_time });
  return [
    `🩺 ${(EVENTS[event] || EVENTS.nueva)(appointment)} — ${clinic.name}`,
    ...patientCardLines({ appointment, interest, when, hours: reminderHours(clinic) }),
  ].join('\n');
}

// Nunca lanza. Devuelve { sent, reason? }.
export async function notifyDoctor(appointment, { event = 'nueva', interest = [], send = jobs.sendWithWindow, clinic = activeClinic } = {}) {
  const to = getDoctorPhone();
  if (!to || to === getReceptionPhone()) return { sent: false, reason: 'no_doctor_phone' };
  const when = slotLabel({ date: appointment.appointment_date, time: appointment.appointment_time });
  const template = TEMPLATES.doctorCard;
  try {
    await send(to, {
      text: doctorCardText(appointment, { event, interest, clinic }),
      template,
      params: template.params({
        clinicName: clinic.name,
        event: (EVENTS[event] || EVENTS.nueva)(appointment),
        patient: appointment.patient_name || 'Sin nombre',
        interest: (interest.length ? interest : [appointment.treatment || 'Evaluación']).join(' + '),
        when: `${when}${appointment.code ? ` (${appointment.code})` : ''}`,
        reminder: reminderStatusText(appointment, reminderHours(clinic)),
        link: conversationLink(appointment.sender_phone),
      }),
    });
    return { sent: true };
  } catch (error) {
    console.error('[Doctor] No se pudo enviar la ficha de la cita:', describeError(error));
    return { sent: false, reason: 'send_failed' };
  }
}

export default { notifyDoctor, doctorCardText, interestOf };
