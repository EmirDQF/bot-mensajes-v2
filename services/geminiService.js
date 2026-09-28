import config from '../config/env.js';
import clinic, { activePromotions, activeTreatments, findTreatment } from '../config/clinic.config.js';
import { formatDateEs, formatTimeEs, localParts, toHHMM, toInstant } from './appointmentService.js';
import { now as clockNow } from './clock.js';
import { botNotesBlock, recommendationSentence } from './recommendationService.js';

const LIMA_TIME_ZONE = clinic.timezone;
const SESSION_TTL_MS = Number(process.env.GEMINI_SESSION_TTL_MS || 30 * 60 * 1000);
const BOOKED_TTL_MS = Number(process.env.GEMINI_BOOKED_SESSION_TTL_MS || 7 * 24 * 60 * 60 * 1000);
const DEBOUNCE_MS = Number(process.env.GEMINI_DEBOUNCE_MS || 0);
const MAX_HISTORY_MESSAGES = Number(process.env.GEMINI_MAX_HISTORY || 6);
const MAX_OUTPUT_TOKENS = 300;
const formatSoles = (value) => `S/ ${Number(value).toLocaleString('es-PE')}`;

const TONE_RULES = {
  cercano: 'Hablas como una asesora peruana amable y resolutiva: tuteas, frases cortas, "con gusto", "claro que sí".',
  formal: 'Hablas como una asesora peruana cordial y profesional: tratas de "usted", frases cortas y claras.',
  juvenil: 'Hablas como una asesora peruana joven y entusiasta: tuteas, frases cortas y cercanas, sin jergas vulgares.',
};
const EMOJI_RULES = { ninguno: 'No uses emojis.', pocos: 'Máximo 2 emojis por mensaje.', normal: 'Máximo 4 emojis por mensaje.' };

