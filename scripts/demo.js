// npm run demo — el panel con pacientes INVENTADOS, sin Meta ni Supabase real (Supabase en memoria y
// WhatsApp simulado). El Probador usa Gemini real si GEMINI_API_KEY está definida.
// Con NODE_ENV=production el arranque falla: el modo demo nunca corre en producción.
process.env.DEMO_MODE = 'true';
await import('../index.js');
const port = process.env.PORT || 3000;
console.log(`[Demo] Abre http://localhost:${port}/panel`);
