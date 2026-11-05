import crypto from 'crypto';
import activeClinic, { getPublicBaseUrl } from '../../config/clinic.config.js';
import { evaluationPackView } from '../catalog.js';
import { color, esc, localImageDataUri, renderPng, wrapText } from './render.js';

// Tarjeta del pack de evaluación en PNG, armada con los datos y colores de la clínica (nada escrito a mano).
// Se sirve en GET /cards/evaluation-pack.png?v=<huella>: si cambia el pack, cambia la URL y WhatsApp no usa
// una copia vieja. No contiene datos de pacientes.

const W = 1080;
const H = 820;
const shortDate = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : null);

// Arco dental "escaneado" (vista oclusal): dientes como puntos sobre una U, con una línea de escaneo que brilla.
function scanArch(x, y, w, h, accent) {
  const cx = x + w / 2;
  const teeth = [];
  for (let i = 0; i < 14; i += 1) {
    const t = i / 13;
    const angle = Math.PI * (1 - t);
    const px = cx + Math.cos(angle) * w * 0.33;
    const py = y + h * 0.78 - Math.sin(angle) * h * 0.52;
    // Muelas (extremos) más grandes que los incisivos (adelante), como en una vista oclusal real.
    const r = 9 + (1 - Math.sin(angle)) * 9;
    teeth.push(`<ellipse cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" rx="${r.toFixed(1)}" ry="${(r * 1.2).toFixed(1)}" fill="#e8fbff" fill-opacity="0.95"/>`);
  }
  const grid = [];
  for (let gx = x + 30; gx < x + w; gx += 34) grid.push(`<line x1="${gx}" y1="${y + 14}" x2="${gx}" y2="${y + h - 14}" stroke="${accent}" stroke-opacity="0.08"/>`);
  for (let gy = y + 30; gy < y + h; gy += 34) grid.push(`<line x1="${x + 14}" y1="${gy}" x2="${x + w - 14}" y2="${gy}" stroke="${accent}" stroke-opacity="0.08"/>`);
  const scanY = y + h * 0.5;
  return `${grid.join('')}
  <rect x="${x + 14}" y="${scanY - 26}" width="${w - 28}" height="52" fill="url(#scanGlow)"/>
  ${teeth.join('')}
  <line x1="${x + 18}" y1="${scanY}" x2="${x + w - 18}" y2="${scanY}" stroke="${accent}" stroke-width="4" stroke-linecap="round"/>
  <circle cx="${x + 18}" cy="${scanY}" r="7" fill="${accent}"/><circle cx="${x + w - 18}" cy="${scanY}" r="7" fill="${accent}"/>`;
}

