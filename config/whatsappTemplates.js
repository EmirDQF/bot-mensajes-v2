// Plantillas de WhatsApp (Meta) que el código usa por nombre fuera de la ventana de 24 h.
// El texto exacto para enviarlas a aprobación está en docs/whatsapp-templates.md.
// Si Meta aprueba otro nombre, cámbialo aquí o con la variable de entorno indicada.

const env = (key, fallback) => process.env[key] || fallback;

export const TEMPLATES = {
  reminder24h: {
    name: env('WA_TEMPLATE_REMINDER_24H', 'recordatorio_cita_24h'),
    language: 'es',
    // {{1}} nombre · {{2}} clínica · {{3}} tratamiento · {{4}} día · {{5}} hora · {{6}} dirección
    params: ({ patient, clinicName, treatment, day, time, address }) => [patient, clinicName, treatment, day, time, address],
  },
  reminder2h: {
    name: env('WA_TEMPLATE_REMINDER_2H', 'recordatorio_cita_2h'),
    language: 'es',
    // {{1}} nombre · {{2}} clínica · {{3}} hora · {{4}} dirección
    params: ({ patient, clinicName, time, address }) => [patient, clinicName, time, address],
  },
  reactivation: {
    name: env('WA_TEMPLATE_REACTIVATION', 'reactivacion_paciente'),
    language: 'es',
    // {{1}} clínica · {{2}} campaña
    params: ({ clinicName, campaign }) => [clinicName, campaign],
  },
  review: {
    name: env('WA_TEMPLATE_REVIEW', 'solicitud_resena'),
    language: 'es',
    // {{1}} nombre · {{2}} clínica · {{3}} enlace de reseña
    params: ({ patient, clinicName, reviewUrl }) => [patient, clinicName, reviewUrl],
  },
  dailySummary: {
    name: env('WA_TEMPLATE_DAILY_SUMMARY', 'resumen_diario'),
    language: 'es',
    // {{1}} fecha · {{2}} fuera de horario · {{3}} citas creadas · {{4}} citas hoy · {{5}} leads sin agendar · {{6}} mejor anuncio
    params: ({ date, afterHours, created, today, unbooked, topAd }) => [date, afterHours, created, today, unbooked, topAd],
  },
};

export default TEMPLATES;
