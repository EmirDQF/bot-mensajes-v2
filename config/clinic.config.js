// Carga la clínica activa (ACTIVE_CLINIC, por defecto "denvari") desde config/clinics/<id>.js,
// valida sus campos al arrancar y expone helpers de teléfonos, media y tratamientos.

import { COMMON_TREATMENT_SYNONYMS } from './colloquial.js';

const DEFAULT_CLINIC_ID = 'denvari';
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const REQUIRED_STRINGS = ['id', 'name', 'botName', 'city', 'address', 'mapsUrl', 'timezone', 'welcomeCaption', 'privacyNotice'];
const PHONE_VARS = ['CLINIC_PHONE', 'RECEPTION_ALERT_PHONE', 'OWNER_ALERT_PHONE'];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

// Rutas de los textos que todavía dicen "TODO" (los deja scripts/new-clinic.js para completar).
export function findTodos(value, path = '') {
  if (typeof value === 'string') return /\bTODO\b/.test(value) ? [path || '(raíz)'] : [];
  if (Array.isArray(value)) return value.flatMap((item, i) => findTodos(item, `${path}[${i}]`));
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, item]) => findTodos(item, path ? `${path}.${key}` : key));
  }
  return [];
}

export function validateClinic(clinic) {
  const errors = [];
  if (!clinic || typeof clinic !== 'object') return ['la configuración no es un objeto'];
  const todos = findTodos(clinic);
  if (todos.length) {
    errors.push(`quedan ${todos.length} datos por completar (busca "TODO" en el archivo): ${todos.slice(0, 10).join(', ')}${todos.length > 10 ? ', …' : ''}`);
  }
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
  if (clinic.quickReplies !== undefined && (!Array.isArray(clinic.quickReplies) || clinic.quickReplies.some((q) => typeof q !== 'string'))) {
    errors.push('"quickReplies" debe ser una lista de textos');
  }
  for (const key of ['primary', 'accent']) {
    const color = clinic.colors?.[key];
    if (color !== undefined && !/^#[0-9a-f]{6}$/i.test(color)) errors.push(`colors.${key} debe ser un color #RRGGBB`);
  }
  return [
    ...errors, ...validateEditable(clinic), ...validateCatalog(clinic), ...validateBooking(clinic), ...validateReminders(clinic),
    ...validateFollowUps(clinic), ...validateMarketingPrice(clinic),
  ];
}

// Modo de agendamiento: "solicitud" (recepción confirma; por defecto) o "confirmacion_directa" (el bot reserva
// en la agenda del panel y confirma; solo si esa es la ÚNICA agenda de la clínica).
export const BOOKING_MODES = ['solicitud', 'confirmacion_directa'];
export const bookingModeOf = (c) => (c?.bookingMode === 'confirmacion_directa' ? 'confirmacion_directa' : 'solicitud');

function validateBooking(c) {
  const errors = [];
  if (c.bookingMode !== undefined && !BOOKING_MODES.includes(c.bookingMode)) errors.push(`"bookingMode" debe ser ${BOOKING_MODES.join(' o ')}`);
  if (c.appointmentCodePrefix !== undefined && !/^[A-Z]{2,4}$/.test(String(c.appointmentCodePrefix))) {
    errors.push('"appointmentCodePrefix" debe tener de 2 a 4 letras mayúsculas (ej. "DV")');
  }
  if (c.specialists !== undefined) {
    const keys = new Set((c.treatments || []).map((t) => t.key));
    if (!Array.isArray(c.specialists) || c.specialists.length > 20) errors.push('"specialists" debe ser una lista (máximo 20)');
    else c.specialists.forEach((s, i) => {
      if (!isText(s?.name, 60)) errors.push(`specialists[${i}] necesita un nombre (máximo 60 caracteres)`);
      if (s?.treatments !== undefined && (!Array.isArray(s.treatments) || s.treatments.some((k) => !keys.has(k)))) {
        errors.push(`specialists[${i}].treatments debe listar claves de tratamientos existentes`);
      }
    });
  }
  return errors;
}

// Recordatorios de cita: horas antes del primero (largo) y del segundo (corto). null apaga ese recordatorio.
export const DEFAULT_REMINDERS = { firstHours: 48, secondHours: 2 };
export function reminderHours(c = clinic) {
  const r = c?.reminders || {};
  return {
    firstHours: r.firstHours === null ? null : r.firstHours ?? DEFAULT_REMINDERS.firstHours,
    secondHours: r.secondHours === null ? null : r.secondHours ?? DEFAULT_REMINDERS.secondHours,
  };
}

function validateReminders(c) {
  if (c.reminders === undefined) return [];
  if (!c.reminders || typeof c.reminders !== 'object') return ['"reminders" debe ser { firstHours, secondHours }'];
  const errors = [];
  const { firstHours, secondHours } = reminderHours(c);
  if (firstHours !== null && !(Number.isInteger(firstHours) && firstHours >= 12 && firstHours <= 96)) errors.push('reminders.firstHours debe ser un entero de 12 a 96 (o null para no enviarlo)');
  // Hasta 6 h: el recordatorio corto siempre cae el mismo día de la cita ("es hoy a las…").
  if (secondHours !== null && !(Number.isInteger(secondHours) && secondHours >= 1 && secondHours <= 6)) errors.push('reminders.secondHours debe ser un entero de 1 a 6 (o null para no enviarlo)');
  return errors;
}

// Seguimiento cuando el paciente no responde (activado por defecto): 3 h y ~22 h dentro de la ventana de 24 h
// (texto libre) y el día 3 con una plantilla de marketing (solo con opt-in). Máximo 3 por conversación.
export const DEFAULT_FOLLOW_UPS = { enabled: true, firstHours: 3, secondHours: 22, thirdDays: 3, max: 3 };
export function followUpSettings(c = clinic) {
  return { ...DEFAULT_FOLLOW_UPS, ...(c?.followUps || {}), max: Math.min(3, c?.followUps?.max ?? DEFAULT_FOLLOW_UPS.max) };
}

function validateFollowUps(c) {
  const errors = [];
  if (c.followUps !== undefined) {
    if (!c.followUps || typeof c.followUps !== 'object') return ['"followUps" debe ser un objeto'];
    const f = followUpSettings(c);
    if (typeof f.enabled !== 'boolean') errors.push('followUps.enabled debe ser sí/no');
    if (!(Number.isInteger(f.firstHours) && f.firstHours >= 1 && f.firstHours <= 12)) errors.push('followUps.firstHours debe ser un entero de 1 a 12');
    // Antes de las 23,5 h: el segundo va con texto libre dentro de la ventana de 24 h de WhatsApp.
    if (!(Number.isInteger(f.secondHours) && f.secondHours > f.firstHours && f.secondHours <= 23)) errors.push('followUps.secondHours debe ser un entero mayor que firstHours y de hasta 23');
    if (!(Number.isInteger(f.thirdDays) && f.thirdDays >= 2 && f.thirdDays <= 7)) errors.push('followUps.thirdDays debe ser un entero de 2 a 7');
    if (!(Number.isInteger(c.followUps.max ?? 3) && (c.followUps.max ?? 3) >= 1 && (c.followUps.max ?? 3) <= 3)) errors.push('followUps.max debe ser de 1 a 3');
  }
  // Calificación de Google (opcional): solo se menciona si está aquí, con su número de reseñas.
  if (c.googleRating !== undefined && c.googleRating !== null) {
    const r = c.googleRating;
    if (!(typeof r?.value === 'number' && r.value >= 1 && r.value <= 5 && Number.isInteger(r?.count) && r.count > 0)) {
      errors.push('"googleRating" debe ser { value: 1 a 5, count: número de reseñas }');
    }
  }
  return errors;
}

// Promociones (pestaña Campañas): tarifa de Meta por mensaje de marketing que el dueño verifica y escribe.
// Sin tarifa no se puede programar una campaña (el costo estimado se muestra antes de enviar).
function validateMarketingPrice(c) {
  const p = c.marketingPrice;
  if (p === undefined || p === null) return [];
  const ok = p && typeof p.amount === 'number' && p.amount >= 0 && p.amount <= 5 && ['USD', 'PEN'].includes(p.currency || 'USD');
  return ok ? [] : ['"marketingPrice" debe ser { amount: número entre 0 y 5, currency: "USD" o "PEN" }'];
}

// Las promociones solo salen de 9:00 a 20:00 (hora de la clínica).
export function isWithinMarketingHours(c, instant) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: c.timezone, hour: '2-digit', hourCycle: 'h23' }).formatToParts(instant);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value);
  return hour >= 9 && hour < 20;
}

