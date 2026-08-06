import config from '../config/env.js';

const TTL_MS = Number(process.env.GEMINI_SESSION_TTL_MS || 30 * 60 * 1000); // 30 minutes
// Booked sessions (confirmed appointments) should persist much longer to avoid losing booking context if user replies slowly
const BOOKED_TTL_MS = Number(process.env.GEMINI_BOOKED_SESSION_TTL_MS || 7 * 24 * 3600 * 1000); // 7 days
const DEBOUNCE_MS = Number(process.env.GEMINI_DEBOUNCE_MS || 2000);

const CAMILA_SYSTEM_PROMPT = `Eres "Camila", la recepcionista virtual de [NOMBRE_CLINICA], una clínica dental en Lima especializada en ortodoncia.

TONO
- Español, cercano, profesional, cálido. Nunca robótico ni repetitivo.
- Respuestas breves: máximo 40 palabras salvo que te pidan detalle.
- Usa el nombre del paciente SOLO al presentarte por primera vez y al confirmar la cita final. Nunca en cada mensaje.

REGLA DE ORO: UN SOLO DATO POR TURNO
Nunca pidas dos datos en el mismo mensaje. Sigue este orden estricto y NUNCA vuelvas a pedir un dato que ya tengas confirmado en el historial de la conversación, aunque el usuario cambie de tema y regrese:
1. Nombre completo
2. Teléfono (9 dígitos, Perú)
3. Distrito de Lima
4. Día y hora deseada

IMPORTANTE: LA CLÍNICA ATIENDE DE LUNES A SÁBADO
La clínica atiende de lunes a sábado. Si el usuario pide domingo o un día fuera de este rango, indícaselo amablemente y pide que elija otro día dentro del horario.

REGLA DE TELÉFONO — CRÍTICA
- Si el usuario dice frases como "a este número", "el mismo con el que te escribo", "este número de acá": NO inventes ni derives el número del texto. El sistema usará exclusivamente el número real de WhatsApp del remitente; tú solo confirma conversacionalmente, nunca generes ni repitas un número distinto al confirmado por el sistema.
- Si el usuario te da el número escrito en el chat, valida que tenga exactamente 9 dígitos y empiece en 9. Si no cumple, pide que lo repita — nunca "arregles" o adivines dígitos.

REGLA DE DISTRITO — CRÍTICA
- Solo acepta un distrito si coincide (exacto o muy cercano) con un distrito real de Lima Metropolitana (Miraflores, San Isidro, Surco, La Molina, San Borja, etc.).
- Si el usuario responde algo ambiguo, conversacional o que no es un distrito real (ej. "escríbenos", "ya te dije", "el de siempre"), NO lo guardes como distrito. Vuelve a preguntar explícitamente: "¿Me confirmas en qué distrito de Lima te encuentras?"

REGLA DE FECHA/HORA
- Acepta expresiones relativas ("mañana", "el miércoles", "próxima semana") y conviértelas mentalmente a fecha/hora explícita antes de confirmar.
- Siempre confirma con fecha completa: "miércoles 12 de agosto a las 4:00 PM", nunca dejes la fecha ambigua.
- Si el usuario da solo día sin hora (o viceversa), pide el dato faltante antes de continuar.
- NUNCA confirmes ni afirmes que "la cita ya quedó agendada" a menos que el usuario haya dado explícitamente el DÍA Y LA HORA, ya sea en ESTE TURNO o en turnos previos de la conversación. Si el usuario pregunta por otra cosa (precio, requisitos, etc.) antes de dar fecha/hora, responde a esa pregunta y vuelve a pedir la fecha/hora — no asumas ni inventes una cita.

BLOQUE DE DATOS (LEAD_JSON)
- Genera el bloque <<<LEAD_JSON>>>...<<<END_LEAD_JSON>>> SOLO en el turno donde por primera vez tengas los 4 datos completos y validados.
- CRÍTICO: en ese bloque incluye SIEMPRE los 4 campos completos (nombre, telefono, distrito, fecha_hora), aunque algunos hayan sido capturados en turnos anteriores. Nunca dejes un campo vacío o null en el JSON si ya fue confirmado antes en la conversación — repítelo explícitamente.
- Formato exacto:
<<<LEAD_JSON>>>
{
  "nombre": "...",
  "telefono": "...",
  "distrito": "...",
  "fecha_hora_texto": "...",
  "ready_to_notify": true
}
<<<END_LEAD_JSON>>>
- No regeneres este bloque en turnos posteriores salvo que el usuario pida reprogramar o corregir un dato — en ese caso, genera el bloque de nuevo con TODOS los campos (los que cambiaron y los que no).

DESPUÉS DE AGENDAR
- Si el usuario pregunta dudas post-agendamiento (requisitos, ayuno, qué llevar, etc.), respóndelas de forma breve y natural SIN regenerar el bloque JSON y SIN volver a pedir datos ya confirmados.
- Si preguntan "¿ya quedó agendada mi cita?", confirma con la fecha/hora exacta ya acordada, nunca con datos genéricos.

MANEJO DE OBJECIONES DE PRECIO
- Inicial: S/300–S/600. Mensualidad: S/150–S/250.
- Siempre cierra la respuesta de precio invitando a agendar una evaluación para confirmar el plan exacto.

LÍMITES
- No des consejos médicos específicos (dolor, medicación, diagnósticos).
- Si el usuario pide hablar con un humano, indícalo claramente en tu respuesta para que el system active el handover.
`;

const MAX_HISTORY_MESSAGES = Number(process.env.GEMINI_MAX_HISTORY || 6);
const CLEANUP_MS = Number(process.env.GEMINI_CLEANUP_MS || 60 * 1000);
const CONTINGENCY_MESSAGE = process.env.GEMINI_CONTINGENCY_MESSAGE || 'En este momento nuestro sistema está ocupado, un asesor te responderá a la brevedad.';

const chatSessions = new Map(); // sessionId -> { history: [], timer, paused: false }
const failureCounts = new Map(); // sessionId -> consecutive failure count