// Construye el prompt con la clínica efectiva (config/clinics/<id>.js + cambios del panel). Se arma en
// cada conversación: un precio o una promoción editados en el panel cambian la siguiente respuesta.
export function buildSystemPrompt(c = clinic, { today = localParts(c.timezone, clockNow()).date } = {}) {
  const treatments = activeTreatments(c)
    .map((t) => `- ${t.name}: desde ${formatSoles(t.priceFrom)}${t.financing ? ` (${t.financing})` : ''}.${t.description ? ` ${t.description}` : ''} Etiqueta de foto: [ENVIAR_FOTO: ${t.key}]`)
    .join('\n');
  const placeTags = ['fachada', 'ubicacion'].filter((key) => c.media?.[key]).map((key) => `[ENVIAR_FOTO: ${key}]`).join(' o ');
  // Promociones vencidas o desactivadas no llegan al prompt: nunca se mencionan.
  const campaign = [
    ...Object.values(c.campaign || {}).filter(Boolean),
    ...activePromotions(today, c).map((p) => `${p.title}${p.description ? `: ${p.description}` : ''}${p.validUntil ? ` (hasta el ${formatDateEs(p.validUntil)})` : ''}`),
  ].join(' · ') || 'Ninguna por ahora';
  const payments = [...(c.paymentMethods || []), c.financingText].filter(Boolean).join(' · ');
  const closedDays = (c.holidays || []).filter((h) => h.date >= today).slice(0, 8)
    .map((h) => `${formatDateEs(h.date)}${h.label ? ` (${h.label})` : ''}`).join('; ');
  const faq = (c.faq || []).map((item) => `- ${item.q} ${item.a}`).join('\n');
  const rules = (c.recommendationRules || []).map((rule) => {
    const treatment = rule.treatmentKey ? activeTreatments(c).find((t) => t.key === rule.treatmentKey) : null;
    return `- Si dice ${rule.triggers.slice(0, 4).map((t) => `"${t}"`).join(', ')}… → evaluación de ${rule.evaluation}${treatment ? ` (${treatment.name}, desde ${formatSoles(treatment.priceFrom)})` : ''}${rule.question ? `. Pregunta: ${rule.question}` : ''}`;
  }).join('\n');
  const forbidden = (c.forbiddenPhrases || []).length ? `\nNunca escribas estas frases ni variantes: ${c.forbiddenPhrases.map((p) => `"${p}"`).join(', ')}.` : '';
  return `Eres ${c.botName}, la asesora dental y coordinadora de citas de ${c.name}, ubicada en ${c.address}. Tu tono es profesional, cálido, resolutivo y cercano. Respondes con mensajes cortos de WhatsApp.

### REGLA 1: CERO SALUDOS REPETIDOS
Si ya hay mensajes previos, jamás digas "¡Hola!", "Buenos días", "¿En qué puedo ayudarte?" ni vuelvas a presentarte.

### REGLA 2: ENVÍO PROACTIVO DE FOTOS
Cuando consulte sobre un tratamiento o pida fotos o resultados, responde breve y termina con la etiqueta de foto del tratamiento (lista abajo). Para ubicación o local usa ${placeTags || 'solo texto'}. Puedes poner varias etiquetas.

### REGLA 3: AGENDAMIENTO EN DOS FASES
FASE A: si faltan nombre completo, tratamiento o día y hora, pide solo lo que falte:
"¡Con mucho gusto coordinamos tu cita! Por favor indícanos:
📌 Nombre y apellido:
📌 Tratamiento que deseas realizarte:
📌 Día y hora de preferencia:"
FASE B: cuando ya tengas los tres datos, NO repitas la plantilla. Di que su SOLICITUD de cita quedó registrada y que recepción se la confirmará. Nunca digas que el horario quedó bloqueado o confirmado.

### REGLA 4: PASE A HUMANO
Si pide hablar con una persona o un doctor, o tiene dudas clínicas complejas, responde: "¡Claro! Un especialista de nuestro equipo te escribirá en unos minutos. 📲"

### REGLA 5: SEGURIDAD CLÍNICA
No diagnosticas ni recetas medicamentos ni dosis. Si menciona dolor fuerte, sangrado, hinchazón, fiebre o un golpe, dile que lo derivas de inmediato con el equipo clínico y recomiéndale acudir a la clínica o a emergencias si empeora.

### REGLA 6: NO INVENTES
Usa solo los precios, horarios y datos de esta lista. Los precios son referenciales "desde"; el costo exacto se define en la evaluación. No inventes descuentos, promociones ni medios de pago: menciona solo la campaña vigente y lo que dicen las preguntas frecuentes.

### REGLA 7: TONO
${TONE_RULES[c.tone] || TONE_RULES.cercano} ${EMOJI_RULES[c.emojiLevel] || EMOJI_RULES.pocos} Cierra con una pregunta o un paso concreto (por ejemplo, elegir un horario).
Eres la asistente virtual de la clínica: si te preguntan si eres una persona, dilo con honestidad. Nunca finjas ser humana.${forbidden}

### REGLA 8: TEMAS AJENOS E INSULTOS
Si el mensaje no tiene que ver con la clínica, responde en una línea que solo puedes ayudar con la atención dental de ${c.name} y ofrece tu ayuda. Si te insultan, mantén la calma y el respeto, no respondas al insulto y ofrece ayuda o hablar con una persona.

### REGLA 9: RECOMIENDA UNA EVALUACIÓN, NUNCA DIAGNOSTIQUES
Cuando el paciente cuente qué le pasa, usa este formato: "Por lo que me cuentas, lo indicado es una evaluación de <X>; el doctor confirma el mejor tratamiento." Luego da el precio "desde" del tratamiento relacionado (solo de la lista) e invítalo a elegir un horario. Nunca digas "tienes…", "padeces…", "es una caries o infección…" ni "necesitas <tratamiento>": eso solo lo dice el doctor en la evaluación.${rules ? `\nGuía de esta clínica:\n${rules}` : ''}

### REGLA 10: CALIFICA SIN INTERROGAR
En toda la conversación haz como máximo 2 preguntas para conocerlo, una a la vez y solo si no lo dijo: qué busca lograr, para cuándo lo necesita o si prefiere pagar en cuotas.

### REGLA 11: OBJECIONES, SOLO CON DATOS DE ESTA CLÍNICA
- "Está caro": recuerda que es un precio "desde", que el costo exacto se ve en la evaluación y menciona las cuotas o formas de pago de la lista. No inventes descuentos.
- Miedo o nervios: tranquilízalo con empatía y solo con lo que la clínica ofrece según esta información; no prometas "sin dolor".
- "Lo voy a pensar": respeta su decisión y pregúntale si puedes escribirle mañana para resolver sus dudas.

### DATOS DE LA CLÍNICA
- Horario: ${c.workingHoursText}${closedDays ? `\n- Días cerrados (feriados): ${closedDays}` : ''}
- Dirección: ${c.address} (mapa: ${c.mapsUrl})
- Campaña y promociones vigentes: ${campaign}${payments ? `\n- Formas de pago y financiamiento: ${payments}` : ''}

### TRATAMIENTOS
${treatments}

### PREGUNTAS FRECUENTES
${faq}`;
}

// Quita del texto las frases que el dueño prohibió (respaldo por si el modelo las usa igual).
export function removeForbiddenPhrases(text, phrases = clinic.forbiddenPhrases || []) {
  let out = String(text || '');
  for (const phrase of phrases) {
    const escaped = String(phrase).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (escaped) out = out.replace(new RegExp(escaped, 'gi'), '');
  }
  return out.replace(/\s{2,}/g, ' ').replace(/\s+([.,!?])/g, '$1').replace(/,\s*([.!?])/g, '$1').trim();
}

