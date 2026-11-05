// npm run quick-demo — demo personalizada para un prospecto en menos de 1 minuto, SIN tocar producción.
// Con su nombre, logo (opcional), colores, precios "desde", promoción, dirección y horario genera:
//   config/clinics/demo-<nombre>.js (validado: falla si queda un TODO) y media/demo-<nombre>/ con su logo y su
//   catálogo ilustrado (con sus colores, su nombre y "Imagen referencial"); además deja en tmp/cards-<id>/ la tarjeta
//   del pack, un pase de cita de ejemplo y la ficha del doctor para revisarlos.
// Luego: npm run demo:video -- demo-<nombre>   (Probador listo para grabar) o ACTIVE_CLINIC=demo-<nombre> npm run demo.
// Los archivos demo-* están en .gitignore: nunca se suben ni llegan a Render. Ningún teléfono va aquí.
//
// Uso:  npm run quick-demo                 (pregunta los datos)
//       npm run quick-demo -- datos.json   (ver docs/ventas/demo-rapida.md: name, address, hours, prices, ...)
import fs from 'fs';
import path from 'path';
import readline from 'readline/promises';
import { pathToFileURL } from 'url';
import demo from '../config/clinics/denvari.js';
import { findTodos, validateClinic } from '../config/clinic.config.js';
import { formatTimeEs } from '../services/appointmentService.js';
import { renderPng, esc } from '../services/cards/render.js';
import { catalogArtFor } from '../services/cards/catalogArt.js';
import { detectImageType } from '../services/clinicSettings.js';

const MAX_PRICE = 100000;
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
// Se dice solo lo que el sistema sabe: el resto lo confirma recepción (regla 14, nada inventado).
const NEUTRAL_FINANCING = 'Formas de pago: se coordinan en la evaluación';
const DEFAULT_COLORS = { primary: '#0f766e', accent: '#14b8a6' };
const HEX = /^#[0-9a-f]{6}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const TREATMENT_KEYS = demo.treatments.map((t) => t.key);

// "Clínica Dental Ñandú & Cía" → "demo-nandu-cia" (sin "clínica dental", tildes ni símbolos).
export function demoIdFor(name) {
  const slug = String(name || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\b(?:clinica|consultorio|centro)\s+(?:dental|odontologic[oa])\b/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 34).replace(/-+$/, '');
  return `demo-${slug || 'prospecto'}`;
}

// "Clínica Dental Sonrisa Feliz" → "SF" (prefijo del código de cita y monograma del logo provisional).
export function initialsFor(name) {
  const words = String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\b(?:clinica|consultorio|centro|dental|odontologica|odontologico|odontologia|de|del|la|el|y)\b/gi, ' ')
    .split(/[^A-Za-z]+/).filter(Boolean);
  return (words.slice(0, 2).map((w) => w[0]).join('') || 'CL').toUpperCase().padEnd(2, 'X');
}

function requireText(value, label) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`Falta ${label}`);
  if (/\bTODO\b/.test(text)) throw new Error(`${label} todavía dice TODO`);
  return text;
}

function parsePrice(value, label) {
  const price = Number(String(value).replace(/[^\d.]/g, ''));
  if (!/\d/.test(String(value)) || !Number.isFinite(price) || price < 0 || price > MAX_PRICE) {
    throw new Error(`Precio inválido para ${label}: "${value}" (escribe solo el número en soles)`);
  }
  return price;
}

function parsePrices(prices) {
  const entries = Object.entries(prices || {}).filter(([, value]) => value !== '' && value !== null && value !== undefined);
  if (!entries.length) throw new Error('Pon al menos un precio "desde" (ej. ortodoncia: 1500)');
  return entries.map(([key, value]) => {
    if (!TREATMENT_KEYS.includes(key)) throw new Error(`"${key}" no es un tratamiento conocido. Usa: ${TREATMENT_KEYS.join(', ')}`);
    const price = parsePrice(value, key);
    if (price <= 0) throw new Error(`Precio inválido para ${key}: "${value}" (escribe solo el número en soles)`);
    return [key, price];
  });
}

