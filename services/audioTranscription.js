import { getGeminiClient } from '../src/geminiClient.js';
import { fetchMetaMedia } from './metaMedia.js';
import { describeError } from './safeLog.js';

// Audios del paciente → texto con Gemini (multimodal). Solo con GEMINI_PAID_TIER=true: en el plan gratuito Google
// puede usar el contenido para mejorar sus modelos y estos son datos de salud. El audio se procesa en memoria y no
// se guarda (ni en la base ni en Storage); en la bandeja queda solo "🎤 (transcripción) …".

export const MAX_AUDIO_SECONDS = 120;
const MAX_AUDIO_BYTES = 3 * 1024 * 1024;
const TIMEOUT_MS = Number(process.env.AUDIO_TRANSCRIPTION_TIMEOUT_MS || 20000);
// Sin duración en el archivo (AAC, AMR, MP4): se estima con un bitrate alto de voz para no cortar audios cortos.
const FALLBACK_BYTES_PER_SECOND = 4000;
const PROMPT = 'Transcribe literalmente este audio de un paciente de una clínica dental en Perú. '
  + 'Devuelve solo lo que dijo, en español, sin comentarios ni resumen. Si no se entiende nada, responde exactamente: [INAUDIBLE]';

export const audioTranscriptionEnabled = (env = process.env) => env.GEMINI_PAID_TIER === 'true';

// Duración de un Ogg (Opus): posición del último paquete / 48000. null si no es Ogg.
export function oggDurationSeconds(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.subarray(0, 4).toString('latin1') !== 'OggS') return null;
  const last = buffer.lastIndexOf(Buffer.from('OggS'));
  if (last < 0 || last + 14 > buffer.length) return null;
  const granule = Number(buffer.readBigUInt64LE(last + 6));
  return Number.isFinite(granule) && granule > 0 ? granule / 48000 : null;
}

export function audioSeconds(buffer) {
  return oggDurationSeconds(buffer) ?? buffer.length / FALLBACK_BYTES_PER_SECOND;
}

export function createAudioTranscriber({
  getClient = getGeminiClient, fetchMedia = fetchMetaMedia, env = process.env, timeoutMs = TIMEOUT_MS,
} = {}) {
  // { text } si se entendió; { reason: 'disabled' | 'too_long' | 'failed' } si no.
  async function transcribe(audio) {
    if (!audioTranscriptionEnabled(env)) return { reason: 'disabled' };
    let buffer;
    let contentType;
    try {
      ({ buffer, contentType } = await fetchMedia(audio?.id));
    } catch (error) {
      console.warn('[Audio] No se pudo descargar el audio:', describeError(error));
      return { reason: 'failed' };
    }
    try {
      if (!buffer?.length) return { reason: 'failed' };
      if (buffer.length > MAX_AUDIO_BYTES || audioSeconds(buffer) > MAX_AUDIO_SECONDS) return { reason: 'too_long' };
      const client = getClient();
      if (!client) return { reason: 'failed' };
      const mimeType = String(contentType || audio?.mime_type || 'audio/ogg').split(';')[0];
      const request = client.generateContent({
        contents: [{ role: 'user', parts: [{ inlineData: { mimeType, data: buffer.toString('base64') } }, { text: PROMPT }] }],
      });
      let timer;
      const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout de transcripción')), timeoutMs); });
      const result = await Promise.race([request, timeout]).finally(() => clearTimeout(timer));
      const text = String(result?.response?.text?.() || '').replace(/\s+/g, ' ').trim();
      if (!text || /^\[?INAUDIBLE\]?$/i.test(text)) return { reason: 'failed' };
      return { text: text.slice(0, 1500) };
    } catch (error) {
      console.warn('[Audio] No se pudo transcribir:', describeError(error));
      return { reason: 'failed' };
    } finally {
      // El audio solo vivió en memoria durante la transcripción.
      if (buffer) buffer.fill(0);
    }
  }
  return { transcribe };
}

const audioTranscriber = createAudioTranscriber();
export default audioTranscriber;
