import { getSupabase as getDefaultClient } from './supabaseClient.js';
import activeClinic from '../config/clinic.config.js';
import { now as clockNow } from './clock.js';
import { describeError } from './safeLog.js';

// Preferencias de contacto por paciente (tabla contact_preferences): opt-out de seguimientos ("no", "stop",
// bloqueo), opt-in de marketing con fecha (requisito de la plantilla del día 3 y de las promociones) y
// "menor de edad" (nunca se le hace seguimiento comercial). Sin la migración, el opt-out se guarda como la
// etiqueta "no_contactar" de la ficha del lead (que el seguimiento ya respeta).

const digits = (phone) => String(phone || '').replace(/\D/g, '');
const isMissingTable = (error) => error?.code === '42P01' || error?.code === 'PGRST205' || /contact_preferences/.test(String(error?.message || ''));

// "no", "no gracias", "ya no"…: respuesta corta. Explícitos: "stop", "no me escriban", "no quiero más mensajes"…
export const OPT_OUT_SOFT = /^\s*(?:no+|nop|nel|no\s+gracias|ya\s+no|no\s+por\s+ahora|no,?\s+gracias)\s*[.!👍🙏]*\s*$/iu;
export const OPT_OUT_EXPLICIT = /\b(?:stop|basta|desuscrib\w*|unsubscribe|dar(?:me)?\s+de\s+baja|no\s+(?:me\s+)?(?:escrib\w+|contact\w+|manden?\s+m[aá]s)|dej(?:en|a)\s+de\s+escribir\w*|no\s+(?:quiero|deseo)\s+(?:recibir\s+)?(?:m[aá]s\s+)?(?:mensajes|promociones|publicidad)|no\s+me\s+interesa)\b/i;
// El paciente dice ser menor de edad (no un padre hablando de su hijo).
export const MINOR = /\b(?:soy\s+menor(?:\s+de\s+edad)?|tengo\s+(?:1[0-7]|[5-9])\s+a[nñ]os)\b/i;

export function detectOptOut(text) {
  const value = String(text || '');
  if (OPT_OUT_EXPLICIT.test(value)) return 'explicit';
  if (OPT_OUT_SOFT.test(value)) return 'soft';
  return null;
}

export const detectMinor = (text) => MINOR.test(String(text || ''));

export function createContactPreferences({ getClient = getDefaultClient, clinic = activeClinic, now = clockNow } = {}) {
  let warned = false;
  const warnOnce = (error) => {
    if (!warned) console.warn('[Preferencias] Falta la tabla contact_preferences; ejecuta migrations/20261107_ethical_follow_ups.sql:', describeError(error));
    warned = true;
  };

  async function getMany(phones) {
    const list = [...new Set(phones.map(digits).filter(Boolean))];
    if (!list.length) return new Map();
    const client = await getClient();
    if (!client) return new Map();
    const { data, error } = await client.from('contact_preferences').select('*').eq('clinic_id', clinic.id).in('phone', list);
    if (error) {
      if (isMissingTable(error)) { warnOnce(error); return new Map(); }
      throw error;
    }
    return new Map((data || []).map((row) => [digits(row.phone), row]));
  }

  async function get(phone) {
    return (await getMany([phone])).get(digits(phone)) || null;
  }

  // Guarda cambios del paciente (se crea la fila si no existe). Nunca lanza: devuelve true si quedó guardado.
  async function save(phone, changes) {
    const client = await getClient();
    if (!client) return false;
    const row = { clinic_id: clinic.id, phone: digits(phone), ...changes, updated_at: new Date(now()).toISOString() };
    const { error } = await client.from('contact_preferences').upsert(row, { onConflict: 'clinic_id,phone' });
    if (!error) return true;
    if (isMissingTable(error)) {
      warnOnce(error);
      return changes.followups_opt_out_at ? tagDoNotContact(client, phone) : false;
    }
    console.error('[Preferencias] No se pudo guardar:', describeError(error));
    return false;
  }

  // Respaldo sin la migración: la etiqueta "no_contactar" de la ficha (leads.tags).
  async function tagDoNotContact(client, phone) {
    try {
      const local = digits(phone).slice(-9);
      const { data } = await client.from('leads').select('telefono, tags').in('telefono', [digits(phone), local]);
      for (const lead of data || []) {
        const tags = Array.isArray(lead.tags) ? lead.tags : [];
        if (!tags.includes('no_contactar')) await client.from('leads').update({ tags: [...tags, 'no_contactar'] }).eq('telefono', lead.telefono);
      }
      return Boolean(data?.length);
    } catch (error) {
      console.error('[Preferencias] No se pudo marcar "no_contactar":', describeError(error));
      return false;
    }
  }

  const stamp = () => new Date(now()).toISOString();
  return {
    get,
    getMany,
    // reason: "paciente" (dijo no/stop), "bloqueo" (Meta no puede entregarle), "recepcion" (desde el panel).
    optOut: (phone, reason = 'paciente') => save(phone, { followups_opt_out_at: stamp(), opt_out_reason: reason, marketing_opt_out_at: stamp() }),
    // Opt-in con fecha, origen y el texto exacto que aceptó (config/legalTexts.js).
    optInMarketing: (phone, source = 'paciente', acceptedText = null) => save(phone, {
      marketing_opt_in_at: stamp(), marketing_opt_in_source: source, marketing_opt_out_at: null,
      ...(acceptedText ? { marketing_opt_in_text: acceptedText } : {}),
    }),
    // Respondió "No" a la pregunta: no recibe promociones y nunca se le vuelve a preguntar.
    declineMarketing: (phone) => save(phone, { marketing_opt_out_at: stamp() }),
    markMarketingAsked: (phone) => save(phone, { marketing_asked_at: stamp() }),
    markMinor: (phone) => save(phone, { minor_at: stamp() }),
  };
}

const contactPreferences = createContactPreferences();
export default contactPreferences;