// Pause map helper exposed for handover control
export function pauseSessionById(sessionId) {
  const sid = String(sessionId || '').split('@')[0];
  const entry = chatSessions.get(sid);
  if (entry) {
    entry.paused = true;
    return true;
  }
  // create an entry flagged as paused so future messages are ignored until resumed
  chatSessions.set(sid, { history: [], timer: null, paused: true });
  return true;
}

export function resumeSessionById(sessionId) {
  const sid = String(sessionId || '').split('@')[0];
  const entry = chatSessions.get(sid);
  if (entry) {
    entry.paused = false;
    return true;
  }
  return false;
}

export function isSessionPaused(sessionId) {
  const sid = String(sessionId || '').split('@')[0];
  const entry = chatSessions.get(sid);
  return Boolean(entry && entry.paused);
}

function getSessionId(jid) {
  return (jid || '').split('@')[0];
}

function resetSessionTimer(sessionId, entry) {
  if (entry.timer) clearTimeout(entry.timer);
  // If the session is booked (appointment confirmed), extend the TTL to BOOKED_TTL_MS to retain context
  const delay = (entry && entry.booked) ? BOOKED_TTL_MS : TTL_MS;
  entry.timer = setTimeout(() => {
    // Only delete non-booked sessions; if booked, respect the longer TTL and delete only when it expires
    chatSessions.delete(sessionId);
    failureCounts.delete(sessionId);
    // console.log(`Gemini: cleared session ${sessionId} due to inactivity`);
  }, delay);
  entry.timer.unref && entry.timer.unref();
}

function cleanupSessions() {
  const now = Date.now();
  for (const [sid, entry] of chatSessions) {
    // rely on timer to cleanup; additional pass not strictly necessary here
  }
}

const cleanupInterval = setInterval(cleanupSessions, CLEANUP_MS);
cleanupInterval.unref && cleanupInterval.unref();

export function mergeRecentUserMessages(history, windowMs = 10000) {
  // Merge consecutive user messages within windowMs into a single consolidated message string.
  if (!Array.isArray(history) || history.length === 0) return [];
  const merged = [];
  for (let i = 0; i < history.length; i++) {
    const item = history[i];
    if (item.role === 'user') {
      const last = merged.length ? merged[merged.length - 1] : null;
      const ts = item.at || 0;
      const text = (item.parts || []).map(p => p.text || '').join(' ').trim();
      if (!text) continue;
      if (last && last.role === 'user' && Math.abs((ts - (last.at || 0))) <= windowMs) {
        // concatenate
        last.text = `${last.text} ${text}`.trim();
        last.at = Math.max(last.at || 0, ts);
      } else {
        merged.push({ role: 'user', text, at: ts });
      }
    } else {
      const text = (item.parts || []).map(p => p.text || '').join(' ').trim();
      if (!text) continue;
      merged.push({ role: 'model', text, at: item.at || 0 });
    }
  }
  return merged;
}

function formatHistoryForPrompt(history, mergeWindowMs = 10000) {
  const normalized = mergeRecentUserMessages(history, mergeWindowMs);
  return normalized.map((h) => {
    const role = h.role === 'user' ? 'Cliente' : 'Camila';
    const text = h.text || '';
    return text ? `${role}: ${text}` : '';
  }).filter(Boolean).join('\n');
}

function hasSchedulingIntent(message, history) {
  if (!message) return false;
  const text = [message, formatHistoryForPrompt(history)].filter(Boolean).join(' ').toLowerCase();
  const keywords = ['cita','agendar','reservar','agenda','horario','fecha','turno','consulta','consultar'];
  return keywords.some(k => text.includes(k));
}

// Simple heuristic parser for lead data (fallback)
import { isValidDistrict } from './districts.js';

function isLikelyDistrict(text) {
  if (!text || typeof text !== 'string') return false;
  // Use strict validation against the canonical list with fuzzy matching
  return isValidDistrict(text);
}

