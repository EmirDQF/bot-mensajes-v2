process.env.NODE_ENV = 'test';
// minimal env for config
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test';
process.env.GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
process.env.WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || '12345';
process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || 'verify-token';
// leave supabase vars undefined for test mode behavior

(async () => {
  // dynamic import after setting env
  const { obtenerRespuestaIA } = await import('../services/geminiService.js');

  const client = {
    async generate(prompt, opts) {
      return { text: 'Perfecto. Tu cita ya quedó agendada para este lunes a las 3:00 PM. Gracias.' };
    }
  };
  const jid = `51990001111@s.whatsapp.net`;
  const res = await obtenerRespuestaIA(jid, '¿Cuánto cuesta el tratamiento?', { client });
  console.log('=== DEBUG obtenerRespuestaIA output ===');
  console.log('texto:', res.texto);
  console.log('leadData:', res.leadData);
})();