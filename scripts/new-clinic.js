// npm run new-clinic -- <id> "<Nombre de la clínica>"
// Crea config/clinics/<id>.js a partir de la demo, con "TODO" en cada dato que hay que reemplazar,
// crea media/<id>/ y lista lo que falta. El bot no arranca mientras quede algún TODO.
// Nunca sobrescribe una clínica existente.
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import demo from '../config/clinics/denvari.js';

const ID_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;
const q = (value) => `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const list = (items) => `[${items.map(q).join(', ')}]`;

export function buildClinicSource({ id, name, date = new Date().toISOString().slice(0, 10) }) {
  const hours = Object.entries(demo.workingHours)
    .map(([day, ranges]) => `    ${day}: [${ranges.map(([from, to]) => `[${q(from)}, ${q(to)}]`).join(', ')}],`)
    .join('\n');
  const treatments = demo.treatments.map((t) => `    {
      key: ${q(t.key)},
      name: ${q(t.name)},
      priceFrom: 'TODO', // número en soles, precio "desde" (ej. ${t.priceFrom})
      durationMin: ${t.durationMin},
      financing: 'TODO: cómo se paga (ej. "Cuota inicial S/ 0 y mensualidades" o "Pago único")',
      synonyms: ${list(t.synonyms)},
    },`).join('\n');
  const media = Object.entries(demo.media).map(([key, file]) => `    ${key}: ${q(file)},`).join('\n');

  return `// Clínica: ${name}. Generado con scripts/new-clinic.js el ${date}.
// Reemplaza cada "TODO" con los datos reales: el bot NO arranca mientras quede alguno.
// Guía de lo que hay que pedirle a la clínica: docs/onboarding-cliente.md
// Los teléfonos NO van aquí: se leen de CLINIC_PHONE, RECEPTION_ALERT_PHONE y OWNER_ALERT_PHONE.
// Si un tratamiento no se ofrece, borra su bloque (y su imagen en media: {...}).

export default {
  id: ${q(id)},
  name: ${q(name)},
  botName: ${q(demo.botName)}, // nombre de la asistente virtual; si lo cambias, cámbialo también en welcomeCaption
  city: 'Lima',
  address: 'TODO: dirección completa (calle, número, distrito)',
  mapsUrl: 'TODO: enlace de Google Maps de la clínica (Compartir → Copiar enlace)',
  // Opcional: enlace de reseñas de Google. Si existe, al marcar "asistió" en el panel se pide una reseña.
  reviewUrl: null,
  timezone: ${q(demo.timezone)},

  // Rangos [inicio, fin] en formato HH:MM por día. Día sin rangos = cerrado. Revísalos con la clínica.
  workingHours: {
${hours}
  },
  workingHoursText: 'TODO: el mismo horario en texto (ej. Lunes a viernes de 9:00 a. m. a 8:00 p. m. y sábados de 9:00 a. m. a 2:00 p. m.)',
  slotMinutes: ${demo.slotMinutes},

  welcomeCaption: \`¡Hola! 👋 Te damos la bienvenida a ${name.replace(/[`$\\]/g, '')} 🦷✨

Soy ${demo.botName}, tu asistente virtual. TODO: campaña del mes en una línea (ej. este mes la evaluación es sin costo y puedes pagar en cuotas).

Cuéntame:
👉 ¿Qué tratamiento o molestia dental quieres solucionar?
👉 ¿O prefieres que te proponga de una vez horarios para tu evaluación? 📅\`,

  privacyNotice: ${q(demo.privacyNotice)},

  // Solo lo que la clínica realmente ofrece este mes (el bot no inventa descuentos).
  campaign: {
    evaluation: 'TODO: ej. Evaluación sin costo',
    initialFee: 'TODO: ej. Cuota inicial S/ 0 (borra esta línea si no aplica)',
    installments: 'TODO: ej. Pago en cuotas con tarjeta',
  },

  treatments: [
${treatments}
  ],

  // Archivos dentro de media/${id}/. Claves de tratamiento = treatments[].key.
  // Fotos reales solo con consentimiento escrito del paciente; si no, ilustraciones (scripts/generate-demo-media.ps1).
  media: {
${media}
  },

  faq: [
    { q: '¿La evaluación tiene costo?', a: 'TODO' },
    { q: '¿Qué medios de pago aceptan?', a: 'TODO: ej. Tarjetas, Yape, Plin y efectivo.' },
    { q: '¿Atienden niños?', a: 'TODO' },
    { q: '¿Hay estacionamiento?', a: 'TODO' },
  ],
};
`;
}