const chatSessions = new Map();
const failureCounts = new Map();

const MONTHS = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};
const WEEKDAYS = {
  domingo: 0, lunes: 1, martes: 2, miércoles: 3, miercoles: 3,
  jueves: 4, viernes: 5, sábado: 6, sabado: 6,
};

function sessionId(jid) {
  return String(jid || '').split('@')[0];
}

function scheduleCleanup(sid, session) {
  if (session.timer) clearTimeout(session.timer);
  session.timer = setTimeout(() => {
    chatSessions.delete(sid);
    failureCounts.delete(sid);
  }, session.booked ? BOOKED_TTL_MS : SESSION_TTL_MS);
  session.timer.unref?.();
}

async function restoreSession(sid, session) {
  const { getByPhone } = await import('./leadService.js');
  if (typeof getByPhone !== 'function') return;
  const stored = await getByPhone(sid);
  if (!stored) return;
  session.leadSnapshot = stored;
  session.booked = Boolean(stored.fecha_hora_iso || stored.fechaHoraISO);
}

export function getOrCreateSession(jid) {
  const sid = sessionId(jid);
  let session = chatSessions.get(sid);
  if (!session) {
    session = {
      history: [],
      timer: null,
      lastUserMessageAt: 0,
      booked: false,
      leadSnapshot: null,
      restorePromise: null,
    };
    session.restorePromise = restoreSession(sid, session).catch(() => null);
    chatSessions.set(sid, session);
  }
  scheduleCleanup(sid, session);
  return session;
}

export async function ensureSessionLoaded(session) {
  if (session?.restorePromise) {
    await session.restorePromise;
    session.restorePromise = null;
  }
  return session;
}

// Horarios concretos ofrecidos al paciente (appointmentService.findNextSlots); se eligen con "1", "2" o "3".
export function setOfferedSlots(jid, slots) {
  const session = getOrCreateSession(jid);
  session.offeredSlots = Array.isArray(slots) && slots.length ? slots : null;
  return session.offeredSlots;
}

export function getOfferedSlots(jid) {
  return chatSessions.get(sessionId(jid))?.offeredSlots || null;
}

// Deshace la Fase B cuando la cita no pudo guardarse (p. ej. el horario se ocupó).
export function releaseBooking(jid) {
  const session = chatSessions.get(sessionId(jid));
  if (!session) return false;
  session.booked = false;
  session.chosenSlot = null;
  if (session.leadSnapshot) {
    session.leadSnapshot = { ...session.leadSnapshot, fecha_hora_texto: null, fecha_hora_iso: null, confirmedAt: null };
  }
  return true;
}

export function isSessionBooked(jid) {
  return Boolean(chatSessions.get(sessionId(jid))?.booked);
}

export function resetSession(jid) {
  const sid = sessionId(jid);
  chatSessions.delete(sid);
  failureCounts.delete(sid);
  return true;
}

export function mergeRecentUserMessages(history, windowMs = 10000) {
  if (!Array.isArray(history)) return [];
  const result = [];
  for (const message of history) {
    if (message.role !== 'user' || !result.length) {
      result.push(message);
      continue;
    }
    const previous = result[result.length - 1];
    if (previous.role === 'user' && message.at && previous.at && message.at - previous.at <= windowMs) {
      const text = [...(previous.parts || []), ...(message.parts || [])]
        .map((part) => part.text || '').filter(Boolean).join(' ');
      previous.parts = [{ text }];
      previous.text = text;
      previous.at = message.at;
    } else {
      result.push(message);
    }
  }
  return result;
}

function normalizeHistoryEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const role = entry.role === 'assistant' || entry.role === 'model' ? 'model' : entry.role === 'user' ? 'user' : null;
  if (!role) return null;
  const partText = (Array.isArray(entry.parts) ? entry.parts : [])
    .map((part) => typeof part?.text === 'string' ? part.text : '')
    .join(' ')
    .trim();
  const text = (typeof entry.text === 'string' ? entry.text.trim() : '') || partText;
  if (!text) return null;
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (/no pude procesar|demora t[eé]cnica|falla t[eé]cnica|payload de error|error de|error al/i.test(normalized)) {
    return null;
  }
  return { role, text: normalized, parts: [{ text: normalized }] };
}

function compactHistoryForPrompt(history, maxMessages = MAX_HISTORY_MESSAGES) {
  if (!Array.isArray(history)) return [];
  return history
    .map(normalizeHistoryEntry)
    .filter(Boolean)
    .slice(-maxMessages);
}