// Especialista para un tratamiento: el primero que lo atiende (o que atiende todo). null si no hay.
export function specialistFor(treatmentKey, c = clinic) {
  const list = Array.isArray(c.specialists) ? c.specialists : [];
  return list.find((s) => treatmentKey && s.treatments?.includes(treatmentKey))
    || list.find((s) => !s.treatments?.length) || null;
}

// Catálogo visual (treatments[].images) y pack de evaluación (evaluationPack). Ambos opcionales.
const MEDIA_FILE = /^(?!.*\.\.)[\w-]+(?:\/[\w-]+)*\.(?:png|jpe?g|webp)$/i;
// Archivo de media/<id>/, URL https (Supabase Storage) o, en npm run demo, una foto subida al Storage en memoria.
const DEMO_MEDIA = /^\/demo-media\/[\w./-]+$/;
export const isMediaRef = (value) => typeof value === 'string' && !value.includes('..')
  && (MEDIA_FILE.test(value) || /^https:\/\/\S+$/i.test(value) || DEMO_MEDIA.test(value));
export const MAX_TREATMENT_IMAGES = 6;

function validateCatalog(c) {
  const errors = [];
  (Array.isArray(c.treatments) ? c.treatments : []).forEach((t, i) => {
    if (t?.images === undefined) return;
    if (!Array.isArray(t.images) || t.images.length > MAX_TREATMENT_IMAGES) {
      errors.push(`treatments[${i}].images debe ser una lista de hasta ${MAX_TREATMENT_IMAGES} imágenes`);
      return;
    }
    t.images.forEach((img, j) => {
      if (!isMediaRef(img?.file)) errors.push(`treatments[${i}].images[${j}].file debe ser un archivo .png/.jpg/.webp de media/${c.id}/ o un enlace https://`);
      if (img?.caption !== undefined && !isText(img.caption, 1000)) errors.push(`treatments[${i}].images[${j}].caption debe ser un texto de hasta 1000 caracteres`);
    });
  });
  const pack = c.evaluationPack;
  if (pack === undefined || pack === null) return errors;
  if (typeof pack !== 'object' || Array.isArray(pack)) return [...errors, '"evaluationPack" debe ser un objeto'];
  if (!isText(pack.title, 60)) errors.push('evaluationPack.title es obligatorio (máximo 60 caracteres)');
  if (!textList(pack.includes, 80) || !pack.includes.length || pack.includes.length > 6) errors.push('evaluationPack.includes debe tener de 1 a 6 textos');
  if (pack.price !== undefined && !isPrice(pack.price)) errors.push('evaluationPack.price debe ser un número (0 = sin costo)');
  if (pack.bring !== undefined && !isText(pack.bring, 120)) errors.push('evaluationPack.bring debe ser un texto de hasta 120 caracteres');
  if (pack.promotion !== undefined && pack.promotion !== null) {
    const promo = pack.promotion;
    if (!isText(promo?.text, 80)) errors.push('evaluationPack.promotion.text es obligatorio (máximo 80 caracteres)');
    if (promo?.price !== undefined && !isPrice(promo.price)) errors.push('evaluationPack.promotion.price debe ser un número');
    if (promo?.validUntil !== undefined && !DATE.test(promo.validUntil || '')) errors.push('evaluationPack.promotion.validUntil debe ser AAAA-MM-DD');
  }
  return errors;
}
const isPrice = (value) => typeof value === 'number' && value >= 0 && value <= 100000;

