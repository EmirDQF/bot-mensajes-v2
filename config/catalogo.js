// config/catalogo.js

// URL base absoluta para servir las imágenes
const BASE_URL = (process.env.RENDER_EXTERNAL_URL || 'https://bot-reumatologia-cqpharma.onrender.com').replace(/\/+$/, '') + '/media/';

// Array aparte (no dentro del objeto) porque dos claves distintas —
// "ortodoncia_antes_despues" y su alias "antesdespues"— deben apuntar
// exactamente a la MISMA lista de fotos, no a copias separadas.
const CASOS_ORTODONCIA_ANTES_DESPUES = [
  BASE_URL + 'ortodoncia_antes_despues.jpeg',
  BASE_URL + 'ortodoncia_antes_despues1.jpeg',
  BASE_URL + 'ortodoncia_antes_despues2.jpeg',
  BASE_URL + 'ortodoncia_antes_despues3.jpeg',
  BASE_URL + 'ortodoncia_antes_despues4.jpeg',
];

const CATALOGO_LUMINZU = {
  ortodoncia: BASE_URL + 'bracketsmuestra.jpeg',
  brackets: BASE_URL + 'bracketsmuestra.jpeg',
  aparato: BASE_URL + 'bracketsmuestra.jpeg',
  invisalign: BASE_URL + 'bracketsmuestra.jpeg',

  // Fotos de "antes" sueltas (sin pareja de "después"): se dejan igual,
  // son una familia distinta a los casos completos de abajo.
  ortodoncia_1: BASE_URL + 'ortodoncia_antes_1.jpeg',
  ortodoncia_2: BASE_URL + 'ortodoncia_antes_2.jpeg',
  ortodoncia_3: BASE_URL + 'ortodoncia_antes_3.jpeg',
  ortodoncia_4: BASE_URL + 'ortodoncia_antes_4.jpeg',
  ortodoncia_5: BASE_URL + 'ortodoncia_antes_5.jpeg',

  // NUEVO: casos completos antes/después. Es un array — cada vez que se pida
  // esta categoría, el bot rota entre las 5 fotos en vez de repetir siempre
  // la misma. Cubre lo que pide el SYSTEM_PROMPT ("Ortodoncia resultados o
  // casos clínicos") y lo que preguntó el cliente en el video de prueba
  // ("fotos de casos similares que hayan arreglado").
  ortodoncia_antes_despues: CASOS_ORTODONCIA_ANTES_DESPUES,
  // Alias: el SYSTEM_PROMPT también usa esta otra etiqueta para "antes y
  // después de estética dental general" — apunta al mismo array, sin
  // duplicar las URLs.
  antesdespues: CASOS_ORTODONCIA_ANTES_DESPUES,

  blanqueamiento: BASE_URL + 'blanqueamiento.jpeg',

  carillas: BASE_URL + 'carillas.jpeg',
  estetica: BASE_URL + 'carillas.jpeg',

  endodoncia: BASE_URL + 'endodoncia.jpeg',

  implante: BASE_URL + 'implantes.jpeg',
  implantes: BASE_URL + 'implantes.jpeg',
  // NUEVO: el SYSTEM_PROMPT pide esta etiqueta para "Implantes dentales"
  // y no existía la clave — caía siempre al logo.
  implantesdentales: BASE_URL + 'implantes.jpeg',

  limpieza: BASE_URL + 'chequeo.jpeg',
  chequeo: BASE_URL + 'chequeo.jpeg',
  kit_preventivo: BASE_URL + 'kit_preventivo.jpeg',
  preventivo: BASE_URL + 'kit_preventivo.jpeg',

  odontopediatria: BASE_URL + 'odontopediatria.jpeg',
  niños: BASE_URL + 'odontopediatria.jpeg',
  // NUEVO: no hay foto dedicada a "ortodoncia para niños", se reutiliza
  // la de odontopediatría por ser la más cercana semánticamente.
  ortodonciakids: BASE_URL + 'odontopediatria.jpeg',
  // NUEVO: "curaciones en niños" — mismo criterio, reutiliza la foto
  // de restauración/resina ya que no existe una imagen específica.
  odontopediatricuracion: BASE_URL + 'restauracion_resina.jpeg',

  protesis: BASE_URL + 'protesis.jpeg',

  restauracion: BASE_URL + 'restauracion_resina.jpeg',
  resina: BASE_URL + 'restauracion_resina.jpeg',
  curaciones: BASE_URL + 'restauracion_resina.jpeg',
  // NUEVO: el SYSTEM_PROMPT usa literalmente esta etiqueta para
  // "Curaciones o calzas estéticas" y no existía como clave.
  restauracion_resina: BASE_URL + 'restauracion_resina.jpeg',

  tratamientos: BASE_URL + 'tratamientos.jpeg',

  ubicacion: BASE_URL + 'ubicacion.jpeg',
  direccion: BASE_URL + 'ubicacion.jpeg',
  fachada: BASE_URL + 'fachada.jpeg',

  promo: BASE_URL + 'promo_consulta.jpeg',
  // NUEVO: el SYSTEM_PROMPT pide "promo_consulta" (con guion bajo) para
  // "Promociones, ofertas o costo de consulta" — clave distinta a "promo".
  promo_consulta: BASE_URL + 'promo_consulta.jpeg',

  extraccion: BASE_URL + 'extraccion.jpeg',
  periodoncia: BASE_URL + 'periodoncia.jpeg',
  corona: BASE_URL + 'corona.jpeg',
  gingivectomia: BASE_URL + 'gingivectomia.jpeg',
  evaluacion: BASE_URL + 'evaluacion.jpeg',
  // NUEVO: "Agendar, reservar o pedir cita" — se usa la foto de
  // evaluación porque agendar siempre deriva en una cita de evaluación.
  agendatuconsulta: BASE_URL + 'evaluacion.jpeg',
  // NUEVO: "Dolor de muela fuerte" — se usa evaluación porque el primer
  // paso ante dolor siempre es un diagnóstico, no un tratamiento fijo.
  tienesdolormuela: BASE_URL + 'evaluacion.jpeg',

  default: BASE_URL + 'logo.jpeg',
  logo: BASE_URL + 'logo.jpeg',
};

// Exportación dual compatible con CommonJS y ESM
export { CATALOGO_LUMINZU };
export default CATALOGO_LUMINZU;