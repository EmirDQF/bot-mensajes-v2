import clinic, { findTreatment } from '../config/clinic.config.js';
import { formatDateEs, formatTimeEs } from './appointmentService.js';

// Fase B del agendamiento: con nombre, tratamiento y horario ya reunidos, la respuesta es la SOLICITUD
// (regla 9: "Recepción te la confirmará"). En confirmación directa el webhook la reemplaza por la confirmación.

export function bookingSummary(lead, treatmentName) {
  return [
    `¡Listo, ${lead.nombre}! Tu solicitud de cita para ${treatmentName} el ${formatDateEs(lead.slot.date)} a las ${formatTimeEs(lead.slot.time)} quedó registrada en ${clinic.address}.`,
    clinic.addressReference ? `Referencia: ${clinic.addressReference}` : null,
    `Cómo llegar: ${clinic.mapsUrl}`,
    'Recepción te la confirmará.',
  ].filter(Boolean).join('\n');
}

// Marca la sesión como agendada y devuelve { texto, appointmentRequest } (el controlador guarda la cita).
export function bookFromLead(session, leadData) {
  const treatmentName = findTreatment(leadData.motivo)?.name || leadData.motivo;
  session.booked = true;
  session.offeredSlots = null;
  session.askedField = null;
  session.leadSnapshot = {
    ...leadData, fecha_hora_texto: leadData.fechaHora, fecha_hora_iso: leadData.fechaHoraISO || null, confirmedAt: new Date().toISOString(),
  };
  return {
    texto: bookingSummary(leadData, treatmentName),
    appointmentRequest: { nombre: leadData.nombre, tratamiento: treatmentName, fecha: leadData.slot.date, hora: leadData.slot.time },
  };
}

export default { bookingSummary, bookFromLead };
