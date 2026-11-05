import crypto from 'crypto';
import activeClinic, { getPublicBaseUrl } from '../../config/clinic.config.js';
import { evaluationPackView } from '../catalog.js';
import { color, esc, localImageDataUri, renderPng, wrapText } from './render.js';

// Tarjeta del pack de evaluación en PNG, armada con los datos y colores de la clínica (nada escrito a mano).
// Se sirve en GET /cards/evaluation-pack.png?v=<huella>: si cambia el pack, cambia la URL y WhatsApp no usa
// una copia vieja. No contiene datos de pacientes.

const W = 1080;
const H = 760;

// Arco dental decorativo (dientes sobre un arco, más grandes adelante).
function dentalArch(cx, baseY, accent) {
  const teeth = [];
  for (let i = 0; i < 14; i += 1) {
    const angle = Math.PI * (0.04 + (0.92 * i) / 13);
    const x = cx + Math.cos(angle) * 135;
    const y = baseY - Math.sin(angle) * 250;
    const r = 12 + Math.sin(angle) * 9;
    teeth.push(`<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${r.toFixed(1)}" ry="${(r * 1.15).toFixed(1)}" fill="#e6fffb" fill-opacity="0.92" stroke="${accent}" stroke-width="3"/>`);
  }
  return teeth.join('');
}

const shortDate = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : null);

export function packCardSvg(clinic = activeClinic, today) {
  const view = evaluationPackView(clinic, today);
  if (!view) return null;
  const primary = color(clinic.colors?.primary, '#0f766e');
  const accent = color(clinic.colors?.accent, '#14b8a6');
  const logo = localImageDataUri(clinic.id, clinic.media?.logo);
  const title = wrapText(view.title, 22, 2);
  const includes = view.includes.slice(0, 5);
  const price = view.promoText ? (view.promoPriceText || view.priceText) : view.priceText;
  const until = shortDate(clinic.evaluationPack?.promotion?.validUntil);
  const promo = view.promoText ? `${view.promoText}${view.untilText && until ? ` · hasta el ${until}` : ''}` : null;
  const titleSvg = title.map((line, i) => `<text x="64" y="${150 + i * 64}" font-size="56" font-weight="800" fill="#ffffff">${esc(line)}</text>`).join('');
  const listTop = 150 + title.length * 64 + 40;
  const listSvg = includes.map((item, i) => {
    const y = listTop + i * 62;
    return `<circle cx="470" cy="${y - 12}" r="17" fill="${accent}"/><path d="M462 ${y - 12} l6 6 l11 -12" stroke="#05222a" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`
      + `<text x="504" y="${y}" font-size="32" font-weight="700" fill="#e6fffb">${esc(wrapText(item, 30, 1)[0])}</text>`;
  }).join('');
  const was = view.promoText && view.priceText && view.promoPriceText && view.priceText !== view.promoPriceText
    ? `<text x="${W - 96}" y="${H - 104}" font-size="26" fill="#9fb8bf" text-anchor="end" text-decoration="line-through">${esc(view.priceText)}</text>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#071a22"/><stop offset="1" stop-color="${primary}"/></linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${accent}" stop-opacity="0.35"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="${W}" height="${H}" rx="36" fill="url(#bg)"/>
  <rect x="24" y="24" width="${W - 48}" height="${H - 48}" rx="28" fill="none" stroke="${accent}" stroke-opacity="0.35" stroke-width="2"/>
  <text x="64" y="86" font-size="24" font-weight="800" letter-spacing="4" fill="${accent}">PRIMERA VISITA</text>
  ${logo ? `<image href="${logo}" x="${W - 168}" y="52" width="104" height="104" preserveAspectRatio="xMidYMid meet"/>` : ''}
  ${titleSvg}
  <circle cx="230" cy="420" r="200" fill="url(#glow)"/>
  ${dentalArch(230, 540, accent)}
  ${listSvg}
  <rect x="56" y="${H - 168}" width="${W - 112}" height="104" rx="22" fill="#04141a" fill-opacity="0.75" stroke="${accent}" stroke-opacity="0.6"/>
  <text x="96" y="${H - 108}" font-size="28" font-weight="700" fill="#e6fffb">${esc(wrapText(view.title, 28, 1)[0])}</text>
  ${promo ? `<text x="96" y="${H - 78}" font-size="22" font-weight="700" fill="#fcd34d">${esc(wrapText(promo, 60, 1)[0])}</text>` : ''}
  ${was}
  ${price ? `<text x="${W - 96}" y="${H - (was ? 72 : 96)}" font-size="${was ? 40 : 44}" font-weight="800" fill="#ffffff" text-anchor="end">${esc(price)}</text>` : ''}
  <text x="${W / 2}" y="${H - 34}" font-size="18" fill="#9fb8bf" text-anchor="middle">${esc(clinic.name)}</text>
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
