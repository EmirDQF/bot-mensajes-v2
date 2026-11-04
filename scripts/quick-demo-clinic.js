// npm run quick-demo — demo personalizada para un prospecto en 2 minutos, SIN tocar producción.
// Pide nombre, dirección, la campaña de su anuncio y sus precios "desde"; genera config/clinics/demo-<nombre>.js
// (validado: falla si queda un TODO) y media/demo-<nombre>/. Luego se prueba con
//   ACTIVE_CLINIC=demo-<nombre> npm run demo
// Los archivos demo-* están en .gitignore: nunca se suben ni llegan a Render. Ningún teléfono va aquí.
//
// Uso:  npm run quick-demo                 (pregunta los datos)
//       npm run quick-demo -- datos.json   ({ name, address, campaign, prices: { ortodoncia: 1500, ... } })
import fs from 'fs';
import path from 'path';
import readline from 'readline/promises';
import { pathToFileURL } from 'url';
import demo from '../config/clinics/denvari.js';
import { findTodos, validateClinic } from '../config/clinic.config.js';

const PLACE_MEDIA = ['logo', 'fachada', 'ubicacion'];
const MAX_PRICE = 100000;
// Se dice solo lo que el sistema sabe: el resto lo confirma recepción (regla 14, nada inventado).
const NEUTRAL_FINANCING = 'Formas de pago: se coordinan en la evaluación';

export const TREATMENT_KEYS = demo.treatments.map((t) => t.key);

// "Clínica Dental Ñandú & Cía" → "demo-nandu-cia" (sin "clínica dental", tildes ni símbolos).
export function demoIdFor(name) {
  const slug = String(name || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\b(?:clinica|consultorio|centro)\s+(?:dental|odontologic[oa])\b/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 34).replace(/-+$/, '');
  return `demo-${slug || 'prospecto'}`;
}

function requireText(value, label) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`Falta ${label}`);
  if (/\bTODO\b/.test(text)) throw new Error(`${label} todavía dice TODO`);
  return text;
}

function parsePrices(prices) {
  const entries = Object.entries(prices || {}).filter(([, value]) => value !== '' && value !== null && value !== undefined);
  if (!entries.length) throw new Error('Pon al menos un precio "desde" (ej. ortodoncia: 1500)');
  return entries.map(([key, value]) => {
    if (!TREATMENT_KEYS.includes(key)) throw new Error(`"${key}" no es un tratamiento conocido. Usa: ${TREATMENT_KEYS.join(', ')}`);
    const price = Number(String(value).replace(/[^\d.]/g, ''));
    if (!/\d/.test(String(value)) || !Number.isFinite(price) || price <= 0 || price > MAX_PRICE) {
      throw new Error(`Precio inválido para ${key}: "${value}" (escribe solo el número en soles)`);
    }
    return [key, price];
  });
}

export function buildQuickDemoClinic({ name, address, campaign, prices, id = null }) {
  const clinicName = requireText(name, 'el nombre de la clínica');
  const clinicAddress = requireText(address, 'la dirección (aunque sea "Distrito, Lima")');
  const adCampaign = requireText(campaign, 'la campaña de su anuncio (ej. "Brackets con inicial S/ 0")');
  const priced = new Map(parsePrices(prices));
  const treatments = demo.treatments.filter((t) => priced.has(t.key))
    .map((t) => ({ ...t, priceFrom: priced.get(t.key), financing: NEUTRAL_FINANCING }));
  const keys = new Set(treatments.map((t) => t.key));
  const media = Object.fromEntries(Object.entries(demo.media).filter(([key]) => PLACE_MEDIA.includes(key) || keys.has(key)));
  // Si no ofrece el tratamiento de una regla, se recomienda la evaluación sin nombrar precio.
  const recommendationRules = (demo.recommendationRules || []).map(({ treatmentKey, ...rule }) => (
    treatmentKey && keys.has(treatmentKey) ? { ...rule, treatmentKey } : rule));

  return {
    ...structuredClone(demo),
    id: id || demoIdFor(clinicName),
    name: clinicName,
    address: clinicAddress,
    mapsUrl: `https://maps.google.com/?q=${encodeURIComponent(clinicAddress)}`,
    reviewUrl: null,
    welcomeCaption: `¡Hola! 👋 Te damos la bienvenida a ${clinicName} 🦷✨

Soy ${demo.botName}, tu asistente virtual. Este mes: ${adCampaign}.

Cuéntame:
👉 ¿Qué tratamiento o molestia dental quieres solucionar?
👉 ¿O prefieres que te proponga de una vez horarios para tu evaluación? 📅`,
    campaign: { ad: adCampaign },
    treatments,
    media,
    recommendationRules,
    paymentMethods: [],
    promotions: [],
    faq: [],
  };
}

