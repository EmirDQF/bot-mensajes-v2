import whatsappService from './whatsappService.js';
import { formatTimeEs, toMinutes } from './appointmentService.js';
import { describeError } from './safeLog.js';

// Horarios libres como botones de WhatsApp (hasta 3) o como lista (4 a 10): el paciente agenda con 1 toque.
// El texto del mensaje siempre trae los horarios escritos ("1) jueves… 2) …"): si su WhatsApp no muestra
// botones, responde "1" o "jueves 4:30" y funciona igual.

export const MAX_BUTTONS = 3;
export const MAX_LIST_ROWS = 10;
const BUTTON_BODY_LIMIT = 1024;
const LIST_BODY_LIMIT = 4096;
const SHORT_DAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const DAY_WORDS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
export const CHOOSE_PROMPT = '¿Cuál horario te acomoda? Tócalo aquí 👇';

const weekdayOf = (date) => new Date(`${date}T12:00:00Z`).getUTCDay();
const normalize = (text) => String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

// "Jue 6 · 4:30 p. m." (WhatsApp corta los botones en 20 caracteres).
export function slotButtonTitle({ date, time }) {
  return `${SHORT_DAYS[weekdayOf(date)]} ${Number(date.slice(8, 10))} · ${formatTimeEs(time)}`.slice(0, 20);
}

export const slotId = ({ date, time }) => `slot:${date}T${time}`;

// Botones (≤ 3) o lista (4 a 10). null si no hay horarios.
export function slotPicker(slots) {
  if (!Array.isArray(slots) || !slots.length) return null;
  if (slots.length <= MAX_BUTTONS) {
    return { type: 'buttons', buttons: slots.map((s) => ({ id: slotId(s), title: slotButtonTitle(s) })) };
  }
  return {
    type: 'list',
    button: 'Ver horarios',
    rows: slots.slice(0, MAX_LIST_ROWS).map((s) => ({ id: slotId(s), title: slotButtonTitle(s), description: String(s.label || '').slice(0, 72) })),
  };
}

// Hora escrita: "4:30", "4 pm", "a las 9", "16:30", "4:30 p. m.", "4 de la tarde".
const TIME = /(?:\ba\s+las\s+)?\b(\d{1,2})(?::(\d{2}))?\s*(a\.?\s?m\.?|p\.?\s?m\.?|de la manana|de la tarde|de la noche)?(?=\s|$|[.,!?])/g;

function timeCandidates(text) {
  const out = [];
  for (const m of text.matchAll(TIME)) {
    const hasColon = m[2] !== undefined;
    const ampm = m[3] || '';
    if (!hasColon && !ampm && !/a\s+las/.test(m[0])) continue;
    const h = Number(m[1]);
    const min = Number(m[2] || 0);
    if (h > 23 || min > 59) continue;
    const pm = /^p|tarde|noche/.test(ampm);
    const am = /^a|manana/.test(ampm);
    if (pm && h < 12) out.push((h + 12) * 60 + min);
    else if (am) out.push((h % 12) * 60 + min);
    else {
      out.push(h * 60 + min);
      if (h < 12) out.push((h + 12) * 60 + min);
    }
  }
  return out;
}

// Elige un horario ofrecido por el texto del botón o por "jueves 4:30" / "a las 9". Solo si queda uno.
export function matchSlotText(message, slots) {
  if (!Array.isArray(slots) || !slots.length) return null;
  const text = normalize(message);
  if (!text) return null;
  const byTitle = slots.filter((s) => text.includes(normalize(slotButtonTitle(s))));
  if (byTitle.length === 1) return byTitle[0];
  const minutes = timeCandidates(text);
  if (!minutes.length) return null;
  const day = DAY_WORDS.findIndex((word) => new RegExp(`\\b${word}\\b`).test(text));
  const matches = slots.filter((s) => minutes.includes(toMinutes(s.time)) && (day < 0 || weekdayOf(s.date) === day));
  return matches.length === 1 ? matches[0] : null;
}

// Envía el texto con los horarios como botones o lista. Si el texto no entra en el mensaje interactivo, sale
// aparte y los botones después. Si Meta rechaza el interactivo, se envía solo el texto (que ya trae los horarios).
export async function sendWithSlotPicker(to, text, slots, { whatsapp = whatsappService } = {}) {
  const picker = slotPicker(slots);
  if (!picker || typeof whatsapp.sendButtonsMessage !== 'function') return whatsapp.sendTextMessage(to, text);
  const limit = picker.type === 'buttons' ? BUTTON_BODY_LIMIT : LIST_BODY_LIMIT;
  const sendPicker = (body) => (picker.type === 'buttons'
    ? whatsapp.sendButtonsMessage(to, body, picker.buttons)
    : whatsapp.sendListMessage(to, body, picker.button, picker.rows));
  let first = null;
  try {
    if (String(text || '').length <= limit) return await sendPicker(text);
    first = await whatsapp.sendTextMessage(to, text);
    await sendPicker(CHOOSE_PROMPT);
    return first;
  } catch (error) {
    if (first) {
      console.warn('[WhatsApp] No se pudieron enviar los botones de horarios (el texto ya los trae):', describeError(error));
      return first;
    }
    console.warn('[WhatsApp] No se pudieron enviar los botones de horarios; se envía el texto:', describeError(error));
    return whatsapp.sendTextMessage(to, text);
  }
}

export default { slotButtonTitle, slotPicker, matchSlotText, sendWithSlotPicker };