function textFromHistory(history) {
  return compactHistoryForPrompt(history)
    .filter((entry) => entry.role === 'user')
    .map((entry) => entry.text || '')
    .filter(Boolean)
    .join('\n');
}

export function extractLeadDataFromText(text, senderPhone = null) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const structuredParts = text.split(/\s*\/\s*/).map((part) => part.trim()).filter(Boolean);
  const structuredName = structuredParts.length >= 3 && /^[A-Za-zÁÉÍÓÚáéíóúÑñÜü]+(?:\s+[A-Za-zÁÉÍÓÚáéíóúÑñÜü]+)+$/.test(structuredParts[0])
    ? structuredParts[0]
    : null;
  const nameMatch = text.match(/\b(?:me llamo|mi nombre es|soy)\s+([A-Za-zÁÉÍÓÚáéíóúÑñÜü]+(?:\s+[A-Za-zÁÉÍÓÚáéíóúÑñÜü]+){0,2})(?=\s*(?:[,.\n]|vivo\b|vi\b|mi\b|tengo\b|y\b|con\b|$))/i);
  
  let phone = text.replace(/\D/g, '').match(/(?:51)?(9\d{8})/)?.[1] || null;
  if (!phone && senderPhone && /este (mismo )?n[uú]mero|mi n[uú]mero de whatsapp|con este whatsapp|a este n[uú]mero/i.test(text)) {
    const rawDigits = String(senderPhone).replace(/\D/g, '');
    phone = rawDigits.match(/(?:51)?(9\d{8})/)?.[1] || (rawDigits.length >= 9 ? rawDigits.slice(-9) : rawDigits);
  }

  const dateMatch = text.match(/\b(?:hoy|mañana|pasado mañana|lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado)(?:\s+\d{1,2}\s+de\s+[a-záéíóú]+)?(?:\s+(?:a\s*las?\s*)?\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?/i)
    || text.match(/\b\d{1,2}\s*(?:de\s*)?(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)(?:\s+(?:a\s*las?\s*)?\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?/i);
  const motivoMatch = text.match(/\b(?:tratamiento|motivo)\s*(?:es|:)?\s*([^,.\n]+)/i);

  return {
    nombre: nameMatch?.[1]?.trim() || structuredName,
    telefono: phone || null,
    motivo: motivoMatch?.[1]?.trim() || structuredParts[1] || null,
    fechaHora: dateMatch?.[0]?.trim() || structuredParts[2] || null,
  };
}

export function isValidName(name) {
  return typeof name === 'string'
    && name.trim().length >= 2
    && !/^(?:no proporcionad[oa]|dr\.?\s*\w+|estimado|paciente)$/i.test(name.trim());
}

export function isExplicitConfirmation(text) {
  if (typeof text !== 'string') return false;
  const value = text.trim().toLowerCase();
  if (/\b(pero|cambiar|reprogramar|otra hora|otra fecha|prefiero|no puedo|espera|luego)\b/.test(value)) return false;
  return /^(?:sí|si|confirmo|confirmado|correcto|vale|perfecto|ok|claro|de acuerdo|gracias)(?:[,.]?\s*(?:sí|si|confirmo|confirmado|correcto|vale|perfecto|ok|claro|de acuerdo|gracias))*[.!]?$/.test(value);
}

async function extractResultText(result) {
  if (typeof result === 'string') return result;
  if (typeof result?.text === 'string') return result.text;
  const response = await result?.response;
  if (typeof response?.text === 'function') return response.text();
  if (typeof response?.text === 'string') return response.text;
  return response?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join(' ').trim() || '';
}

export function sanitizeModelTextOutput(rawText) {
  if (typeof rawText !== 'string') return '';
  let text = rawText
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .replace(/\[ENVIAR[_ ]?IMAGEN:[^\]]+\]/gi, '')
    .replace(/\[AGENDAR_CITA:\{[\s\S]*?\}\]/gi, '')
    .trim();
  if (text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text);
      text = typeof parsed.response === 'string' ? parsed.response
        : typeof parsed.text === 'string' ? parsed.text : text;
    } catch {
      text = text.replace(/^\s*\{\s*"(?:response|texto|text|message)"\s*:\s*"([\s\S]*)"\s*\}\s*$/i, '$1');
    }
  }
  return text.replace(/[*_]/g, '').replace(/\s+/g, ' ').trim();
}

function limaNow() {
  return new Intl.DateTimeFormat('es-PE', {
    timeZone: LIMA_TIME_ZONE, weekday: 'long', year: 'numeric', month: 'long',
    day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true,
  }).format(clockNow());
}

