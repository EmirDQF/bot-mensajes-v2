import config from '../config/env.js';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Un cliente por modelo: el SDK fija el modelo al crearlo.
const cachedClients = new Map();

export function getGeminiClient(modelName = config.gemini?.model || 'gemini-3.5-flash-lite') {
  if (cachedClients.has(modelName)) {
    return cachedClients.get(modelName);
  }

  const apiKey = config.gemini?.apiKey;

  if (!apiKey) {
    console.warn('GEMINI_API_KEY not set; returning null client. Gemini calls will fall back to local heuristics in test mode.');
    return null;
  }

  console.log('[geminiClient] initializing client with model:', modelName);
  const generativeAi = new GoogleGenerativeAI(apiKey);
  const client = generativeAi.getGenerativeModel({
    model: modelName,
    // Mismo tope que geminiService (config/env.js); cada pedido lo vuelve a enviar.
    generationConfig: {
      maxOutputTokens: config.gemini.maxOutputTokens,
      ...(config.gemini.thinkingConfig ? { thinkingConfig: config.gemini.thinkingConfig } : {}),
    },
  });
  cachedClients.set(modelName, client);
  return client;
}

// Clientes de respaldo (GEMINI_FALLBACK_MODELS), en orden, para cuando el modelo principal está saturado.
export function getGeminiFallbackClients() {
  return (config.gemini?.fallbackModels || []).map((name) => getGeminiClient(name)).filter(Boolean);
}

export function initializeGeminiClient() {
  return getGeminiClient();
}