// ---------- Horario: "lun-vie 09:00-13:00,14:00-20:00; sab 09:00-14:00" ----------
const DAY_TOKENS = { lun: 'mon', mar: 'tue', mie: 'wed', jue: 'thu', vie: 'fri', sab: 'sat', dom: 'sun' };
const WEEK = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_NAMES = { mon: 'lunes', tue: 'martes', wed: 'miércoles', thu: 'jueves', fri: 'viernes', sat: 'sábado', sun: 'domingo' };
// Un solo día abierto se dice en plural ("sábados de…"); un rango, en singular ("lunes a sábado").
const DAY_PLURAL = { ...DAY_NAMES, sat: 'sábados', sun: 'domingos' };
const plainDay = (token) => DAY_TOKENS[String(token).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').slice(0, 3)];
const hhmm = (value) => {
  const m = String(value).trim().match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (!m || Number(m[1]) > 23 || Number(m[2] || 0) > 59) return null;
  return `${m[1].padStart(2, '0')}:${m[2] || '00'}`;
};

export function parseHours(text) {
  const source = requireText(text, 'el horario (ej. "lun-vie 09:00-20:00; sab 09:00-14:00")');
  const hours = Object.fromEntries(WEEK.map((d) => [d, []]));
  for (const part of source.split(/[;\n]+/).map((p) => p.trim()).filter(Boolean)) {
    const m = part.match(/^([a-záéíóú]+)(?:\s*-\s*([a-záéíóú]+))?\s+(.+)$/i);
    const from = m && plainDay(m[1]);
    const to = m && (m[2] ? plainDay(m[2]) : from);
    if (!from || !to) throw new Error(`No entiendo el horario "${part}". Ejemplo: "lun-vie 09:00-20:00; sab 09:00-14:00"`);
    const days = WEEK.slice(WEEK.indexOf(from), WEEK.indexOf(to) + 1);
    if (!days.length) throw new Error(`Rango de días al revés en "${part}"`);
    if (/^cerrado$/i.test(m[3].trim())) { for (const d of days) hours[d] = []; continue; }
    const ranges = m[3].split(',').map((r) => r.split('-').map(hhmm));
    if (ranges.some(([a, b]) => !a || !b || a >= b)) throw new Error(`Horas inválidas en "${part}" (usa 09:00-13:00,14:00-20:00)`);
    for (const d of days) hours[d] = ranges;
  }
  if (!WEEK.some((d) => hours[d].length)) throw new Error('El horario no tiene ningún día abierto');
  return hours;
}

// "Lunes a viernes de 9:00 a. m. a 8:00 p. m. y sábados de 9:00 a. m. a 2:00 p. m."
export function hoursText(hours) {
  const groups = [];
  for (const day of WEEK) {
    const key = JSON.stringify(hours[day] || []);
    const last = groups.at(-1);
    if (last && last.key === key) last.days.push(day); else groups.push({ key, days: [day], ranges: hours[day] || [] });
  }
  const parts = groups.filter((g) => g.ranges.length).map((g) => {
    const label = g.days.length > 1 ? `${DAY_NAMES[g.days[0]]} a ${DAY_NAMES[g.days.at(-1)]}` : DAY_PLURAL[g.days[0]];
    return `${label} de ${g.ranges.map(([a, b]) => `${formatTimeEs(a)} a ${formatTimeEs(b)}`).join(' y de ')}`;
  });
  const text = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} y ${parts.at(-1)}` : parts[0];
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}${text.endsWith('.') ? '' : '.'}`;
}

