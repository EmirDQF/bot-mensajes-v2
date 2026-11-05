import fs from 'fs';
import path from 'path';
import { Resvg } from '@resvg/resvg-js';
import { cachedImageDataUri } from './remoteImages.js';

// SVG → PNG en el servidor (sin navegador). Usa solo la fuente Inter de assets/fonts (licencia OFL):
// el resultado es igual en Windows y en Render, sin depender de las fuentes del sistema.

const FONT_DIR = path.join(process.cwd(), 'assets', 'fonts');
const FONT_FILES = ['Inter-Regular.ttf', 'Inter-Bold.ttf', 'Inter-ExtraBold.ttf'].map((file) => path.join(FONT_DIR, file));

export function renderPng(svg, { width } = {}) {
  const resvg = new Resvg(svg, {
    font: { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: 'Inter' },
    ...(width ? { fitTo: { mode: 'width', value: width } } : {}),
  });
  return resvg.render().asPng();
}

// Texto seguro dentro de un SVG.
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

// Corta un texto en líneas de ~maxChars sin partir palabras (resvg no hace saltos de línea solo).
export function wrapText(text, maxChars, maxLines = 3) {
  // Solo espacios normales: un espacio no separable (U+00A0) mantiene juntas "4:30 p. m.".
  const words = String(text || '').split(/[ \t\r\n]+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = `${kept[maxLines - 1].replace(/[.,;:]?$/, '')}…`;
  return kept;
}

// Logo como data URI para incrustarlo en el SVG: archivo local (media/<id>/logo.png) o el subido desde el panel
// (ya descargado por remoteImages.prefetchImage). null si no hay.
export function localImageDataUri(clinicId, file) {
  if (/^https:\/\//i.test(String(file || ''))) return cachedImageDataUri(file);
  if (!file || /^https?:\/\//i.test(file) || file.includes('..')) return null;
  const full = path.join(process.cwd(), 'media', clinicId, file);
  try {
    const buffer = fs.readFileSync(full);
    const type = /\.jpe?g$/i.test(file) ? 'image/jpeg' : /\.webp$/i.test(file) ? 'image/webp' : 'image/png';
    return `data:${type};base64,${buffer.toString('base64')}`;
  } catch {
    return null;
  }
}

// #RRGGBB válido o el color por defecto.
export const color = (value, fallback) => (/^#[0-9a-f]{6}$/i.test(String(value || '')) ? value : fallback);

export default { renderPng, esc, wrapText, localImageDataUri, color };
