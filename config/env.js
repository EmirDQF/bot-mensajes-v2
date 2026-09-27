const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || null;
const webhookVerifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || null;
const configuredGeminiModel = process.env.GEMINI_MODEL;
const geminiModel = configuredGeminiModel && /^gemini-(?:1\.5|2\.0|3\.5)-flash(?:-lite)?$/i.test(configuredGeminiModel)
  ? configuredGeminiModel
  : 'gemini-3.5-flash-lite';

export default {
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || null,
    model: geminiModel,
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
