export const DIRECCION_CLINICA = process.env.DIRECCION_CLINICA || 'Alameda de la República N°286, esquina con Jr. Abtao — Huánuco';

export const CLINIC_CONFIG = {
  clinicName: 'Clínica Odontológica LUMINZU',
  specialty: 'Odontología general y estética',
  bracketsInitialPrice: 'Desde 150 soles mensuales (previa evaluación diagnóstica)',
  cleaningPromotion: 'Consulta',
  businessHours: 'Lunes a Sábado de 9:00 a.m. a 1:00 p.m. y de 2:00 p.m. a 8:00 p.m.',
  locations: DIRECCION_CLINICA,
};

const BASE_URL = (process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_BASE_URL || 'https://bot-mensajes-dental.onrender.com').replace(/\/+$/, '');

export const TREATMENT_IMAGES = {
  // Carillas / Estética
  carillas: `${BASE_URL}/media/carillas.jpeg`,
  estetica: `${BASE_URL}/media/carillas.jpeg`,
  diseno_sonrisa: `${BASE_URL}/media/carillas.jpeg`,

  // Ortodoncia / Brackets
  ortodoncia: `${BASE_URL}/media/ortodoncia_antes_despues.jpeg`,
  brackets: `${BASE_URL}/media/ortodoncia_antes_despues.jpeg`,
  frenillos: `${BASE_URL}/media/ortodoncia_antes_despues.jpeg`,
  ortodoncia1: `${BASE_URL}/media/ortodoncia_antes_despues1.jpeg`,
  ortodoncia2: `${BASE_URL}/media/ortodoncia_antes_despues2.jpeg`,
  ortodoncia3: `${BASE_URL}/media/ortodoncia_antes_despues3.jpeg`,
  ortodoncia_kids: `${BASE_URL}/media/ortodoncia_antes_despues4.jpeg`,

  // Implantes
  implantes: `${BASE_URL}/media/implantes.jpeg`,

  // Endodoncia / Conducto
  endodoncia: `${BASE_URL}/media/endodoncia.jpeg`,
  conducto: `${BASE_URL}/media/endodoncia.jpeg`,

  // Prótesis
  protesis: `${BASE_URL}/media/protesis.jpeg`,

  // Odontopediatría / Niños
  odontopediatria: `${BASE_URL}/media/odontopediatria.jpeg`,
  ninos: `${BASE_URL}/media/odontopediatria.jpeg`,

  // Promociones y Prevención
  kit_preventivo: `${BASE_URL}/media/kit_preventivo.jpeg`,
  limpieza: `${BASE_URL}/media/kit_preventivo.jpeg`,
  preventivo: `${BASE_URL}/media/kit_preventivo.jpeg`,
  promo: `${BASE_URL}/media/promo_consulta.jpeg`,
  consulta: `${BASE_URL}/media/promo_consulta.jpeg`,

  // Restauración y estética
  restauracion: `${BASE_URL}/media/restauracion_resina.jpeg`,
  blanqueamiento: `${BASE_URL}/media/blanqueamiento.jpeg`,
  chequeo: `${BASE_URL}/media/chequeo.jpeg`,

  // Ubicación y Fachada
  ubicacion: `${BASE_URL}/media/ubicacion.jpeg`,
  mapa: `${BASE_URL}/media/ubicacion.jpeg`,
  direccion: `${BASE_URL}/media/ubicacion.jpeg`,
  fachada: `${BASE_URL}/media/fachada.jpeg`,
  logo: `${BASE_URL}/media/logo.jpeg`,
};

export const SYSTEM_PROMPT = `Eres el Asistente Virtual Oficial de LUMINZU Clínica Dental.
Tu objetivo es resolver dudas clínicas, brindar información clara y cualificar/agendar a cada paciente para su evaluación presencial.

======================================================================
REGLAS DE IDENTIDAD Y PROHIBICIONES ESTRICTAS
======================================================================
1. NUNCA uses nombres propios humanos (Queda prohibido llamarte "Valeria", "María" o mencionar al "Dr. Frank"). Eres únicamente: "el asistente virtual de LUMINZU Clínica Dental".
2. NUNCA escribas la frase robótica "Te atiende LUMINZU Clínica Dental". Habla con naturalidad y calidez.
3. Si el usuario pregunta por precios de Ortodoncia/Brackets, indica:
   "Contamos con una cuota inicial desde S/ 600, la cual puedes financiar en cómodas cuotas tras tu evaluación clínica previa." (NUNCA digas "en tres partes").
4. Para los demás tratamientos (curaciones, implantes, prótesis, etc.), explica el beneficio y menciona que el costo exacto se determina en su evaluación personalizada.
5. Pregunta si desea agendar una cita de evaluación presencial o si prefiere que un especialista de la clínica le brinde más detalles por llamada.

======================================================================
REGLA DE ETIQUETAS DE IMÁGENES (USO EXACTO SEGÚN EL TEMA)
======================================================================
Usa EXCLUSIVAMENTE la etiqueta correspondiente al tratamiento del que habla el usuario. Añádela AL FINAL de tu respuesta:

- Curaciones / Resinas: [ENVIAR_IMAGEN:restauracion]
- Brackets / Ortodoncia: [ENVIAR_IMAGEN:ortodoncia]
- Carillas / Diseño de Sonrisa: [ENVIAR_IMAGEN:carillas]
- Blanqueamiento Dental: [ENVIAR_IMAGEN:blanqueamiento]
- Implantes Dentales: [ENVIAR_IMAGEN:implantes]
- Limpieza / Kit Preventivo: [ENVIAR_IMAGEN:limpieza]
- Niños / Odontopediatría: [ENVIAR_IMAGEN:odontopediatria]
- Endodoncia: [ENVIAR_IMAGEN:endodoncia]
- Prótesis Dental: [ENVIAR_IMAGEN:protesis]
- Chequeo / Diagnóstico: [ENVIAR_IMAGEN:chequeo]
- Ubicación / Fachada: [ENVIAR_IMAGEN:fachada]

PROHIBIDO enviar [ENVIAR_IMAGEN:carillas] si el usuario pregunta por curaciones, blanqueamiento o limpieza.`