// Campos opcionales que el dueño puede editar desde el panel (mismas reglas para la base y los cambios).
const TONES = ['cercano', 'formal', 'juvenil'];
const EMOJI_LEVELS = ['ninguno', 'pocos', 'normal'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isText = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const textList = (list, max) => Array.isArray(list) && list.every((item) => isText(item, max));

function validateEditable(c) {
  const errors = [];
  const tooLong = (field, max) => { if (typeof c[field] === 'string' && c[field].length > max) errors.push(`"${field}" supera ${max} caracteres`); };
  tooLong('botName', 40);
  tooLong('welcomeCaption', 1200);
  tooLong('afterHoursNotice', 400);
  tooLong('address', 200);
  tooLong('workingHoursText', 300);
  // Ubicación opcional: referencia para llegar y coordenadas (ambas) para el mensaje de ubicación de WhatsApp.
  if (c.addressReference != null && !isText(c.addressReference, 200)) errors.push('"addressReference" debe ser un texto de hasta 200 caracteres');
  const hasLat = c.latitude != null;
  const hasLng = c.longitude != null;
  if (hasLat !== hasLng) errors.push('"latitude" y "longitude" van juntas (o ninguna)');
  if (hasLat && !(typeof c.latitude === 'number' && c.latitude >= -90 && c.latitude <= 90)) errors.push('"latitude" debe ser un número entre -90 y 90');
  if (hasLng && !(typeof c.longitude === 'number' && c.longitude >= -180 && c.longitude <= 180)) errors.push('"longitude" debe ser un número entre -180 y 180');
  if (c.financingText != null && !isText(c.financingText, 300)) errors.push('"financingText" debe ser un texto de hasta 300 caracteres');
  if (c.tone !== undefined && !TONES.includes(c.tone)) errors.push(`"tone" debe ser ${TONES.join(', ')}`);
  if (c.emojiLevel !== undefined && !EMOJI_LEVELS.includes(c.emojiLevel)) errors.push(`"emojiLevel" debe ser ${EMOJI_LEVELS.join(', ')}`);
  for (const field of ['mapsUrl', 'reviewUrl']) {
    if (c[field] && !/^https:\/\/\S+$/i.test(c[field])) errors.push(`"${field}" debe ser un enlace https://`);
  }
  if (c.holidays !== undefined && (!Array.isArray(c.holidays) || c.holidays.some((d) => !DATE.test(d?.date || '')))) {
    errors.push('"holidays" debe ser una lista de { date: "AAAA-MM-DD", label }');
  }
  if (c.promotions !== undefined) {
    if (!Array.isArray(c.promotions) || c.promotions.length > 20) errors.push('"promotions" debe ser una lista (máximo 20)');
    else c.promotions.forEach((p, i) => {
      if (!isText(p?.title, 120)) errors.push(`promotions[${i}] necesita un título (máximo 120 caracteres)`);
      if (p?.description !== undefined && typeof p.description !== 'string') errors.push(`promotions[${i}].description debe ser texto`);
      if (p?.validUntil && !DATE.test(p.validUntil)) errors.push(`promotions[${i}].validUntil debe ser AAAA-MM-DD`);
      if (p?.validFrom && !DATE.test(p.validFrom)) errors.push(`promotions[${i}].validFrom debe ser AAAA-MM-DD`);
      if (p?.validFrom && p?.validUntil && p.validFrom > p.validUntil) errors.push(`promotions[${i}]: la fecha de inicio es posterior a la de fin`);
    });
  }
  for (const field of ['paymentMethods', 'forbiddenPhrases', 'quickReplies']) {
    if (c[field] !== undefined && (!textList(c[field], 300) || c[field].length > 30)) errors.push(`"${field}" debe ser una lista de textos (máximo 30)`);
  }
  if (c.faq !== undefined && Array.isArray(c.faq)) {
    if (c.faq.length > 40) errors.push('"faq" admite máximo 40 preguntas');
    c.faq.forEach((item, i) => { if (!isText(item?.q, 300) || !isText(item?.a, 1000)) errors.push(`faq[${i}] necesita pregunta y respuesta`); });
  }
  if (Array.isArray(c.treatments)) {
    if (new Set(c.treatments.map((t) => t?.key)).size !== c.treatments.length) errors.push('treatments: hay claves repetidas');
    c.treatments.forEach((t, i) => {
      if (t?.description !== undefined && typeof t.description !== 'string') errors.push(`treatments[${i}].description debe ser texto`);
      if (t?.active !== undefined && typeof t.active !== 'boolean') errors.push(`treatments[${i}].active debe ser sí/no`);
      if (typeof t?.priceFrom === 'number' && (t.priceFrom < 0 || t.priceFrom > 100000)) errors.push(`treatments[${i}].priceFrom fuera de rango`);
    });
  }
  if (c.recommendationRules !== undefined) {
    const keys = new Set((c.treatments || []).map((t) => t.key));
    if (!Array.isArray(c.recommendationRules) || c.recommendationRules.length > 30) errors.push('"recommendationRules" debe ser una lista (máximo 30)');
    else c.recommendationRules.forEach((rule, i) => {
      if (!textList(rule?.triggers, 80) || !rule.triggers.length) errors.push(`recommendationRules[${i}] necesita palabras que la activen`);
      if (!isText(rule?.evaluation, 120)) errors.push(`recommendationRules[${i}] necesita la evaluación que se recomienda`);
      if (rule?.treatmentKey && !keys.has(rule.treatmentKey)) errors.push(`recommendationRules[${i}].treatmentKey "${rule.treatmentKey}" no es un tratamiento`);
      if (rule?.priority !== undefined && !(Number.isInteger(rule.priority) && rule.priority >= 0 && rule.priority <= 10)) errors.push(`recommendationRules[${i}].priority debe ser un entero de 0 a 10`);
    });
  }
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
  return data;
}

const deepFreeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
};