export function renderClinicSource(clinic, date = new Date().toISOString().slice(0, 10)) {
  return `// DEMO para un prospecto (${clinic.name}). Generado con scripts/quick-demo-clinic.js el ${date}.
// Solo para mostrar con "ACTIVE_CLINIC=${clinic.id} npm run demo": no es una clínica conectada.
// Ignorado por git (config/clinics/demo-*.js). Los teléfonos NO van aquí.
export default ${JSON.stringify(clinic, null, 2)};
`;
}

// Escribe los archivos (root permite probarlo en una carpeta temporal). Nunca sobrescribe.
export function createQuickDemoFiles(input, { root = process.cwd() } = {}) {
  const clinic = buildQuickDemoClinic(input);
  const errors = [...validateClinic(clinic), ...findTodos(clinic).map((p) => `TODO en ${p}`)];
  if (errors.length) throw new Error(`La clínica de demo no es válida: ${errors.join(' | ')}`);
  const configPath = path.join(root, 'config', 'clinics', `${clinic.id}.js`);
  if (fs.existsSync(configPath)) throw new Error(`Ya existe config/clinics/${clinic.id}.js: bórralo o usa otro nombre.`);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, renderClinicSource(clinic));
  const mediaDir = path.join(root, 'media', clinic.id);
  fs.mkdirSync(mediaDir, { recursive: true });
  const missingMedia = Object.values(clinic.media).filter((file) => !fs.existsSync(path.join(mediaDir, file)));
  return { clinic, configPath, mediaDir, missingMedia };
}

async function askInput() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const name = await rl.question('Nombre de la clínica (como en su anuncio): ');
    const address = await rl.question('Dirección o "Distrito, Lima": ');
    const campaign = await rl.question('Campaña de su anuncio en una línea (ej. Brackets con inicial S/ 0): ');
    console.log('\nPrecios "desde" en soles (Enter = no lo ofrece):');
    const prices = {};
    for (const t of demo.treatments) prices[t.key] = (await rl.question(`  ${t.name}: `)).trim();
    return { name, address, campaign, prices };
  } finally {
    rl.close();
  }
}

async function main() {
  const file = process.argv[2];
  let result;
  try {
    const input = file ? JSON.parse(fs.readFileSync(file, 'utf8')) : await askInput();
    result = createQuickDemoFiles(input);
  } catch (error) {
    console.error(`❌ ${error.message}`);
    process.exit(1);
  }
  const { clinic, missingMedia } = result;
  const shortName = clinic.name.split(/\s+/).pop().toUpperCase();
  console.log(`\n✅ Creado config/clinics/${clinic.id}.js (${clinic.treatments.length} tratamientos, sin TODO)`);
  if (missingMedia.length) {
    console.log(`🖼️  Genera sus ilustraciones (${missingMedia.length} imágenes) con su nombre:`);
    console.log(`   pwsh scripts/generate-demo-media.ps1 -ClinicId ${clinic.id} -ClinicName "${clinic.name}" -ShortName "${shortName}" -AddressLine "${clinic.address}" -AddressNote "" -Footnote "Imagen referencial"`);
  }
  console.log('\n▶️  Pruébala (no toca producción ni Render):');
  console.log(`   PowerShell:  $env:ACTIVE_CLINIC="${clinic.id}"; npm run demo`);
  console.log(`   Git Bash:    ACTIVE_CLINIC=${clinic.id} npm run demo`);
  console.log('   Luego /panel → 🧪 Probador → "Simular 10:30 p. m." (guía: docs/ventas/demo-rapida.md)');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
