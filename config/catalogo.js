// config/catalogo.js — catálogo de imágenes generado desde la clínica activa (config/clinics/<id>.js).
import clinic, { mediaUrl, resolveMediaKey } from './clinic.config.js';

export const CLINIC_NAME = clinic.name;

// clave de media -> URL pública (logo, fachada, ubicacion y una por tratamiento)
const CATALOGO = Object.fromEntries(
  Object.keys(clinic.media).map((key) => [key, mediaUrl(key)]),
);
CATALOGO.default = mediaUrl('logo');

function obtenerImagen(clave) {
  if (!clave) return null;
  const key = resolveMediaKey(clave);
  return key ? CATALOGO[key] : null;
}

export { CATALOGO, obtenerImagen };

export default CATALOGO;
