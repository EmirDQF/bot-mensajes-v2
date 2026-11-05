import qrcode from 'qrcode-generator';
import activeClinic, { reminderHours } from '../../config/clinic.config.js';
import { formatDateEs, formatTimeEs } from '../appointmentService.js';
import { color, esc, localImageDataUri, renderPng, wrapText } from './render.js';

// "Pase de cita" en PNG con los colores y el logo de la clínica. Solo para citas CONFIRMADAS con código.
// El QR contiene SOLO el código corto (ej. DV-0472): nada de nombre, teléfono ni fecha.
// Se genera a pedido desde la fila de la cita: no se guarda el archivo ni queda en una URL pública.

const W = 1080;
// Sin cortar "4:30 p. m." en dos líneas.
const NBSP = '\u00a0';
const keepTogether = (text) => String(text).replace(/ ([ap])\. m\./g, `${NBSP}$1.${NBSP}m.`);
const capitalize = (text) => String(text || '').charAt(0).toUpperCase() + String(text || '').slice(1);

export function canHavePass(appointment) {
  return Boolean(appointment?.code) && appointment.status === 'confirmada';
}

// Matriz del QR como un solo <path> (módulos oscuros).
export function qrPath(text, x, y, size) {
  const qr = qrcode(0, 'M');
  qr.addData(String(text));
  qr.make();
  const count = qr.getModuleCount();
  const cell = size / count;
  let d = '';
  for (let r = 0; r < count; r += 1) {
    for (let c = 0; c < count; c += 1) {
      if (qr.isDark(r, c)) d += `M${(x + c * cell).toFixed(2)} ${(y + r * cell).toFixed(2)}h${cell.toFixed(2)}v${cell.toFixed(2)}h-${cell.toFixed(2)}z`;
    }
  }
  return `<path d="${d}" fill="#0b1f26"/>`;
}

function rowsFor(appointment, clinic) {
  const when = `${capitalize(formatDateEs(appointment.appointment_date))} · ${keepTogether(formatTimeEs(appointment.appointment_time))}`;
  return [
    ['PACIENTE', appointment.patient_name || 'Paciente'],
    ['TRATAMIENTO', appointment.treatment || 'Evaluación'],
    ['FECHA Y HORA', when],
    ...(appointment.specialist ? [['ESPECIALISTA', appointment.specialist]] : []),
    ['LUGAR', clinic.address],
  ];
}

// Campana dibujada (resvg no tiene fuente de emojis).
const bell = (x, y, fill) => `<path d="M${x} ${y + 16} h22 l-3 -4 v-7 a8 8 0 0 0 -16 0 v7 z M${x + 8} ${y + 18} a3 3 0 0 0 6 0 z" fill="${fill}"/>`;

