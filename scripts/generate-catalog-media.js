// Genera las ilustraciones del catálogo en media/<id>/catalogo/ (SVG → PNG con resvg), con los colores, el nombre
// y los precios "desde" de la clínica. Son dibujos propios marcados "Imagen referencial": ninguno es una foto de
// un paciente (regla 12). Uso:
//   node scripts/generate-catalog-media.js            # clínica activa (ACTIVE_CLINIC, por defecto denvari)
//   node scripts/generate-catalog-media.js <id>       # otra clínica (p. ej. una demo de quick-demo)
import fs from 'fs';
import path from 'path';
import { renderPng } from '../services/cards/render.js';
import { catalogArtFor } from '../services/cards/catalogArt.js';

// Escribe los PNG de la clínica y devuelve [{ key, file, caption }].
export function writeCatalogMedia(target, { root = process.cwd(), log = console.log } = {}) {
  fs.mkdirSync(path.join(root, 'media', target.id, 'catalogo'), { recursive: true });
  const items = catalogArtFor(target);
  for (const item of items) {
    fs.writeFileSync(path.join(root, 'media', target.id, item.file), renderPng(item.svg, { width: 1080 }));
    log(`✅ media/${target.id}/${item.file}`);
    // El bot solo envía lo que está en treatments[].images: si falta, se dice qué agregar.
    const treatment = target.treatments.find((t) => t.key === item.key);
    if (!treatment?.images?.some((img) => img.file === item.file)) {
      log(`   → agrega en el tratamiento "${item.key}" de config/clinics/${target.id}.js (o súbela en Mi clínica):`);
      log(`     images: [{ file: '${item.file}', caption: ${JSON.stringify(item.caption)} }],`);
    }
  }
  return items.map(({ svg: _svg, ...rest }) => rest);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.dirname, 'generate-catalog-media.js');
if (isMain) {
  const id = process.argv.slice(2).find((a) => !a.startsWith('--'));
  if (id) process.env.ACTIVE_CLINIC = id;
  const { default: clinic } = await import('../config/clinic.config.js');
  writeCatalogMedia(clinic);
}
