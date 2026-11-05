import whatsappService from '../services/whatsappService.js';
import contactPreferences from '../services/contactPreferences.js';
import { now as clockNow } from '../services/clock.js';
import { describeError } from '../services/safeLog.js';
import {
  MARKETING_OPT_IN_BUTTONS, MARKETING_OPT_IN_NO_REPLY, MARKETING_OPT_IN_QUESTION, MARKETING_OPT_IN_YES_REPLY,
} from '../config/legalTexts.js';
import { recordInbox } from './conversationStore.js';

// Permiso para promociones (opt-in de marketing): se pregunta UNA sola vez, con botones Sí/No, después de que el
// paciente agenda. Se guarda la fecha y el texto exacto aceptado. A quien dijo "No" (o pidió no recibir mensajes,
// o es menor de edad) nunca se le pregunta.

const ANSWER_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const YES = /^\s*(?:s[ií]+|s[ií],?\s*(?:quiero|acepto|claro|por\s+favor)|acepto|claro(?:\s+que\s+s[ií])?|ok|dale|ya)\s*[.!👍🙌]*\s*$/iu;
const NO = /^\s*(?:no+|no,?\s*gracias|no\s+quiero|mejor\s+no)\s*[.!👍🙏]*\s*$/iu;
const normalize = (text) => String(text || '').trim().toLowerCase();

export function shouldAskMarketing(prefs) {
  return !prefs?.marketing_asked_at && !prefs?.marketing_opt_in_at && !prefs?.marketing_opt_out_at
    && !prefs?.followups_opt_out_at && !prefs?.minor_at;
}

export function createMarketingConsent({ preferences = contactPreferences, whatsapp = whatsappService, now = clockNow, record = recordInbox } = {}) {
  // Después de agendar. Nunca lanza; true si se preguntó.
  async function askAfterBooking(phone) {
    try {
      if (!shouldAskMarketing(await preferences.get(phone))) return false;
      // Si no se puede registrar que ya se preguntó (migración pendiente), no se pregunta: nunca dos veces.
      if (!(await preferences.markMarketingAsked(phone))) return false;
      const result = await whatsapp.sendButtonsMessage(phone, MARKETING_OPT_IN_QUESTION, [
        { id: 'promo_si', title: MARKETING_OPT_IN_BUTTONS.yes }, { id: 'promo_no', title: MARKETING_OPT_IN_BUTTONS.no },
      ]);
      void record({ phone, sender: 'bot', text: MARKETING_OPT_IN_QUESTION, wamid: result?.messages?.[0]?.id || null });
      return true;
    } catch (error) {
      console.warn('[Promociones] No se pudo preguntar por el permiso:', describeError(error));
      return false;
    }
  }

  // Respuesta a la pregunta (botón o escrita). Devuelve el texto a responder o null si no es una respuesta.
  async function handleAnswer(phone, text) {
    const value = normalize(text);
    const isYes = value === normalize(MARKETING_OPT_IN_BUTTONS.yes) || YES.test(value);
    const isNo = value === normalize(MARKETING_OPT_IN_BUTTONS.no) || NO.test(value);
    if (!isYes && !isNo) return null;
    try {
      const prefs = await preferences.get(phone);
      const pending = prefs?.marketing_asked_at && !prefs.marketing_opt_in_at && !prefs.marketing_opt_out_at
        && now() - new Date(prefs.marketing_asked_at) < ANSWER_WINDOW_MS;
      if (!pending) return null;
      if (isYes) {
        await preferences.optInMarketing(phone, 'paciente', MARKETING_OPT_IN_QUESTION);
        return MARKETING_OPT_IN_YES_REPLY;
      }
      await preferences.declineMarketing(phone);
      return MARKETING_OPT_IN_NO_REPLY;
    } catch (error) {
      console.warn('[Promociones] No se pudo guardar la respuesta al permiso:', describeError(error));
      return null;
    }
  }

  return { askAfterBooking, handleAnswer };
}

const marketingConsent = createMarketingConsent();
export default marketingConsent;
