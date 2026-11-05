import qrcode from 'qrcode-generator';
import activeClinic from '../../config/clinic.config.js';
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

export function appointmentPassSvg(appointment, clinic = activeClinic) {
  if (!canHavePass(appointment)) return null;
  const primary = color(clinic.colors?.primary, '#0f766e');
  const accent = color(clinic.colors?.accent, '#14b8a6');
  const logo = localImageDataUri(clinic.id, clinic.media?.logo);
  const rows = rowsFor(appointment, clinic);
  let y = 330;
  const rowSvg = rows.map(([label, value]) => {
    const lines = wrapText(value, 38, label === 'LUGAR' ? 3 : 2);
    const block = `<text x="72" y="${y}" font-size="24" font-weight="700" letter-spacing="2" fill="#7b8f95">${label}</text>`
      + lines.map((line, i) => `<text x="${W - 72}" y="${y + i * 40}" font-size="34" font-weight="700" fill="#0b2a33" text-anchor="end">${esc(line)}</text>`).join('');
    y += 40 * lines.length + 34;
    return block;
  }).join('');
  const cutY = y + 10;
  const qrSize = 300;
  const qrTop = cutY + 60;
  const H = qrTop + qrSize + 110;
  const bring = clinic.evaluationPack?.bring || 'Presenta este pase en recepción.';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs><linearGradient id="hd" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#071a22"/><stop offset="1" stop-color="${primary}"/></linearGradient></defs>
  <rect width="${W}" height="${H}" rx="40" fill="#ffffff"/>
  <path d="M0 40 Q0 0 40 0 H${W - 40} Q${W} 0 ${W} 40 V250 H0 Z" fill="url(#hd)"/>
  ${logo ? `<image href="${logo}" x="64" y="62" width="120" height="120" preserveAspectRatio="xMidYMid meet"/>` : ''}
  <text x="${logo ? 212 : 72}" y="96" font-size="24" font-weight="800" letter-spacing="3" fill="${accent}">${esc(clinic.name.toUpperCase().slice(0, 40))}</text>
  <text x="${logo ? 212 : 72}" y="160" font-size="62" font-weight="800" fill="#ffffff">PASE DE CITA</text>
  <g transform="rotate(-4 ${W - 190} 128)">
    <rect x="${W - 330}" y="92" width="270" height="72" rx="14" fill="#fef3c7" stroke="#f59e0b" stroke-width="4"/>
    <text x="${W - 195}" y="140" font-size="32" font-weight="800" fill="#92400e" text-anchor="middle">✓ CONFIRMADA</text>
  </g>
  ${rowSvg}
  <line x1="48" y1="${cutY}" x2="${W - 48}" y2="${cutY}" stroke="#cfd9dc" stroke-width="3" stroke-dasharray="14 12"/>
  <circle cx="0" cy="${cutY}" r="26" fill="#0b1f26" fill-opacity="0.12"/><circle cx="${W}" cy="${cutY}" r="26" fill="#0b1f26" fill-opacity="0.12"/>
  <rect x="64" y="${qrTop - 16}" width="${qrSize + 32}" height="${qrSize + 32}" rx="18" fill="#ffffff" stroke="#e2e8ea" stroke-width="2"/>
  ${qrPath(appointment.code, 80, qrTop, qrSize)}
  <text x="440" y="${qrTop + 50}" font-size="24" font-weight="700" letter-spacing="2" fill="#7b8f95">CÓDIGO DE CITA</text>
  <text x="440" y="${qrTop + 130}" font-size="88" font-weight="800" fill="#0b2a33">${esc(appointment.code)}</text>
  ${wrapText(bring, 34, 3).map((line, i) => `<text x="440" y="${qrTop + 190 + i * 36}" font-size="28" fill="#4b5f66">${esc(line)}</text>`).join('')}
  <text x="440" y="${qrTop + 310}" font-size="24" font-weight="700" fill="${primary}">Te enviaremos un recordatorio por aquí.</text>
</svg>`;
}

export function appointmentPassPng(appointment, clinic = activeClinic) {
  const svg = appointmentPassSvg(appointment, clinic);
  return svg ? renderPng(svg) : null;
}

export default { appointmentPassSvg, appointmentPassPng, canHavePass };
