import { color, esc, localImageDataUri, wrapText } from './render.js';

// Ilustraciones del catálogo (SVG) con los colores, el nombre y los precios "desde" de la clínica.
// Son DIBUJOS propios marcados como "Imagen referencial": nunca fotos de pacientes (regla 12).
// Los precios y el financiamiento salen de treatments[] de la configuración; si faltan, no se muestran.
// Las usan scripts/generate-catalog-media.js y npm run quick-demo (scripts/quick-demo-clinic.js).

const W = 1080;
const H = 1080;
const formatSoles = (value) => `S/ ${Number(value).toLocaleString('es-PE')}`;
const TEETH = [0.72, 0.82, 0.92, 1.05, 1.28, 1.28, 1.05, 0.92, 0.82, 0.72];

// Sonrisa ilustrada: labios, encía, dientes superiores con volumen y fila inferior.
// opts.toothFill(i, centerX) → color del diente; opts.brackets: { kind: 'metal' | 'zafiro' }.
export function smile(x, y, w, h, { id, toothFill = () => 'url(#enamel)', brackets = null }) {
  const lipsOuter = `M${x} ${y + h * 0.42} C${x + w * 0.2} ${y + h * 0.02} ${x + w * 0.8} ${y + h * 0.02} ${x + w} ${y + h * 0.42} C${x + w * 0.8} ${y + h * 1.06} ${x + w * 0.2} ${y + h * 1.06} ${x} ${y + h * 0.42} Z`;
  const mouth = `M${x + w * 0.06} ${y + h * 0.42} C${x + w * 0.26} ${y + h * 0.15} ${x + w * 0.74} ${y + h * 0.15} ${x + w * 0.94} ${y + h * 0.42} C${x + w * 0.74} ${y + h * 0.88} ${x + w * 0.26} ${y + h * 0.88} ${x + w * 0.06} ${y + h * 0.42} Z`;
  const total = TEETH.reduce((a, b) => a + b, 0);
  const innerW = w * 0.84;
  let cursor = x + (w - innerW) / 2;
  const upper = [];
  const lower = [];
  const attachments = [];
  const wirePoints = [];
  TEETH.forEach((size, i) => {
    const tw = (innerW * size) / total;
    const cx = cursor + tw / 2;
    const d = (cx - (x + w / 2)) / (innerW / 2); // -1 … 1
    const top = y + h * (0.2 + d * d * 0.1);
    const bottom = y + h * (0.6 - d * d * 0.07);
    const th = bottom - top;
    upper.push(`<rect x="${(cursor + 1.5).toFixed(1)}" y="${top.toFixed(1)}" width="${(tw - 3).toFixed(1)}" height="${th.toFixed(1)}" rx="${(tw * 0.32).toFixed(1)}" fill="${toothFill(i, cx)}"/>`
      + `<rect x="${(cursor + 1.5).toFixed(1)}" y="${top.toFixed(1)}" width="${(tw - 3).toFixed(1)}" height="${th.toFixed(1)}" rx="${(tw * 0.32).toFixed(1)}" fill="url(#toothShade)" fill-opacity="${(0.25 + Math.abs(d) * 0.55).toFixed(2)}"/>`);
    const ltop = y + h * (0.63 - d * d * 0.05);
    const lh = h * (0.2 - d * d * 0.04);
    lower.push(`<rect x="${(cursor + tw * 0.12).toFixed(1)}" y="${ltop.toFixed(1)}" width="${(tw * 0.76).toFixed(1)}" height="${lh.toFixed(1)}" rx="${(tw * 0.25).toFixed(1)}" fill="#e9e4d6"/>`);
    if (brackets) {
      const bw = Math.min(tw * 0.5, w * 0.05);
      const by = top + th * 0.5 - bw * 0.45;
      wirePoints.push([cx, by + bw * 0.45]);
      attachments.push(brackets.kind === 'metal'
        ? `<rect x="${(cx - bw / 2).toFixed(1)}" y="${by.toFixed(1)}" width="${bw.toFixed(1)}" height="${(bw * 0.9).toFixed(1)}" rx="${(bw * 0.18).toFixed(1)}" fill="url(#metal)" stroke="#6b737b" stroke-width="1.5"/>`
          + `<rect x="${(cx - bw * 0.18).toFixed(1)}" y="${by.toFixed(1)}" width="${(bw * 0.36).toFixed(1)}" height="${(bw * 0.9).toFixed(1)}" fill="#9aa3ab" fill-opacity="0.6"/>`
        : `<rect x="${(cx - bw / 2).toFixed(1)}" y="${by.toFixed(1)}" width="${bw.toFixed(1)}" height="${(bw * 0.9).toFixed(1)}" rx="${(bw * 0.22).toFixed(1)}" fill="#ffffff" fill-opacity="0.55" stroke="#c9d6dc" stroke-width="1.5"/>`);
    }
    cursor += tw;
  });
  const wire = wirePoints.length
    ? `<polyline points="${wirePoints.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(' ')}" fill="none" stroke="${brackets.kind === 'metal' ? '#7c858e' : '#d5dee2'}" stroke-width="3.5" stroke-linejoin="round"/>`
    : '';
  return `<clipPath id="${id}"><path d="${mouth}"/></clipPath>
  <path d="${lipsOuter}" fill="url(#lips)"/>
  <path d="${mouth}" fill="#3b1016"/>
  <g clip-path="url(#${id})">
    <rect x="${x}" y="${y + h * 0.1}" width="${w}" height="${h * 0.22}" fill="#e98f99"/>
    ${lower.join('')}${upper.join('')}${wire}${attachments.join('')}
  </g>
  <path d="M${x + w * 0.3} ${y + h * 0.9} Q${x + w / 2} ${y + h * 0.97} ${x + w * 0.7} ${y + h * 0.9}" stroke="#ffffff" stroke-opacity="0.25" stroke-width="6" fill="none" stroke-linecap="round"/>`;
}

