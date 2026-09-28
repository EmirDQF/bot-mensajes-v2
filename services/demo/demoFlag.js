// Modo demo (npm run demo): Supabase en memoria con pacientes inventados y WhatsApp falso.
// Sin dependencias para poder usarlo desde cualquier servicio sin ciclos de importación.

export const isDemoMode = (env = process.env) => /^(1|true|yes|si|sí)$/i.test(String(env.DEMO_MODE || '').trim());

// El modo demo nunca corre en producción: ahí el bot atiende pacientes reales.
export function assertDemoAllowed(env = process.env) {
  if (isDemoMode(env) && String(env.NODE_ENV || '').toLowerCase() === 'production') {
    throw new Error('DEMO_MODE=true no está permitido con NODE_ENV=production: quita DEMO_MODE de las variables de Render.');
  }
}

export default isDemoMode;
