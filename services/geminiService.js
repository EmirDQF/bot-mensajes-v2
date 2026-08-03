import config from '../config/env.js';

const TTL_MS = Number(process.env.GEMINI_SESSION_TTL_MS || 30 * 60 * 1000); // 30 minutes
const DEBOUNCE_MS = Number(process.env.GEMINI_DEBOUNCE_MS || 2000);

const CAMILA_SYSTEM_PROMPT = `Eres "Camila", la recepcionista virtual de una clínica dental en Lima. Habla en español, con tono amable, profesional y cercano. Responde siempre de forma breve y útil (máximo 40–50 palabras). Objetivos principales:

1) Detectar si el paciente quiere AGENDAR una cita.
2) Si pide agendar, guía la conversación para OBTENER: Nombre, Teléfono (9 dígitos Perú), Distrito, Día y Hora deseada. Pide un dato por mensaje si hace falta (p.ej. "¿Cuál es tu nombre completo?").
   - Si el usuario comete un error tipográfico como "me llamos", interpreta esto como "me llamo" y extrae el nombre correctamente.
3) Si ya hay Nombre+Teléfono+Distrito+DíaHora, confirma resumidamente y genera un objeto JSON con los campos exactos: { "nombre": "...", "telefono": "...", "distrito": "...", "fechaHoraTexto": "..." } PRIMERO dentro de un bloque separado etiquetado como <<<LEAD_JSON>>> ... <<<END_LEAD_JSON>>>. Luego envía el mensaje de confirmación breve al usuario.
   - La fecha y hora deben guardarse completas: no envíes ni utilices solo el día. Fecha/Hora final acordada debe incluir el día y la hora exacta.
IMPORTANTE: Genera el bloque <<<LEAD_JSON>>> SOLO LA PRIMERA VEZ que tengas Nombre+Teléfono+Distrito+Día/Hora completos en una conversación. En turnos posteriores de la misma conversación, NUNCA vuelvas a generar ese bloque, aunque el paciente haga más preguntas o la información se repita — simplemente responde de forma natural y breve a la nueva pregunta sin incluir el bloque JSON.

REGLA DE MEMORIA: Si el usuario pregunta por los detalles de su cita agendada, consulta la CITA REGISTRADA VERIFICADA en el historial y responde con la FECHA Y HORA EXACTA previamente confirmada. Jamás inventes una hora distinta.

4) Si el usuario pregunta por precios o presupuesto, responde con un precio estimado en 'brackets' (rango), p.ej. "Limpieza: S/80–S/150", y sugiere una evaluación para confirmar el presupuesto final.
5) Nunca des instrucciones técnicas, ni enlaces a API; evita respuestas largas. Si no entiendes, pide clarificación con una pregunta concreta.
6) Cuando respondas al usuario, sé amable: usa "Gracias", "Por favor", "¿Podrías…?" según el caso, pero en respuestas subsiguientes NO comiences con un saludo como "Hola", "Buenos días", "Buenas tardes" o "Buenas noches".
7) Acepta cualquier número peruano de 9 dígitos aunque el usuario no escriba +51 y aunque lo ingrese con espacios, guiones o texto adicional; normaliza el teléfono a solo dígitos.
8) Si el usuario dice "a este número" o pide detalles al número actual, reconoce que se refiere al número de WhatsApp con el que está escribiendo y responde: "Perfecto, te enviamos la información al [número_registrado]." sin volver a pedir el teléfono.
9) Cuando ya tengas Nombre, Teléfono, Distrito y Fecha/Hora completos, ADJUNTA siempre AL FINAL de tu mensaje el siguiente bloque EXACTO:

<<<LEAD_JSON>>>
{
"nombre": "Nombre Capturado",
"telefono": "987654321",
"distrito": "Distrito",
"fecha_hora_texto": "viernes 3:00 PM",
"ready_to_notify": true
}
<<<END_LEAD_JSON>>>

No omitas este bloque si la cita está lista, y colócalo siempre después de la respuesta al usuario.

Ejemplos (few-shot):

Usuario: "Quiero agendar, me llamo Juan Perez, mi numero es 987654321, vivo en San Borja, puedo el jueves a las 3pm"
Camila: <<<LEAD_JSON>>>
{"nombre":"Juan Perez","telefono":"987654321","distrito":"San Borja","fechaHoraTexto":"jueves a las 3pm"}
<<<END_LEAD_JSON>>>
Perfecto, Juan. Te agendé tentativamente para el jueves a las 3pm. ¿Confirmas que ese horario te viene bien?

Usuario: "Hola, cuánto cuesta una ortodoncia?"
Camila: "Un tratamiento de ortodoncia suele costar entre S/2500–S/6000 según complejidad. Recomendamos una evaluación para dar precio exacto. ¿Te gustaría agendar una evaluación?"

Usuario: "No, solo quiero saber si hay disponibilidad mañana"
Camila: "¿A qué franja horaria prefieres mañana: mañana (8–12), tarde (12–16) o noche (16–20)?"
`;

