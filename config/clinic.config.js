// Carga la clínica activa (ACTIVE_CLINIC, por defecto "denvari") desde config/clinics/<id>.js,
// valida sus campos al arrancar y expone helpers de teléfonos, media y tratamientos.

const DEFAULT_CLINIC_ID = 'denvari';
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const REQUIRED_STRINGS = ['id', 'name', 'botName', 'city', 'address', 'mapsUrl', 'timezone', 'welcomeCaption', 'privacyNotice'];
const PHONE_VARS = ['CLINIC_PHONE', 'RECEPTION_ALERT_PHONE', 'OWNER_ALERT_PHONE'];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function validateClinic(clinic) {
  const errors = [];
  if (!clinic || typeof clinic !== 'object') return ['la configuración no es un objeto'];
  for (const field of REQUIRED_STRINGS) {
    if (typeof clinic[field] !== 'string' || !clinic[field].trim()) errors.push(`falta "${field}"`);
  }
  if (!Number.isInteger(clinic.slotMinutes) || clinic.slotMinutes <= 0) errors.push('"slotMinutes" debe ser un entero > 0');
  if (!clinic.workingHours || typeof clinic.workingHours !== 'object') {
    errors.push('falta "workingHours"');
  } else {
    for (const day of DAY_KEYS) {
      const ranges = clinic.workingHours[day];
      if (!Array.isArray(ranges)) { errors.push(`workingHours.${day} debe ser un arreglo`); continue; }
      for (const range of ranges) {
        if (!Array.isArray(range) || range.length !== 2 || !HHMM.test(range[0]) || !HHMM.test(range[1]) || range[0] >= range[1]) {
          errors.push(`workingHours.${day} tiene un rango inválido: ${JSON.stringify(range)}`);
        }
      }
    }
  }
  if (!clinic.campaign || typeof clinic.campaign !== 'object') errors.push('falta "campaign"');
  if (!Array.isArray(clinic.treatments) || clinic.treatments.length === 0) {
    errors.push('"treatments" debe tener al menos un tratamiento');
  } else {
    for (const [i, t] of clinic.treatments.entries()) {
      if (!t?.key || !t?.name) errors.push(`treatments[${i}] necesita key y name`);
      if (typeof t?.priceFrom !== 'number') errors.push(`treatments[${i}].priceFrom debe ser número`);
      if (!Number.isInteger(t?.durationMin) || t.durationMin <= 0) errors.push(`treatments[${i}].durationMin debe ser entero > 0`);
      if (!Array.isArray(t?.synonyms)) errors.push(`treatments[${i}].synonyms debe ser un arreglo`);
    }
  }
  if (!clinic.media || typeof clinic.media !== 'object' || !clinic.media.logo) errors.push('"media.logo" es obligatorio');
  if (!Array.isArray(clinic.faq)) errors.push('"faq" debe ser un arreglo');
  return errors;
}

async function loadClinic(id) {
  if (!/^[a-z0-9_-]+$/.test(id)) throw new Error(`[Clinic] ACTIVE_CLINIC inválido: "${id}"`);
  let mod;
  try {
    mod = await import(`./clinics/${id}.js`);
  } catch (error) {
    throw new Error(`[Clinic] No se pudo cargar config/clinics/${id}.js: ${error.message}`);
  }
  const data = mod.default;
  const errors = validateClinic(data);
  if (errors.length) throw new Error(`[Clinic] config/clinics/${id}.js inválido:\n - ${errors.join('\n - ')}`);
  if (data.id !== id) throw new Error(`[Clinic] config/clinics/${id}.js declara id "${data.id}"; deben coincidir`);
  return Object.freeze(data);
}

export const ACTIVE_CLINIC_ID = String(process.env.ACTIVE_CLINIC || DEFAULT_CLINIC_ID).trim().toLowerCase();
export const clinic = await loadClinic(ACTIVE_CLINIC_ID);
export default clinic;

// ---------- Teléfonos (siempre desde variables de entorno) ----------

export function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return null;
  return digits.length === 9 ? `51${digits}` : digits;
}

export function getClinicPhone() { return normalizePhone(process.env.CLINIC_PHONE); }
export function getReceptionPhone() { return normalizePhone(process.env.RECEPTION_ALERT_PHONE); }
export function getOwnerPhone() { return normalizePhone(process.env.OWNER_ALERT_PHONE); }

export function missingPhoneVars() {
  return PHONE_VARS.filter((name) => !normalizePhone(process.env[name]));
}

// ---------- URLs públicas y media ----------

export function getPublicBaseUrl() {
  const raw = process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || process.env.APP_URL
    || `http://localhost:${process.env.PORT || 3000}`;
  return raw.replace(/\/+$/, '');
}

export function mediaUrl(key) {
  const file = clinic.media?.[key];
  if (!file) return null;
  return `${getPublicBaseUrl()}/media/${clinic.id}/${file}`;
}

// ---------- Tratamientos y sinónimos ----------

export function normalizeText(text) {
  return String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function editDistanceAtMostOne(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0; let j = 0; let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i += 1; j += 1; continue; }
    edits += 1;
    if (edits > 1) return false;
    if (a.length > b.length) i += 1;
    else if (b.length > a.length) j += 1;
    else { i += 1; j += 1; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

function treatmentTerms(t) {
  return [t.key, ...(t.synonyms || [])].map(normalizeText).filter(Boolean);
}

// Devuelve el tratamiento mencionado en un texto libre (tolera 1 error de tipeo en palabras de 5+ letras).
export function findTreatment(text) {
  const value = normalizeText(text);
  if (!value) return null;
  const padded = ` ${value} `;
  for (const t of clinic.treatments) {
    if (treatmentTerms(t).some((term) => padded.includes(` ${term} `))) return t;
  }
  const words = value.split(' ').filter((w) => w.length >= 5);
  for (const t of clinic.treatments) {
    const singleWordTerms = treatmentTerms(t).filter((term) => !term.includes(' ') && term.length >= 5);
    if (words.some((w) => singleWordTerms.some((term) => editDistanceAtMostOne(w, term)))) return t;
  }
  return null;
}

export function getTreatmentByKey(key) {
  return clinic.treatments.find((t) => t.key === key) || null;
}

// Traduce la categoría de una etiqueta [ENVIAR_FOTO: x] a una clave de clinic.media.
export function resolveMediaKey(category) {
  const value = normalizeText(category);
  if (!value) return null;
  const direct = value.replace(/\s+/g, '_');
  if (clinic.media[direct]) return direct;
  if (/\b(direccion|mapa|croquis|sede|ubicados?)\b/.test(value)) return clinic.media.ubicacion ? 'ubicacion' : null;
  if (/\b(clinica|local|consultorio|instalaciones)\b/.test(value)) return clinic.media.fachada ? 'fachada' : null;
  const treatment = findTreatment(value);
  return treatment && clinic.media[treatment.key] ? treatment.key : null;
}

// Datos que puede ver el navegador (panel). Nada de teléfonos de alerta.
export function publicClinicInfo() {
  return {
    id: clinic.id,
    name: clinic.name,
    botName: clinic.botName,
    city: clinic.city,
    address: clinic.address,
    logoUrl: `/media/${clinic.id}/${clinic.media.logo}`,
    treatments: clinic.treatments.map(({ key, name }) => ({ key, name })),
  };
}
