const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || null;
const webhookVerifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || null;
const configuredGeminiModel = process.env.GEMINI_MODEL;
const isGeminiModel = (name) => /^gemini-[a-z0-9.-]+$/i.test(name || '');
const geminiModel = isGeminiModel(configuredGeminiModel) ? configuredGeminiModel : 'gemini-3.5-flash-lite';
// Modelos a los que se pasa si el principal está saturado (503), no responde a tiempo o ya no existe (404).
const geminiFallbackModels = (process.env.GEMINI_FALLBACK_MODELS ?? 'gemini-3.6-flash,gemini-3.1-flash-lite')
  .split(',').map((name) => name.trim()).filter((name) => isGeminiModel(name) && name !== geminiModel);

export default {
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || null,
    model: geminiModel,
    fallbackModels: [...new Set(geminiFallbackModels)],
    maxOutputTokens: Number(process.env.GEMINI_MAX_OUTPUT_TOKENS || 100),
  },
  whatsapp: {
    token: process.env.WHATSAPP_TOKEN || null,
    apiVersion: process.env.WHATSAPP_API_VERSION || 'v21.0',
    businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || null,
    phoneNumberId,
    appSecret: process.env.WHATSAPP_APP_SECRET || null,
    webhookVerifyToken,
  },
  supabase: {
    // supabase-js agrega /rest/v1 por su cuenta: si la URL ya lo trae, todas las consultas fallan
    // con "Invalid path specified in request URL". Se normaliza a https://<proyecto>.supabase.co
    url: (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '').replace(/\/rest\/v1$/i, '') || null,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || null,
  },
};