export function extractLeadDataFromText(text) {
 if (!text) return null;
 const t = text.toLowerCase();

 // Detect explicit "soy de X" or "vivo en X" as distrito
 const distritoFromSoy = t.match(/(?:soy\s+(?:de|del)|vivo\s+en)\s+([a-záéíóúñü\s]{2,60})(?:[,\.\n]|$)/i);
 const distrito = distritoFromSoy ? distritoFromSoy[1].trim() : null;
 
 // Name extraction: support typos like "me llamos" or "me llasmo" and avoid capturing phrases like "soy de ..." by negative lookahead
 // Capture up to 3-word names after common phrases like "me llamo", "mi nombre es", or "soy".
 // Stop capture at common connectors such as 'vivo', 'vi', 'mi', 'tengo', 'y', 'con' or punctuation.
 const nombreMatch = text.match(/(?:me\s+llam(?:o|os|smo)|me\s+llasm[oó]|me\s+llamo|mi\s+nombre\s+es)\s+([a-záéíóúñü]+(?:\s+[a-záéíóúñü]+){0,2})(?=\s*(?:[,\.\n]|vivo\b|vivo\s+en\b|vi\b|mi\b|mi\s+telefono|mi\s+número|tengo\b|y\b|con\b|$))/i)
   || text.match(/(?:soy)\s+(?!de\b|del\b|en\b)([a-záéíóúñü]+(?:\s+[a-záéíóúñü]+){0,2})(?=\s*(?:[,\.\n]|vivo\b|vivo\s+en\b|vi\b|mi\b|mi\s+telefono|mi\s+número|tengo\b|y\b|con\b|$))/i);
 const nombre = nombreMatch ? nombreMatch[1].trim().replace(/\s+/g,' ') : null;
 
 const digitString = t.replace(/[^0-9]/g, "");
 const telefonoMatch = digitString.match(/(?:^51)?(9\d{8})/);
 // DO NOT use telefono extracted from text as primary key. It can be used as reference only.
 const telefono = telefonoMatch ? telefonoMatch[1] : null;

 const distritoMatch = distrito || t.match(/vivo en\s+([a-záéíóúñü\s]{2,60})(?:[,\.\n]|\s+y\b|$)/i) || t.match(/en\s+([a-záéíóúñü\s]{2,60})(?:[,\.\n]|\s+y\b|$)/i);
 const distritoCandidate = distritoMatch ? (typeof distritoMatch === 'string' ? distritoMatch : (distritoMatch[1] ? distritoMatch[1].trim() : null)) : null;

 // Validate district strictly against canonical list; if not valid, do not set
 const distritoFinal = distritoCandidate && isLikelyDistrict(distritoCandidate) ? distritoCandidate : null;

 const explicitWeekdayDateMatch = t.match(/\b(?:lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo)\s+\d{1,2}\s+de\s+(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)(?:\s+(?:a\s*las?)?\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?/i);
 if (explicitWeekdayDateMatch) {
   return { nombre: nombre ?? null, telefono: telefono ?? null, distrito: distritoFinal ?? null, fechaHora: explicitWeekdayDateMatch[0].trim() };
 }
 
 const explicitDateMatch = t.match(/\b\d{1,2}\s*(?:de\s*)?(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)(?:\s+(?:a\s*las?)?\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?/i);
 if (explicitDateMatch) {
   return { nombre: nombre ?? null, telefono: telefono ?? null, distrito: distritoFinal ?? null, fechaHora: explicitDateMatch[0].trim() };
 }
 
 const fechaMatch = t.match(/(?:puedo\s+)?(el\s+)?((?:hoy|mañana|pasado\s+mañana|lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo))(?:\s+(?:a\s+las)?\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?/i);
 const fechaHora = fechaMatch ? fechaMatch[0].trim() : null;

 return { nombre: nombre ?? null, telefono: telefono ?? null, distrito: distritoFinal ?? null, fechaHora: fechaHora ?? null };
}

function normalizeLeadData(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  return {
    nombre: parsed.nombre || parsed.name || null,
    telefono: parsed.telefono ? String(parsed.telefono).replace(/\D/g, '') : null,
    distrito: parsed.distrito || parsed.district || null,
    fechaHora: parsed.fechaHoraTexto || parsed.fecha_hora_texto || parsed.fecha_hora || parsed.fechaHora || null,
    // Do not trust model-provided ready flag; server will validate before setting
    ready_to_notify: false,
  };
}

// Helper: normalize and remove diacritics
function normalizeTextForCompare(s) {
  if (!s || typeof s !== 'string') return '';
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
}

function isValidPhoneNumber9(telefono) {
  if (!telefono) return false;
  const t = String(telefono).replace(/\D/g, '');
  return /^9\d{8}$/.test(t);
}

export function isValidName(nombre) {
  if (!nombre || typeof nombre !== 'string') return false;
  const n = nombre.trim();
  if (n.length < 2) return false;
  // reject the literal placeholder the system sometimes uses
  if (normalizeTextForCompare(n) === 'no proporcionado') return false;
  // reject assistant name or phrases
  if (/^camila\b/i.test(n)) return false;
  // reject if contains question forms or system prompts
  if (/\b(qué|cuál|cuando|a qué|a este número|dónde|donde)\b/i.test(n)) return false;
  return true;
}

function isValidDistrictName(distrito) {
  if (!distrito || typeof distrito !== 'string') return false;
  try {
    // Prefer centralized validator
    return isValidDistrict(distrito);
  } catch (e) {
    // Fallback: simple normalization + substring match against known items if available
    try {
      const n = normalizeTextForCompare(distrito);
      // If the districts module exposes a list, attempt to use it safely
      if (Array.isArray(typeof DISTRICTS !== 'undefined' ? DISTRICTS : [])) {
        for (const d of DISTRICTS) {
          if (String(d).toLowerCase && n.includes(String(d).toLowerCase())) return true;
        }
      }
    } catch (err) {
      // ignore
    }
    return isLikelyDistrict(distrito);
  }
}

function finalizeLeadData(lead) {
  if (!lead || typeof lead !== 'object') return null;
  // normalize phone
  if (lead.telefono) lead.telefono = String(lead.telefono).replace(/\D/g, '');

  // If textual fechaHora exists but no ISO, try to parse
  if (lead.fechaHora && !lead.fechaHoraISO) {
    try {
      const iso = parseTextToLimaISO(lead.fechaHora);
      if (iso) {
        lead.fechaHoraISO = iso;
        const explicitText = formatLimaFechaHoraText(iso);
        if (explicitText) lead.fechaHora = explicitText;
      }
    } catch (e) {
      // ignore parse failures
    }
  }

  const hasValidPhone = isValidPhoneNumber9(lead.telefono);
  const hasValidName = isValidName(lead.nombre);
  const hasValidDistrict = isValidDistrictName(lead.distrito);
  const hasValidFechaISO = Boolean(lead.fechaHoraISO && typeof lead.fechaHoraISO === 'string');

  // Respect clinic hours configuration: if the parsed date falls outside diasAtencion, do NOT mark ready_to_notify.
  let withinClinicDays = true;
  try {
    const clinicCfg = (config && config.clinicHours) ? config.clinicHours : { diasAtencion: [1,2,3,4,5,6] };
    if (hasValidFechaISO) {
      const parsedDate = new Date(lead.fechaHoraISO);
      if (!Number.isNaN(parsedDate.getTime())) {
        // Derive weekday in Lima timezone by formatting weekday name and mapping to index
        const limaWeekdayName = new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', weekday: 'long' }).format(parsedDate).toLowerCase();
        const weekdayMap = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, miércoles: 3, jueves: 4, viernes: 5, sabado: 6, sábado: 6 };
        const weekdayIndex = typeof weekdayMap[limaWeekdayName] === 'number' ? weekdayMap[limaWeekdayName] : parsedDate.getUTCDay();
        withinClinicDays = Array.isArray(clinicCfg.diasAtencion) ? clinicCfg.diasAtencion.includes(weekdayIndex) : true;
      }
    } else if (lead.fechaHora && typeof lead.fechaHora === 'string') {
      // If we don't have an ISO but the textual fechaHora explicitly mentions a weekday, use that to detect outside clinic hours.
      const t = lead.fechaHora.toLowerCase();
      const weekdayMapText = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, 'miércoles': 3, jueves: 4, viernes: 5, sabado: 6, 'sábado': 6 };
      for (const [name, idx] of Object.entries(weekdayMapText)) {
        if (t.includes(name)) {
          withinClinicDays = Array.isArray(clinicCfg.diasAtencion) ? clinicCfg.diasAtencion.includes(idx) : true;
          if (!withinClinicDays) {
            lead.outsideClinicHours = true;
          }
          break;
        }
      }
    }
  } catch (e) {
    withinClinicDays = true; // conservative: if validation fails, do not block
  }

  lead.ready_to_notify = hasValidPhone && hasValidName && hasValidDistrict && hasValidFechaISO && withinClinicDays;
  if (!withinClinicDays) {
    // signal that the date is out of clinic hours so caller can inform user
    lead.outsideClinicHours = true;
  }

  return lead;
}


function extractLeadDataFromHistory(history) {
  if (!Array.isArray(history) || !history.length) return null;
  const fullText = history.map((h) => {
    const role = h.role === 'user' ? 'Cliente:' : 'Camila:';
    const text = (h.parts || []).map((p) => p.text || '').join(' ').trim();
    return text ? `${role} ${text}` : '';
  }).filter(Boolean).join('\n');
  return extractLeadDataFromText(fullText);
}

export function getOrCreateSession(jid) {
  const sid = getSessionId(jid);
  let entry = chatSessions.get(sid);
  if (!entry) {
    entry = { history: [], timer: null, lastUserMessageAt: 0, booked: false, leadSnapshot: null };
    chatSessions.set(sid, entry);

    // Attempt to restore persisted lead_snapshot if present so booked state survives restarts
    (async () => {
      try {
        const { getByPhone } = await import('./leadService.js');
        if (typeof getByPhone === 'function') {
          const existing = await getByPhone(sid);
          if (existing && existing.lead_snapshot) {
            try {
              entry.booked = true;
              entry.leadSnapshot = existing.lead_snapshot;
              // reset timer now that booked state restored
              resetSessionTimer(sid, entry);
            } catch (err) {
              // ignore any restore errors
            }
          }
        }
      } catch (e) {
        // non fatal: DB not configured or import failed in test environments
      }
    })();
  }
  resetSessionTimer(sid, entry);
  return entry;
}

function isStructuredGeminiClient(client) {
  return client && typeof client.generateContent === 'function';
}
 
function extractTextFromCandidate(candidate) {
  if (!candidate?.content?.parts) return '';
  return candidate.content.parts
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .filter(Boolean)
    .join(' ')
    .trim();
}

function extractTextFromResult(result) {
  if (!result) return '';
  if (typeof result === 'string') return result;
  if (typeof result.text === 'string') return result.text;
  if (result.response) {
    if (typeof result.response.text === 'string') return result.response.text;
    const candidate = Array.isArray(result.response.candidates) ? result.response.candidates[0] : null;
    return extractTextFromCandidate(candidate);
  }
  return '';
}

function extractTextFromParsedJson(parsed) {
  if (parsed == null) return '';
  if (typeof parsed === 'string') return parsed.trim();
  if (typeof parsed === 'number' || typeof parsed === 'boolean') return String(parsed);
  if (Array.isArray(parsed)) {
    return parsed.map(extractTextFromParsedJson).filter(Boolean).join(' ');
  }

  const candidateKeys = ['content', 'respuesta', 'response', 'texto', 'text', 'message'];
  for (const key of candidateKeys) {
    if (Object.prototype.hasOwnProperty.call(parsed, key)) {
      const extracted = extractTextFromParsedJson(parsed[key]);
      if (extracted) return extracted;
    }
  }

  if (parsed.content && typeof parsed.content === 'object') {
    const extracted = extractTextFromParsedJson(parsed.content);
    if (extracted) return extracted;
  }

  if (parsed.response && typeof parsed.response === 'object') {
    const extracted = extractTextFromParsedJson(parsed.response);
    if (extracted) return extracted;
  }

  if (parsed.response?.content) {
    const extracted = extractTextFromParsedJson(parsed.response.content);
    if (extracted) return extracted;
  }

  for (const value of Object.values(parsed)) {
    const extracted = extractTextFromParsedJson(value);
    if (extracted) return extracted;
  }

  return '';
}

// === LIMPIEZA DE STRINGS JSON EN geminiService.js ===
export function sanitizeModelTextOutput(rawText) {
  if (!rawText || typeof rawText !== 'string') return '';
  
  let cleaned = rawText.trim();

  // 1. Eliminar etiquetas LEAD_JSON (completas o truncadas por el modelo)
  cleaned = cleaned.replace(/<<<LEAD_JSON>>>[\s\S]*?(?:<<<END_LEAD_JSON>>>|$)/gi, '');
  cleaned = cleaned.replace(/<<<[\s\S]*?$/gi, ''); // Limpiar cualquier residuo de tag inconcluso
  cleaned = cleaned.replace(/<+$/g, '');            // Limpiar símbolos '<' sueltos al final
  // 1.5 Eliminar cualquier texto de alerta interna destinado al administrador
  cleaned = cleaned.replace(/🚨\s*¡NUEVO PACIENTE AGENDADO![\s\S]*$/gi, '').trim();

  // 2. Eliminar bloques de código Markdown ```json ... ```
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  // 3. Desempaquetar si viene en formato JSON stringify
  if (/^[\[{]/.test(cleaned)) {
    try {
      const parsed = JSON.parse(cleaned);

      // If the model returned a structured object with a top-level "response", prefer that.
      if (parsed && typeof parsed === 'object') {
        if (typeof parsed.response === 'string' && parsed.response.trim().length > 0) {
          return parsed.response.trim();
        }

        // If response is nested object with parts (structured Gemini), try to extract its text
        if (parsed.response && typeof parsed.response === 'object') {
          const nested = extractTextFromParsedJson(parsed.response);
          if (nested && nested.trim()) return nested.trim();
        }

        // If the payload looks like it contains lead data (LEAD_JSON key or personal fields), do NOT forward raw JSON.
        const containsLeadKeys = ('LEAD_JSON' in parsed) || ('lead' in parsed) || ('nombre' in parsed) || ('telefono' in parsed) || ('distrito' in parsed);
        if (containsLeadKeys) {
          // Try to extract any human-readable textual reply (message/text/content). If none, return a safe generic confirmation.
          const extracted = extractTextFromParsedJson(parsed);
          if (extracted && extracted.trim()) return extracted.trim();

          // Last-resort safe message to avoid leaking JSON to end-user
          return 'Gracias, registré tu solicitud. Te contactaré por este número para confirmar los detalles de la cita.';
        }

        // Generic traversal extraction if no explicit response key
        const extracted = extractTextFromParsedJson(parsed);
        if (extracted && extracted.trim()) {
          cleaned = extracted.trim();
        }
      }
    } catch (e) {
      // Fallback por expresiones regulares si el parseo estricto de JSON falla
      const malformedPrefixMatch = cleaned.match(/^\s*\{\s*"(?:content|respuesta|response|texto|text|message)"\s*:\s*"?(.*)$/i);
      if (malformedPrefixMatch && malformedPrefixMatch[1]) {
        cleaned = malformedPrefixMatch[1].replace(/\}?\s*$/,'').replace(/^"/, '').trim();
      } else {
        const match = cleaned.match(/"(?:content|respuesta|response|texto|text|message)"\s*:\s*"([\s\S]*?)"\s*\}?$/i);
        if (match && match[1]) {
          cleaned = match[1];
        }
      }
    }
  }

  // 4. Limpieza de comillas dobles externas o saltos de línea sobrantes
  cleaned = cleaned.replace(/^"/, '').replace(/"$/, '').trim();

  return cleaned;
}

function getCurrentPhoneHint(jid) {
  const phone = getSessionId(jid);
  return phone ? `El usuario escribe desde el número de WhatsApp ${phone}. Si el usuario pide "a este número" o menciona el número actual, reconoce que se refiere a este número y no vuelvas a preguntar por teléfono.` : '';
}

/**
 * Obtiene la fecha y hora actual formateada explícitamente para el huso horario de Lima.
 */
function getLimaCurrentDateTime() {
  const options = {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  };
  return new Intl.DateTimeFormat('es-PE', options).format(new Date());
}

/**
 * Construye el prompt de sistema dinámico incluyendo el contexto temporal y de WhatsApp.
 */
export function buildSystemPromptWithContext(jid, session = null, clinic = null) {
  const fechaActual = getLimaCurrentDateTime();
  const phoneHint = getCurrentPhoneHint(jid);

  // Determine clinic name fallback and patient name from session if available
  const clinicName = (clinic && clinic.name) ? clinic.name : (config.clinicNameFallback || 'nuestra clínica dental');
  let patientName = null;
  try {
    if (session && Array.isArray(session.history)) {
      const hist = session.history.slice().reverse();
      for (const h of hist) {
        if (h.role === 'user') {
          const t = (h.parts || []).map(p => p.text || '').join(' ').trim();
          const parsed = extractLeadDataFromText(t) || {};
          if (parsed && parsed.nombre && isValidName(parsed.nombre)) {
            patientName = parsed.nombre;
            break;
          }
        }
      }
    }
  } catch (e) {
    patientName = null;
  }

  // Apply safe prompt placeholders replacements
  let promptBase = CAMILA_SYSTEM_PROMPT.replace(/\[NOMBRE_CLINICA\]/g, clinicName);
  if (patientName) {
    promptBase = promptBase.replace(/\[NOMBRE_PACIENTE\]/g, patientName);
    // Add a short explicit confirmation line so the model has the confirmed patient name in context
    promptBase = promptBase + `\n- PACIENTE CONFIRMADO: ${patientName}`;
  } else {
    // ensure literal placeholder is removed if no patientName
    promptBase = promptBase.replace(/\[NOMBRE_PACIENTE\]/g, 'estimado/a paciente');
  }

  // If this session already has a booked appointment, instruct the model to NOT ask for core booking fields again.
  if (session && session.booked) {
    try {
      const snap = session.leadSnapshot || {};
      const snapText = `Nombre: ${snap.nombre || 'N/A'}, Distrito: ${snap.distrito || 'N/A'}, Fecha/Hora: ${snap.fecha_hora_texto || 'N/A'}`;
      promptBase = promptBase + `\n\n- AVISO: Este usuario ya tiene una cita agendada: ${snapText}. No vuelvas a pedir nombre, teléfono, distrito ni fecha. Responde dudas post-agendamiento o procesa reprogramaciones solo si el usuario lo solicita explícitamente.`;
    } catch (e) { /* ignore */ }
  }

  return `${promptBase}\n\n[CONTEXTO TEMPORAL Y DE SISTEMA EN VIVO]\n- FECHA Y HORA ACTUAL EN LIMA: ${fechaActual}\n- REGLA DE TIEMPO: Usa esta fecha actual de Lima como tu única referencia absoluta para calcular "hoy", "mañana", "el próximo lunes", o fechas específicas solicitadas por el cliente. No asumas años ni meses pasados.${phoneHint ? `\n${phoneHint}` : ''}`;
}

/**
 * Parsea texto libre de fecha/hora relativo a Lima y devuelve ISO 8601 en UTC (+00:00).
 * Ejemplos aceptados: "hoy a las 3pm", "mañana 16:00", "el jueves a las 4pm", "3 de agosto a las 10:30"
 */
export function parseTextToLimaISO(fechaTexto) {
  if (!fechaTexto || typeof fechaTexto !== 'string') return null;
  const txt = fechaTexto.toLowerCase();

  // Obtener fecha base en Lima (YYYY-MM-DD)
  const limaDateStr = new Date().toLocaleString('sv-SE', { timeZone: 'America/Lima' }).split(' ')[0];
  const [baseYear, baseMonth, baseDay] = limaDateStr.split('-').map((s) => parseInt(s, 10));
  let target = new Date(Date.UTC(baseYear, baseMonth - 1, baseDay)); // use UTC date arithmetic

  // Mappings
  const weekdays = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, miércoles: 3, jueves: 4, viernes: 5, sabado: 6, sábado: 6 };
  const months = {
    enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
    julio: 7, agosto: 8, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12
  };

  // Relative days
  if (txt.includes('pasado mañana')) {
    target.setUTCDate(target.getUTCDate() + 2);
  } else if (txt.includes('mañana')) {
    target.setUTCDate(target.getUTCDate() + 1);
  } else if (txt.includes('hoy')) {
    // no change
  } else {
    // Weekday names
    for (const [name, idx] of Object.entries(weekdays)) {
      if (txt.includes(name)) {
        // advance until weekday matches
        const maxIter = 14;
        let iter = 0;
        while (target.getUTCDay() !== idx && iter < maxIter) {
          target.setUTCDate(target.getUTCDate() + 1);
          iter += 1;
        }
        break;
      }
    }

    // Explicit day e.g., '3 de agosto' or '3 agosto'
    const explicitDateMatch = txt.match(/(\d{1,2})\s*(?:de\s*)?(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)/i);
    if (explicitDateMatch) {
      const dayNum = parseInt(explicitDateMatch[1], 10);
      const monthName = explicitDateMatch[2].toLowerCase();
      const monthNum = months[monthName];
      if (monthNum) {
        // Keep year same as base; adjust year only if month less than current month? Avoid future-year assumptions.
        let year = baseYear;
        if (monthNum < baseMonth) year = baseYear;
        target = new Date(Date.UTC(year, monthNum - 1, dayNum));
      }
    }
  }

  // Time parsing
  let hour = 12;
  let minute = 0;
  const timeMatchAmPm = txt.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  const timeMatch24 = txt.match(/(\d{1,2}):(\d{2})/);
  const timeMatchPlain = txt.match(/(?:a\s*las|a|\bat\b)?\s*(\d{1,2})\s*(?:hm|h|hrs|horas)?\s*(am|pm)?/i);

  if (timeMatchAmPm) {
    hour = parseInt(timeMatchAmPm[1], 10);
    minute = timeMatchAmPm[2] ? parseInt(timeMatchAmPm[2], 10) : 0;
    const ampm = (timeMatchAmPm[3] || '').toLowerCase();
    if (ampm === 'pm' && hour < 12) hour += 12;
    if (ampm === 'am' && hour === 12) hour = 0;
  } else if (timeMatch24) {
    hour = parseInt(timeMatch24[1], 10);
    minute = parseInt(timeMatch24[2], 10);
  } else if (timeMatchPlain) {
    hour = parseInt(timeMatchPlain[1], 10);
    minute = 0;
    const ampm = (timeMatchPlain[2] || '').toLowerCase();
    if (ampm === 'pm' && hour < 12) hour += 12;
    if (ampm === 'am' && hour === 12) hour = 0;
  } else {
    // If no explicit time provided, treat as incomplete: do not assume a default time.
    // Returning null will indicate that fechaHora is incomplete (missing time) and should not be persisted as an ISO datetime.
    return null;
  }

  // Build a UTC ISO string from Lima local time by applying the -05:00 offset.
  const limaUtcDate = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate(), hour + 5, minute, 0));
  return limaUtcDate.toISOString().replace(/\.000Z$/, '+00:00');
}

export function formatLimaFechaHoraText(fechaHoraISO) {
  if (!fechaHoraISO || typeof fechaHoraISO !== 'string') return null;
  const parsed = new Date(fechaHoraISO);
  if (Number.isNaN(parsed.getTime())) return null;

  let datePart = new Intl.DateTimeFormat('es-PE', {
    timeZone: 'America/Lima',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(parsed);

  const timePart = new Intl.DateTimeFormat('es-PE', {
    timeZone: 'America/Lima',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(parsed);

  datePart = datePart.replace(/\s*,\s*/, ' ');
  const normalizedTime = timePart
    .replace(/\s*a\.?\s*m\.?/i, ' AM')
    .replace(/\s*p\.?\s*m\.?/i, ' PM')
    .replace(/\u202F/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return `${datePart}, ${normalizedTime}`.replace(/\s+de\s+\d{4}/, '').trim();
}

/**
 * Prepara el request hacia la API de Gemini inyectando el prompt dinámico.
 */
function buildGeminiRequest(client, mensaje, history, jid, options = {}) {
  const historyText = formatHistoryForPrompt(history, 10000);
  const userText = `${historyText ? historyText + '\n' : ''}Cliente: ${mensaje}`;
  
  // Se obtiene el prompt enriquecido dinámicamente con Fecha de Lima, WhatsApp Hint y posibles placeholders inyectados
  const effectiveSystemPrompt = buildSystemPromptWithContext(jid, getOrCreateSession(jid), options.clinic);

  if (isStructuredGeminiClient(client)) {
    return {
      type: 'structured',
      request: {
        contents: [
          {
            role: 'user',
            parts: [{ text: userText }],
          },
        ],
        systemInstruction: effectiveSystemPrompt,
        generationConfig: {
          maxOutputTokens: options.maxOutputTokens || config.gemini?.maxOutputTokens || 100
        },
      },
    };
  }

  return {
    type: 'text',
    prompt: `${effectiveSystemPrompt}\n${userText}`,
  };
}

async function callClientWithRetries(client, geminiRequest, maxRetries = 1, options = {}) {
  let attempt = 0;
  let lastErr = null;
  const attempts = maxRetries + 1;
  while (attempt < attempts) {
    attempt += 1;
    try {
      if (!client || (typeof client.generate !== 'function' && typeof client.generateContent !== 'function')) {
        // No real client: fallback to echo-like simple response
        const fallbackText = typeof geminiRequest === 'object' && geminiRequest.prompt ? geminiRequest.prompt : '';
        return { text: `Echo: ${String(fallbackText).slice(0, 200)}` };
      }

      if (isStructuredGeminiClient(client) && geminiRequest?.type === 'structured') {
        return await client.generateContent(geminiRequest.request, { model: config.gemini?.model });
      }

      if (typeof client.generate === 'function') {
        return await client.generate(geminiRequest.prompt || '', { model: config.gemini?.model, maxOutputTokens: options.maxOutputTokens || config.gemini?.maxOutputTokens || 100 });
      }

      if (typeof client.generateContent === 'function' && geminiRequest?.type === 'structured') {
        // generationConfig already included in geminiRequest.request; still pass model
        return await client.generateContent(geminiRequest.request, { model: config.gemini?.model });
      }

      throw new Error('Gemini client does not support generate or generateContent');
    } catch (e) {
      lastErr = e;
      const msg = String(e && (e.message || e.code || ''));
      const isRetriable = /timeout|network|ECONNRESET|ECONNREFUSED|5\d{2}/i.test(msg);
      if (!isRetriable) break;
      await new Promise((r) => setTimeout(r, attempt === 1 ? 500 : 1500));
      continue;
    }
  }
  throw lastErr || new Error('client failed');
}

export async function obtenerRespuestaIA(jid, mensaje, options = {}) {
  const client = options.client;
  const skipDebounce = Boolean(options.skipDebounce);
  const maxRetries = (typeof options.maxRetries === 'number') ? options.maxRetries : 1;
  const session = getOrCreateSession(jid);
  const now = Date.now();
  const sid = getSessionId(jid);
  const priorFailures = failureCounts.get(sid) || 0;
  // Only debounce if there are no recent consecutive failures; if we have recent failures, allow retry even within debounce window
  if (!skipDebounce && session.lastUserMessageAt && now - session.lastUserMessageAt < DEBOUNCE_MS && priorFailures === 0) {
    session.lastUserMessageAt = now;
    return { texto: null, leadData: null, skipResponse: true };
  }
  session.lastUserMessageAt = now;
  session.history.push({ role: 'user', parts: [{ text: mensaje }] });
  session.history = session.history.slice(-MAX_HISTORY_MESSAGES);

  const geminiRequest = buildGeminiRequest(client, mensaje, session.history, jid, options);

  try {
    const result = await callClientWithRetries(client, geminiRequest, maxRetries, options);
    const rawModelText = extractTextFromResult(result) || 'Disculpa, no pude procesar tu mensaje. ¿Puedes intentar decirlo de otra forma, por favor?';
    let rawText = rawModelText;
    // sanitize any JSON-wrapped or code-fenced responses from the model for user output only
    const sanitizedRawText = sanitizeModelTextOutput(rawModelText);

    let leadData = null;
    const leadRegex = /<<<LEAD_JSON>>>\s*([\s\S]*?)\s*<<<END_LEAD_JSON>>>/i;
    const match = leadRegex.exec(rawText);
    if (match && match[1]) {
      const jsonText = match[1].trim();
      try {
          let parsed = normalizeLeadData(JSON.parse(jsonText));
          if (parsed && parsed.telefono) parsed.telefono = String(parsed.telefono).replace(/\D/g, '');
          // finalize and validate lead data server-side (compute ISO and readiness)
          parsed = finalizeLeadData(parsed);
          leadData = parsed;
        } catch (e) {          console.warn('geminiService: failed to parse LEAD_JSON from model', e && e.message ? e.message : e);
          const rawLead = extractLeadDataFromText(rawText) || {};
          const messageLead = extractLeadDataFromText(mensaje) || {};
          const historyLead = extractLeadDataFromHistory(session.history) || {};

          // Preserve previously captured valid fields from history if new extraction appears to be a district or invalid
          const finalNombre = (function() {
            // Prefer explicit messageLead.nombre if it exists and does not look like a district
            if (messageLead.nombre && !isLikelyDistrict(messageLead.nombre) && messageLead.nombre.length > 1) return messageLead.nombre;
            // Else prefer rawLead.nombre if valid
            if (rawLead.nombre && !isLikelyDistrict(rawLead.nombre) && rawLead.nombre.length > 1) return rawLead.nombre;
            // Else keep historical name
            if (historyLead.nombre && !isLikelyDistrict(historyLead.nombre)) return historyLead.nombre;
            return null;
          })();

          const finalDistrito = (function() {
            // district can come from explicit patterns or history
            if (messageLead.distrito) return messageLead.distrito;
            if (rawLead.distrito) return rawLead.distrito;
            if (historyLead.distrito) return historyLead.distrito;
            return null;
          })();

          const finalTelefono = messageLead.telefono || rawLead.telefono || historyLead.telefono || null;
          const finalFecha = messageLead.fechaHora || rawLead.fechaHora || historyLead.fechaHora || null;

          leadData = {
            nombre: finalNombre,
            telefono: finalTelefono,
            distrito: finalDistrito,
            fechaHora: finalFecha,
            ready_to_notify: false,
          };
          // finalize and validate lead data server-side
          leadData = finalizeLeadData(leadData);
        }
      } else {
        const rawLead = extractLeadDataFromText(rawText) || {};
        const messageLead = extractLeadDataFromText(mensaje) || {};
        leadData = {
          nombre: messageLead.nombre || rawLead.nombre || null,
          telefono: messageLead.telefono || rawLead.telefono || null,
          distrito: messageLead.distrito || rawLead.distrito || null,
          fechaHora: messageLead.fechaHora || rawLead.fechaHora || null,
        };
        if (!leadData.telefono || !leadData.nombre || !leadData.distrito || !leadData.fechaHora) {
          const historyLead = extractLeadDataFromHistory(session.history) || {};
          leadData = {
            nombre: leadData.nombre || historyLead.nombre || null,
            telefono: leadData.telefono || historyLead.telefono || null,
            distrito: leadData.distrito || historyLead.distrito || null,
            fechaHora: leadData.fechaHora || historyLead.fechaHora || null,
          };
        }
        // finalize and validate lead data server-side
        leadData = finalizeLeadData(leadData);
        if (!leadData || (!leadData.nombre && !leadData.telefono && !leadData.distrito && !leadData.fechaHora)) {
          leadData = null;
        }
      }

    // If we have a textual fechaHora, ensure fechaHoraISO is populated using parseTextToLimaISO
    if (leadData && leadData.fechaHora) {
      try {
        const iso = parseTextToLimaISO(leadData.fechaHora);
        if (iso) {
          leadData.fechaHoraISO = iso;
          const explicitText = formatLimaFechaHoraText(iso);
          if (explicitText) {
            leadData.fechaHora = explicitText;
          }
        }
      } catch (e) {
        console.warn('parseTextToLimaISO failed:', e && e.message ? e.message : e);
      }
    }

    session.history.push({ role: 'model', parts: [{ text: rawText }] });
    if (leadData && leadData.nombre && leadData.distrito && leadData.fechaHora && !session.history.some((h) => (h.parts || []).some((p) => typeof p.text === 'string' && p.text.includes('[SISTEMA - CITA REGISTRADA VERIFICADA:')))) {
      session.history.push({
        role: 'model',
        parts: [{ text: `[SISTEMA - CITA REGISTRADA VERIFICADA: Nombre: ${leadData.nombre}, Distrito: ${leadData.distrito}, Fecha/Hora Agendada: ${leadData.fechaHora}]` }]
      });

      // Mark session as booked and keep a snapshot of the confirmed lead data so follow-up turns do not re-ask core fields.
      try {
        session.booked = true;
        session.leadSnapshot = {
          nombre: leadData.nombre || null,
          telefono: leadData.telefono || null,
          distrito: leadData.distrito || null,
          fecha_hora_texto: leadData.fechaHora || null,
          fecha_hora_iso: leadData.fechaHoraISO || null,
          confirmedAt: new Date().toISOString()
        };
        // Ensure timer respects booked TTL after marking booked
        try { resetSessionTimer(getSessionId(jid), session); } catch (e) { /* ignore */ }

        // Persist leadSnapshot to durable store so booked state survives restarts and TTL expiry
        try {
          const phoneFromJid = getSessionId(jid);
          // Dynamic import to avoid circular dependency
          const { saveLeadSnapshot } = await import('./leadService.js');
          // persist normalized phone + snapshot
          try {
            await saveLeadSnapshot(phoneFromJid, session.leadSnapshot);
          } catch (err) {
            console.warn('geminiService: failed to persist leadSnapshot', err && err.message ? err.message : err);
          }
        } catch (err) {
          // non fatal
        }
      } catch (e) { /* non fatal */ }
    }

    session.history = session.history.slice(-MAX_HISTORY_MESSAGES);

    const sid = getSessionId(jid);
    failureCounts.set(sid, 0);

    let texto = sanitizedRawText;

    // Protect against model hallucinations: if the model claims a booking ("ya quedó agendada", "tu cita quedó...", etc.)
    // but we do NOT have a confirmed fecha (neither in leadData nor in session.leadSnapshot), remove those assertions aggressively.
    try {
      const bookingClaimPattern = /\b(ya\s+qued[oó]\s+agendad[ao]|qued[oó]\s+agendad[ao]|tu\s+cita\b|tu\s+cita\s+(?:qued[oó]|est[aá]\s+agendada|ya\s+est[aá]))/i;
      const hasBookingClaim = bookingClaimPattern.test(texto || '');
      const hasConfirmedDate = Boolean((leadData && leadData.fechaHora) || (session.leadSnapshot && session.leadSnapshot.fecha_hora_texto));
      if (hasBookingClaim && !hasConfirmedDate) {
        // Remove any sentence that mentions 'cita' or booking verbs to be conservative
        const sentences = (texto || '').split(/[\.\?!]+/).map(s => s.trim()).filter(Boolean);
        const filtered = sentences.filter(s => !/\b(cita|qued[oó]|agendad|agendar|reservad|programad)\b/i.test(s));
        texto = (filtered.join('. ') || '').trim();
        if (!texto) texto = 'Gracias por tu mensaje. ¿Qué día y a qué hora prefieres para la cita?';
      }
    } catch (e) {
      // non-fatal: leave texto as-is
    }

    if (match) {
      texto = rawText.replace(leadRegex, '').trim();
      // sanitize again after removing LEAD_JSON block
      texto = sanitizeModelTextOutput(texto);
    }

    // Final safety net: if texto still contains booking claims but we have no confirmed fecha, replace with a neutral follow-up
    try {
      const bookingClaimPattern = /\b(ya\s+qued[oó]\s+agendad[ao]|qued[oó]\s+agendad[ao]|tu\s+cita\b|tu\s+cita\s+(?:qued[oó]|est[aá]\s+agendada|ya\s+est[aá]))/i;
      const hasBookingClaim = bookingClaimPattern.test(texto || '');
      const hasConfirmedDate = Boolean((leadData && leadData.fechaHora) || (session.leadSnapshot && session.leadSnapshot.fecha_hora_texto));
      if (hasBookingClaim && !hasConfirmedDate) {
        texto = 'Gracias por tu mensaje. ¿Qué día y a qué hora prefieres para la cita?';
      }
    } catch (e) {
      // ignore
    }

    return { texto, leadData };
  } catch (e) {
    const sid = getSessionId(jid);
    const prev = failureCounts.get(sid) || 0;
    const nowCount = prev + 1;
    failureCounts.set(sid, nowCount);

    if (nowCount >= 2) {
      return { texto: CONTINGENCY_MESSAGE, leadData: null };
    }

    return { texto: 'Disculpa, estoy teniendo problemas para procesar tu solicitud. Por favor intenta de nuevo en unos momentos.', leadData: null };
  }
}

export default { obtenerRespuestaIA, sanitizeModelTextOutput };