export const ACTIVE_CLINIC_ID = String(process.env.ACTIVE_CLINIC || DEFAULT_CLINIC_ID).trim().toLowerCase();
// Valores base (el archivo de la clínica) y clínica efectiva = base + cambios guardados desde el panel.
// Todos los módulos comparten el mismo objeto `clinic`: al guardar, se actualiza en el lugar.
export const BASE_CLINIC = deepFreeze(structuredClone(await loadClinic(ACTIVE_CLINIC_ID)));
export const clinic = structuredClone(BASE_CLINIC);
export default clinic;

// ---------- Cambios desde el panel (overrides) ----------

// Lo que el dueño puede cambiar. id, nombre de la clínica, zona horaria, aviso legal y teléfonos no.
export const EDITABLE_FIELDS = [
  'name', 'botName', 'tone', 'emojiLevel', 'workingHours', 'workingHoursText', 'holidays', 'treatments', 'promotions',
  'campaign', 'paymentMethods', 'financingText', 'address', 'mapsUrl', 'reviewUrl', 'faq', 'welcomeCaption',
  'afterHoursNotice', 'recommendationRules', 'quickReplies', 'forbiddenPhrases', 'colors', 'media', 'evaluationPack', 'bookingMode', 'specialists', 'reminders', 'followUps', 'googleRating',
  // Panel "Mi clínica": datos de ubicación, duración de la cita y prefijo del código de cita.
  'addressReference', 'latitude', 'longitude', 'slotMinutes', 'appointmentCodePrefix', 'marketingPrice',
];
// Objetos que se combinan por clave (un día del horario, una foto); el resto se reemplaza entero.
const MERGED_OBJECTS = ['workingHours', 'campaign', 'colors', 'media', 'reminders', 'followUps'];