export function buildSystemPromptWithContext(jid, session = null, clinicOverride = null) {
  const profile = clinicOverride || clinic;
  const address = profile.address || clinic.address;
  const hours = profile.workingHoursText || clinic.workingHoursText;
  const snapshot = session?.leadSnapshot;
  const patientName = snapshot?.nombre || extractLeadDataFromText(textFromHistory(session?.history))?.nombre;
  const booked = session?.booked ? '\nEsta sesión ya tiene una cita registrada. No vuelvas a pedir sus datos salvo que solicite cambios.' : '';
  const slots = !session?.booked && session?.offeredSlots?.length
    ? `\nHORARIOS LIBRES QUE EL SISTEMA LE MOSTRARÁ DEBAJO DE TU MENSAJE (no los escribas tú): ${session.offeredSlots.map((s, i) => `${i + 1}) ${s.label}`).join('; ')}. Invítalo a responder 1, 2 o 3 y pide solo el nombre o tratamiento que falten.`
    : '';
  const clinicName = profile.name || clinic.name;
  // Modo nocturno: el sistema ya le avisó que la clínica está cerrada; Gemini no debe prometer atención inmediata.
  const closed = session?.afterHours
    ? '\nESTADO: la clínica está CERRADA en este momento. Tú sí respondes y dejas la solicitud de cita lista; recepción la confirma cuando abra. No repitas que está cerrada (el sistema ya lo dijo) ni prometas llamadas o atención inmediata de una persona.'
    : '';
  const welcomed = session?.welcomed
    ? '\nYa se le envió la bienvenida con la campaña: no saludes ni te presentes; responde directo a su consulta.'
    : '';
  // Regla de la clínica que aplica a este mensaje (la respuesta debe seguirla, sin diagnosticar).
  const recommendation = session?.recommendation
    ? `\nRECOMENDACIÓN PARA ESTE MENSAJE (úsala con estas palabras o muy parecidas): "${recommendationSentence(session.recommendation)}"${session.recommendation.rule.question ? ` Si aún no lo sabes, pregunta: ${session.recommendation.rule.question}` : ''}`
    : '';
  const notes = botNotesBlock(session?.botNotes);
  return `${buildSystemPrompt(clinic)}\n\nDATOS ACTUALIZADOS:\n- Clínica: ${clinicName}\n- Dirección: ${address}\n- Horario: ${hours}\n- Fecha y hora actual: ${limaNow()}\n- Número de WhatsApp del usuario: ${sessionId(jid)}\n  ${patientName ? `- Nombre del paciente ya proporcionado: ${patientName}` : ''}${snapshot ? `- Datos ya proporcionados: ${JSON.stringify(snapshot)}` : ''}${booked}${slots}${closed}${welcomed}${recommendation}${notes}`;
}

export function parseTextToLimaDate(text) {
  if (typeof text !== 'string') return null;
  const now = clockNow();
  const base = new Date(Date.UTC(Number(new Intl.DateTimeFormat('en', { timeZone: LIMA_TIME_ZONE, year: 'numeric' }).format(now)), Number(new Intl.DateTimeFormat('en', { timeZone: LIMA_TIME_ZONE, month: 'numeric' }).format(now)) - 1, Number(new Intl.DateTimeFormat('en', { timeZone: LIMA_TIME_ZONE, day: 'numeric' }).format(now))));
  const value = text.toLowerCase();
  if (value.includes('pasado mañana')) base.setUTCDate(base.getUTCDate() + 2);
  else if (value.includes('mañana')) base.setUTCDate(base.getUTCDate() + 1);
  else if (!value.includes('hoy')) {
    const weekday = Object.entries(WEEKDAYS).find(([name]) => value.includes(name));
    if (weekday) while (base.getUTCDay() !== weekday[1]) base.setUTCDate(base.getUTCDate() + 1);
    const date = value.match(/(\d{1,2})\s*(?:de\s*)?(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)/);
    if (date) base.setUTCDate(1), base.setUTCMonth(MONTHS[date[2]] - 1), base.setUTCDate(Number(date[1]));
  }
  const time = value.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i)
    || value.match(/\ba\s*las?\s+(\d{1,2})(?::(\d{2}))?\b/i);
  if (!time) return null;
  let hour = Number(time[1]);
  if (time[3]?.toLowerCase() === 'pm' && hour < 12) hour += 12;
  if (time[3]?.toLowerCase() === 'am' && hour === 12) hour = 0;
  // Hora local de la clínica → instante UTC (sirve para cualquier zona horaria, no solo Lima).
  const localDate = base.toISOString().slice(0, 10);
  const localTime = `${String(hour).padStart(2, '0')}:${String(Number(time[2] || 0)).padStart(2, '0')}`;
  return toInstant(localDate, localTime, LIMA_TIME_ZONE).toISOString().replace('.000Z', '+00:00');
}

