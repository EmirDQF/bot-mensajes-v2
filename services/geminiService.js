import config from '../config/env.js';
import { CATALOGO_LUMINZU } from '../config/catalogo.js';

const LIMA_TIME_ZONE = 'America/Lima';
const SESSION_TTL_MS = Number(process.env.GEMINI_SESSION_TTL_MS || 30 * 60 * 1000);
const BOOKED_TTL_MS = Number(process.env.GEMINI_BOOKED_SESSION_TTL_MS || 7 * 24 * 60 * 60 * 1000);
const DEBOUNCE_MS = Number(process.env.GEMINI_DEBOUNCE_MS || 0);
const MAX_HISTORY_MESSAGES = Number(process.env.GEMINI_MAX_HISTORY || 8);
const CLEANUP_MS = Number(process.env.GEMINI_CLEANUP_MS || 60 * 1000);
const CONTINGENCY_MESSAGE = process.env.GEMINI_CONTINGENCY_MESSAGE
  || 'Estoy teniendo una demora técnica. ¿Me indicas tu nombre y el tratamiento que deseas agendar?';

export const SYSTEM_PROMPT = `Eres el Asistente Virtual Oficial de LUMINZU Clínica Dental.
Tu misión es resolver dudas clínicas de forma breve y amable, y guiar siempre al paciente hacia su evaluación presencial.

🎯 REGLAS DE IDENTIDAD Y ESTILO:
- Identidad: Únicamente "el asistente virtual de LUMINZU Clínica Dental". Prohibido usar nombres humanos (Valeria, Frank, María).
- Tono: Cercano, empático y profesional. Usa frases cortas (máximo 2-3 oraciones) y 1-2 emojis por mensaje (🦷, 😊, 📅, ✨, 📍).
- Precios de Ortodoncia/Brackets: Indicar cuota inicial desde S/ 600 financiada en cómodas cuotas previa evaluación (prohibido decir "en 3 partes").
- Otros tratamientos: Indicar que el presupuesto exacto se define en la evaluación clínica.
- Cierre: Termina SIEMPRE con UNA sola pregunta para pedir nombre, distrito o agendar fecha/turno (mañana o tarde).

📸 REGLA CRÍTICA DE IMÁGENES:
Si el usuario pide fotos, imágenes, referencias, ver cómo quedan los tratamientos o pregunta por un tratamiento en específico, debes OBLIGATORIAMENTE terminar tu mensaje con la etiqueta exacta:
[ENVIAR_IMAGEN:categoría]

Categorías válidas para la etiqueta:
- ortodoncia (brackets, ortodoncia, aparatos, invisalign)
- restauracion (curaciones, resinas)
- carillas (carillas, diseño de sonrisa)
- blanqueamiento
- implantes
- endodoncia
- limpieza (limpieza, kit preventivo)
- odontopediatria (niños, odontopediatría)
- protesis
- fachada (instalaciones)
- ubicacion (dirección, mapa)

Ejemplo: Si el paciente pregunta "¿tienen fotos de brackets?", tu respuesta debe terminar con:
[ENVIAR_IMAGEN:ortodoncia]

Nunca incluyas la etiqueta en medio del texto, solo al final.`;

// ... (resto de constantes y funciones auxiliares sin cambios) ...

/**
 * Extrae la etiqueta [ENVIAR_IMAGEN:categoría] del texto y la elimina.
 * @param {string} texto - Texto completo de la respuesta de la IA.
 * @returns {{texto: string, categoria: string|null}} Texto limpio y categoría extraída (si existe).
 */
function extraerEtiquetaImagen(texto) {
  const regex = /\[ENVIAR_IMAGEN:([a-zA-Z_]+)\]/i;
  const match = texto.match(regex);
  if (match) {
    const categoria = match[1].toLowerCase();
    const textoLimpio = texto.replace(regex, '').trim();
    return { texto: textoLimpio, categoria };
  }
  return { texto, categoria: null };
}

/**
 * Busca la URL de la imagen en el catálogo según la categoría.
 * @param {string} categoria - Categoría (posiblemente con variaciones).
 * @returns {string} URL de la imagen.
 */
export function buscarImagenEnCatalogo(categoria) {
  if (!categoria) return CATALOGO_LUMINZU.default;
  // Búsqueda exacta
  if (CATALOGO_LUMINZU[categoria]) {
    return CATALOGO_LUMINZU[categoria];
  }
  // Búsqueda por coincidencia parcial (normalizando)
  const keys = Object.keys(CATALOGO_LUMINZU);
  const categoriaLower = categoria.toLowerCase();
  for (const key of keys) {
    const keyLower = key.toLowerCase();
    if (categoriaLower.includes(keyLower) || keyLower.includes(categoriaLower)) {
      return CATALOGO_LUMINZU[key];
    }
  }
  // Fallback
  return CATALOGO_LUMINZU.default;
}

