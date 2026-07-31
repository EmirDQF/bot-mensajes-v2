import '../src/envLoader.js';
import { GoogleGenerativeAI } from '@google/generative-ai';


(async () => {
  try {
    if (!process.env.GEMINI_API_KEY) {
      console.error('GEMINI_API_KEY not set');
      process.exit(2);
    }
    const gen = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const res = await gen.listModels();
    console.log(JSON.stringify(res, null, 2));
  } catch (e) {
    console.error('LIST_MODELS_ERROR:', e && e.message ? e.message : e);
    if (e && e.stack) console.error(e.stack);
    process.exit(2);
  }
})();