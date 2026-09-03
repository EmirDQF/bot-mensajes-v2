// config/catalogo.js

const BASE_URL = (process.env.RENDER_EXTERNAL_URL || 'https://bot-reumatologia-cqpharma.onrender.com').replace(/\/+$/, '') + '/media/';

const toUrl = (file) => `${BASE_URL}${file}`;

// Casos reales de ortodoncia disponibles actualmente
const CASOS_ORTODONCIA = [
  toUrl('ortodoncia_caso_1.jpeg'),
  toUrl('ortodoncia_caso_3.jpeg'),
];

// Casos de blanqueamiento dental
const CASOS_BLANQUEAMIENTO = [
  toUrl('blanqueamiento_1.jpeg'),
  toUrl('blanqueamiento_2.jpeg'),
];

const SERVICIOS = {
  ortodoncia: {
    nombre: 'Ortodoncia y Brackets',
    imagen_promo: toUrl('ortodoncia_promo.jpeg'),
    casos: CASOS_ORTODONCIA,
    kids: toUrl('ortodonciakids.jpeg'),
  },
  ubicacion: {
    imagen: toUrl('ubicacion.jpeg'),
    fachada: toUrl('fachada.jpeg'),
  },
  blanqueamiento: {
    nombre: 'Blanqueamiento Dental',
    imagen_promo: toUrl('blanqueamiento_1.jpeg'),
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

const CATALOGO_LUMINZU = {
  // === ORTODONCIA & BRACKETS ===
  ortodoncia: toUrl('ortodoncia_promo.jpeg'),
  brackets: toUrl('ortodoncia_promo.jpeg'),
  aparato: toUrl('ortodoncia_promo.jpeg'),
  invisalign: toUrl('ortodoncia_promo.jpeg'),
  ortodoncia_promo: toUrl('ortodoncia_promo.jpeg'),
  ortodoncia_antes_despues: CASOS_ORTODONCIA,
  antesdespues: CASOS_ORTODONCIA,
  ortodonciakids: toUrl('ortodonciakids.jpeg'),
  ortodoncia_kids: toUrl('ortodonciakids.jpeg'),

  // === BLANQUEAMIENTO DENTAL ===
  blanqueamiento: toUrl('blanqueamiento_1.jpeg'),
  blanqueamientodental: toUrl('blanqueamiento_2.jpeg'),
  blanqueamiento_dental: toUrl('blanqueamiento_2.jpeg'),
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

function obtenerImagen(clave) {
  if (!clave) return null;
  const key = clave.toLowerCase().trim();

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

module.exports = {
  BASE_URL,
  SERVICIOS,
  CATALOGO_LUMINZU,
  obtenerImagen,
  default: CATALOGO_LUMINZU,
};