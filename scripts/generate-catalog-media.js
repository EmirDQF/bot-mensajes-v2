// Genera las ilustraciones del catálogo visual de la demo en media/<id>/catalogo/ (SVG → PNG con resvg).
// Son dibujos propios: ninguna es foto de un paciente (regla 12). Uso:
//   node scripts/generate-catalog-media.js            # clínica activa (ACTIVE_CLINIC, por defecto denvari)
import fs from 'fs';
import path from 'path';

const { default: clinic } = await import('../config/clinic.config.js');
const { renderPng, esc, color } = await import('../services/cards/render.js');

const W = 1080;
const H = 1080;
const primary = color(clinic.colors?.primary, '#0f766e');
const accent = color(clinic.colors?.accent, '#14b8a6');
const outDir = path.join(process.cwd(), 'media', clinic.id, 'catalogo');

// Sonrisa dibujada: labios, boca y fila de dientes superiores. toothColor puede ser una función por diente.
function smile(x, y, w, h, { toothColor = '#fbfbf7', brackets = null, clipId }) {
  const teeth = [];
  const count = 8;
  const widths = [0.8, 0.9, 1, 1.2, 1.2, 1, 0.9, 0.8];
  const total = widths.reduce((a, b) => a + b, 0);
  const innerW = w * 0.78;
  let cursor = x + (w - innerW) / 2;
  const top = y + h * 0.3;
  for (let i = 0; i < count; i += 1) {
    const tw = (innerW * widths[i]) / total;
    const th = h * (0.34 + widths[i] * 0.08);
    const fill = typeof toothColor === 'function' ? toothColor(i, cursor + tw / 2) : toothColor;
    teeth.push(`<rect x="${(cursor + 2).toFixed(1)}" y="${top.toFixed(1)}" width="${(tw - 4).toFixed(1)}" height="${th.toFixed(1)}" rx="${(tw / 3).toFixed(1)}" fill="${fill}" stroke="#d6d3c4" stroke-width="2"/>`);
    if (brackets) {
      const bx = cursor + tw / 2 - 13;
      const by = top + th * 0.45;
      teeth.push(`<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="26" height="22" rx="4" fill="${brackets.fill}" stroke="${brackets.stroke}" stroke-width="2"/>`);
    }
    cursor += tw;
  }
  const wire = brackets
    ? `<path d="M${x + w * 0.13} ${top + h * 0.2} Q ${x + w / 2} ${top + h * 0.26} ${x + w * 0.87} ${top + h * 0.2}" stroke="${brackets.wire}" stroke-width="4" fill="none"/>`
    : '';
  const lips = `M${x} ${y + h * 0.45} Q ${x + w / 2} ${y - h * 0.05} ${x + w} ${y + h * 0.45} Q ${x + w / 2} ${y + h * 1.15} ${x} ${y + h * 0.45} Z`;
  const mouth = `M${x + w * 0.07} ${y + h * 0.46} Q ${x + w / 2} ${y + h * 0.12} ${x + w * 0.93} ${y + h * 0.46} Q ${x + w / 2} ${y + h * 0.98} ${x + w * 0.07} ${y + h * 0.46} Z`;
  return `<clipPath id="${clipId}"><path d="${mouth}"/></clipPath>
  <path d="${lips}" fill="#d9646f"/>
  <path d="${mouth}" fill="#5b1820"/>
  <g clip-path="url(#${clipId})"><rect x="${x}" y="${y + h * 0.18}" width="${w}" height="${h * 0.18}" fill="#e88f97"/>${teeth.join('')}${wire}</g>`;
}

const frame = (title, subtitle, body, footnote) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs><linearGradient id="hd" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#071a22"/><stop offset="1" stop-color="${primary}"/></linearGradient></defs>
  <rect width="${W}" height="${H}" fill="#f4f7f7"/>
  <rect width="${W}" height="190" fill="url(#hd)"/>
  <text x="60" y="95" font-size="54" font-weight="800" fill="#ffffff">${title}</text>
  <text x="60" y="148" font-size="28" fill="#cdeeea">${esc(subtitle)}</text>
  ${body}
  <text x="${W / 2}" y="${H - 34}" font-size="22" fill="#61757b" text-anchor="middle">${esc(footnote)}</text>
