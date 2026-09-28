// Plantillas de WhatsApp (Meta) que el código usa por nombre fuera de la ventana de 24 h.
// El texto exacto para enviarlas a aprobación está en docs/whatsapp-templates.md.
// Si Meta aprueba otro nombre, cámbialo aquí o con la variable de entorno indicada.
// body/category/buttons/example son lo que npm run meta:templates envía a aprobación (idioma "es"; Meta
// no ofrece es_PE). Los ejemplos salen de la clínica activa (c): cero datos fijos de un cliente.

const env = (key, fallback) => process.env[key] || fallback;

export const TEMPLATES = {
  reminder24h: {
    name: env('WA_TEMPLATE_REMINDER_24H', 'recordatorio_cita_24h'),
    language: 'es',
    // {{1}} nombre · {{2}} clínica · {{3}} tratamiento · {{4}} día · {{5}} hora · {{6}} dirección
    params: ({ patient, clinicName, treatment, day, time, address }) => [patient, clinicName, treatment, day, time, address],
    category: 'UTILITY',
    body: 'Hola {{1}} 👋 Te recordamos tu cita en {{2}} para {{3}} el {{4}} a las {{5}}. 📍 Dirección: {{6}}. ¿Nos confirmas tu asistencia?',
    buttons: ['Confirmo', 'Reprogramar'],
    example: (c) => ['Ana', c.name, c.treatments[0]?.name || 'Evaluación', 'martes, 29 de setiembre', '10:00 a. m.', c.address],
  },
  reminder2h: {
    name: env('WA_TEMPLATE_REMINDER_2H', 'recordatorio_cita_2h'),
    language: 'es',
    // {{1}} nombre · {{2}} clínica · {{3}} hora · {{4}} dirección
    params: ({ patient, clinicName, time, address }) => [patient, clinicName, time, address],
    category: 'UTILITY',
    body: 'Hola {{1}}, tu cita en {{2}} es hoy a las {{3}}. 📍 Dirección: {{4}}. Si no podrás llegar, toca Reprogramar y te ofrecemos otro horario.',
    buttons: ['Confirmo', 'Reprogramar'],
    example: (c) => ['Ana', c.name, '10:00 a. m.', c.address],
  },
  reactivation: {
    name: env('WA_TEMPLATE_REACTIVATION', 'reactivacion_paciente'),
    language: 'es',
    // {{1}} clínica · {{2}} campaña
    params: ({ clinicName, campaign }) => [clinicName, campaign],
    // Retoma comercial: Meta la clasifica como MARKETING (como UTILITY la rechazaría o la reclasificaría).
    category: 'MARKETING',
    body: 'Hola 👋 Te escribimos de {{1}}. Seguimos con nuestra campaña: {{2}}. ¿Quieres que te propongamos 3 horarios para tu evaluación? Responde "quiero una cita".',
    buttons: ['Quiero una cita'],
    example: (c) => [c.name, [c.campaign?.evaluation, c.campaign?.initialFee].filter(Boolean).join(' y ') || 'Evaluación sin costo'],
  },
  review: {
    name: env('WA_TEMPLATE_REVIEW', 'solicitud_resena'),
    language: 'es',
    // {{1}} nombre · {{2}} clínica · {{3}} enlace de reseña
    params: ({ patient, clinicName, reviewUrl }) => [patient, clinicName, reviewUrl],
    category: 'MARKETING',
    body: '¡Gracias por visitarnos, {{1}}! 🦷 En {{2}} nos ayudaría mucho conocer tu opinión. Déjanos tu reseña aquí: {{3}} ¡Gracias por tu tiempo!',
    example: (c) => ['Ana', c.name, c.reviewUrl || 'https://g.page/r/tu-clinica/review'],
  },
  dailySummary: {
    name: env('WA_TEMPLATE_DAILY_SUMMARY', 'resumen_diario'),
    language: 'es',
    // {{1}} fecha · {{2}} fuera de horario · {{3}} citas creadas · {{4}} citas hoy · {{5}} leads sin agendar · {{6}} mejor anuncio
    // {{7}} citas solicitadas con la clínica cerrada
    params: ({ date, afterHours, created, today, unbooked, topAd, afterHoursAppointments }) => [
      date, afterHours, created, today, unbooked, topAd, afterHoursAppointments,
    ],
    category: 'UTILITY',
    body: '📊 Resumen del {{1}}. Consultas fuera de horario: {{2}}. Citas creadas: {{3}}. Citas para hoy: {{4}}. Leads sin agendar: {{5}}. Anuncio con más citas: {{6}}. Citas solicitadas con la clínica cerrada: {{7}}. Revisa el detalle en tu panel.',
    example: () => ['lunes, 28 de setiembre', '7', '4', '6', '3', 'Brackets (2 citas)', '2'],
  },
  weeklyReport: {
    name: env('WA_TEMPLATE_WEEKLY_REPORT', 'reporte_semanal'),
    language: 'es',
    // {{1}} rango · {{2}} conversaciones · {{3}} fuera de horario · {{4}} citas solicitadas · {{5}} confirmadas · {{6}} línea de garantía
    params: ({ range, conversations, afterHours, requested, confirmed, guarantee }) => [
      range, conversations, afterHours, requested, confirmed, guarantee,
    ],
    category: 'UTILITY',
    body: '📈 Reporte semanal del {{1}}. Conversaciones: {{2}} ({{3}} fuera de horario). Citas solicitadas: {{4}}. Confirmadas: {{5}}. Garantía: {{6}}. Revisa el detalle e imprime el reporte en tu panel, pestaña Reporte.',
    example: () => ['lunes, 21 de setiembre al domingo, 27 de setiembre', '34', '14', '9', '5', 'Citas de evaluación confirmadas: 5 / meta 2 → cumplido'],
  },
};

export default TEMPLATES;
