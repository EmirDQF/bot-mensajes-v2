// config/catalogo.js

// URL base absoluta para servir las imágenes
const BASE_URL = (process.env.RENDER_EXTERNAL_URL || 'https://bot-reumatologia-cqpharma.onrender.com').replace(/\/+$/, '') + '/media/';

const CATALOGO_LUMINZU = {
  ortodoncia: BASE_URL + 'bracketsmuestra.jpeg',
  brackets: BASE_URL + 'bracketsmuestra.jpeg',
  aparato: BASE_URL + 'bracketsmuestra.jpeg',
  invisalign: BASE_URL + 'bracketsmuestra.jpeg',

  ortodoncia_1: BASE_URL + 'ortodoncia_antes_1.jpeg',
  ortodoncia_2: BASE_URL + 'ortodoncia_antes_2.jpeg',
  ortodoncia_3: BASE_URL + 'ortodoncia_antes_3.jpeg',
  ortodoncia_4: BASE_URL + 'ortodoncia_antes_4.jpeg',
  ortodoncia_5: BASE_URL + 'ortodoncia_antes_5.jpeg',

  blanqueamiento: BASE_URL + 'blanqueamiento.jpeg',

  carillas: BASE_URL + 'carillas.jpeg',
  estetica: BASE_URL + 'carillas.jpeg',

  endodoncia: BASE_URL + 'endodoncia.jpeg',

  implante: BASE_URL + 'implantes.jpeg',
  implantes: BASE_URL + 'implantes.jpeg',

  limpieza: BASE_URL + 'chequeo.jpeg',
  chequeo: BASE_URL + 'chequeo.jpeg',
  kit_preventivo: BASE_URL + 'kit_preventivo.jpeg',
  preventivo: BASE_URL + 'kit_preventivo.jpeg',

  odontopediatria: BASE_URL + 'odontopediatria.jpeg',
  niños: BASE_URL + 'odontopediatria.jpeg',

  protesis: BASE_URL + 'protesis.jpeg',

  restauracion: BASE_URL + 'restauracion_resina.jpeg',
  resina: BASE_URL + 'restauracion_resina.jpeg',
  curaciones: BASE_URL + 'restauracion_resina.jpeg',

  tratamientos: BASE_URL + 'tratamientos.jpeg',

  ubicacion: BASE_URL + 'ubicacion.jpeg',
  direccion: BASE_URL + 'ubicacion.jpeg',
  fachada: BASE_URL + 'fachada.jpeg',

  promo: BASE_URL + 'promo_consulta.jpeg',

  extraccion: BASE_URL + 'extraccion.jpeg',
  periodoncia: BASE_URL + 'periodoncia.jpeg',
  corona: BASE_URL + 'corona.jpeg',
  gingivectomia: BASE_URL + 'gingivectomia.jpeg',
  evaluacion: BASE_URL + 'evaluacion.jpeg',

  default: BASE_URL + 'logo.jpeg',
  logo: BASE_URL + 'logo.jpeg',
};

// Exportación dual compatible con CommonJS y ESM
export { CATALOGO_LUMINZU };
export default CATALOGO_LUMINZU;