export function parseTextToLimaISO(text) {
  return parseTextToLimaDate(text)?.replace('.000Z', '+00:00') || null;
}

export function formatLimaFechaHoraText(iso) {
  if (!iso || Number.isNaN(new Date(iso).getTime())) return null;
  const date = new Intl.DateTimeFormat('es-PE', { timeZone: LIMA_TIME_ZONE, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(iso));
  const time = new Intl.DateTimeFormat('es-PE', { timeZone: LIMA_TIME_ZONE, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso));
  return `${date}, ${time.replace(/\s*a\.?\s*m\.?/i, ' AM').replace(/\s*p\.?\s*m\.?/i, ' PM')}`;
}

function buildRequest(client, message, session, jid, options) {
  const systemPrompt = buildSystemPromptWithContext(jid, session, options.clinic);
  const historyEntries = compactHistoryForPrompt(mergeRecentUserMessages(session.history));
  const history = historyEntries
    .map((entry) => `${entry.role === 'model' ? 'Asistente' : 'Paciente'}: ${entry.text}`)
    .join('\n');
  const messageParts = Array.isArray(options.messageParts) && options.messageParts.length
    ? options.messageParts
    : [{ type: 'text', content: String(message || '') }];
  const currentMessageText = messageParts
    .filter((part) => part.type === 'text')
    .map((part) => part.content)
    .join('\n');
  const prompt = `${systemPrompt}

${history}
Cliente: ${currentMessageText}`;
  if (typeof client?.generateContent === 'function') {
    const parts = [];
    let previousInputType = null;
    for (const part of messageParts) {
      if (part.type === 'image') {
        parts.push({ inlineData: { mimeType: part.mimeType, data: part.base64Data } });
        if (part.caption) parts.push({ text: part.caption });
        previousInputType = 'image';
      } else {
        const previous = parts[parts.length - 1];
        if (previous?.text && previousInputType === 'text') {
          previous.text += `\n${part.content}`;
        } else {
          parts.push({ text: part.content });
        }
        previousInputType = 'text';
      }
    }
    return {
      structured: true,
      request: {
        contents: [
          ...historyEntries.slice(0, -1).map((entry) => ({ role: entry.role === 'assistant' ? 'model' : entry.role, parts: [{ text: entry.text }] })),
          { role: 'user', parts: [{ text: currentMessageText }, ...parts] },
        ],
        systemInstruction: systemPrompt,
        generationConfig: { maxOutputTokens: options.maxOutputTokens || MAX_OUTPUT_TOKENS },
      },
    };
  }
  return { structured: false, prompt };
}

// Gemini saturado (503/UNAVAILABLE/overloaded), error interno o sin respuesta a tiempo: vale un reintento corto.
// Una clave inválida o la cuota agotada (4xx) no mejoran reintentando: se pasa directo al respaldo.
export function isRetriableGeminiError(error) {
  const text = `${error?.status || ''} ${error?.code || ''} ${error?.message || error || ''}`;
  if (/\b4\d{2}\b|API_KEY|PERMISSION_DENIED|RESOURCE_EXHAUSTED|quota/i.test(text) && !/\b5\d{2}\b/.test(text)) return false;
  return /timeout|timed out|network|fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|UNAVAILABLE|overloaded|INTERNAL|\b5\d{2}\b/i.test(text);
}

const GEMINI_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS || 12000);
const GEMINI_BACKOFF_MS = [600, 1500];

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(`Gemini timeout: sin respuesta en ${ms} ms`), { code: 'ETIMEDOUT' })), ms);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Reintento corto con backoff (600 ms, 1,5 s) y un tope de tiempo por intento. Si igual falla, lanza:
// el webhook responde con su respaldo (horarios o aviso) y alerta a recepción. Nunca deja al paciente sin respuesta.
export async function callGemini(client, request, options = {}) {
  const attempts = Math.max(1, Number(options.maxRetries ?? 1) + 1);
  const timeoutMs = Number(options.timeoutMs || GEMINI_TIMEOUT_MS);
  const backoff = options.backoffMs || GEMINI_BACKOFF_MS;
  const model = config.gemini.model || process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      if (request.structured) return await withTimeout(client.generateContent(request.request, { model }), timeoutMs);
      if (typeof client?.generate === 'function') {
        return await withTimeout(client.generate(request.prompt, { model, maxOutputTokens: options.maxOutputTokens || MAX_OUTPUT_TOKENS }), timeoutMs);
      }
      throw new Error('Gemini client does not support generate or generateContent');
    } catch (error) {
      lastError = error;
      const retriable = isRetriableGeminiError(error);
      console.error(`[Gemini] Intento ${attempt + 1}/${attempts} falló${retriable ? ' (se reintenta)' : ''}:`, error?.message || error);
      if (attempt + 1 >= attempts || !retriable) break;
      await new Promise((resolve) => setTimeout(resolve, backoff[Math.min(attempt, backoff.length - 1)]));
    }
  }
  throw lastError;
}