</svg>`;

function bracketsComparison() {
  const panel = (px, label, name, sub, checks, brackets, clipId) => `
  <rect x="${px}" y="230" width="470" height="700" rx="28" fill="#ffffff" stroke="#dbe5e6" stroke-width="2"/>
  ${smile(px + 25, 280, 420, 300, { brackets, clipId })}
  <rect x="${px + 25}" y="560" width="${label.length * 15 + 40}" height="44" rx="22" fill="#071a22"/>
  <text x="${px + 45}" y="590" font-size="22" font-weight="800" fill="#ffffff" letter-spacing="2">${esc(label)}</text>
  <text x="${px + 25}" y="668" font-size="38" font-weight="800" fill="#0b2a33">${esc(name)}</text>
  <text x="${px + 25}" y="708" font-size="26" fill="#61757b">${esc(sub)}</text>
  ${checks.map((c, i) => `<text x="${px + 25}" y="${770 + i * 50}" font-size="30" fill="#0b2a33"><tspan fill="${accent}" font-weight="800">✓ </tspan>${esc(c)}</text>`).join('')}`;
  const body = `${panel(50, 'ACERO MÉDICO', 'Brackets metálicos', 'Clásicos · alta precisión', ['Máxima resistencia', 'Casos complejos'], { fill: '#a7b0b9', stroke: '#6b7580', wire: '#8a949e' }, 'm1')}
  ${panel(560, 'ZAFIRO', 'Brackets de zafiro', 'Estéticos · transparentes', ['Casi invisibles', 'No se manchan'], { fill: '#ffffff', stroke: '#e3ebee', wire: '#c9d3d8' }, 'm2')}
  <circle cx="540" cy="430" r="44" fill="${accent}" stroke="#ffffff" stroke-width="6"/>
  <text x="540" y="442" font-size="32" font-weight="800" fill="#ffffff" text-anchor="middle">VS</text>`;
  return frame('Brackets <tspan fill="#ffffff">metálicos</tspan> <tspan fill="' + accent + '">vs</tspan> zafiro', clinic.name, body, 'Ilustración referencial · no es un paciente real');
}

function veneersBeforeAfter() {
  const split = 540;
  const yellow = '#e7cf86';
  const white = '#fbfbf5';
  const shades = [['A3', '#ead7a4'], ['A2', '#efdfb6'], ['A1', '#f3e8c8'], ['B1', '#f7f0db'], ['BL2', '#fbf8ee'], ['BL1', '#ffffff']];
  const body = `
  <rect x="50" y="230" width="980" height="560" rx="28" fill="#ffffff" stroke="#dbe5e6" stroke-width="2"/>
  ${smile(110, 300, 860, 430, { toothColor: (i, cx) => (cx < split ? yellow : white), clipId: 'm3' })}
  <line x1="${split}" y1="240" x2="${split}" y2="780" stroke="#ffffff" stroke-width="6"/>
  <circle cx="${split}" cy="510" r="30" fill="#ffffff" stroke="#dbe5e6" stroke-width="3"/>
  <text x="${split}" y="520" font-size="26" font-weight="800" fill="#0b2a33" text-anchor="middle">‹ ›</text>
  <rect x="80" y="256" width="140" height="48" rx="24" fill="#071a22"/><text x="150" y="288" font-size="24" font-weight="800" fill="#fff" text-anchor="middle">ANTES</text>
  <rect x="840" y="256" width="170" height="48" rx="24" fill="${accent}"/><text x="925" y="288" font-size="24" font-weight="800" fill="#fff" text-anchor="middle">DESPUÉS</text>
  <text x="60" y="850" font-size="24" font-weight="800" fill="#61757b" letter-spacing="2">GUÍA DE COLOR</text>
  ${shades.map(([name, fill], i) => `<rect x="${60 + i * 162}" y="872" width="140" height="64" rx="14" fill="${fill}" stroke="${i === 5 ? accent : '#e1e6e6'}" stroke-width="${i === 5 ? 5 : 2}"/>
  <text x="${130 + i * 162}" y="968" font-size="22" fill="#61757b" text-anchor="middle">${name}</text>`).join('')}`;
  return frame('Carillas · diseño de sonrisa', `${clinic.name} · color, forma y tamaño`, body, 'Ilustración referencial · no es un paciente real');
}

fs.mkdirSync(outDir, { recursive: true });
const files = {
  'ortodoncia-metalicos-vs-zafiro.png': bracketsComparison(),
  'carillas-antes-despues.png': veneersBeforeAfter(),
};
for (const [file, svg] of Object.entries(files)) {
  fs.writeFileSync(path.join(outDir, file), renderPng(svg, { width: 900 }));
  console.log(`✅ media/${clinic.id}/catalogo/${file}`);
}
