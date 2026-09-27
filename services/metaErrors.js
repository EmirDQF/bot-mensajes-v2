// Motivos legibles para recepción cuando Meta rechaza o no entrega un mensaje.
// Códigos: https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes

const REASONS = {
  131047: 'Fuera de la ventana de 24 h: el paciente no escribe hace más de un día. Solo se puede enviar una plantilla aprobada.',
  131026: 'No se pudo entregar: el número no tiene WhatsApp o no aceptó las condiciones actuales de WhatsApp.',
  131049: 'Meta no lo entregó para cuidar la experiencia del usuario (límite de mensajes de marketing).',
  131051: 'Tipo de mensaje no admitido.',
  131052: 'No se pudo descargar la foto o archivo del paciente.',
  131053: 'No se pudo subir la foto o archivo.',
  131056: 'Demasiados mensajes seguidos a este número: espera un momento y vuelve a intentar.',
  131031: 'La cuenta de WhatsApp Business está restringida o bloqueada: revisa el Administrador de WhatsApp de Meta.',
  131042: 'Problema de pago en la cuenta de Meta: registra o revisa la tarjeta en el Administrador de WhatsApp.',
  131021: 'No puedes enviarte mensajes a ti mismo (el número del bot).',
  132000: 'La plantilla no tiene la cantidad correcta de variables.',
  132001: 'La plantilla no existe o aún no está aprobada en este idioma.',
  132015: 'La plantilla está en pausa por baja calidad.',
  190: 'El token de WhatsApp venció: genera uno permanente (docs/go-live.md).',
  368: 'Meta bloqueó temporalmente la cuenta por infringir políticas.',
  80007: 'Se alcanzó el límite de mensajes de la cuenta: espera o sube el límite en Meta.',
};

export function describeMetaError(error) {
  if (!error) return 'Meta no entregó el mensaje (sin detalle).';
  const code = Number(error.code);
  const known = REASONS[code];
  if (known) return `${known} (código ${code})`;
  const detail = error.error_data?.details || error.message || error.title || 'sin detalle';
  return `Meta rechazó el mensaje: ${String(detail).slice(0, 200)}${Number.isFinite(code) ? ` (código ${code})` : ''}`;
}

export default describeMetaError;