export function mergeClinic(base, overrides = {}) {
  const merged = structuredClone(base);
  for (const field of EDITABLE_FIELDS) {
    if (!(field in (overrides || {}))) continue;
    const value = structuredClone(overrides[field]);
    merged[field] = MERGED_OBJECTS.includes(field) && value && typeof value === 'object' && !Array.isArray(value)
      ? { ...(base[field] || {}), ...value }
      : value;
  }
  return merged;
}

// Solo campos permitidos; lo demás se descarta.
export function pickEditable(data = {}) {
  return Object.fromEntries(Object.entries(data || {}).filter(([key]) => EDITABLE_FIELDS.includes(key)));
}

// Valida base + cambios con el MISMO validador; si todo está bien, actualiza la clínica en memoria.
// Devuelve la lista de errores (vacía si se aplicó).
export function applyClinicOverrides(overrides = {}) {
  const merged = mergeClinic(BASE_CLINIC, pickEditable(overrides));
  const errors = validateClinic(merged);
  if (errors.length) return errors;
  for (const key of Object.keys(clinic)) delete clinic[key];
  Object.assign(clinic, merged);
  return [];
}

export function isHoliday(date, c = clinic) {
  return (c.holidays || []).some((h) => h.date === date);
}

export function activeTreatments(c = clinic) {
  return c.treatments.filter((t) => t.active !== false);
}

// Promociones vigentes: activas y sin vencer (validUntil incluido). Una vencida nunca se menciona.
export function activePromotions(today, c = clinic) {
  return (c.promotions || []).filter((p) => p.active !== false && (!p.validUntil || p.validUntil >= today)
    && (!p.validFrom || p.validFrom <= today));
}

