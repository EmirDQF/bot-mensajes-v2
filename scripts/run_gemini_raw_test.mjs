import { obtenerRespuestaIA } from '../services/geminiService.js';

(async () => {
  try {
    const jid = '51987654321@s.whatsapp.net';
    const mensaje = 'quiero ver fotos de carillas';
    console.log('Running local gemini raw test...');
    const res = await obtenerRespuestaIA(jid, mensaje, { client: null });
    console.log('Result from obtenerRespuestaIA:', JSON.stringify(res, null, 2));
  } catch (e) {
    console.error('Test failed:', e && (e.message || e));
    process.exit(1);
  }
})();