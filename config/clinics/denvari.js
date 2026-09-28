// Clínica 100% ficticia para demos comerciales.
// Para dar de alta una clínica real: copia este archivo como <id>.js, cambia los datos
// e imágenes (media/<id>/) y define ACTIVE_CLINIC=<id>. Los teléfonos NO van aquí:
// se leen de CLINIC_PHONE, RECEPTION_ALERT_PHONE y OWNER_ALERT_PHONE.

export default {
  id: 'denvari',
  name: 'Clínica Dental Denvari',
  botName: 'Camila',
  city: 'Lima',
  address: 'Calle Las Orquídeas 450, San Isidro, Lima (dirección de demostración)',
  mapsUrl: 'https://maps.google.com/?q=Calle+Las+Orqu%C3%ADdeas+450+San+Isidro+Lima',
  // Opcional: enlace de reseñas de Google. Si existe, al marcar "asistió" en el panel se pide una reseña.
  reviewUrl: null,
  timezone: 'America/Lima',

  // Rangos [inicio, fin] en formato HH:MM por día. Día sin rangos = cerrado.
  workingHours: {
    mon: [['09:00', '20:00']],
    tue: [['09:00', '20:00']],
    wed: [['09:00', '20:00']],
    thu: [['09:00', '20:00']],
    fri: [['09:00', '20:00']],
    sat: [['09:00', '14:00']],
    sun: [],
  },
  workingHoursText: 'Lunes a viernes de 9:00 a. m. a 8:00 p. m. y sábados de 9:00 a. m. a 2:00 p. m.',
  slotMinutes: 30,

  welcomeCaption: `¡Hola! 👋 Te damos la bienvenida a Clínica Dental Denvari 🦷✨

Soy Camila, tu asistente virtual. Este mes tenemos campaña: evaluación digital 3D sin costo, cuota inicial S/ 0 y pago en cuotas.

Cuéntame:
👉 ¿Qué tratamiento o molestia dental quieres solucionar?
👉 ¿O prefieres que te proponga de una vez horarios para tu evaluación? 📅`,

  privacyNotice: '🔒 Aviso de privacidad (Ley 29733): guardamos tu nombre, número y los datos de tu cita solo para agendarte y recordarte tu atención. Puedes pedir que los eliminemos escribiendo "borrar mis datos".',

  campaign: {
    evaluation: 'Evaluación digital 3D sin costo',
    initialFee: 'Cuota inicial S/ 0',
    installments: 'Pago en cuotas sin intereses con tarjeta o en efectivo',
  },

  treatments: [
    {
      key: 'ortodoncia',
      name: 'Ortodoncia (brackets metálicos y estéticos)',
      priceFrom: 1800,
      durationMin: 60,
      financing: 'Cuota inicial S/ 0 y mensualidades desde S/ 150',
      synonyms: ['ortodoncia', 'brackets', 'bracket', 'bravkets', 'braquets', 'frenillos', 'frenos', 'aparatos', 'alineadores'],
    },
    {
      key: 'carillas',
      name: 'Carillas y diseño de sonrisa',
      priceFrom: 450,
      durationMin: 60,
      financing: 'Precio por pieza; pago en cuotas',
      synonyms: ['carillas', 'carilla', 'diseño de sonrisa', 'diseno de sonrisa', 'sonrisa', 'carrillas'],
    },
    {
      key: 'implantes',
      name: 'Implantes dentales',
      priceFrom: 2500,
      durationMin: 60,
      financing: 'Pago en cuotas tras la evaluación',
      synonyms: ['implantes', 'implante', 'inplante', 'inplantes', 'protesis', 'prótesis', 'diente postizo'],
    },
    {
      key: 'blanqueamiento',
      name: 'Blanqueamiento dental',
      priceFrom: 350,
      durationMin: 60,
      financing: 'Pago único o en 2 cuotas',
      synonyms: ['blanqueamiento', 'blanquear', 'blanqueamento', 'dientes blancos'],
    },
    {
      key: 'limpieza',
      name: 'Limpieza dental (profilaxis)',
      priceFrom: 80,
      durationMin: 30,
      financing: 'Pago único',
      synonyms: ['limpieza', 'limpiesa', 'profilaxis', 'sarro', 'destartraje'],
    },
    {
      key: 'odontopediatria',
      name: 'Odontopediatría (niños)',
      priceFrom: 60,
      durationMin: 30,
      financing: 'Pago único',
      synonyms: ['odontopediatria', 'odontopediatría', 'niños', 'niño', 'hijo', 'hija', 'bebe', 'bebé'],
    },
    {
      key: 'endodoncia',
      name: 'Endodoncia (tratamiento de conducto)',
      priceFrom: 350,
      durationMin: 60,
      financing: 'Pago en cuotas',
      synonyms: ['endodoncia', 'conducto', 'nervio', 'endodonsia'],
    },
    {
      key: 'extraccion',
      name: 'Extracción dental',
      priceFrom: 80,
      durationMin: 30,
      financing: 'Pago único',
      synonyms: ['extraccion', 'extracción', 'sacar muela', 'muela del juicio', 'estraccion'],
    },
  ],

  // Archivos dentro de media/<id>/. Claves de tratamiento = treatments[].key.
  media: {
    logo: 'logo.png',
    fachada: 'fachada.png',
    ubicacion: 'ubicacion.png',
    ortodoncia: 'ortodoncia.png',
    carillas: 'carillas.png',
    implantes: 'implantes.png',
    blanqueamiento: 'blanqueamiento.png',
    limpieza: 'limpieza.png',
    odontopediatria: 'odontopediatria.png',
    endodoncia: 'endodoncia.png',
    extraccion: 'extraccion.png',
  },

  // Tono de la asistente ('cercano' | 'formal' | 'juvenil') y emojis ('pocos' | 'ninguno' | 'normal').
  tone: 'cercano',
  emojiLevel: 'pocos',

  // Venta consultiva sin diagnosticar: si el paciente cuenta algo así, se recomienda una EVALUACIÓN
  // ("por lo que me cuentas, lo indicado es una evaluación de X; el doctor confirma el mejor tratamiento").
  // Dolor fuerte, hinchazón, fiebre o golpe siempre pasan antes a urgencia. Editables en el panel.
  // priority (opcional, 0-10): si coinciden varias reglas, gana la mayor.
  recommendationRules: [
    {
      id: 'ortodoncia',
      triggers: ['chuecos', 'chueco', 'chuecas', 'torcidos', 'torcido', 'apiñados', 'apiñado', 'amontonados', 'separados', 'separacion', 'dientes separados', 'mordida'],
      evaluation: 'ortodoncia (brackets o alineadores)',
      treatmentKey: 'ortodoncia',
      question: '¿Lo buscas más por estética o por la mordida?',
    },
    {
      id: 'implante',
      triggers: ['me falta un diente', 'me falta una muela', 'me faltan dientes', 'perdi un diente', 'perdi una muela', 'sin un diente', 'me sacaron un diente', 'me sacaron una muela'],
      evaluation: 'implante dental',
      treatmentKey: 'implantes',
    },
    {
      id: 'blanqueamiento',
      triggers: ['amarillos', 'amarillo', 'amarillentos', 'manchas', 'manchados', 'manchado', 'oscuros', 'dientes blancos', 'sonrisa blanca'],
      evaluation: 'blanqueamiento dental',
      treatmentKey: 'blanqueamiento',
    },
    {
      id: 'periodontal',
      triggers: ['sangran las encias', 'sangrado de encias', 'me sangran', 'encias sangran', 'sangran al cepillarme', 'sangrado', 'sangran'],
      evaluation: 'encías (periodontal)',
      treatmentKey: 'limpieza',
    },
    {
      id: 'evento',
      triggers: ['boda', 'matrimonio', 'graduacion', 'quinceañero', 'evento', 'fiesta'],
      evaluation: 'diseño de sonrisa o blanqueamiento',
      treatmentKey: 'carillas',
      question: '¿Para qué fecha es tu evento?',
    },
    {
      id: 'ninos',
      triggers: ['mi hijo', 'mi hija', 'mi niño', 'mi niña', 'mi bebe', 'para un niño', 'para una niña', 'niños'],
      evaluation: 'odontopediatría',
      treatmentKey: 'odontopediatria',
      priority: 1, // si habla de su hijo, manda odontopediatría aunque mencione "chuecos
      question: '¿Qué edad tiene?',
    },
  ],

  paymentMethods: ['Tarjetas de crédito y débito', 'Yape y Plin', 'Efectivo'],

  // Colores del panel (hex). Opcional.
  colors: { primary: '#0f766e', accent: '#14b8a6' },

  // Respuestas rápidas de recepción en la bandeja del panel.
  quickReplies: [
    '¡Hola! Te escribe recepción 😊 ¿En qué te ayudo?',
    'Te confirmo tu cita. Te esperamos 10 minutos antes, por favor.',
    'Para darte el precio exacto necesitamos la evaluación. ¿Qué día te acomoda?',
    'Gracias por escribirnos. En unos minutos te respondemos.',
  ],

  faq: [
    { q: '¿La evaluación tiene costo?', a: 'No. La evaluación digital 3D es sin costo durante la campaña.' },
    { q: '¿Aceptan tarjeta?', a: 'Sí, aceptamos tarjetas, Yape, Plin y efectivo.' },
    { q: '¿Atienden niños?', a: 'Sí, tenemos odontopediatría para niños desde los 3 años.' },
    { q: '¿Hay estacionamiento?', a: 'Hay estacionamiento público a media cuadra.' },
  ],
};
