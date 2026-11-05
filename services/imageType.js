// Tipo real de una imagen según sus primeros bytes (no se confía en la extensión ni en el encabezado).
// Solo JPG, PNG y WebP: un SVG o cualquier otra cosa devuelve null.

export const PHOTO_TYPES = {
  'image/jpeg': { ext: 'jpg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/png': { ext: 'png', magic: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/webp': { ext: 'webp', magic: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
};

export function detectImageType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  return Object.entries(PHOTO_TYPES).find(([, t]) => t.magic(buffer))?.[0] || null;
}

export default { PHOTO_TYPES, detectImageType };
