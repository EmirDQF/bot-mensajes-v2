// npm run demo:video -- <id> — deja el Probador listo para grabar un video como democlinicatop.mp4 con la clínica
// <id> (p. ej. una demo de npm run quick-demo): modo demo (Supabase en memoria, WhatsApp simulado), hora simulada
// 10:30 p. m., confirmación directa con pase de cita y alertas a números FALSOS (nunca a un celular real).
// Abre /panel?video=1#tester: el botón "🎬 Siguiente línea" escribe el guion del video por ti.
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

// Números imposibles (51 + "0…" no existe en Perú) y distintos de los del Probador (prefijo 5100000).
export const FAKE_PHONES = {
  CLINIC_PHONE: '51000010000',
  RECEPTION_ALERT_PHONE: '51000010001',
  DOCTOR_ALERT_PHONE: '51000010002',
  OWNER_ALERT_PHONE: '51000010003',
};

export function videoEnv(id, env = process.env, password = crypto.randomBytes(6).toString('base64url')) {
  if (env.NODE_ENV === 'production') throw new Error('demo:video no corre con NODE_ENV=production');
  return {
    ...FAKE_PHONES,
    ACTIVE_CLINIC: id,
    DEMO_MODE: 'true',
    PANEL_OWNER_USER: 'demo',
    PANEL_OWNER_PASSWORD: password,
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.dirname, 'demo-video.js');
if (isMain) {
  const id = String(process.argv[2] || '').trim().toLowerCase();
  if (!id || !/^[a-z0-9-]+$/.test(id) || !fs.existsSync(path.join(process.cwd(), 'config', 'clinics', `${id}.js`))) {
    console.error('Uso: npm run demo:video -- <id>   (ej. demo-sonrisa-perfecta; créala con npm run quick-demo, o usa denvari)');
    process.exitCode = 1;
  } else {
    // Antes de cargar el .env y el bot: estas variables mandan sobre las del .env (las alertas nunca salen a números reales).
    Object.assign(process.env, videoEnv(id));
    await import('../index.js');
    const port = process.env.PORT || 3000;
    console.log(`
🎬 Listo para grabar (${id}):
   1. Abre http://localhost:${port}/panel?video=1#tester  →  usuario "demo", contraseña "${process.env.PANEL_OWNER_PASSWORD}"
   2. La hora del bot ya está en 🌙 10:30 p. m. Pulsa "🎬 Siguiente línea" y Enter en cada paso; en el paso 3 toca un horario.
   3. La alerta al doctor aparece como notificación arriba del celular (números falsos: nada sale a Meta).
   Guía completa: docs/demo-script.md`);
  }
}
