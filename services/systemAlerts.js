import defaultEvents from './liveEvents.js';

// Alertas del sistema para el panel (banner rojo arriba) y los logs de Render.
// Hoy: token de WhatsApp vencido (error 190 de Meta). En memoria: se limpia en cuanto un envío vuelve a funcionar.

export const TOKEN_STEPS = 'Crea un token PERMANENTE: Meta Business → Configuración del negocio → Usuarios → Usuarios del sistema → '
  + 'Agregar (rol Administrador) → Asignar activos: tu app y tu cuenta de WhatsApp (control total) → Generar token → '
  + 'caducidad "Nunca" y permisos whatsapp_business_messaging y whatsapp_business_management. '
  + 'Pégalo en WHATSAPP_TOKEN (Render → Environment) y en tu .env. Guía: docs/go-live.md.';

// Meta devuelve code 190 (OAuthException) cuando el token venció, se revocó o cambió la contraseña.
export const isTokenError = (metaError) => Number(metaError?.code) === 190;

export function createSystemAlerts({ events = defaultEvents, log = (...args) => console.error(...args), now = () => new Date() } = {}) {
  const alerts = new Map();

  function tokenExpired(metaError = {}) {
    const first = !alerts.has('whatsapp_token');
    alerts.set('whatsapp_token', {
      code: 'whatsapp_token', level: 'error', at: now().toISOString(),
      title: 'TOKEN DE WHATSAPP VENCIDO: el bot no puede enviar mensajes',
      detail: TOKEN_STEPS,
    });
    // Siempre en el log (Render → Logs); el panel se avisa una sola vez por incidente.
    log(`[WhatsApp] TOKEN DE WHATSAPP VENCIDO (error 190${metaError.error_subcode ? `/${metaError.error_subcode}` : ''}). ${TOKEN_STEPS}`);
    if (first) events.publish('alert', alerts.get('whatsapp_token'));
  }

  function whatsappOk() {
    if (!alerts.delete('whatsapp_token')) return;
    events.publish('alert', { code: 'whatsapp_token', resolved: true });
  }

  const active = () => [...alerts.values()];
  return { tokenExpired, whatsappOk, active };
}

const systemAlerts = createSystemAlerts();
export default systemAlerts;