// ---------- Teléfonos (siempre desde variables de entorno) ----------

export function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return null;
  return digits.length === 9 ? `51${digits}` : digits;
}

export function getClinicPhone() { return normalizePhone(process.env.CLINIC_PHONE); }
export function getReceptionPhone() { return normalizePhone(process.env.RECEPTION_ALERT_PHONE); }
export function getOwnerPhone() { return normalizePhone(process.env.OWNER_ALERT_PHONE); }
// Opcional: el doctor recibe la ficha de cada cita nueva. Sin esta variable, la ficha va solo a recepción.
export function getDoctorPhone() { return normalizePhone(process.env.DOCTOR_ALERT_PHONE); }

export function missingPhoneVars() {
  return PHONE_VARS.filter((name) => !normalizePhone(process.env[name]));
}

// ---------- URLs públicas y media ----------

export function getPublicBaseUrl() {
  const raw = process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || process.env.APP_URL
    || `http://localhost:${process.env.PORT || 3000}`;
  return raw.replace(/\/+$/, '');
}

// Una foto puede ser un archivo de media/<id>/ o una URL https de Supabase Storage (subida desde el panel).
const isRemote = (value) => /^https:\/\//i.test(String(value || '')) || DEMO_MEDIA.test(String(value || ''));

// Ruta relativa (/media/<id>/<archivo>) o URL remota para el panel; mediaUrl() la vuelve absoluta para WhatsApp.
export function mediaPath(key) {
  return mediaFilePath(clinic.media?.[key]);
}

// Un archivo cualquiera de media/<id>/ (p. ej. las imágenes del catálogo) o una URL https.
export function mediaFilePath(file) {
  if (!file) return null;
  return isRemote(file) ? file : `/media/${clinic.id}/${file}`;
}

// URL absoluta para WhatsApp (las rutas /media y /demo-media se sirven desde este servidor).
const absolute = (path) => (/^https:\/\//i.test(path) ? path : `${getPublicBaseUrl()}${path}`);

export function mediaFileUrl(file) {
  const path = mediaFilePath(file);
  return path ? absolute(path) : null;
}

export function mediaUrl(key) {
  const path = mediaPath(key);
  return path ? absolute(path) : null;
}

// ---------- Tratamientos y sinónimos ----------

export function normalizeText(text) {
  return String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]+/g, ' ').replace(/\s+/g, ' ').trim();
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

// Sinónimos de la clínica + palabras coloquiales comunes para esa clave (config/colloquial.js).
function treatmentTerms(t) {
  return [t.key, ...(t.synonyms || []), ...(COMMON_TREATMENT_SYNONYMS[t.key] || [])].map(normalizeText).filter(Boolean);
}

function mentionKind(t, padded, words) {
  if (treatmentTerms(t).some((term) => padded.includes(` ${term} `))) return 'exact';
  const singleWordTerms = treatmentTerms(t).filter((term) => !term.includes(' ') && term.length >= 5);
  return words.some((w) => singleWordTerms.some((term) => editDistanceAtMostOne(w, term))) ? 'fuzzy' : null;
}

// Todos los tratamientos mencionados ("info de ortodoncia o carillas"): primero las coincidencias exactas,
// luego las que tienen 1 error de tipeo (en palabras de 5+ letras), en el orden de la clínica.
export function findTreatments(text) {
  const value = normalizeText(text);
  if (!value) return [];
  const padded = ` ${value} `;
  const words = value.split(' ').filter((w) => w.length >= 5);
  const found = activeTreatments().map((t) => ({ t, kind: mentionKind(t, padded, words) })).filter((m) => m.kind);
  return [...found.filter((m) => m.kind === 'exact'), ...found.filter((m) => m.kind === 'fuzzy')].map((m) => m.t);
}

// El tratamiento mencionado en un texto libre (el primero si hay varios).
export function findTreatment(text) {
  return findTreatments(text)[0] || null;
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
    logoUrl: mediaPath('logo'),
    treatments: activeTreatments().map(({ key, name }) => ({ key, name })),
    colors: clinic.colors || null,
    quickReplies: clinic.quickReplies || [],
  };
}
