// config/catalogo.js

// URL base absoluta para servir las imágenes
const BASE_URL = (process.env.RENDER_EXTERNAL_URL || 'https://bot-reumatologia-cqpharma.onrender.com').replace(/\/+$/, '') + '/media/';

const CATALOGO_LUMINZU = {
  // --- ORTODONCIA / BRACKETS ---
  ortodoncia: BASE_URL + 'bracketsmuestra.jpg',
  brackets: BASE_URL + 'bracketsmuestra.jpg',
  aparato: BASE_URL + 'bracketsmuestra.jpg',
  invisalign: BASE_URL + 'bracketsmuestra.jpg',

  // Casos antes/después de ortodoncia (imágenes múltiples)
  ortodoncia_1: BASE_URL + 'ortodoncia_antes_1.jpeg',
  ortodoncia_2: BASE_URL + 'ortodoncia_antes_2.jpeg',
  ortodoncia_3: BASE_URL + 'ortodoncia_antes_3.jpeg',
  ortodoncia_4: BASE_URL + 'ortodoncia_antes_4.jpeg',
  ortodoncia_5: BASE_URL + 'ortodoncia_antes_5.jpeg',

  // --- BLANQUEAMIENTO ---
  blanqueamiento: BASE_URL + 'blanqueamiento.jpg',

  // --- CARILLAS / ESTÉTICA ---
  carillas: BASE_URL + 'carillas.jpeg',
  estetica: BASE_URL + 'carillas.jpeg',

  // --- ENDODONCIA ---
  endodoncia: BASE_URL + 'endodoncia.jpeg',

  // --- IMPLANTES ---
  implante: BASE_URL + 'implantes.jpeg',
  implantes: BASE_URL + 'implantes.jpeg',

  // --- LIMPIEZA / CHEQUEO ---
  limpieza: BASE_URL + 'chequeo.jpeg',
  chequeo: BASE_URL + 'chequeo.jpeg',
  kit_preventivo: BASE_URL + 'kit_preventivo.jpeg',
  preventivo: BASE_URL + 'kit_preventivo.jpeg',

  // --- ODONTOPEDIATRÍA ---
  odontopediatria: BASE_URL + 'odontopediatria.jpg',
  niños: BASE_URL + 'odontopediatria.jpg',

  // --- PRÓTESIS ---
  protesis: BASE_URL + 'protesis.jpeg',

  // --- RESTAURACIÓN CON RESINA ---
  restauracion: BASE_URL + 'restauracion_resina.jpeg',
  resina: BASE_URL + 'restauracion_resina.jpeg',
  curaciones: BASE_URL + 'restauracion_resina.jpeg',

  // --- TRATAMIENTOS GENERALES ---
  tratamientos: BASE_URL + 'tratamientos.jpeg',

  // --- UBICACIÓN / DIRECCIÓN / FACHADA ---
  ubicacion: BASE_URL + 'ubicacion.jpeg',
  direccion: BASE_URL + 'ubicacion.jpeg',
  fachada: BASE_URL + 'fachada.jpeg',

  // --- PROMOCIÓN ---
  promo: BASE_URL + 'promo_consulta.jpeg',

  // --- FALLBACK (cuando no se encuentra categoría) ---
  default: BASE_URL + 'logo.jpeg',
  logo: BASE_URL + 'logo.jpeg',
};

// Exportación dual compatible con CommonJS y ESM
export { CATALOGO_LUMINZU };
export default CATALOGO_LUMINZU;