function parseColors(colors) {
  if (!colors) return DEFAULT_COLORS;
  const primary = String(colors.primary || '').trim();
  const accent = String(colors.accent || colors.primary || '').trim();
  if (!HEX.test(primary) || !HEX.test(accent)) throw new Error('Los colores van en formato #RRGGBB (ej. "#7c3aed")');
  return { primary, accent };
}

// Pack de la primera visita: solo con lo que dio el prospecto (qué incluye y precio). Sin datos, no hay tarjeta.
function parsePack(pack, promotion) {
  if (!pack) return undefined;
  const includes = (Array.isArray(pack.includes) ? pack.includes : String(pack.includes || '').split(','))
    .map((s) => String(s).trim()).filter(Boolean);
  if (!includes.length) throw new Error('El pack de evaluación necesita al menos un ítem en "incluye"');
  const result = { title: requireText(pack.title || 'Evaluación', 'el nombre del pack'), includes: includes.slice(0, 5) };
  if (pack.price !== undefined && pack.price !== '') result.price = parsePrice(pack.price, 'el pack');
  if (pack.bring) result.bring = requireText(pack.bring, 'qué debe traer');
  if (promotion?.text && promotion.packPrice !== undefined && promotion.packPrice !== '') {
    result.promotion = { text: promotion.text, price: parsePrice(promotion.packPrice, 'la promoción del pack'), ...(promotion.validUntil ? { validUntil: promotion.validUntil } : {}) };
  }
  return result;
}

function parsePromotion(promotion) {
  if (!promotion?.text) return null;
  const text = requireText(promotion.text, 'la promoción');
  if (promotion.validUntil && !DATE.test(promotion.validUntil)) throw new Error('La fecha de fin de la promoción va como AAAA-MM-DD');
  return { ...promotion, text };
}

export function buildQuickDemoClinic({
  name, address, campaign, prices, id = null, hours, colors, pack, promotion, specialist,
}) {
  const clinicName = requireText(name, 'el nombre de la clínica');
  const clinicAddress = requireText(address, 'la dirección (aunque sea "Distrito, Lima")');
  const adCampaign = requireText(campaign, 'la campaña de su anuncio (ej. "Brackets con inicial S/ 0")');
  const workingHours = parseHours(hours);
  const priced = new Map(parsePrices(prices));
  const promo = parsePromotion(promotion);
  const clinicId = id || demoIdFor(clinicName);
  const base = demo.treatments.filter((t) => priced.has(t.key))
    // Sin el catálogo de la demo: sus textos son de Denvari. El catálogo se regenera con los datos del prospecto.
    .map(({ images, ...t }) => ({ ...t, priceFrom: priced.get(t.key), financing: NEUTRAL_FINANCING }));
  const draft = { id: clinicId, name: clinicName, colors: parseColors(colors), treatments: base, media: { logo: 'logo.png' } };
  const art = new Map(catalogArtFor(draft).map((item) => [item.key, item]));
  const treatments = base.map((t) => (art.has(t.key) ? { ...t, images: [{ file: art.get(t.key).file, caption: art.get(t.key).caption }] } : t));
  const keys = new Set(treatments.map((t) => t.key));
  // Si no ofrece el tratamiento de una regla, se recomienda la evaluación sin nombrar precio.
  const recommendationRules = (demo.recommendationRules || []).map(({ treatmentKey, ...rule }) => (
    treatmentKey && keys.has(treatmentKey) ? { ...rule, treatmentKey } : rule));

  return {
    ...structuredClone(demo),
    id: clinicId,
    name: clinicName,
    address: clinicAddress,
    addressReference: undefined,
    latitude: undefined,
    longitude: undefined,
    mapsUrl: `https://maps.google.com/?q=${encodeURIComponent(clinicAddress)}`,
    reviewUrl: null,
    workingHours,
    workingHoursText: hoursText(workingHours),
    holidays: [],
    welcomeCaption: `¡Hola! 👋 Te damos la bienvenida a *${clinicName}* 🦷✨

Soy ${demo.botName}, tu asistente virtual. Este mes: ${adCampaign}.

Cuéntame:
👉 ¿Qué tratamiento o molestia dental quieres solucionar?
👉 ¿O prefieres que te proponga de una vez horarios para tu evaluación? 📅`,
    campaign: { ad: adCampaign },
    colors: draft.colors,
    treatments,
    media: { logo: 'logo.png' },
    recommendationRules,
    paymentMethods: [],
    promotions: promo ? [{ title: promo.text, active: true, ...(promo.validUntil ? { validUntil: promo.validUntil } : {}) }] : [],
    faq: [],
    evaluationPack: parsePack(pack, promo),
    // Es una demo: el bot confirma y envía el pase (en una clínica real se decide en el panel).
    bookingMode: 'confirmacion_directa',
    appointmentCodePrefix: initialsFor(clinicName),
    specialists: specialist ? [{ name: requireText(specialist, 'el especialista'), treatments: [...keys] }] : undefined,
  };
}