const sharedDefs = (primary, accent) => `
  <linearGradient id="hd" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#06161d"/><stop offset="1" stop-color="${primary}"/></linearGradient>
  <linearGradient id="band" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${primary}"/><stop offset="1" stop-color="${accent}"/></linearGradient>
  <linearGradient id="lips" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c84f5d"/><stop offset="1" stop-color="#e17d87"/></linearGradient>
  <linearGradient id="enamel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f3efe4"/><stop offset="0.6" stop-color="#ffffff"/><stop offset="1" stop-color="#ece7da"/></linearGradient>
  <linearGradient id="yellowed" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d7bd7a"/><stop offset="0.6" stop-color="#ead39a"/><stop offset="1" stop-color="#cdb06c"/></linearGradient>
  <linearGradient id="toothShade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8d8778"/><stop offset="0.25" stop-color="#8d8778" stop-opacity="0"/><stop offset="0.75" stop-color="#8d8778" stop-opacity="0"/><stop offset="1" stop-color="#8d8778"/></linearGradient>
  <linearGradient id="metal" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#eef1f4"/><stop offset="0.5" stop-color="#b3bbc3"/><stop offset="1" stop-color="#8a939c"/></linearGradient>`;

// Encabezado (etiqueta + título con una parte en color de acento) y logo o nombre de la clínica.
function header(clinic, { label, titleHtml, accent }) {
  const titleLength = titleHtml.replace(/<[^>]+>/g, '').length;
  const logo = localImageDataUri(clinic.id, clinic.media?.logo);
  return `<rect width="${W}" height="220" fill="url(#hd)"/>
  <circle cx="${W - 60}" cy="20" r="170" fill="${accent}" fill-opacity="0.10"/>
  <text x="60" y="84" font-size="24" font-weight="800" letter-spacing="5" fill="${accent}">${esc(label)}</text>
  <text x="60" y="156" font-size="${titleLength > 24 ? 50 : 60}" font-weight="800" fill="#ffffff">${titleHtml}</text>
  ${logo
    ? `<clipPath id="lg"><rect x="${W - 168}" y="56" width="108" height="108" rx="26"/></clipPath><image href="${logo}" x="${W - 168}" y="56" width="108" height="108" preserveAspectRatio="xMidYMid slice" clip-path="url(#lg)"/>`
    : ''}
  <text x="60" y="198" font-size="24" fill="#cfe9ec">${esc(clinic.name)}</text>`;
}

