// config/catalogo.js

// Define la URL base donde se sirven las imágenes
// Si tus imágenes están en public/images/, usa '/images/'
// Si están en otra carpeta, ajusta la ruta
const BASE_URL = process.env.IMAGE_BASE_URL || '/images/';

const CATALOGO_LUMINZU = {
  // --- ORTODONCIA / BRACKETS ---
  ortodoncia: BASE_URL + 'bracketsmuestra.jpg',
  brackets: BASE_URL + 'bracketsmuestra.jpg',
  aparato: BASE_URL + 'bracketsmuestra.jpg',
  invisalign: BASE_URL + 'bracketsmuestra.jpg',

  // --- BLANQUEAMIENTO ---
  blanqueamiento: BASE_URL + 'blanqueamiento.jpg',

  // --- CARILLAS ---
  carillas: BASE_URL + 'carillas.jpeg',

  // --- ENDODONCIA ---
  endodoncia: BASE_URL + 'endodoncia.jpeg',

  // --- IMPLANTES ---
  implante: BASE_URL + 'implantes.jpeg',
  implantes: BASE_URL + 'implantes.jpeg',

  // --- LIMPIEZA / CHEQUEO ---
  limpieza: BASE_URL + 'chequeo.jpeg',
  chequeo: BASE_URL + 'chequeo.jpeg',

  // --- ODONTOPEDIATRÍA ---
  odontopediatria: BASE_URL + 'odontopediatria.jpg',
  niños: BASE_URL + 'odontopediatria.jpg',

  // --- PRÓTESIS ---
  protesis: BASE_URL + 'protesis.jpeg',

  // --- RESTAURACIÓN CON RESINA ---
  restauracion: BASE_URL + 'restauracion_resina.jpeg',
  resina: BASE_URL + 'restauracion_resina.jpeg',

  // --- TRATAMIENTOS GENERALES ---
  tratamientos: BASE_URL + 'tratamientos.jpeg',

  // --- KIT PREVENTIVO ---
  preventivo: BASE_URL + 'kit_preventivo.jpeg',
  kit: BASE_URL + 'kit_preventivo.jpeg',

  // --- UBICACIÓN / DIRECCIÓN ---
  ubicacion: BASE_URL + 'ubicacion.jpeg',
  direccion: BASE_URL + 'ubicacion.jpeg',

  // --- FALLBACK (cuando no se encuentra categoría) ---
  default: BASE_URL + 'logo.jpeg'
};

export { CATALOGO_LUMINZU };
export default CATALOGO_LUMINZU;