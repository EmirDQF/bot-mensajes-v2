// Prueba real y corta de los modelos de Gemini: cuáles responden hoy, cuánto tardan, si cortan por
// MAX_TOKENS y si aceptan thinkingConfig. Recomienda GEMINI_MODEL / GEMINI_FALLBACK_MODELS / GEMINI_THINKING_*.
// Uso: npm run gemini:probe   (lee GEMINI_API_KEY del entorno o de .env; nunca la imprime)
// Opcional: npm run gemini:probe -- gemini-x,gemini-y   para probar otros modelos.
import '../src/envLoader.js';
import { DEFAULT_GEMINI_FALLBACK_MODELS, GEMINI_MIN_OUTPUT_TOKENS, isGeminiModel } from '../config/env.js';

const PROMPT = 'Eres la recepcionista virtual de una clínica dental en Lima. Un paciente pregunta: "¿Cuánto cuesta la ortodoncia y qué incluye la evaluación?". Responde en 3 líneas, en español peruano cálido, y termina con una pregunta.';
const THINKING_VARIANTS = [
  ['sin thinkingConfig', null],
  ['GEMINI_THINKING_LEVEL=minimal', { thinkingLevel: 'minimal' }],
  ['GEMINI_THINKING_BUDGET=0', { thinkingBudget: 0 }],
];
const TIMEOUT_MS = 30000;

async function call(apiKey, model, thinkingConfig) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: PROMPT }] }],
        generationConfig: { maxOutputTokens: GEMINI_MIN_OUTPUT_TOKENS, ...(thinkingConfig ? { thinkingConfig } : {}) },
      }),
    });
    const body = await res.json().catch(() => ({}));
    const candidate = body.candidates?.[0];
    return {
      ok: res.ok,
      status: res.status,
      ms: Date.now() - started,
      finish: candidate?.finishReason || null,
      thoughts: body.usageMetadata?.thoughtsTokenCount ?? 0,
      chars: (candidate?.content?.parts || []).map((p) => p.text || '').join('').length,
      error: body.error?.message?.slice(0, 120) || null,
    };
  } catch (error) {
    return { ok: false, status: error.name === 'AbortError' ? 'timeout' : 'red', ms: Date.now() - started, error: error.message };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('Falta GEMINI_API_KEY (en el entorno o en .env). No se imprime nunca.');
    process.exit(1);
  }
  const extra = String(process.argv[2] || '').split(',').map((m) => m.trim()).filter(isGeminiModel);
  const models = [...new Set([
    process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
    ...String(process.env.GEMINI_FALLBACK_MODELS || DEFAULT_GEMINI_FALLBACK_MODELS).split(',').map((m) => m.trim()).filter(isGeminiModel),
    ...extra,
  ])];
  const results = [];
  for (const model of models) {
    for (const [label, thinking] of THINKING_VARIANTS) {
      const r = await call(apiKey, model, thinking);
      results.push({ model, label, thinking, ...r });
      const state = r.ok ? `${r.finish}, ${r.chars} caracteres, ${r.thoughts} tokens pensando` : `FALLA ${r.status}${r.error ? ` (${r.error})` : ''}`;
      console.log(`${model.padEnd(28)} ${label.padEnd(32)} ${String(r.ms).padStart(6)} ms  ${state}`);
    }
  }
  const usable = results.filter((r) => r.ok && r.finish === 'STOP' && r.chars > 0).sort((a, b) => a.ms - b.ms);
  const order = [...new Set(usable.map((r) => r.model))];
  console.log('\nRecomendación (más rápido primero, solo modelos que respondieron completo):');
  if (!order.length) {
    console.log('  Ningún modelo respondió completo. Revisa la clave y la cuota en Google AI Studio.');
    return;
  }
  console.log(`  GEMINI_MODEL=${order[0]}`);
  console.log(`  GEMINI_FALLBACK_MODELS=${order.slice(1).join(',')}`);
  const best = usable.find((r) => r.model === order[0]);
  if (best?.thinking) {
    const [name, value] = Object.entries(best.thinking)[0];
    console.log(`  ${name === 'thinkingLevel' ? 'GEMINI_THINKING_LEVEL' : 'GEMINI_THINKING_BUDGET'}=${value}  (el modelo principal lo acepta y fue lo más rápido)`);
  } else {
    console.log('  (sin GEMINI_THINKING_*: el modelo principal fue más rápido sin thinkingConfig o no lo acepta)');
  }
}

main();
