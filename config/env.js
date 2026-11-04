const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || null;
const webhookVerifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || null;
const configuredGeminiModel = process.env.GEMINI_MODEL;
export const isGeminiModel = (name) => /^gemini-[a-z0-9.-]+$/i.test(name || '');
const geminiModel = isGeminiModel(configuredGeminiModel) ? configuredGeminiModel : 'gemini-3.5-flash-lite';
// Modelos a los que se pasa si el principal está saturado (503), no responde a tiempo o ya no existe (404).
export const DEFAULT_GEMINI_FALLBACK_MODELS = 'gemini-3.6-flash,gemini-3.1-flash-lite,gemini-flash-latest';
export const parseFallbackModels = (value, primary) => [...new Set(String(value ?? DEFAULT_GEMINI_FALLBACK_MODELS)
  .split(',').map((name) => name.trim()).filter((name) => isGeminiModel(name) && name !== primary))];
const geminiFallbackModels = parseFallbackModels(process.env.GEMINI_FALLBACK_MODELS, geminiModel);

// Único lugar del tope de tokens de salida. Los modelos Gemini 3.x gastan parte en "pensar": con 100-300
// las respuestas salían cortadas a la mitad ("tenemos una campaña con cu"). Nunca menos de 1024.
export const GEMINI_MIN_OUTPUT_TOKENS = 1024;
export function resolveMaxOutputTokens(value) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > GEMINI_MIN_OUTPUT_TOKENS ? parsed : GEMINI_MIN_OUTPUT_TOKENS;
}

// Pensamiento del modelo (opcional, se prueba antes con npm run gemini:probe): GEMINI_THINKING_BUDGET=0
// (familia 2.5) o GEMINI_THINKING_LEVEL=minimal|low (familia 3). Sin definir no se envía nada.
const THINKING_LEVELS = ['minimal', 'low', 'medium', 'high'];
export function parseThinkingConfig(env = process.env) {
  const level = String(env.GEMINI_THINKING_LEVEL || '').trim().toLowerCase();
  if (level) return THINKING_LEVELS.includes(level) ? { thinkingLevel: level } : null;
  const raw = String(env.GEMINI_THINKING_BUDGET ?? '').trim();
  if (!raw) return null;
  const budget = Number(raw);
  return Number.isInteger(budget) && budget >= 0 ? { thinkingBudget: budget } : null;
}

const positiveMs = (value, fallback) => (Number(value) > 0 ? Number(value) : fallback);

export default {
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || null,
    model: geminiModel,
    fallbackModels: [...new Set(geminiFallbackModels)],
    maxOutputTokens: resolveMaxOutputTokens(process.env.GEMINI_MAX_OUTPUT_TOKENS),
    thinkingConfig: parseThinkingConfig(),
    // Tope por intento y tope total (todos los intentos y modelos): el paciente no espera más que eso.
    timeoutMs: positiveMs(process.env.GEMINI_TIMEOUT_MS, 20000),
    totalTimeoutMs: positiveMs(process.env.GEMINI_TOTAL_TIMEOUT_MS, 35000),
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