// Franja de precio real: "Desde S/ 1,800" + financiamiento de la configuración. Sin precio: solo el financiamiento.
function priceBand(treatment, y, accent) {
  const finance = treatment?.financing ? wrapText(treatment.financing, 40, 2) : [];
  const hasPrice = typeof treatment?.priceFrom === 'number';
  if (!hasPrice && !finance.length) return '';
  return `<rect x="50" y="${y}" width="${W - 100}" height="118" rx="26" fill="url(#band)"/>
  ${finance.map((line, i) => `<text x="86" y="${y + (finance.length === 1 ? 70 : 52) + i * 36}" font-size="28" font-weight="700" fill="#ffffff">${esc(line)}</text>`).join('')}
  ${hasPrice ? `<text x="${W - 86}" y="${y + 44}" font-size="20" font-weight="800" letter-spacing="3" fill="#e6fffb" text-anchor="end">DESDE</text>
  <text x="${W - 86}" y="${y + 94}" font-size="52" font-weight="800" fill="#ffffff" text-anchor="end">${esc(formatSoles(treatment.priceFrom))}</text>` : ''}
  <rect x="50" y="${y}" width="${W - 100}" height="118" rx="26" fill="none" stroke="${accent}" stroke-opacity="0.4"/>`;
}

const footnote = () => `<text x="${W / 2}" y="${H - 28}" font-size="22" font-weight="700" fill="#6b7f85" text-anchor="middle">Imagen referencial · ilustración, no es un paciente real</text>`;

export function bracketsComparisonSvg(clinic, treatment) {
  const primary = color(clinic.colors?.primary, '#0f766e');
  const accent = color(clinic.colors?.accent, '#14b8a6');
  const panel = (px, tag, name, sub, checks, kind, id) => `
  <rect x="${px}" y="250" width="470" height="590" rx="30" fill="#ffffff" stroke="#dbe5e6" stroke-width="2"/>
  <rect x="${px + 14}" y="264" width="442" height="300" rx="22" fill="#fbe9eb"/>
  ${smile(px + 24, 290, 422, 250, { id, brackets: { kind } })}
  <rect x="${px + 24}" y="530" width="${tag.length * 14.5 + 44}" height="44" rx="22" fill="#071a22"/>
  <text x="${px + 46}" y="560" font-size="21" font-weight="800" fill="#ffffff" letter-spacing="2">${esc(tag)}</text>
  <text x="${px + 26}" y="636" font-size="38" font-weight="800" fill="#0b2a33">${esc(name)}</text>
  <text x="${px + 26}" y="676" font-size="25" fill="#61757b">${esc(sub)}</text>
  ${checks.map((c, i) => `<circle cx="${px + 40}" cy="${724 + i * 50}" r="14" fill="${accent}"/><path d="M${px + 33} ${724 + i * 50} l5 5 l9 -10" stroke="#ffffff" stroke-width="3.5" fill="none" stroke-linecap="round"/>
  <text x="${px + 66}" y="${734 + i * 50}" font-size="29" fill="#0b2a33">${esc(c)}</text>`).join('')}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>${sharedDefs(primary, accent)}</defs>
  <rect width="${W}" height="${H}" fill="#f2f6f7"/>
  ${header(clinic, { label: 'CATÁLOGO · ORTODONCIA', accent, titleHtml: `Brackets metálicos <tspan fill="${accent}">vs</tspan> zafiro` })}
  ${panel(50, 'ACERO MÉDICO', 'Brackets metálicos', 'Clásicos · alta precisión', ['Máxima resistencia', 'Casos complejos'], 'metal', 'm1')}
  ${panel(560, 'ZAFIRO', 'Brackets de zafiro', 'Estéticos · transparentes', ['Casi invisibles', 'No se manchan'], 'zafiro', 'm2')}
  <circle cx="540" cy="415" r="46" fill="${accent}" stroke="#ffffff" stroke-width="7"/>
  <text x="540" y="428" font-size="34" font-weight="800" fill="#ffffff" text-anchor="middle">VS</text>
  ${priceBand(treatment, 866, accent)}
  ${footnote()}
</svg>`;
}