// "2" o "2, me llamo Ana" (número al inicio) · "…, la 2" / "opción 3" (en cualquier parte).
// Excluye fechas y horas: "el 2 de octubre", "a las 2 pm", "la 1:30".
const NOT_DATE_OR_TIME = String.raw`(?!\d)(?!\s*(?:de\b|:|a\.?\s*m|p\.?\s*m|am\b|pm\b|hrs?\b|horas?\b))`;
const SLOT_CHOICE_START = new RegExp(String.raw`^\s*(?:opci[oó]n\s*)?([1-3])${NOT_DATE_OR_TIME}(?:\s*[).,!-]|\s|$)`, 'i');
const SLOT_CHOICE_INLINE = new RegExp(String.raw`\b(?:la|el|opci[oó]n|n[uú]mero|horario)\s+(?:n[uú]mero\s+)?([1-3])${NOT_DATE_OR_TIME}`, 'i');
const SLOT_CHOICE_ORDINAL = /\b(primer[ao]?|segund[ao]|tercer[ao]?)\b/i;
const ORDINALS = { primer: 1, primera: 1, primero: 1, segunda: 2, segundo: 2, tercer: 3, tercera: 3, tercero: 3 };

// Devuelve el horario ofrecido que eligió el paciente ("1", "la 2", "opción 3", "la primera"), o null.
export function pickOfferedSlot(message, offeredSlots) {
  if (!Array.isArray(offeredSlots) || !offeredSlots.length) return null;
  const text = String(message || '').trim();
  const numeric = text.match(SLOT_CHOICE_START) || text.match(SLOT_CHOICE_INLINE);
  if (numeric) return offeredSlots[Number(numeric[1]) - 1] || null;
  const ordinal = text.match(SLOT_CHOICE_ORDINAL);
  if (ordinal) return offeredSlots[(ORDINALS[ordinal[1].toLowerCase()] || 0) - 1] || null;
  return null;
}

function collectLead(session, message, senderPhone = null) {
  const current = extractLeadDataFromText(textFromHistory(session.history), senderPhone);
  const incoming = extractLeadDataFromText(message, senderPhone);
  const chosen = pickOfferedSlot(message, session.offeredSlots);
  if (chosen) session.chosenSlot = chosen;
  const treatment = findTreatment(message) || findTreatment(textFromHistory(session.history));
  const lead = {
    nombre: incoming?.nombre || current?.nombre || session.leadSnapshot?.nombre || null,
    telefono: incoming?.telefono || current?.telefono || session.leadSnapshot?.telefono || null,
    motivo: incoming?.motivo || current?.motivo || session.leadSnapshot?.motivo || treatment?.name || null,
    fechaHora: incoming?.fechaHora || current?.fechaHora || session.leadSnapshot?.fecha_hora_texto || null,
  };
  if (session.chosenSlot) {
    // Un horario elegido de la lista ofrecida manda sobre fechas escritas a mano.
    const { date, time, label } = session.chosenSlot;
    lead.slot = { date, time };
    lead.fechaHoraISO = toInstant(date, time, clinic.timezone).toISOString().replace('.000Z', '+00:00');
    lead.fechaHora = label;
  } else if (lead.fechaHora) {
    lead.fechaHoraISO = parseTextToLimaISO(lead.fechaHora);
    if (lead.fechaHoraISO) {
      lead.fechaHora = formatLimaFechaHoraText(lead.fechaHoraISO);
      const local = localParts(clinic.timezone, new Date(lead.fechaHoraISO));
      lead.slot = { date: local.date, time: toHHMM(local.minutes) };
    }
  }
  lead.ready_to_notify = Boolean(isValidName(lead.nombre) && /^9\d{8}$/.test(lead.telefono || '') && lead.motivo && lead.fechaHoraISO);
  // Fase B exige día Y hora concretos: con "mañana en la tarde" se ofrecen horarios en vez de confirmar.
  lead.ready_for_confirmation = Boolean(isValidName(lead.nombre) && lead.motivo && lead.slot);
  return Object.values(lead).some(Boolean) ? lead : null;
}