const MAX_HISTORY_MESSAGES = Number(process.env.GEMINI_MAX_HISTORY || 8);
const CLEANUP_MS = Number(process.env.GEMINI_CLEANUP_MS || 60 * 1000);
const CONTINGENCY_MESSAGE = process.env.GEMINI_CONTINGENCY_MESSAGE || 'En este momento nuestro sistema está ocupado, un asesor te responderá a la brevedad.';

const chatSessions = new Map(); // sessionId -> { history: [], timer }
const failureCounts = new Map(); // sessionId -> consecutive failure count

function getSessionId(jid) {
  return (jid || '').split('@')[0];
}

function resetSessionTimer(sessionId, entry) {
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = setTimeout(() => {
    chatSessions.delete(sessionId);
    failureCounts.delete(sessionId);
    // console.log(`Gemini: cleared session ${sessionId} due to inactivity`);
  }, TTL_MS);
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

function formatHistoryForPrompt(history) {
  return history.map((h) => {
    const role = h.role === 'user' ? 'Cliente' : 'Camila';
    const text = (h.parts || []).map(p => p.text || '').join(' ').trim();
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
function isLikelyDistrict(text) {
  if (!text || typeof text !== 'string') return false;
  const t = text.toLowerCase().trim();
  // patterns like "soy de los olivos", "de los olivos", "vivo en san borja"
  if (/^\s*(?:de|del)\s+/i.test(t)) return true;
  if (/\b(?:soy de|vivo en|nací en|naci en)\b/i.test(t)) return true;
  // short check: if string has 'distrito' word
  if (/\bdistrit[oó]\b/i.test(t)) return true;
  // common district words (Los, San, Santa) followed by a name
  if (/\b(?:los|san|santa|villa|sur|norte)\b\s+[a-záéíóúñü]+/i.test(t)) return true;
  return false;
}

function extractLeadDataFromText(text) {
  if (!text) return null;
  const t = text.toLowerCase();

  // Detect explicit "soy de X" or "vivo en X" as distrito
  const distritoFromSoy = t.match(/(?:soy\s+(?:de|del)|vivo\s+en)\s+([a-záéíóúñü\s]{2,60})(?:[,\.\n]|$)/i);
  const distrito = distritoFromSoy ? distritoFromSoy[1].trim() : null;

  // Name extraction: support typos like "me llamos" and avoid capturing phrases like "soy de ..." by negative lookahead
  const nombreMatch = t.match(/(?:me\s+llam(?:o|os)|me\s+llamo|mi\s+nombre\s+es)\s+([a-záéíóúñü\s]{2,60}?)(?=\s*(?:[,\.\n]|vivo\s+en|mi\s+telefono|mi\s+número|mi\s+nro|tengo\b|y\b|con\b|$))/i)
    || t.match(/(?:soy)\s+(?!de\b|del\b|en\b)([a-záéíóúñü\s]{2,60}?)(?=\s*(?:[,\.\n]|vivo\s+en|mi\s+telefono|mi\s+número|mi\s+nro|tengo\b|y\b|con\b|$))/i);
  const nombre = nombreMatch ? nombreMatch[1].trim().replace(/\s+/g,' ') : null;

  const digitString = t.replace(/[^0-9]/g, "");
  const telefonoMatch = digitString.match(/(?:^51)?(9\d{8})/);
  const telefono = telefonoMatch ? telefonoMatch[1] : null;

  const distritoMatch = distrito || t.match(/vivo en\s+([a-záéíóúñü\s]{2,60})(?:[,\.\n]|\s+y\b|$)/i) || t.match(/en\s+([a-záéíóúñü\s]{2,60})(?:[,\.\n]|\s+y\b|$)/i);
  const distritoFinal = distritoMatch ? (typeof distritoMatch === 'string' ? distritoMatch : (distritoMatch[1] ? distritoMatch[1].trim() : null)) : null;

  const fechaMatch = t.match(/(?:puedo\s+)?(el\s+)?((?:hoy|mañana|pasado\s+mañana|lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo)|\d{1,2}\s+de\s+\w+)(?:\s+(?:a\s+las)?\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?/i);
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
    ready_to_notify: parsed.ready_to_notify === true || parsed.readyToNotify === true || false,
  };
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

function getOrCreateSession(jid) {
  const sid = getSessionId(jid);
  let entry = chatSessions.get(sid);
  if (!entry) {
    entry = { history: [], timer: null, lastUserMessageAt: 0 };
    chatSessions.set(sid, entry);
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

  // 2. Eliminar bloques de código Markdown ```json ... ```
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  // 3. Desempaquetar si viene en formato JSON stringify
  if (/^[\[{]/.test(cleaned)) {
    try {
      const candidate = cleaned;
      const parsed = JSON.parse(candidate);
      const extracted = extractTextFromParsedJson(parsed);
      if (extracted) {
        cleaned = extracted;
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
export function buildSystemPromptWithContext(jid) {
  const fechaActual = getLimaCurrentDateTime();
  const phoneHint = getCurrentPhoneHint(jid);

  return `${CAMILA_SYSTEM_PROMPT}\n\n[CONTEXTO TEMPORAL Y DE SISTEMA EN VIVO]\n- FECHA Y HORA ACTUAL EN LIMA: ${fechaActual}\n- REGLA DE TIEMPO: Usa esta fecha actual de Lima como tu única referencia absoluta para calcular "hoy", "mañana", "el próximo lunes", o fechas específicas solicitadas por el cliente. No asumas años ni meses pasados.${phoneHint ? `\n${phoneHint}` : ''}`;
}

/**
 * Parsea texto libre de fecha/hora relativo a Lima y devuelve ISO 8601 con offset -05:00
 * Ejemplos aceptados: "hoy a las 3pm", "mañana 16:00", "el jueves a las 4pm", "3 de agosto a las 10:30"
 */
function parseTextToLimaISO(fechaTexto) {
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
        // Keep year same as base; adjust year if month earlier than base month (assume next year if month < baseMonth - rare but safe)
        let year = baseYear;
        if (monthNum < baseMonth) year = baseYear + 0; // keep same year to avoid assumptions
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
    // default to 12:00 (noon) if no time provided
    hour = 12;
    minute = 0;
  }

  // Build ISO-like string with -05:00 offset for Lima
  const y = target.getUTCFullYear();
  const m = String(target.getUTCMonth() + 1).padStart(2, '0');
  const d = String(target.getUTCDate()).padStart(2, '0');
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');

  return `${y}-${m}-${d}T${hh}:${mm}:00-05:00`;
}

/**
 * Prepara el request hacia la API de Gemini inyectando el prompt dinámico.
 */
function buildGeminiRequest(client, mensaje, history, jid) {
  const historyText = formatHistoryForPrompt(history);
  const userText = `${historyText ? historyText + '\n' : ''}Cliente: ${mensaje}`;
  
  // Se obtiene el prompt enriquecido dinámicamente con Fecha de Lima y WhatsApp Hint
  const effectiveSystemPrompt = buildSystemPromptWithContext(jid);

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
          maxOutputTokens: config.gemini?.maxOutputTokens || 150,
          responseMimeType: "application/json"
        },
      },
    };
  }

  return {
    type: 'text',
    prompt: `${effectiveSystemPrompt}\n${userText}`,
  };
}

async function callClientWithRetries(client, geminiRequest, maxRetries = 1) {
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
        return await client.generate(geminiRequest.prompt || '', { model: config.gemini?.model, maxOutputTokens: config.gemini?.maxOutputTokens || 150 });
      }

      if (typeof client.generateContent === 'function' && geminiRequest?.type === 'structured') {
        return await client.generateContent(geminiRequest.request, { model: config.gemini?.model });
      }

      throw new Error('Gemini client does not support generate or generateContent');
    } catch (e) {
      lastErr = e;
      const msg = String(e && (e.message || e.code || ''));
      const isRetriable = /timeout|network|ECONNRESET|ECONNREFUSED|5\d{2}/i.test(msg) || true;
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
  const session = getOrCreateSession(jid);
  const now = Date.now();
  if (!skipDebounce && session.lastUserMessageAt && now - session.lastUserMessageAt < DEBOUNCE_MS) {
    session.lastUserMessageAt = now;
    return { texto: null, leadData: null, skipResponse: true };
  }
  session.lastUserMessageAt = now;
  session.history.push({ role: 'user', parts: [{ text: mensaje }] });
  session.history = session.history.slice(-MAX_HISTORY_MESSAGES);

  const geminiRequest = buildGeminiRequest(client, mensaje, session.history, jid);

  try {
    const result = await callClientWithRetries(client, geminiRequest, 1);
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
          const parsed = normalizeLeadData(JSON.parse(jsonText));
          if (parsed && parsed.telefono) parsed.telefono = String(parsed.telefono).replace(/\D/g, '');
          if (parsed && parsed.ready_to_notify === false && parsed.nombre && parsed.telefono && parsed.distrito && parsed.fechaHora) {
            parsed.ready_to_notify = true;
          }
          leadData = parsed;
        } catch (e) {
          console.warn('geminiService: failed to parse LEAD_JSON from model', e && e.message ? e.message : e);
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
          if (leadData.nombre && leadData.telefono && leadData.distrito && leadData.fechaHora) {
            leadData.ready_to_notify = true;
          }
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
        if (leadData.nombre && leadData.telefono && leadData.distrito && leadData.fechaHora) {
          leadData.ready_to_notify = true;
        }
        if (!leadData.nombre && !leadData.telefono && !leadData.distrito && !leadData.fechaHora) {
          leadData = null;
        }
      }

    // If we have a textual fechaHora, ensure fechaHoraISO is populated using parseTextToLimaISO
    if (leadData && leadData.fechaHora) {
      try {
        const iso = parseTextToLimaISO(leadData.fechaHora);
        if (iso) {
          leadData.fechaHoraISO = iso;
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
    }
    session.history = session.history.slice(-MAX_HISTORY_MESSAGES);

    const sid = getSessionId(jid);
    failureCounts.set(sid, 0);

    let texto = sanitizedRawText;
    if (match) {
      texto = rawText.replace(leadRegex, '').trim();
      // sanitize again after removing LEAD_JSON block
      texto = sanitizeModelTextOutput(texto);
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
