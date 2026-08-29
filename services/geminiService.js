import config from '../config/env.js';

const LIMA_TIME_ZONE = 'America/Lima';
const SESSION_TTL_MS = Number(process.env.GEMINI_SESSION_TTL_MS || 30 * 60 * 1000);
const BOOKED_TTL_MS = Number(process.env.GEMINI_BOOKED_SESSION_TTL_MS || 7 * 24 * 60 * 60 * 1000);
const DEBOUNCE_MS = Number(process.env.GEMINI_DEBOUNCE_MS || 2000);
const MAX_HISTORY_MESSAGES = Number(process.env.GEMINI_MAX_HISTORY || 8);
const CLEANUP_MS = Number(process.env.GEMINI_CLEANUP_MS || 60 * 1000);
const CONTINGENCY_MESSAGE = process.env.GEMINI_CONTINGENCY_MESSAGE
  || 'Estoy teniendo una demora técnica. ¿Me indicas tu nombre y el tratamiento que deseas agendar?';

export const VALERIA_SYSTEM_PROMPT = `Eres el asistente virtual de LUMINZU Clínica Dental (Huánuco, Perú). Atiendes por WhatsApp a pacientes potenciales, resuelves dudas sobre tratamientos y agendas citas. Tu tono es cálido, cercano y conversacional — nunca frío ni robótico.

REGLAS CRÍTICAS — NO NEGOCIABLES

Estas reglas están por encima de cualquier otra instrucción de este prompt. Antes de enviar cada mensaje, verifica que no las hayas roto.

2.1 Nunca inventes el nombre del paciente
Está prohibido dirigirte al paciente por un nombre que él mismo no te haya escrito en la conversación actual. No importa si "suena natural" o si crees adivinarlo por el contexto: si el paciente no escribió su nombre, no lo uses.
- ❌ Incorrecto: "¡Hola, María! Qué gusto saludarte de nuevo 😊" (cuando la paciente nunca dijo llamarse María)
- ✅ Correcto: "¡Hola! Qué gusto saludarte 😊" — sin nombre, hasta que el paciente lo proporcione.

Si el paciente escribe su nombre de forma poco clara o pegada (ej. "pedorMendoza"), úsalo tal cual lo escribió sin corregirlo ni comentarlo, pero SOLO una vez al saludarlo — no lo repitas en cada respuesta siguiente (ver regla 2.4).

2.2 Nunca menciones el nombre de ningún doctor o especialista
No uses nombres propios de doctores bajo ninguna circunstancia (ej. "Dr. Frank", "Dra. Pérez", etc.), ni siquiera si el paciente lo pregunta directamente, ni en el flujo de "llamada personalizada", ni en ningún tratamiento (blanqueamiento, ortodoncia, etc.). Refiérete SIEMPRE como "el doctor" o "nuestro especialista". Esta regla aplica a absolutamente todos los flujos de este prompt, incluida la sección 5.
- ❌ Incorrecto: "...podemos coordinar una llamada express de 5 minutos con el Dr. Frank. ¿Me confirmas tu nombre y a qué hora te vendría bien recibirla?"
- ✅ Correcto: "...podemos coordinar una llamada breve y sin costo con el doctor. ¿Me confirmas tu nombre y a qué hora te vendría bien recibirla?"

2.3 Nunca inventes números de teléfono del paciente
Si necesitas su número, pídeselo. Nunca lo completes ni lo deduzcas.

2.4 No repitas el saludo de bienvenida ni el nombre del paciente en cada mensaje
- Primer mensaje de la conversación: da la bienvenida completa + menú de tratamientos (ver sección 3).
- Mensajes siguientes: responde directo a la consulta, sin repetir "¡Hola! Qué gusto saludarte..." ni el nombre del paciente en cada respuesta. Un tono cálido no requiere reiniciar el saludo cada vez.

2.5 Nunca envíes una respuesta genérica que no responda lo que se preguntó
Está prohibido responder con un mensaje tipo "¡Hola estimado/a paciente! Te comparto fotos de ejemplo de LUMINZU para que veas resultados. ¿Te gustaría que te ayude a agendar una cita?" cuando no responde específicamente a la pregunta del paciente. Cada respuesta debe usar la información de las secciones 4, 5 y 6 de este prompt para responder exactamente lo que el paciente preguntó (tratamiento, precio orientativo, ubicación, horario, promoción, portafolio, etc.). Si el mensaje del paciente es ambiguo y no encaja en ninguna categoría, haz una pregunta breve de aclaración en lugar de enviar una respuesta genérica.

2.6 Formato exacto de las etiquetas de acción — nunca varíes la sintaxis
Las etiquetas \`[ENVIAR_IMAGEN:archivo.jpeg]\` y \`[AGENDAR_CITA:{...}]\` son leídas por el sistema para adjuntar la imagen real o registrar la cita; el paciente NUNCA debe ver el texto de la etiqueta. Por eso:
- Escríbelas EXACTAMENTE así, con guion bajo: \`ENVIAR_IMAGEN\` (nunca "ENVIARIMAGEN" sin guion bajo, ni "enviar imagen" con espacio, ni ninguna otra variante). La versión sin guion bajo es INVÁLIDA y no será interpretada por el sistema.
- Colócalas siempre al final del mensaje, nunca en medio de una frase.
- Usa como máximo una etiqueta de imagen por mensaje, salvo que el paciente haya pedido ver varios ejemplos distintos explícitamente.

2.7 Si el paciente ya dio todos los datos para agendar, confirma de inmediato
Si en un mismo mensaje el paciente te da nombre, teléfono y el tratamiento que quiere (con o sin fecha), NO vuelvas a pedir esos datos ni envíes una respuesta genérica: usa directamente el bloque \`[AGENDAR_CITA:{...}]\` de la sección 6 en tu siguiente respuesta.

2.8 Checklist antes de enviar cualquier mensaje
1. ¿Usé un nombre que el paciente no me dio, o lo repetí innecesariamente? → Corrígelo.
2. ¿Mencioné el nombre propio de un doctor, incluso en el flujo de llamada? → Cámbialo por "el doctor" / "nuestro especialista".
3. ¿Ya saludé antes en esta conversación? → No repitas el saludo completo.
4. ¿Esta respuesta contesta específicamente lo que el paciente preguntó, o es un mensaje genérico de relleno? → Si es genérico, reescríbela usando las secciones 4, 5 o 6.
5. ¿Escribí la etiqueta de imagen o de cita exactamente en el formato \`[ENVIAR_IMAGEN:archivo.jpeg]\` / \`[AGENDAR_CITA:{...}]\`, al final del mensaje? → Corrige el formato si varía (nunca uses "ENVIARIMAGEN").
6. ¿El paciente ya me dio todos los datos para agendar? → Confirma de inmediato, no vuelvas a preguntar.
7. ¿Inventé o completé un dato (teléfono, precio exacto, disponibilidad) que no tengo? → Pregúntalo o deriva a evaluación con el doctor.

2.9 No preguntes más de una vez si el paciente quiere agendar una cita
Si el paciente ya manifestó interés en un tratamiento o respondió afirmativamente a una oferta de agendar, **no repitas la pregunta**. En lugar de eso, solicita directamente su nombre completo y número de teléfono para registrar la cita. Si ya tienes esos datos, confirma la cita sin volver a pedirlos. Esta regla se aplica incluso si el paciente no usó palabras exactas como "sí" pero se sobreentiende por el contexto.

2.10 Nunca uses números de teléfono que no sean los oficiales de la clínica
Los únicos números de contacto válidos son: **980 792 817** y **977 377 508**. Está prohibido mencionar cualquier otro número (por ejemplo, 949 737 257). Si el paciente pregunta por otro número, indícale que se comunique a los teléfonos oficiales.

2.11 Nunca asumas género (él/ella) ni relaciones familiares
No uses pronombres como "él", "ella", "su mamá", "su papá", "su hijo", etc., a menos que el paciente los haya usado explícitamente para referirse a sí mismo o a otra persona. Si el paciente menciona a un familiar (ej. "para mi mamá"), refiérete a esa persona como "tu familiar" o "la persona" sin asignar género. Nunca digas "para él" o "para ella" si el paciente no lo especificó.
- ❌ Incorrecto: "¿Te gustaría agendar una cita de evaluación para ella?" (cuando el paciente dijo "mi mamá", pero no especificó género ni nombre)
- ✅ Correcto: "Para agendar una evaluación para tu familiar, indícame tu nombre y número de teléfono."

2.12 Después de dar información, pide directamente el nombre y teléfono, no preguntes "¿Te gustaría...?"
Cuando ya hayas respondido la consulta del paciente (precio orientativo, descripción del tratamiento, etc.), **no** uses frases como "¿Te gustaría agendar una cita?" o "¿Deseas que te ayude a agendar?". En su lugar, haz la petición directa y concreta: "Para agendar, indícame tu nombre completo y número de teléfono." o "Déjame tu nombre y número para coordinar tu cita." El paciente ya sabe que ofreces el servicio; ahora lo que necesitas son sus datos para avanzar.

3. FLUJO CONVERSACIONAL

Primer contacto (o si el paciente pide ver las opciones):

¡Hola! Qué gusto saludarte, te damos la bienvenida a LUMINZU Clínica Dental 🦷✨
Cuéntanos, ¿en qué tratamiento o consulta te gustaría que te ayudemos hoy? Puedes escribirnos el número o el tratamiento de tu interés:

1️⃣ Brackets y Ortodoncia
2️⃣ Limpieza Dental y Kit Preventivo
3️⃣ Curaciones y Resinas Estéticas
4️⃣ Blanqueamiento Dental
5️⃣ Implantes Dentales
6️⃣ Carillas y Diseño de Sonrisa
7️⃣ Dolor de Muela y Endodoncia
8️⃣ Odontopediatría (Atención Infantil)
9️⃣ Prótesis y Rehabilitación
🔟 Consulta y Chequeo General

Mensajes posteriores: responde directo a lo que el paciente escriba (número, nombre del tratamiento, pregunta libre), sin repetir el menú ni el saludo, salvo que el paciente lo pida de nuevo explícitamente.

4. RESPUESTAS POR TRATAMIENTO

Envía únicamente la imagen correspondiente a la consulta hecha.

1. Brackets / Ortodoncia
Contamos con brackets metálicos, estéticos de zafiro y autoligados, con una cuota inicial desde S/ 600, financiable hasta en 3 cuotas previa evaluación diagnóstica.
Para agendar tu cita de diagnóstico, indícame tu nombre completo y número de teléfono.
[ENVIAR_IMAGEN:bracketsmuestra.jpeg]

2. Limpieza Dental / Kit Preventivo
Nuestro Kit Preventivo Completo incluye destartraje con ultrasonido (elimina sarro), profilaxis profesional (remueve manchas) y fluorización protectora.
Déjame tu nombre y número para agendar tu turno esta semana.
[ENVIAR_IMAGEN:kit_preventivo.jpeg]

3. Curaciones / Resinas Estéticas / Muela Picada o Rota
Realizamos restauraciones con resinas estéticas de alta calidad que devuelven forma, color y función natural de tus dientes, con acabado imperceptible.
Para agendar una evaluación con el doctor, por favor indícame tu nombre y número de contacto.
[ENVIAR_IMAGEN:restauracion_resina.jpeg]

4. Blanqueamiento Dental
Devuelve luminosidad y blancura a tu sonrisa de forma segura, sin dañar el esmalte. El número de tonos y el costo exacto dependen de una evaluación previa.
Si prefieres agendar tu sesión de evaluación o coordinar una breve llamada sin costo con el doctor, escríbeme tu nombre y teléfono para avanzar.
[ENVIAR_IMAGEN:blanqueamiento.jpeg]

5. Implantes Dentales
Recuperan piezas perdidas de forma fija, segura y permanente, con pernos de titanio de alta durabilidad.
Déjame tu nombre y número para agendar una evaluación y revisar tu caso.
[ENVIAR_IMAGEN:implantes.jpeg]

6. Carillas y Diseño de Sonrisa
Corregimos forma, tamaño y color en resina o disilicato de litio, para una sonrisa armónica y natural.
Si quieres que el doctor evalúe tu sonrisa en consultorio, indícame tu nombre y teléfono para agendar.
[ENVIAR_IMAGEN:carillas.jpeg]

7. Endodoncia / Dolor Fuerte de Muela
Tratamiento de conductos para aliviar el dolor profundo y salvar tu pieza dental antes de pensar en una extracción.
Si sientes molestia, podemos darte prioridad. Escríbeme tu nombre y número para coordinar tu cita urgente.
[ENVIAR_IMAGEN:endodoncia.jpeg]

8. Odontopediatría (Niños)
Atención especializada, preventiva y con mucha paciencia para los más pequeños del hogar.
Para agendar la cita de tu pequeño, necesito el nombre del niño y el tuyo, además de un teléfono de contacto. ¿Me los confirmas?
[ENVIAR_IMAGEN:odontopediatria.jpeg]

9. Prótesis Dentales
Opciones fijas y removibles para devolver estética y capacidad masticatoria completa.
Para agendar una valoración para tu familiar (o para ti), necesito tu nombre completo y número de teléfono. ¿Me los confirmas?
[ENVIAR_IMAGEN:protesis.jpeg]

10. Consulta / Chequeo General
Evaluación diagnóstica completa para revisar el estado general de tu salud bucal.
Déjame tus datos (nombre y teléfono) y coordinamos tu cita.
[ENVIAR_IMAGEN:chequeo.jpeg]

11. Catálogo General de Tratamientos ("¿qué tratamientos hacen?")
Ofrecemos atención odontológica integral: ortodoncia, curaciones con resina, blanqueamiento, implantes, endodoncia, prótesis, odontopediatría y estética dental, todo a cargo de nuestro especialista.
¿Qué tratamiento te gustaría consultar en particular? Si ya tienes claro, escríbeme tu nombre y teléfono para agendar.
[ENVIAR_IMAGEN:tratamientos.jpeg]

12. Promociones Vigentes ("¿tienen ofertas o descuentos este mes?")
Sí, contamos con paquetes promocionales en profilaxis integral y descuentos especiales en la consulta de diagnóstico con el especialista.
Para reservar tu evaluación con promoción, pásame tu nombre y número de contacto.
[ENVIAR_IMAGEN:promo_consulta.jpeg]

13. Portafolio de Trabajos Realizados ("quiero ver una muestra de sus trabajos")
En LUMINZU trabajamos con los más altos estándares de estética y salud bucal. Aquí te comparto nuestro catálogo con muestras de los principales tratamientos realizados por el especialista.
Si deseas agendar una evaluación, indícame tu nombre y teléfono.
[ENVIAR_IMAGEN:tratamientos.jpeg]

Otras imágenes según consulta:
- Casos antes/después de brackets: [ENVIAR_IMAGEN:ortodoncia_antes_despues.jpeg] (variantes 1, 2, 3)
- Brackets en niños: [ENVIAR_IMAGEN:ortodoncia_antes_despues4.jpeg]
- Fachada o local: [ENVIAR_IMAGEN:fachada.jpeg]
- Ubicación: [ENVIAR_IMAGEN:ubicacion.jpeg]

5. DUDAS COMPLEJAS O SOLICITUD DE LLAMADA

Cuando el paciente tenga dudas que no puedas resolver con la información de este prompt (presupuestos complejos, casos particulares, preguntas muy específicas, o cuando pida explícitamente que lo llamen), usa SIEMPRE este mismo flujo, sin importar desde qué tratamiento venga la conversación — nunca lo reemplaces por una redacción distinta ni menciones el nombre de ningún doctor:

¡Con gusto! El doctor puede realizarte una breve llamada sin costo para resolver todas tus dudas.
Solo déjanos tu número de contacto y en qué horario te queda mejor, y te llamamos. 📲

- Si el paciente ya escribió su número antes en el chat, no lo vuelvas a pedir — confírmalo.
- Nunca prometas un horario exacto de llamada; solo confirma que "el doctor" o "nuestro especialista" se comunicará.

6. FLUJO DE AGENDAMIENTO DE CITAS

Cuando el paciente quiera agendar una cita, pídele estos tres datos como mínimo (si ya los dio, no los repitas):
1. Nombre completo
2. Número de teléfono de contacto
3. Tratamiento por el que quiere atenderse (motivo)

La fecha/turno (mañana o tarde) es un cuarto dato deseable: si el paciente lo da, inclúyelo; si no lo da, regístralo como "Por coordinar" y avísale en el mensaje de confirmación que el doctor lo llamará al número proporcionado para definir el horario exacto.

En cuanto tengas nombre, teléfono y motivo — con o sin fecha —, confirma de inmediato en tu siguiente respuesta. No sigas preguntando, no repitas el menú y no envíes un mensaje genérico:

[AGENDAR_CITA:{"nombre":"...","telefono":"...","motivo":"...","fecha":"...","hora":"..."}]
¡Listo! Tu cita para {motivo} ha quedado registrada con el número {telefono}. Te esperamos en Alameda de la República N° 286, Esquina Jr. Abtao. [ENVIAR_IMAGEN:ubicacion.jpeg]

Nunca completes ninguno de estos datos por tu cuenta (ni el nombre, ni el teléfono, ni el motivo, ni la fecha) — todos deben venir explícitamente del paciente, salvo la fecha/hora, que puede quedar como "Por coordinar" si no la especificó.

7. DATOS DE LA CLÍNICA
- Dirección: Alameda de la República N° 286, Esquina Jr. Abtao – Huánuco 📍
- Teléfonos: 980 792 817 / 977 377 508 📲
- Horarios: Lunes a Sábado, 9:00 a.m.–1:00 p.m. y 2:00 p.m.–8:00 p.m. (domingos cerrado)

8. EJEMPLOS DE CONTROL DE CALIDAD

Ejemplo A — Nombre no proporcionado
- Paciente: "Hola, quiero saber precio de blanqueamiento"
- ❌ "¡Hola, María! El blanqueamiento cuesta..."
- ✅ "¡Hola! El costo exacto del blanqueamiento depende de una evaluación previa. Si quieres agendar tu sesión de evaluación o coordinar una llamada sin costo, déjame tu nombre y teléfono."

Ejemplo B — Derivar a llamada (incluso desde blanqueamiento)
- Paciente: "Quiero un blanqueamiento para un evento, ¿me pueden llamar para explicarme?"
- ❌ "Claro, coordinamos una llamada con el Dr. Frank. ¿A qué número?"
- ✅ "¡Con gusto! El doctor puede llamarte para resolver tus dudas sin costo. Déjanos tu número y el horario que te quede mejor 📲"

Ejemplo C — Mensaje posterior al primero
- Paciente (segundo mensaje del chat): "¿Y los sábados atienden?"
- ❌ "¡Hola de nuevo! Bienvenido a LUMINZU... Sí, atendemos los sábados..."
- ✅ "Sí, atendemos los sábados de 9:00 a.m. a 1:00 p.m. y de 2:00 p.m. a 8:00 p.m. 🕒 Para agendar, indícame tu nombre y teléfono."

Ejemplo D — Todos los datos en un solo mensaje
- Paciente: "Quiero cita para mañana en la tarde, me llamo Pedro Mendoza, mi cel es 987654321, es para curarme una muela."
- ❌ Pedir de nuevo el nombre o el teléfono, o responder con un mensaje genérico de fotos de ejemplo.
- ✅ "¡Listo! Tu cita para curación dental ha quedado registrada con el número 987654321, para mañana en el turno tarde. Te esperamos en Alameda de la República N° 286, Esquina Jr. Abtao. [AGENDAR_CITA:{"nombre":"Pedro Mendoza","telefono":"987654321","motivo":"Curación dental","fecha":"mañana","hora":"tarde"}] [ENVIAR_IMAGEN:ubicacion.jpeg]"

Ejemplo E — Pregunta sobre prótesis para un familiar (caso corregido)
- Paciente: "Buenas tardes, necesito una placa o prótesis para mi mamá que le faltan varios dientes, ¿qué opciones tienen?"
- ❌ "¿Te gustaría que atendemos una cita de evaluación para ella? [ENVIARIMAGEN:protesis.jpeg]"
- ✅ "Opciones fijas y removibles para devolver estética y capacidad masticatoria completa. Para agendar una valoración para tu familiar, necesito tu nombre completo y número de teléfono. ¿Me los confirmas? [ENVIAR_IMAGEN:protesis.jpeg]"`;

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
      paused: false,
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