export async function obtenerRespuestaIA(jid, mensaje, options = {}) {
  const session = getOrCreateSession(jid);
  await ensureSessionLoaded(session);
  const sid = sessionId(jid);
  const now = Date.now();
  if (!options.skipDebounce && now - session.lastUserMessageAt < DEBOUNCE_MS) {
    return { texto: null, leadData: null, skipResponse: true };
  }
  session.lastUserMessageAt = now;
  session.afterHours = Boolean(options.afterHours);
  session.welcomed = Boolean(options.welcomed);
  session.recommendation = options.recommendation || null;
  session.botNotes = options.botNotes || null;
  if (Array.isArray(options.availableSlots) && options.availableSlots.length && !session.booked) {
    session.offeredSlots = options.availableSlots;
  }
  const messageParts = Array.isArray(options.messageParts) && options.messageParts.length
    ? options.messageParts
    : [{ type: 'text', content: String(mensaje || '') }];
  const messageText = messageParts.filter((part) => part.type === 'text').map((part) => part.content).join('\n');
  session.history.push({ role: 'user', parts: [{ text: messageText }], at: now });
  session.history = compactHistoryForPrompt(session.history, MAX_HISTORY_MESSAGES);
  try {
    const result = await callGemini(options.client, buildRequest(options.client, messageText, session, jid, { ...options, messageParts }), options);
    const responseText = await extractResultText(result);
    if (typeof responseText !== 'string' || !responseText.trim()) {
      throw new Error('Gemini returned an empty response');
    }
    const rawText = responseText.trim();
    const leadData = collectLead(session, messageText, sid);
    let texto = removeForbiddenPhrases(sanitizeModelTextOutput(rawText));
    let appointmentRequest = null;
    if (leadData?.ready_for_confirmation && !session.booked) {
      const treatmentName = findTreatment(leadData.motivo)?.name || leadData.motivo;
      texto = `¡Listo, ${leadData.nombre}! Tu solicitud de cita para ${treatmentName} el ${formatDateEs(leadData.slot.date)} a las ${formatTimeEs(leadData.slot.time)} quedó registrada en ${clinic.address}. Recepción te la confirmará.`;
      // El controlador guarda la cita (appointmentService) y avisa a recepción.
      appointmentRequest = {
        nombre: leadData.nombre,
        tratamiento: treatmentName,
        fecha: leadData.slot.date,
        hora: leadData.slot.time,
      };
      session.booked = true;
      session.offeredSlots = null;
      session.leadSnapshot = {
        ...leadData,
        fecha_hora_texto: leadData.fechaHora,
        fecha_hora_iso: leadData.fechaHoraISO || null,
        confirmedAt: new Date().toISOString(),
      };
    } else if (!leadData?.ready_for_confirmation && !session.booked && /\b(?:tu cita|qued[oó]\s+agendada|ya est[aá]\s+agendada)\b/i.test(texto)) {
      texto = '¡Con mucho gusto coordinamos tu cita! Por favor confírmanos:\n📌 Nombre completo:\n📌 Tratamiento de interés:\n📌 Día y turno de preferencia (Mañana o Tarde):';
    }
    session.history.push({ role: 'model', parts: [{ text: rawText || '' }] });
    session.history = compactHistoryForPrompt(session.history, MAX_HISTORY_MESSAGES);
    failureCounts.delete(sid);


    if (leadData?.ready_to_notify && !options.skipLeadPersistence) {
      session.booked = true;
      session.leadSnapshot = { ...leadData, fecha_hora_texto: leadData.fechaHora, fecha_hora_iso: leadData.fechaHoraISO, confirmedAt: new Date().toISOString() };
      try {
        const { saveLeadSnapshot } = await import('./leadService.js');
        await saveLeadSnapshot(sid, session.leadSnapshot);
      } catch (error) {
        console.warn('geminiService: lead snapshot persistence failed:', error?.message || error);
      }
      scheduleCleanup(sid, session);
    }

    // rawTexto conserva las etiquetas [ENVIAR_FOTO: x] que sanitizeModelTextOutput elimina o deforma.
    return {
      texto, rawTexto: rawText, leadData, appointmentRequest, skipLeadPersistence: Boolean(options.skipLeadPersistence),
    };
  } catch (error) {
    const failures = (failureCounts.get(sid) || 0) + 1;
    failureCounts.set(sid, failures);
    console.error('[Gemini Error Detallado]:', error);
    return {
      texto: null,
      leadData: null,
      skipResponse: true,
    };
  }
}

export default {
  obtenerRespuestaIA,
  sanitizeModelTextOutput,
  isExplicitConfirmation,
  resetSession,
  getOrCreateSession,
  extractLeadDataFromText,
  isValidName,
  setOfferedSlots,
  getOfferedSlots,
  releaseBooking,
  isSessionBooked,
  pickOfferedSlot,
};