import { DISTRICTS } from './districts.js';
import { findTreatment, normalizeText } from '../config/clinic.config.js';

// Datos del agendamiento que la asistente pide UNO por mensaje, en este orden, sin repetir lo ya respondido:
// tratamiento → nombre → distrito → horario. Aquí se reconocen las respuestas cortas ("Ana Torres", "Surco").

export const LEAD_FIELDS = ['tratamiento', 'nombre', 'distrito', 'horario'];

const QUESTIONS = {
  tratamiento: '¿Qué tratamiento te interesa?',
  nombre: '¿A nombre de quién registro la solicitud (nombre y apellido)?',
  distrito: '¿De qué distrito nos escribes?',
  horario: '¿Qué día y hora te acomodan?',
};

export const questionFor = (field) => QUESTIONS[field] || QUESTIONS.tratamiento;

const hasValue = (value) => typeof value === 'string' ? value.trim().length >= 2 : Boolean(value);

// Siguiente dato que falta para la solicitud de cita, o null si ya están todos.
export function nextMissingField(lead = {}) {
  if (!hasValue(lead.motivo || lead.tratamiento)) return 'tratamiento';
  if (!hasValue(lead.nombre)) return 'nombre';
  if (!hasValue(lead.distrito)) return 'distrito';
  if (!lead.fechaHoraISO && !lead.slot) return 'horario';
  return null;
}

const titleCase = (text) => text.split(' ').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');

// "lima" sola no es un distrito; "lica a" y "venta" son entradas rotas de la lista histórica.
const KNOWN_DISTRICTS = DISTRICTS.filter((d) => d.length >= 4 && !['lima', 'lica a', 'venta'].includes(d))
  .sort((a, b) => b.length - a.length);
const NOT_A_PLACE = new Set(['si', 'no', 'ok', 'hola', 'gracias', 'claro', 'bueno', 'vale', 'nose', 'no se', 'ya', 'listo', 'perfecto', 'buenas', 'buenos dias', 'buenas tardes', 'buenas noches']);
const PLACE_PHRASE = /\b(?:vivo|resido|estoy|soy|vengo)\s+(?:en|de|por|desde)\s+([a-zñ]+(?:\s+[a-zñ]+){0,3})/;
const CONNECTORS = /\s+(?:y|pero|para|porque|quiero|me|mi|con|el|la)\b.*$/;

// Distrito mencionado en el texto. Con asked=true (se le acaba de preguntar) se acepta una respuesta corta
// aunque no esté en la lista de Lima, para clínicas de otras ciudades.
export function extractDistrict(text, { asked = false } = {}) {
  const value = normalizeText(text);
  if (!value) return null;
  const padded = ` ${value} `;
  const known = KNOWN_DISTRICTS.find((d) => padded.includes(` ${d} `));
  if (known) return titleCase(known);
  const phrase = value.match(PLACE_PHRASE)?.[1]?.replace(CONNECTORS, '').trim();
  if (phrase && phrase !== 'lima' && !findTreatment(phrase)) return titleCase(phrase);
  if (!asked) return null;
  const words = value.split(' ');
  if (words.length > 4 || NOT_A_PLACE.has(value) || findTreatment(value) || /\d/.test(value)) return null;
  return titleCase(value);
}

// ---------- Nombre ----------

const NAME_SHAPE = /^\p{L}[\p{L}'’-]*(?:\s+\p{L}[\p{L}'’-]*){0,3}$/u;
// Empresas, cargos y apodos que no son el nombre de una persona.
const NOT_NAME_WORDS = new Set([
  'clinica', 'dental', 'dentista', 'consultorio', 'odontologia', 'tienda', 'store', 'shop', 'ventas', 'venta', 'sac', 'srl',
  'eirl', 'empresa', 'oficial', 'inc', 'ltd', 'studio', 'spa', 'bot', 'admin', 'whatsapp', 'business', 'servicios',
  'importaciones', 'grupo', 'corp', 'negocio', 'delivery', 'boutique', 'market', 'online', 'peru', 'lima',
  'mama', 'papa', 'mami', 'papi', 'amor', 'baby', 'bebe', 'king', 'queen', 'cliente', 'paciente', 'usuario', 'yo',
  'hola', 'info', 'informacion', 'doctor', 'doctora', 'dr', 'dra', 'sr', 'sra', 'senor', 'senora',
]);

// true si el texto parece el nombre de una persona: solo letras (sin números ni emojis), 1 a 4 palabras,
// sin palabras de empresa ni apodos ("Mamá", "Dental Store SAC", "Diegooo").
export function looksLikeRealName(raw) {
  const name = String(raw || '').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 40 || !NAME_SHAPE.test(name)) return false;
  if (/(\p{L})\1\1/iu.test(name)) return false;
  const words = name.split(' ').map((w) => normalizeText(w).replace(/\s+/g, ''));
  if (words.some((w) => w.length < 2 || NOT_NAME_WORDS.has(w))) return false;
  return true;
}

// Respuesta corta al dato que se le pidió: { nombre } o { distrito }, o null si no responde eso.
export function captureAnswer(field, text) {
  const value = String(text || '').trim().replace(/[.!¡¿?]+$/g, '').trim();
  if (!value) return null;
  if (field === 'nombre') {
    const cleaned = value.replace(/^(?:me llamo|mi nombre es|soy|es)\s+/i, '');
    return looksLikeRealName(cleaned) && !findTreatment(cleaned) ? { nombre: cleaned } : null;
  }
  if (field === 'distrito') {
    const distrito = extractDistrict(value, { asked: true });
    return distrito ? { distrito } : null;
  }
  return null;
}

export default { LEAD_FIELDS, questionFor, nextMissingField, extractDistrict, looksLikeRealName, captureAnswer };