export function veneersBeforeAfterSvg(clinic, treatment) {
  const primary = color(clinic.colors?.primary, '#0f766e');
  const accent = color(clinic.colors?.accent, '#14b8a6');
  const split = 540;
  const shades = [['A3', '#e2cd96'], ['A2', '#ead9ab'], ['A1', '#f0e4c2'], ['B1', '#f5edd8'], ['BL2', '#faf6ec'], ['BL1', '#ffffff']];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>${sharedDefs(primary, accent)}</defs>
  <rect width="${W}" height="${H}" fill="#f2f6f7"/>
  ${header(clinic, { label: 'DISEÑO DE SONRISA', accent, titleHtml: `Carillas <tspan fill="${accent}">antes y después</tspan>` })}
  <rect x="50" y="250" width="${W - 100}" height="500" rx="30" fill="#fbe9eb" stroke="#dbe5e6" stroke-width="2"/>
  ${smile(100, 300, 880, 420, { id: 'm3', toothFill: (i, cx) => (cx < split ? 'url(#yellowed)' : 'url(#enamel)') })}
  <line x1="${split}" y1="262" x2="${split}" y2="738" stroke="#ffffff" stroke-width="6"/>
  <circle cx="${split}" cy="500" r="32" fill="#ffffff" stroke="#dbe5e6" stroke-width="3"/>
  <path d="M${split - 12} 490 l-10 10 l10 10 M${split + 12} 490 l10 10 l-10 10" stroke="#0b2a33" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  <rect x="78" y="276" width="150" height="50" rx="25" fill="#071a22"/><text x="153" y="310" font-size="24" font-weight="800" fill="#fff" text-anchor="middle">ANTES</text>
  <rect x="${W - 258}" y="276" width="180" height="50" rx="25" fill="${accent}"/><text x="${W - 168}" y="310" font-size="24" font-weight="800" fill="#fff" text-anchor="middle">DESPUÉS</text>
  <text x="60" y="800" font-size="23" font-weight="800" fill="#61757b" letter-spacing="3">GUÍA DE COLOR</text>
  <text x="${W - 60}" y="800" font-size="23" font-weight="800" fill="${accent}" text-anchor="end">Color · Forma · Tamaño</text>
  ${shades.map(([name, fill], i) => `<rect x="${60 + i * 162}" y="818" width="140" height="44" rx="12" fill="${fill}" stroke="${i === 5 ? accent : '#dfe5e6'}" stroke-width="${i === 5 ? 5 : 2}"/>
  <text x="${130 + i * 162}" y="${i === 5 ? 851 : 848}" font-size="20" font-weight="700" fill="#61757b" text-anchor="middle">${name}</text>`).join('')}
  ${priceBand(treatment, 890, accent)}
  ${footnote()}
</svg>`;
}

// Tratamientos con ilustración (por key). Devuelve [{ key, file, svg, caption }] solo para los que la clínica tiene.
const ART = [
  {
    key: 'ortodoncia', file: 'catalogo/ortodoncia-metalicos-vs-zafiro.png', draw: bracketsComparisonSvg,
    caption: '🦷 *Ortodoncia:* brackets metálicos (máxima resistencia) o de zafiro (casi invisibles). Corregimos la posición y la mordida paso a paso. _Imagen referencial._',
  },
  {
    key: 'carillas', file: 'catalogo/carillas-antes-despues.png', draw: veneersBeforeAfterSvg,
    caption: '✨ *Carillas:* cambio estético en color, forma y tamaño. _Imagen referencial: no es un paciente real._',
  },
];

export function catalogArtFor(clinic) {
  return ART.map((art) => {
    const treatment = (clinic.treatments || []).find((t) => t.key === art.key);
    return treatment ? { key: art.key, file: art.file, caption: art.caption, svg: art.draw(clinic, treatment) } : null;
  }).filter(Boolean);
}

export default { catalogArtFor, smile, bracketsComparisonSvg, veneersBeforeAfterSvg };