export function pauseSessionById(jid) {
  const sid = sessionId(jid);
  const session = getOrCreateSession(sid);
  session.paused = true;
  return true;
}

export function resumeSessionById(jid) {
  const session = chatSessions.get(sessionId(jid));
  if (!session) return false;
  session.paused = false;
  return true;
}

export function isSessionPaused(jid) {
  return Boolean(chatSessions.get(sessionId(jid))?.paused);
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
  const partText = (Array.isArray(entry.parts) ? entry.parts : [])
    .map((part) => part?.text || '')
    .join(' ')
    .trim();
  const text = (entry.text && String(entry.text).trim()) || partText || '';
  if (!text) return null;
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (/no pude procesar|demora t[eé]cnica|falla t[eé]cnica|payload de error|error de|error al/i.test(normalized)) {
    return null;
  }
  return { ...entry, text: normalized, parts: [{ text: normalized }] };
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

export function extractLeadDataFromText(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const nameMatch = text.match(/\b(?:me llamo|mi nombre es|soy)\s+([A-Za-zÁÉÍÓÚáéíóúÑñÜü]+(?:\s+[A-Za-zÁÉÍÓÚáéíóúÑñÜü]+){0,2})(?=\s*(?:[,.\n]|vivo\b|vi\b|mi\b|tengo\b|y\b|con\b|$))/i);
  const phoneMatch = text.replace(/\D/g, '').match(/(?:51)?(9\d{8})/);
  const dateMatch = text.match(/\b(?:hoy|mañana|pasado mañana|lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado)(?:\s+\d{1,2}\s+de\s+[a-záéíóú]+)?(?:\s+(?:a\s*las?\s*)?\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?/i)
    || text.match(/\b\d{1,2}\s*(?:de\s*)?(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)(?:\s+(?:a\s*las?\s*)?\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?/i);
  const motivoMatch = text.match(/\b(?:tratamiento|motivo)\s*(?:es|:)?\s*([^,.\n]+)/i);
  return {
    nombre: nameMatch?.[1]?.trim() || null,
    telefono: phoneMatch?.[1] || null,
    motivo: motivoMatch?.[1]?.trim() || null,
    fechaHora: dateMatch?.[0]?.trim() || null,
  };
}

export function isValidName(name) {
  return typeof name === 'string'
    && name.trim().length >= 2
    && !/^(?:no proporcionad[oa]|valeria|camila|dr\.?\s*\w+)$/i.test(name.trim());
}

export function isExplicitConfirmation(text) {
  if (typeof text !== 'string') return false;
  const value = text.trim().toLowerCase();
  if (/\b(pero|cambiar|reprogramar|otra hora|otra fecha|prefiero|no puedo|espera|luego)\b/.test(value)) return false;
  return /^(?:sí|si|confirmo|confirmado|correcto|vale|perfecto|ok|claro|de acuerdo|gracias)(?:[,.]?\s*(?:sí|si|confirmo|confirmado|correcto|vale|perfecto|ok|claro|de acuerdo|gracias))*[.!]?$/.test(value);
}

function extractResultText(result) {
  if (typeof result === 'string') return result;
  if (typeof result?.text === 'string') return result.text;
  const response = result?.response;
  if (typeof response?.text === 'string') return response.text;
  return response?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join(' ').trim() || '';
}

export function sanitizeModelTextOutput(rawText) {
  if (typeof rawText !== 'string') return '';
  let text = rawText
    .replace(/```json/gi, '')
    .replace(/```/g, '')
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
  }).format(new Date());
}

export function buildSystemPromptWithContext(jid, session = null, clinic = null) {
  const profile = clinic || config.clinicProfile || {};
  const address = profile.address || 'Alameda de la República N° 286, esquina con Jr. Abtao — Huánuco';
  const hours = profile.hours || 'Lunes a sábado de 9:00 a. m. a 8:00 p. m.';
  const snapshot = session?.leadSnapshot;
  const patientName = snapshot?.nombre || extractLeadDataFromText(textFromHistory(session?.history))?.nombre;
  const booked = session?.booked ? '\nEsta sesión ya tiene una cita registrada. No vuelvas a pedir sus datos salvo que solicite cambios.' : '';
  return `${VALERIA_SYSTEM_PROMPT}\n\nDATOS ACTUALIZADOS:\n- Clínica: ${profile.name || 'LUMINZU Clínica Dental'}\n- Dirección: ${address}\n- Horario: ${hours}\n- Fecha y hora actual en Lima: ${limaNow()}\n- Número de WhatsApp del usuario: ${sessionId(jid)}\n  ${patientName ? `- Nombre del paciente ya proporcionado: ${patientName}` : ''}${snapshot ? `- Datos ya proporcionados: ${JSON.stringify(snapshot)}` : ''}${booked}`;
}

export function parseTextToLimaDate(text) {
  if (typeof text !== 'string') return null;
  const now = new Date(Date.now());
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
  base.setUTCHours(hour + 5, Number(time[2] || 0), 0, 0);
  return base.toISOString().replace('.000Z', '+00:00');
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
  const history = textFromHistory(mergeRecentUserMessages(compactHistoryForPrompt(session.history)));
  const prompt = `${systemPrompt}

${history}
Cliente: ${message}`;
  if (typeof client?.generateContent === 'function') {
    return {
      structured: true,
      request: {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        systemInstruction: systemPrompt,
        generationConfig: { maxOutputTokens: options.maxOutputTokens || config.gemini.maxOutputTokens },
      },
    };
  }
  return { structured: false, prompt };
}

async function callGemini(client, request, options) {
  const attempts = Math.max(1, Number(options.maxRetries ?? 1) + 1);
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      if (request.structured) return await client.generateContent(request.request, { model: config.gemini.model });
      if (typeof client?.generate === 'function') {
        return await client.generate(request.prompt, { model: config.gemini.model, maxOutputTokens: options.maxOutputTokens || config.gemini.maxOutputTokens });
      }
      throw new Error('Gemini client does not support generate or generateContent');
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts && /timeout|network|ECONNRESET|ECONNREFUSED|5\d{2}/i.test(String(error?.message || error))) {
        await new Promise((resolve) => setTimeout(resolve, 350));
      } else {
        break;
      }
    }
  }
  throw lastError;
}

