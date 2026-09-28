import './src/envLoader.js';
import createApp from './app.js';
import { initializeGeminiClient } from './src/geminiClient.js';
import clinic, { missingPhoneVars } from './config/clinic.config.js';
import clinicSettings from './services/clinicSettings.js';
import { assertDemoAllowed, isDemoMode } from './services/demo/demoFlag.js';

// DEMO_MODE con NODE_ENV=production detiene el arranque (el modo demo usa pacientes inventados).
assertDemoAllowed();
if (isDemoMode()) {
  const { enableDemoMode } = await import('./services/demo/demoMode.js');
  await enableDemoMode();
}

const app = createApp();

const port = process.env.PORT || 3000;

// Initialize once at startup so webhook batches reuse the same Gemini client.
initializeGeminiClient();

console.log(`[Clinic] Clínica activa: ${clinic.name} (ACTIVE_CLINIC=${clinic.id})`);
// Cambios guardados desde el panel (⚙️ Configuración). Si Supabase no responde, se usa la base.
clinicSettings.load().then(({ meta }) => {
  if (meta.source === 'panel') console.log('[Config] Aplicados los cambios guardados desde el panel');
});
for (const name of missingPhoneVars()) {
  console.warn(`[Clinic] Advertencia: ${name} no está definida. El bot sigue funcionando, pero no se enviarán las alertas que dependen de ese número.`);
}

// Validaciones ligeras de variables de entorno para evitar que PM2 entre en crash loop silencioso
const requiredLike = ['GEMINI_MODEL', 'WHATSAPP_WEBHOOK_VERIFY_TOKEN'];
for (const v of requiredLike) {
  if (!process.env[v]) {
    console.warn(`Advertencia: la variable de entorno ${v} no está definida. El proceso seguirá, pero algunas funciones pueden no estar disponibles.`);
  }
}
if (!process.env.GEMINI_API_KEY) {
  console.warn('Advertencia crítica: GEMINI_API_KEY no está definida. Las llamadas a Gemini fallarán hasta que se configure. Evitando crash para que PM2 no entre en loop de reintentos.');
}
if (!process.env.WHATSAPP_TOKEN || !process.env.WHATSAPP_PHONE_NUMBER_ID) {
  console.warn('Advertencia: WHATSAPP_TOKEN o WHATSAPP_PHONE_NUMBER_ID no están definidas. El servidor arrancará, pero el envío de mensajes de WhatsApp no funcionará hasta que se configuren.');
}
if (!process.env.WHATSAPP_APP_SECRET) {
  console.warn('Advertencia: WHATSAPP_APP_SECRET no está definida. El webhook aceptará solicitudes sin verificar la firma.');
}
console.log('Diagnóstico completo del entorno: npm run preflight');

app.listen(port, () => {
  console.log(`Express server listening on http://localhost:${port}`);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Promise Rejection:', reason);
});
