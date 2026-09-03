// config/catalogo.js

// URL base absoluta para servir las imágenes
const BASE_URL = (process.env.RENDER_EXTERNAL_URL || 'https://bot-reumatologia-cqpharma.onrender.com').replace(/\/+$/, '') + '/media/';

// Función auxiliar para construir URLs completas
const toUrl = (file) => `${BASE_URL}${file}`;

// Casos reales de antes y después de ortodoncia
const CASOS_ORTODONCIA = [
  toUrl('ortodoncia_antes_despues.jpeg'),
  toUrl('ortodoncia_antes_despues1.jpeg'),
  toUrl('ortodoncia_antes_despues2.jpeg'),
  toUrl('ortodoncia_antes_despues3.jpeg'),
  toUrl('ortodoncia_antes_despues4.jpeg'),
];

// Casos de blanqueamiento dental
const CASOS_BLANQUEAMIENTO = [
  toUrl('blanqueamiento.jpeg'),
  toUrl('blanqueamientodeental.jpeg'),
];

// Estructura organizada por servicios (Ideal para lógica avanzada y respuestas ricas)
const SERVICIOS = {
  ortodoncia: {
    nombre: 'Ortodoncia y Brackets',
    imagen_promo: toUrl('bracketsmuestra.jpeg'),
    casos: CASOS_ORTODONCIA,
    kids: toUrl('ortodonciakids.jpeg'),
  },
  ubicacion: {
    imagen: toUrl('ubicacion.jpeg'),
    fachada: toUrl('fachada.jpeg'),
  },
  blanqueamiento: {
    nombre: 'Blanqueamiento Dental',
    imagen_promo: toUrl('blanqueamiento.jpeg'),
    casos: CASOS_BLANQUEAMIENTO,
  },
  resinas: {
    nombre: 'Restauración con Resina Estética',
    casos: [toUrl('restauracion_resina.jpeg')],
  },
  implantes: {
    nombre: 'Implantes Dentales',
    casos: [toUrl('implantes.jpeg'), toUrl('implantesdentales.jpeg')],
  },
  odontopediatria: {
    nombre: 'Odontopediatría Integral',
    casos: [toUrl('odontopediatria.jpeg'), toUrl('odontopediatriacuracion.jpeg')],
  }
};

// Diccionario plano de alias y palabras clave directas del bot / System Prompt
const CATALOGO_LUMINZU = {
  // === ORTODONCIA & BRACKETS ===
  ortodoncia: toUrl('bracketsmuestra.jpeg'),
  brackets: toUrl('bracketsmuestra.jpeg'),
  aparato: toUrl('bracketsmuestra.jpeg'),
  invisalign: toUrl('bracketsmuestra.jpeg'),
  ortodoncia_promo: toUrl('bracketsmuestra.jpeg'),
  ortodoncia_antes_despues: CASOS_ORTODONCIA,
  antesdespues: CASOS_ORTODONCIA,
  ortodonciakids: toUrl('ortodonciakids.jpeg'),
  ortodoncia_kids: toUrl('ortodonciakids.jpeg'),

  // === BLANQUEAMIENTO DENTAL ===
  blanqueamiento: toUrl('blanqueamiento.jpeg'),
  blanqueamientodental: toUrl('blanqueamientodeental.jpeg'),
  blanqueamiento_dental: toUrl('blanqueamientodeental.jpeg'),
  blanqueamiento_casos: CASOS_BLANQUEAMIENTO,

  // === CARILLAS & ESTÉTICA ===
  carillas: toUrl('carillas.jpeg'),
  estetica: toUrl('carillas.jpeg'),

  // === ENDODONCIA & DOLOR ===
  endodoncia: toUrl('endodoncia.jpeg'),
  tienesdolormuela: toUrl('tienesdolormuela.jpeg'),
  dolor_muela: toUrl('tienesdolormuela.jpeg'),

  // === IMPLANTES DENTALES ===
  implante: toUrl('implantes.jpeg'),
  implantes: toUrl('implantes.jpeg'),
  implantesdentales: toUrl('implantesdentales.jpeg'),
  implantes_dentales: toUrl('implantesdentales.jpeg'),

  // === LIMPIEZA & PREVENTIVO ===
  limpieza: toUrl('chequeo.jpeg'),
  chequeo: toUrl('chequeo.jpeg'),
  kit_preventivo: toUrl('kit_preventivo.jpeg'),
  preventivo: toUrl('kit_preventivo.jpeg'),

  // === ODONTOPEDIATRÍA ===
  odontopediatria: toUrl('odontopediatria.jpeg'),
  niños: toUrl('odontopediatria.jpeg'),
  odontopediatricuracion: toUrl('odontopediatriacuracion.jpeg'),
  odontopediatria_curacion: toUrl('odontopediatriacuracion.jpeg'),

  // === PRÓTESIS DENTAL ===
  protesis: toUrl('protesis.jpeg'),

  // === RESINAS & CURACIONES ===
  restauracion: toUrl('restauracion_resina.jpeg'),
  resina: toUrl('restauracion_resina.jpeg'),
  resinas: toUrl('restauracion_resina.jpeg'),
  curaciones: toUrl('restauracion_resina.jpeg'),
  restauracion_resina: toUrl('restauracion_resina.jpeg'),

  // === UBICACIÓN & SEDE ===
  ubicacion: toUrl('ubicacion.jpeg'),
  direccion: toUrl('ubicacion.jpeg'),
  croquis: toUrl('ubicacion.jpeg'),
  fachada: toUrl('fachada.jpeg'),

  // === PROMOCIONES & AGENDAMIENTO ===
  promo: toUrl('promo_consulta.jpeg'),
  promo_consulta: toUrl('promo_consulta.jpeg'),
  agendatuconsulta: toUrl('agendatuconsulta.jpeg'),
  agendar_cita: toUrl('agendatuconsulta.jpeg'),
  tratamientos: toUrl('tratamientos.jpeg'),

  // === EXTRACCIÓN ===
  extraccion: toUrl('extraccion.jpeg'),

  // === FALLBACKS ===
  logo: toUrl('logo.jpeg'),
  default: toUrl('logo.jpeg'),
};

/**
 * Función helper para resolver imágenes de forma segura:
 * - Si es un array, rota o elige una al azar para no saturar con la misma.
 * - Si es string URL, la devuelve directo.
 * - Si no existe, devuelve null (evita mandar el logo por error).
 */
function obtenerImagen(clave) {
  if (!clave) return null;
  const key = clave.toLowerCase().trim();

  // Si piden formato objeto: "ortodoncia.casos" o "ubicacion.fachada"
  if (key.includes('.')) {
    const [modulo, propiedad] = key.split('.');
    if (SERVICIOS[modulo] && SERVICIOS[modulo][propiedad]) {
      const target = SERVICIOS[modulo][propiedad];
      return Array.isArray(target) ? target[Math.floor(Math.random() * target.length)] : target;
    }
  }

  const resultado = CATALOGO_LUMINZU[key];
  if (!resultado) return null;

  if (Array.isArray(resultado)) {
    return resultado[Math.floor(Math.random() * resultado.length)];
  }

  return resultado;
}

// Exportación para CommonJS (require) y ESM (import)
module.exports = {
  BASE_URL,
  SERVICIOS,
  CATALOGO_LUMINZU,
  obtenerImagen,
  default: CATALOGO_LUMINZU,
};