/**
 * Determina la categoría de imagen según el mensaje y la respuesta de la IA.
 * (Función original, ligeramente mejorada)
 */
export function determinarCategoriaImagen(mensaje, respuestaIA) {
  const texto = (mensaje + ' ' + respuestaIA).toLowerCase();

  const mapeo = {
    'brackets': 'brackets',
    'ortodoncia': 'ortodoncia',
    'aparato': 'aparato',
    'invisalign': 'invisalign',
    'limpieza': 'limpieza',
    'chequeo': 'chequeo',
    'blanqueamiento': 'blanqueamiento',
    'carillas': 'carillas',
    'implante': 'implante',
    'implantes': 'implantes',
    'endodoncia': 'endodoncia',
    'odontopediatria': 'odontopediatria',
    'niños': 'odontopediatria',
    'protesis': 'protesis',
    'restauracion': 'restauracion',
    'resina': 'resina',
    'tratamientos': 'tratamientos',
    'preventivo': 'preventivo',
    'kit': 'kit',
    'ubicacion': 'ubicacion',
    'direccion': 'ubicacion'
  };

  for (const [key, categoria] of Object.entries(mapeo)) {
    if (texto.includes(key)) {
      return categoria;
    }
  }
  return 'default';
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
  session.history.push({ role: 'user', parts: [{ text: String(mensaje || '') }], at: now });
  session.history = compactHistoryForPrompt(session.history, MAX_HISTORY_MESSAGES);
  try {
    const result = await callGemini(options.client, buildRequest(options.client, mensaje, session, jid, options), options);
    const rawText = extractResultText(result);
    const leadData = collectLead(session, mensaje, sid);

    // 1. Limpiar el texto básico (quitar markdown, JSON, etc.)
    let texto = sanitizeModelTextOutput(rawText);

    // 2. Extraer etiqueta de imagen si existe y eliminarla del texto visible
    const { texto: textoSinEtiqueta, categoria: categoriaEtiqueta } = extraerEtiquetaImagen(texto);
    texto = textoSinEtiqueta;

    // 3. Determinar categoría final: prioridad a la etiqueta, si no, usar palabras clave
    const categoriaFinal = categoriaEtiqueta || determinarCategoriaImagen(mensaje, texto);
    const imagenURL = buscarImagenEnCatalogo(categoriaFinal);

    // 4. Verificar si hay mención de cita agendada y ajustar mensaje si falta información
    if (!leadData?.ready_to_notify && !session.booked && /\b(?:tu cita|qued[oó]\s+agendada|ya est[aá]\s+agendada)\b/i.test(texto)) {
      texto = 'Para ayudarte a agendar, indícame tu nombre, teléfono, tratamiento y fecha o turno preferido. 😊📅';
    }

    // 5. Guardar en historial
    session.history.push({ role: 'model', parts: [{ text: rawText || '' }] });
    session.history = compactHistoryForPrompt(session.history, MAX_HISTORY_MESSAGES);
    failureCounts.delete(sid);

    // 6. Persistir lead si está completo
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

    return { texto, leadData, imagenURL, skipLeadPersistence: Boolean(options.skipLeadPersistence) };
  } catch (error) {
    const failures = (failureCounts.get(sid) || 0) + 1;
    failureCounts.set(sid, failures);
    return {
      texto: failures === 1 ? 'No pude procesar tu mensaje. ¿Me lo repites para ayudarte a agendar? 🦷' : CONTINGENCY_MESSAGE,
      leadData: null,
      imagenURL: CATALOGO_LUMINZU.default,
    };
  }
}

setInterval(() => {
  const now = Date.now();
  for (const [sid, session] of chatSessions) {
    if (now - session.lastUserMessageAt > (session.booked ? BOOKED_TTL_MS : SESSION_TTL_MS)) {
      chatSessions.delete(sid);
      failureCounts.delete(sid);
    }
  }
}, CLEANUP_MS).unref?.();

export default {
  obtenerRespuestaIA,
  sanitizeModelTextOutput,
  isExplicitConfirmation,
  pauseSessionById,
  resumeSessionById,
  isSessionPaused,
  resetSession,
  getOrCreateSession,
  extractLeadDataFromText,
  isValidName,
  determinarCategoriaImagen,
  buscarImagenEnCatalogo,
};