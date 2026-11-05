// Español coloquial de Perú: cómo llaman los pacientes a los tratamientos y cómo escriben por WhatsApp.
// No son datos de una clínica (esos van en config/clinics/<id>.js): son palabras del idioma que se suman a los
// sinónimos de cada clínica según la clave del tratamiento (treatments[].key).

export const COMMON_TREATMENT_SYNONYMS = {
  ortodoncia: [
    'brackets', 'bracket', 'braquets', 'brakets', 'braket', 'bravkets', 'brackes', 'bracketts', 'frenillos', 'frenillo',
    'frenos', 'fierritos', 'alambritos', 'aparatos', 'aparatito', 'ortodonsia', 'ortodoncia invisible', 'alineadores',
    'zafiro', 'brackets de zafiro', 'brackets metalicos',
  ],
  carillas: ['carillas', 'carilla', 'carrillas', 'cariyas', 'carillas de resina', 'carillas de porcelana', 'diseno de sonrisa'],
  implantes: [
    'implantes', 'implante', 'inplante', 'inplantes', 'diente postizo', 'dientes postizos', 'postizo', 'muela postiza',
    'poner un diente', 'ponerme un diente', 'reponer un diente',
  ],
  blanqueamiento: ['blanqueamiento', 'blanquiamiento', 'blanquear', 'blanqueamento', 'aclarar los dientes', 'dientes blancos'],
  limpieza: ['limpieza', 'limpiesa', 'limpiza', 'limpieza dental', 'profilaxis', 'sarro', 'destartraje', 'destartarje'],
  extraccion: [
    'extraccion', 'estraccion', 'sacar muela', 'sacar una muela', 'sacarme una muela', 'sacarme la muela',
    'sacar un diente', 'sacarme un diente', 'sacarme el diente', 'quitar una muela', 'muela del juicio', 'cordal',
  ],
  endodoncia: ['endodoncia', 'endodonsia', 'conducto', 'tratamiento de conducto', 'matar el nervio', 'nervio'],
  odontopediatria: ['odontopediatria', 'odontopediatra', 'dentista para ninos', 'dentista de ninos'],
};

// Reescrituras para DETECTAR intenciones (precio, cita, información). El texto que lee Gemini no se toca.
const REWRITES = [
  [/\b(?:pls|plis|plz|porfa|porfis|xfa|xfavor)\b/g, 'por favor'],
  [/\b(?:cuanto|cuánto|qnto|cnto|kuanto)\s+(?:sale|esta|está|cobran|me sale|vale)\b/g, 'cuanto cuesta'],
  [/\ba\s+cuanto\b/g, 'cuanto cuesta'],
  [/\b(?:precio|precios|presio|presios)\b/g, 'precio'],
  [/\binfo\b/g, 'informacion'],
  [/\b(?:q|k|ke)\b/g, 'que'],
  [/\b(?:xq|xk|pq)\b/g, 'porque'],
  [/\b(?:ctia|cit|sita)\b/g, 'cita'],
  [/\b(?:orario|orarios)\b/g, 'horario'],
];

export function expandColloquial(text) {
  let value = String(text || '').toLowerCase();
  for (const [pattern, replacement] of REWRITES) value = value.replace(pattern, replacement);
  return value;
}

export default { COMMON_TREATMENT_SYNONYMS, expandColloquial };