export function appointmentPassSvg(appointment, clinic = activeClinic) {
  if (!canHavePass(appointment)) return null;
  const primary = color(clinic.colors?.primary, '#0f766e');
  const accent = color(clinic.colors?.accent, '#14b8a6');
  const logo = localImageDataUri(clinic.id, clinic.media?.logo);
  const rows = rowsFor(appointment, clinic);
  const M = 28; // margen: el "papel" del pase sobre un fondo, para que los cortes laterales se vean reales
  const CW = W - M * 2;
  const pageBg = '#e7eef0';
  let y = M + 300;
  const rowSvg = rows.map(([label, value]) => {
    const lines = wrapText(value, 34, label === 'LUGAR' ? 3 : 2);
    const block = `<text x="${M + 52}" y="${y}" font-size="23" font-weight="700" letter-spacing="2.5" fill="#8a9ca2">${label}</text>`
      + lines.map((line, i) => `<text x="${W - M - 52}" y="${y + i * 42}" font-size="34" font-weight="800" fill="#0b2a33" text-anchor="end">${esc(line)}</text>`).join('');
    y += 42 * lines.length + 30;
    return block;
  }).join('');
  const cutY = y + 6;
  const qrSize = 290;
  const qrTop = cutY + 56;
  const hours = Object.values(reminderHours(clinic)).filter(Boolean);
  const reminder = hours.length ? `Recordatorio ${hours.map((h) => `${h} h`).join(' y ')} antes: programado` : null;
  const H = qrTop + qrSize + 92 + M;
  const bring = clinic.evaluationPack?.bring || '';
  const note = `Presenta este pase en recepción.${bring ? ` ${bring}` : ''}`;
  const name = clinic.name.toUpperCase();
  const textX = logo ? M + 196 : M + 52;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="hd" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#06161d"/><stop offset="1" stop-color="${primary}"/></linearGradient>
    <clipPath id="card"><rect x="${M}" y="${M}" width="${CW}" height="${H - M * 2}" rx="36"/></clipPath>
    <clipPath id="head"><rect x="${M}" y="${M}" width="${CW}" height="240" rx="36"/></clipPath>
    <clipPath id="logoClip"><rect x="${M + 48}" y="${M + 56}" width="120" height="120" rx="28"/></clipPath>
  </defs>
  <rect width="${W}" height="${H}" fill="${pageBg}"/>
  <g clip-path="url(#card)">
    <rect x="${M}" y="${M}" width="${CW}" height="${H - M * 2}" fill="#ffffff"/>
    <rect x="${M}" y="${M}" width="${CW}" height="240" fill="url(#hd)"/>
  </g>
  <g clip-path="url(#head)">
    <circle cx="${W - M - 70}" cy="${M + 30}" r="150" fill="${accent}" fill-opacity="0.10"/>
    <circle cx="${W - M - 10}" cy="${M + 200}" r="90" fill="${accent}" fill-opacity="0.08"/>
  </g>
  ${logo ? `<image href="${logo}" x="${M + 48}" y="${M + 56}" width="120" height="120" preserveAspectRatio="xMidYMid slice" clip-path="url(#logoClip)"/>` : ''}
  <text x="${textX}" y="${M + 92}" font-size="${name.length > 30 ? 19 : 23}" font-weight="800" letter-spacing="3" fill="${accent}">${esc(name.slice(0, 44))}</text>
  <text x="${textX}" y="${M + 158}" font-size="64" font-weight="800" fill="#ffffff">PASE DE CITA</text>
  <rect x="${W - M - 300}" y="${M + 178}" width="252" height="50" rx="25" fill="${accent}" fill-opacity="0.18" stroke="${accent}" stroke-width="2.5"/>
  <text x="${W - M - 174}" y="${M + 212}" font-size="25" font-weight="800" letter-spacing="2" fill="#ffffff" text-anchor="middle">✓ CONFIRMADA</text>
  ${rowSvg}
  <line x1="${M + 40}" y1="${cutY}" x2="${W - M - 40}" y2="${cutY}" stroke="#cfd9dc" stroke-width="3" stroke-dasharray="14 12"/>
  <circle cx="${M}" cy="${cutY}" r="24" fill="${pageBg}"/><circle cx="${W - M}" cy="${cutY}" r="24" fill="${pageBg}"/>
  <rect x="${M + 40}" y="${qrTop - 16}" width="${qrSize + 32}" height="${qrSize + 32}" rx="20" fill="#ffffff" stroke="#e2e8ea" stroke-width="2"/>
  ${qrPath(appointment.code, M + 56, qrTop, qrSize)}
  <text x="${M + 410}" y="${qrTop + 40}" font-size="23" font-weight="700" letter-spacing="2.5" fill="#8a9ca2">CÓDIGO DE CITA</text>
  <text x="${M + 406}" y="${qrTop + 124}" font-size="86" font-weight="800" fill="#0b2a33">${esc(appointment.code)}</text>
  ${wrapText(note, 32, 3).map((line, i) => `<text x="${M + 410}" y="${qrTop + 180 + i * 36}" font-size="27" fill="#4b5f66">${esc(line)}</text>`).join('')}
  ${reminder ? `${bell(M + 410, qrTop + 272, '#f59e0b')}<text x="${M + 442}" y="${qrTop + 290}" font-size="23" font-weight="800" fill="${primary}">${esc(reminder)}</text>` : ''}
</svg>`;
}

export function appointmentPassPng(appointment, clinic = activeClinic) {
  const svg = appointmentPassSvg(appointment, clinic);
  return svg ? renderPng(svg) : null;
}

export default { appointmentPassSvg, appointmentPassPng, canHavePass };
