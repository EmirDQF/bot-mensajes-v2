// npm run cards:preview [-- <id>] — guarda en tmp/cards-<id>/ las imágenes que el bot envía (tarjeta del pack,
// pase de cita de ejemplo y catálogo) y una hoja con todas juntas, para revisarlas antes de una demo.
// Usa un paciente INVENTADO para el pase. No toca Supabase ni WhatsApp.
import fs from 'fs';
import path from 'path';

const id = process.argv.slice(2).find((a) => !a.startsWith('--'));
if (id) process.env.ACTIVE_CLINIC = id;

const { default: clinic } = await import('../config/clinic.config.js');
const { packCardPng } = await import('../services/cards/packCard.js');
const { appointmentPassPng } = await import('../services/cards/appointmentPass.js');
const { doctorCardText } = await import('../services/doctorAlert.js');

const outDir = path.join(process.cwd(), 'tmp', `cards-${clinic.id}`);
fs.mkdirSync(outDir, { recursive: true });

const today = new Intl.DateTimeFormat('en-CA', { timeZone: clinic.timezone || 'America/Lima' }).format(new Date());
// Primer día con atención desde dentro de 3 días (el pase de ejemplo nunca cae en un día cerrado).
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
let inThreeDays = null;
for (let i = 3; i < 10 && !inThreeDays; i += 1) {
  const date = new Date(Date.parse(`${today}T12:00:00Z`) + i * 86400000);
  if ((clinic.workingHours?.[DAY_KEYS[date.getUTCDay()]] || []).length) inThreeDays = date.toISOString().slice(0, 10);
}
const prefix = (clinic.appointmentCodePrefix || clinic.name.replace(/[^A-Za-z]/g, '').slice(0, 2) || 'CL').toUpperCase();
const sample = {
  code: `${prefix}-0472`,
  status: 'confirmada',
  confirmed_by: 'bot',
  patient_name: 'Carlos Mendoza',
  treatment: 'Evaluación Ortodoncia + Carillas',
  appointment_date: inThreeDays,
  appointment_time: '16:30',
  specialist: clinic.specialists?.[0]?.name || null,
  sender_phone: '51900000000',
};

const written = [];
const save = (file, buffer) => {
  if (!buffer) return;
  fs.writeFileSync(path.join(outDir, file), buffer);
  written.push(file);
};
save('pack.png', packCardPng(clinic, today));
save('pase.png', appointmentPassPng(sample, clinic));
for (const t of clinic.treatments) {
  for (const img of t.images || []) {
    const src = path.join(process.cwd(), 'media', clinic.id, img.file);
    if (fs.existsSync(src)) save(`catalogo-${path.basename(img.file)}`, fs.readFileSync(src));
  }
}
fs.writeFileSync(path.join(outDir, 'ficha-doctor.txt'), `${doctorCardText(sample, { interest: ['Ortodoncia', 'Carillas'], clinic })}\n`);

console.log(`🖼️  ${clinic.name}: ${written.length} imágenes en tmp/cards-${clinic.id}/`);
for (const file of [...written, 'ficha-doctor.txt']) console.log(`   • ${file}`);