// Tira tipo radiografía panorámica: dos filas de dientes claros sobre fondo oscuro.
function panoramicStrip(x, y, w, h) {
  const n = 14;
  const gap = 4;
  const tw = (w - 40 - gap * (n - 1)) / n;
  const row = (top, height, up) => Array.from({ length: n }, (_, i) => {
    const tx = x + 20 + i * (tw + gap);
    const center = 1 - Math.abs(i - (n - 1) / 2) / ((n - 1) / 2);
    const th = height * (0.72 + center * 0.28);
    const ty = up ? top + height - th : top;
    return `<rect x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" width="${tw.toFixed(1)}" height="${th.toFixed(1)}" rx="${(tw / 2.4).toFixed(1)}" fill="#dfe9ec" fill-opacity="${(0.55 + center * 0.4).toFixed(2)}"/>`;
  }).join('');
  const half = (h - 44) / 2;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="22" fill="url(#xray)" stroke="#ffffff" stroke-opacity="0.08"/>
  ${row(y + 18, half, true)}${row(y + 26 + half, half, false)}`;
}

// "Pack Evaluación Digital 3D" → la última o las 2 últimas palabras en el color de acento (como en el video).
function titleSpans(title, accent) {
  const words = String(title).split(/\s+/).filter(Boolean);
  const cut = words.length >= 4 ? words.length - 2 : words.length >= 2 ? words.length - 1 : words.length;
  const head = words.slice(0, cut).join(' ');
  const tail = words.slice(cut).join(' ');
  return `${esc(head)}${tail ? `${head ? ' ' : ''}<tspan fill="${accent}">${esc(tail)}</tspan>` : ''}`;
}

export function packCardSvg(clinic = activeClinic, today) {
  const view = evaluationPackView(clinic, today);
  if (!view) return null;
  const primary = color(clinic.colors?.primary, '#0f766e');
  const accent = color(clinic.colors?.accent, '#14b8a6');
  const logo = localImageDataUri(clinic.id, clinic.media?.logo);
  const title = view.title.length > 34 ? wrapText(view.title, 34, 1)[0] : view.title;
  const includes = view.includes.slice(0, 4);
  const price = view.promoText ? (view.promoPriceText || view.priceText) : view.priceText;
  const was = view.promoText && view.priceText && view.promoPriceText && view.priceText !== view.promoPriceText ? view.priceText : null;
  const until = shortDate(clinic.evaluationPack?.promotion?.validUntil);
  const promo = view.promoText ? `${view.promoText}${view.untilText && until ? ` · hasta el ${until}` : ''}` : null;
  const listTop = 432;
  const listSvg = includes.map((item, i) => {
    const y = listTop + i * 50;
    return `<circle cx="508" cy="${y - 10}" r="15" fill="${accent}"/><path d="M501 ${y - 10} l5 5 l9 -10" stroke="#04161c" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`
      + `<text x="536" y="${y}" font-size="29" font-weight="700" fill="#eafcff">${esc(wrapText(item, 30, 1)[0])}</text>`;
  }).join('');
  const barY = 652;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <title>${esc(view.title)}</title>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#06131b"/><stop offset="0.65" stop-color="#0a1f2a"/><stop offset="1" stop-color="${primary}"/></linearGradient>
    <linearGradient id="panel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0d2a36"/><stop offset="1" stop-color="#081c25"/></linearGradient>
    <linearGradient id="xray" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b2f37"/><stop offset="0.5" stop-color="#0c1a20"/><stop offset="1" stop-color="#1b2f37"/></linearGradient>
    <linearGradient id="scanGlow" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${accent}" stop-opacity="0"/><stop offset="0.5" stop-color="${accent}" stop-opacity="0.35"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></linearGradient>
    <linearGradient id="bar" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${primary}"/><stop offset="1" stop-color="#062a2a"/></linearGradient>
  </defs>
  <rect width="${W}" height="${H}" rx="40" fill="url(#bg)"/>
  <rect x="18" y="18" width="${W - 36}" height="${H - 36}" rx="30" fill="none" stroke="${accent}" stroke-opacity="0.28" stroke-width="2"/>
  <text x="60" y="88" font-size="24" font-weight="800" letter-spacing="5" fill="${accent}">PRIMERA VISITA</text>
  <text x="60" y="152" font-size="${title.length > 26 ? 46 : 56}" font-weight="800" fill="#ffffff">${titleSpans(title, accent)}</text>
  ${logo ? `<clipPath id="logoClip"><rect x="${W - 172}" y="52" width="112" height="112" rx="26"/></clipPath><rect x="${W - 176}" y="48" width="120" height="120" rx="30" fill="#ffffff" fill-opacity="0.12"/><image href="${logo}" x="${W - 172}" y="52" width="112" height="112" preserveAspectRatio="xMidYMid slice" clip-path="url(#logoClip)"/>` : ''}
  <rect x="56" y="196" width="400" height="420" rx="26" fill="url(#panel)" stroke="${accent}" stroke-opacity="0.35" stroke-width="2"/>
  ${scanArch(56, 196, 400, 420, accent)}
  ${panoramicStrip(480, 196, 544, 176)}
  ${listSvg}
  <rect x="56" y="${barY}" width="${W - 112}" height="112" rx="24" fill="url(#bar)" stroke="${accent}" stroke-opacity="0.55" stroke-width="2"/>
  <text x="92" y="${barY + 48}" font-size="28" font-weight="800" fill="#ffffff">${esc(wrapText(view.title, 30, 1)[0])}</text>
  ${promo ? `<text x="92" y="${barY + 84}" font-size="23" font-weight="700" fill="#fcd34d">${esc(wrapText(promo, 44, 1)[0])}</text>` : `<text x="92" y="${barY + 84}" font-size="22" fill="#b9d3d8">${esc(clinic.name)}</text>`}
  ${was ? `<text x="${W - 96}" y="${barY + 40}" font-size="26" fill="#b9d3d8" text-anchor="end" text-decoration="line-through">${esc(was)}</text>` : ''}
  ${price ? `<text x="${W - 96}" y="${barY + (was ? 86 : 72)}" font-size="${was ? 44 : 50}" font-weight="800" fill="#ffffff" text-anchor="end">${esc(price)}</text>` : ''}
  <text x="${W / 2}" y="${H - 30}" font-size="18" fill="#8fb0b7" text-anchor="middle">${esc(clinic.name)}${clinic.address ? ` · ${esc(wrapText(clinic.address, 50, 1)[0])}` : ''}</text>
</svg>`;
}

// Huella del contenido: cambia cuando cambian el pack, los colores o la promo vigente.
export function packCardVersion(clinic = activeClinic, today) {
  const svg = packCardSvg(clinic, today);
  return svg ? crypto.createHash('sha1').update(svg).digest('hex').slice(0, 12) : null;
}

export function packCardUrl(clinic = activeClinic, today) {
  const version = packCardVersion(clinic, today);
  return version ? `${getPublicBaseUrl()}/cards/evaluation-pack.png?v=${version}` : null;
}

// PNG en memoria por huella (se regenera solo si cambia el contenido).
const cache = new Map();
export function packCardPng(clinic = activeClinic, today) {
  const svg = packCardSvg(clinic, today);
  if (!svg) return null;
  const key = crypto.createHash('sha1').update(svg).digest('hex');
  if (!cache.has(key)) {
    cache.clear();
    cache.set(key, renderPng(svg));
  }
  return cache.get(key);
}

export default { packCardSvg, packCardUrl, packCardPng, packCardVersion };