// Crea los archivos. root permite probarlo en una carpeta temporal.
export function createClinicFiles({ id, name, root = process.cwd() }) {
  if (!ID_RE.test(String(id || ''))) {
    throw new Error('El id debe ir en minúsculas, sin espacios ni tildes (letras, números y guiones), ej. sonrisa-surco');
  }
  if (!String(name || '').trim()) throw new Error('Falta el nombre de la clínica, ej. "Clínica Dental Sonrisa"');
  const configPath = path.join(root, 'config', 'clinics', `${id}.js`);
  if (fs.existsSync(configPath)) throw new Error(`Ya existe config/clinics/${id}.js: no se sobrescribe. Edítalo directamente.`);
  const source = buildClinicSource({ id, name: name.trim() });
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, source);
  const mediaDir = path.join(root, 'media', id);
  fs.mkdirSync(mediaDir, { recursive: true });

  const todos = source.split('\n').map((line, i) => ({ line: i + 1, text: line.trim() })).filter((l) => /\bTODO\b/.test(l.text) && !l.text.startsWith('//'));
  const missingMedia = Object.values(demo.media).filter((file) => !fs.existsSync(path.join(mediaDir, file)));
  return { configPath, mediaDir, todos, missingMedia };
}

function main() {
  const [id, ...nameParts] = process.argv.slice(2);
  const name = nameParts.join(' ');
  if (!id || !name) {
    console.log('Uso: npm run new-clinic -- <id> "<Nombre de la clínica>"\nEjemplo: npm run new-clinic -- sonrisa-surco "Clínica Dental Sonrisa"');
    process.exit(1);
  }
  let result;
  try {
    result = createClinicFiles({ id, name });
  } catch (error) {
    console.error(`❌ ${error.message}`);
    process.exit(1);
  }
  const rel = (p) => path.relative(process.cwd(), p).replace(/\\/g, '/');
  console.log(`✅ Creado ${rel(result.configPath)}`);
  console.log(`✅ Creada la carpeta ${rel(result.mediaDir)}/\n`);
  console.log(`📝 Completa ${result.todos.length} datos marcados con TODO en ${rel(result.configPath)}:`);
  for (const todo of result.todos) console.log(`   línea ${String(todo.line).padStart(3)}: ${todo.text.slice(0, 110)}`);
  console.log(`\n🖼️  Faltan ${result.missingMedia.length} imágenes en ${rel(result.mediaDir)}/: ${result.missingMedia.join(', ')}`);
  console.log('   Fotos reales solo con consentimiento escrito del paciente. Si no hay, genera ilustraciones de la clínica:');
  console.log(`   pwsh scripts/generate-demo-media.ps1 -ClinicId ${id} -ClinicName "${name}" -ShortName "${name.split(/\s+/).pop().toUpperCase()}" -AddressLine "<dirección corta>" -AddressNote "" -Footnote "Imagen referencial"`);
  console.log('\n➡️  Después:');
  console.log(`   1. En .env y en Render: ACTIVE_CLINIC=${id} y los 3 teléfonos (CLINIC_PHONE, RECEPTION_ALERT_PHONE, OWNER_ALERT_PHONE).`);
  console.log('   2. npm run preflight  → todo en ✅ (el arranque falla con un mensaje claro si queda algún TODO).');
  console.log('   3. Sigue docs/onboarding-cliente.md para la prueba en vivo con el dueño.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
