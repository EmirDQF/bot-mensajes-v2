import config from '../config/env.js';

const TTL_MS = Number(process.env.GEMINI_SESSION_TTL_MS || 30 * 60 * 1000); // 30 minutes

const CAMILA_SYSTEM_PROMPT = `Eres "Camila", la recepcionista virtual de una clínica dental en Lima. Habla en español, con tono amable, profesional y cercano. Responde siempre de forma breve y útil (máximo 40–50 palabras). Objetivos principales:

1) Detectar si el paciente quiere AGENDAR una cita.
2) Si pide agendar, guía la conversación para OBTENER: Nombre, Teléfono (9 dígitos Perú), Distrito, Día y Hora deseada. Pide un dato por mensaje si hace falta (p.ej. "¿Cuál es tu nombre completo?").
3) Si ya hay Nombre+Teléfono+Distrito+DíaHora, confirma resumidamente y genera un objeto JSON con los campos exactos: { "nombre": "...", "telefono": "...", "distrito": "...", "fechaHoraTexto": "..." } PRIMERO dentro de un bloque separado etiquetado como <<<LEAD_JSON>>> ... <<<END_LEAD_JSON>>>. Luego envía el mensaje de confirmación breve al usuario.
4) Si el usuario pregunta por precios o presupuesto, responde con un precio estimado en 'brackets' (rango), p.ej. "Limpieza: S/80–S/150", y sugiere una evaluación para confirmar el presupuesto final.
5) Nunca des instrucciones técnicas, ni enlaces a API; evita respuestas largas. Si no entiendes, pide clarificación con una pregunta concreta.
6) Cuando respondas al usuario, sé amable: usa "Hola", "Gracias", "Por favor", "¿Podrías…?" según el caso.

Ejemplos (few-shot):

Usuario: "Quiero agendar, me llamo Juan Perez, mi numero es 987654321, vivo en San Borja, puedo el jueves a las 3pm"
Camila: <<<LEAD_JSON>>>
{"nombre":"Juan Perez","telefono":"987654321","distrito":"San Borja","fechaHoraTexto":"jueves a las 3pm"}
<<<END_LEAD_JSON>>>
Perfecto, Juan. Te agendé tentativamente para el jueves a las 3pm. ¿Confirmas que ese horario te viene bien?

Usuario: "Hola, cuánto cuesta una ortodoncia?"
Camila: "Hola 👋. Un tratamiento de ortodoncia suele costar entre S/2500–S/6000 según complejidad. Recomendamos una evaluación para dar precio exacto. ¿Te gustaría agendar una evaluación?"

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
function extractLeadDataFromText(text) {
  if (!text) return null;
  const t = text.toLowerCase();
  const nombreMatch = t.match(/me llamo\s+([a-záéíóúñü\s]{2,60})(?:[,.\n]|$)/i) || t.match(/soy\s+([a-záéíóúñü\s]{2,60})(?:[,.\n]|$)/i);
  const nombre = nombreMatch ? nombreMatch[1].trim().replace(/\s+/g,' ') : null;
  const telefonoMatch = t.match(/(\+?51)?\s*(9\d{8}|\b\d{9}\b)/);
  const telefono = telefonoMatch ? (telefonoMatch[2] || telefonoMatch[0]).replace(/[^0-9]/g,'') : null;
  const distritoMatch = t.match(/vivo en\s+([a-záéíóúñü\s]{2,60})(?:[,\.\n]|$)/i) || t.match(/en\s+([a-záéíóúñü\s]{2,60})(?:[,\.\n]|$)/i);
  const distrito = distritoMatch ? distritoMatch[1].trim() : null;
  const fechaMatch = t.match(/(?:puedo\s+)?(el\s+)?((?:hoy|mañana|pasado\s+mañana|lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo)|\d{1,2}\s+de\s+\w+)(?:\s+(?:a\s+las)?\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?/i);
  const fechaHora = fechaMatch ? fechaMatch[0].trim() : null;
  return { nombre: nombre ?? null, telefono: telefono ?? null, distrito: distrito ?? null, fechaHora: fechaHora ?? null };
}

function getOrCreateSession(jid) {
  const sid = getSessionId(jid);
  let entry = chatSessions.get(sid);
  if (!entry) {
    entry = { history: [], timer: null };
    chatSessions.set(sid, entry);
  }
  resetSessionTimer(sid, entry);
  return entry;
}

function isStructuredGeminiClient(client) {
  return client && typeof client.generateContent === 'function';
}

function buildGeminiRequest(client, mensaje, history) {
  const historyText = formatHistoryForPrompt(history);
  const userText = `${historyText ? historyText + '\n' : ''}Cliente: ${mensaje}`;

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
        systemInstruction: CAMILA_SYSTEM_PROMPT,
        generationConfig: {
          maxOutputTokens: config.gemini?.maxOutputTokens || 150,
        },
      },
    };
  }

  return {
    type: 'text',
    prompt: `${CAMILA_SYSTEM_PROMPT}\n${userText}`,
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
  const session = getOrCreateSession(jid);
  session.history.push({ role: 'user', parts: [{ text: mensaje }] });
  session.history = session.history.slice(-MAX_HISTORY_MESSAGES);

  const geminiRequest = buildGeminiRequest(client, mensaje, session.history);

  try {
    const result = await callClientWithRetries(client, geminiRequest, 1);
    const rawText = (result && (result.text || (result.response && result.response.text))) || (typeof result === 'string' ? result : null) || 'Disculpa, no pude procesar tu mensaje. ¿Puedes intentar decirlo de otra forma, por favor?';

    let leadData = null;
    const leadRegex = /<<<LEAD_JSON>>>\s*([\s\S]*?)\s*<<<END_LEAD_JSON>>>/i;
    const match = leadRegex.exec(rawText);
    if (match && match[1]) {
      const jsonText = match[1].trim();
      try {
        const parsed = JSON.parse(jsonText);
        if (parsed.telefono) parsed.telefono = String(parsed.telefono).replace(/\D/g, '');
        leadData = parsed;
      } catch (e) {
        console.warn('geminiService: failed to parse LEAD_JSON from model', e && e.message ? e.message : e);
        const rawLead = extractLeadDataFromText(rawText) || {};
        const messageLead = extractLeadDataFromText(mensaje) || {};
        leadData = {
          nombre: messageLead.nombre || rawLead.nombre || null,
          telefono: messageLead.telefono || rawLead.telefono || null,
          distrito: messageLead.distrito || rawLead.distrito || null,
          fechaHora: messageLead.fechaHora || rawLead.fechaHora || null,
        };
      }
    } else {
      if (hasSchedulingIntent(mensaje, session.history)) {
        const rawLead = extractLeadDataFromText(rawText) || {};
        const messageLead = extractLeadDataFromText(mensaje) || {};
        leadData = {
          nombre: messageLead.nombre || rawLead.nombre || null,
          telefono: messageLead.telefono || rawLead.telefono || null,
          distrito: messageLead.distrito || rawLead.distrito || null,
          fechaHora: messageLead.fechaHora || rawLead.fechaHora || null,
        };
      }
    }

    session.history.push({ role: 'model', parts: [{ text: rawText }] });
    session.history = session.history.slice(-MAX_HISTORY_MESSAGES);

    const sid = getSessionId(jid);
    failureCounts.set(sid, 0);

    let texto = rawText;
    if (match) {
      texto = rawText.replace(leadRegex, '').trim();
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

export default { obtenerRespuestaIA };