export function renderClinicSource(clinic, date = new Date().toISOString().slice(0, 10)) {
  return `// DEMO para un prospecto (${clinic.name}). Generado con scripts/quick-demo-clinic.js el ${date}.
// Solo para mostrar con "npm run demo:video -- ${clinic.id}": no es una clínica conectada.
// Ignorado por git (config/clinics/demo-*.js). Los teléfonos NO van aquí.
export default ${JSON.stringify(clinic, null, 2)};
`;
}

// Logo provisional: monograma con las iniciales y los colores del prospecto (hasta que envíe el suyo).
export function monogramSvg(clinic) {
  const { primary, accent } = clinic.colors;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${primary}"/><stop offset="1" stop-color="${accent}"/></linearGradient></defs>
  <rect width="512" height="512" rx="112" fill="url(#g)"/>
  <text x="256" y="318" font-size="190" font-weight="800" fill="#ffffff" text-anchor="middle">${esc(initialsFor(clinic.name))}</text>
</svg>`;
}

// Copia el logo del prospecto (solo JPG, PNG o WebP verificados por sus bytes, máx. 2 MB) o crea el monograma.
function writeLogo(clinic, mediaDir, logoPath) {
  if (logoPath) {
    const buffer = fs.readFileSync(logoPath);
    const type = detectImageType(buffer);
    if (!type || buffer.length > MAX_LOGO_BYTES) throw new Error('El logo debe ser JPG, PNG o WebP de hasta 2 MB');
    const file = `logo.${type === 'image/jpeg' ? 'jpg' : type.split('/')[1]}`;
    fs.writeFileSync(path.join(mediaDir, file), buffer);
    return file;
  }
  fs.writeFileSync(path.join(mediaDir, 'logo.png'), renderPng(monogramSvg(clinic), { width: 512 }));
  return 'logo.png';
}

// Escribe los archivos (root permite probarlo en una carpeta temporal). Nunca sobrescribe una demo existente.
export function createQuickDemoFiles(input, { root = process.cwd() } = {}) {
  const clinic = buildQuickDemoClinic(input);
  const configPath = path.join(root, 'config', 'clinics', `${clinic.id}.js`);
  if (fs.existsSync(configPath)) throw new Error(`Ya existe config/clinics/${clinic.id}.js: bórralo o usa otro nombre.`);
  const mediaDir = path.join(root, 'media', clinic.id);
  fs.mkdirSync(path.join(mediaDir, 'catalogo'), { recursive: true });
  clinic.media = { logo: writeLogo(clinic, mediaDir, input.logo) };
  const errors = [...validateClinic(clinic), ...findTodos(clinic).map((p) => `TODO en ${p}`)];
  if (errors.length) throw new Error(`La clínica de demo no es válida: ${errors.join(' | ')}`);
  // Catálogo con sus colores, su nombre y su logo.
  const art = catalogArtFor(clinic);
  for (const item of art) fs.writeFileSync(path.join(mediaDir, item.file), renderPng(item.svg, { width: 1080 }));
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, renderClinicSource(clinic));
  return { clinic, configPath, mediaDir, catalog: art.map((a) => a.file) };
}

async function askInput() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = async (q) => (await rl.question(q)).trim();
  try {
    const name = await ask('Nombre de la clínica (como en su anuncio): ');
    const address = await ask('Dirección: ');
    const hours = await ask('Horario (ej. lun-vie 09:00-13:00,14:00-20:00; sab 09:00-14:00): ');
    const campaign = await ask('Campaña de su anuncio en una línea (ej. Brackets con inicial S/ 0): ');
    const primary = await ask('Color principal #RRGGBB (Enter = verde azulado): ');
    const accent = primary ? await ask('Color de acento #RRGGBB (Enter = el mismo): ') : '';
    const logo = await ask('Ruta del logo JPG/PNG/WebP (Enter = monograma con sus iniciales): ');
    console.log('\nPrecios "desde" en soles (Enter = no lo ofrece):');
    const prices = {};
    for (const t of demo.treatments) prices[t.key] = await ask(`  ${t.name}: `);
    const packIncludes = await ask('\nPack de evaluación: qué incluye, separado por comas (Enter = sin pack): ');
    const pack = packIncludes ? {
      title: (await ask('  Nombre del pack (ej. Evaluación digital): ')) || 'Evaluación',
      includes: packIncludes,
      price: await ask('  Precio regular en soles (Enter = no mostrar precio): '),
      bring: (await ask('  Qué debe traer el paciente (Enter = nada): ')) || undefined,
    } : undefined;
    const promoText = await ask('Promoción vigente (ej. Evaluación sin costo) (Enter = ninguna): ');
    const promotion = promoText ? {
      text: promoText,
      validUntil: (await ask('  Fecha de fin AAAA-MM-DD (Enter = sin fecha): ')) || undefined,
      packPrice: pack ? await ask('  Precio del pack con la promoción (0 = sin costo, Enter = no aplica): ') : undefined,
    } : undefined;
    const specialist = (await ask('Especialista para el pase (Enter = ninguno): ')) || undefined;
    return {
      name, address, hours, campaign, prices, pack, promotion, specialist,
      colors: primary ? { primary, accent: accent || primary } : undefined, logo: logo || undefined,
    };
  } finally {
    rl.close();
  }
}

async function main() {
  const started = Date.now();
  const file = process.argv[2];
  let result;
  try {
    const input = file ? JSON.parse(fs.readFileSync(file, 'utf8')) : await askInput();
    result = createQuickDemoFiles(input);
  } catch (error) {
    console.error(`❌ ${error.message}`);
    process.exitCode = 1;
    return;
  }
  const { clinic, catalog } = result;
  console.log(`\n✅ config/clinics/${clinic.id}.js (${clinic.treatments.length} tratamientos, sin TODO)`);
  console.log(`🖼️  media/${clinic.id}/: ${clinic.media.logo}${catalog.length ? ` + catálogo (${catalog.length} ilustraciones "Imagen referencial")` : ''}`);
  if (!clinic.evaluationPack) console.log('ℹ️  Sin pack de evaluación: no habrá tarjeta del pack (pídele qué incluye y su precio).');
  // Vista previa de la tarjeta del pack, el pase y la ficha (proceso aparte: carga la clínica nueva).
  const { spawnSync } = await import('child_process');
  spawnSync(process.execPath, ['scripts/preview-cards.js', clinic.id], { stdio: 'inherit' });
  console.log(`\n⏱️  Listo en ${((Date.now() - started) / 1000).toFixed(1)} s`);
  console.log('\n▶️  Para grabar su video (Probador en modo noche, alertas a números falsos):');
  console.log(`   npm run demo:video -- ${clinic.id}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