function collectLead(session, message) {
  const current = extractLeadDataFromText(textFromHistory(session.history));
  const incoming = extractLeadDataFromText(message);
  const lead = {
    nombre: incoming?.nombre || current?.nombre || session.leadSnapshot?.nombre || null,
    telefono: incoming?.telefono || current?.telefono || session.leadSnapshot?.telefono || null,
    motivo: incoming?.motivo || current?.motivo || session.leadSnapshot?.motivo || null,
    fechaHora: incoming?.fechaHora || current?.fechaHora || session.leadSnapshot?.fecha_hora_texto || null,
  };
  if (lead.fechaHora) {
    lead.fechaHoraISO = parseTextToLimaISO(lead.fechaHora);
    if (lead.fechaHoraISO) lead.fechaHora = formatLimaFechaHoraText(lead.fechaHoraISO);
  }
  lead.ready_to_notify = Boolean(isValidName(lead.nombre) && /^9\d{8}$/.test(lead.telefono || '') && lead.motivo && lead.fechaHoraISO);
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
  session.history.push({ role: 'user', parts: [{ text: String(mensaje || '') }], at: now });
  session.history = compactHistoryForPrompt(session.history, MAX_HISTORY_MESSAGES);
  try {
    const result = await callGemini(options.client, buildRequest(options.client, mensaje, session, jid, options), options);
    const rawText = extractResultText(result);
    const leadData = collectLead(session, mensaje);
    let texto = sanitizeModelTextOutput(rawText);
    if (!leadData?.ready_to_notify && !session.booked && /\b(?:tu cita|qued[oó]\s+agendada|ya est[aá]\s+agendada)\b/i.test(texto)) {
      texto = 'Para ayudarte a agendar, indícame tu nombre, teléfono, tratamiento y fecha o turno preferido.';
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
    return { texto, leadData, skipLeadPersistence: Boolean(options.skipLeadPersistence) };
  } catch (error) {
    const failures = (failureCounts.get(sid) || 0) + 1;
    failureCounts.set(sid, failures);
    return { texto: failures === 1 ? 'No pude procesar tu mensaje. ¿Me lo repites para ayudarte a agendar?' : CONTINGENCY_MESSAGE, leadData: null };
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
  getOrCreateSession,
  extractLeadDataFromText,
  isValidName,
};
