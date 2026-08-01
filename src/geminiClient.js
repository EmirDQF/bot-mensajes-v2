import config from '../config/env.js';
import { GoogleGenerativeAI } from '@google/generative-ai';

let cachedClient = null;

export function getGeminiClient() {
  if (cachedClient) {
    return cachedClient;
  }

  const apiKey = config.gemini?.apiKey;
  const modelName = config.gemini?.model || 'gemini-3.5-flash-lite';
  const maxOutputTokens = Number(config.gemini?.maxOutputTokens || 150);

  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is required to initialize the Gemini client. Set it in your environment variables.');
  }

  const generativeAi = new GoogleGenerativeAI(apiKey);
  cachedClient = generativeAi.getGenerativeModel({
    model: modelName,
    generationConfig: {
      maxOutputTokens,
    },
  });

  return cachedClient;
}
