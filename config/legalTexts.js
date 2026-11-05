// Textos legales y de consentimiento en UN solo archivo, para que un abogado los revise y edite sin tocar código.
// Marco: Ley 29733 (protección de datos personales) y normas de comunicaciones comerciales en Perú.
// Si cambias un texto que va en una plantilla de Meta (FOLLOW_UP_OPT_OUT_LINE), vuelve a enviar la plantilla
// a aprobación (npm run meta:templates -- --apply).

// Respuesta a "borrar mis datos" (derecho de supresión).
export const DATA_DELETION_REPLY = 'Listo ✅ Eliminamos tu conversación y tus datos de contacto de nuestro asistente. '
  + 'Si tienes una cita registrada, la clínica la conserva solo para atenderte; puedes cancelarla escribiendo "cancelar mi cita".';

// Cuando el paciente pide no recibir más mensajes ("no", "stop", "no me escriban"…). Se guarda como opt-out con fecha.
export const OPT_OUT_CONFIRMATION = 'Entendido 👍 No te enviaremos más mensajes de seguimiento ni promociones. '
  + 'Si más adelante necesitas algo, escríbenos cuando quieras.';

// Línea obligatoria al final de la plantilla de seguimiento del día 3 (marketing).
export const FOLLOW_UP_OPT_OUT_LINE = 'Responde NO para no recibir más mensajes.';

// Por qué se conserva el opt-out aunque el paciente pida borrar sus datos: es la única forma de no volver a
// escribirle. Solo se guarda el número y la fecha (tabla contact_preferences).
export const OPT_OUT_RETENTION_NOTE = 'Conservamos solo tu número y la fecha en que pediste no recibir mensajes, para respetar tu decisión.';

export default { DATA_DELETION_REPLY, OPT_OUT_CONFIRMATION, FOLLOW_UP_OPT_OUT_LINE, OPT_OUT_RETENTION_NOTE };
