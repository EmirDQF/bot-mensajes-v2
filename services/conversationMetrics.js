import { getSupabase as getDefaultClient } from './supabaseClient.js';
import activeClinic from '../config/clinic.config.js';
import { isMissingColumn, isWithinWorkingHours } from './appointmentService.js';
import leadService from './leadService.js';
import { now as clockNow } from './clock.js';

// Métricas del primer contacto: ¿llegó con la clínica cerrada? ¿cuánto tardó la primera respuesta?
// Se guardan en conversations (first_message_at, first_response_ms, after_hours) y leads.after_hours.
// Nunca lanzan: una métrica que falla no puede frenar la conversación.

const digits = (phone) => String(phone || '').replace(/\D/g, '');
let warnedMissingColumns = false;

export function createConversationMetrics({
  getClient = getDefaultClient,
  clinic = activeClinic,
  leads = leadService,
  now = clockNow,
} = {}) {
  // firstMessageAt: hora del mensaje según Meta (message.timestamp); respondedAt: cuando salió la primera respuesta.
  async function recordFirstContact({ phone, firstMessageAt, respondedAt = now() }) {
    const id = digits(phone);
    const start = firstMessageAt instanceof Date && !Number.isNaN(firstMessageAt.getTime()) ? firstMessageAt : respondedAt;
    const afterHours = !isWithinWorkingHours(clinic, start);
    const firstResponseMs = Math.max(0, respondedAt - start);
    const result = { afterHours, firstResponseMs, saved: false };
    if (!id) return result;
    try {
      const client = await getClient();
      if (client) {
        const { error } = await client.from('conversations')
          .update({ first_message_at: start.toISOString(), first_response_ms: firstResponseMs, after_hours: afterHours })
          .eq('conversation_id', id)
          .is('first_response_ms', null);
        if (error) throw error;
        result.saved = true;
      }
    } catch (error) {
      if (isMissingColumn(error, 'first_response_ms')) {
        if (!warnedMissingColumns) console.warn('[Metrics] Faltan columnas de métricas; ejecuta migrations/20260927_after_hours_metrics.sql');
        warnedMissingColumns = true;
      } else {
        console.error('[Metrics] No se pudo guardar el primer contacto:', error?.message || error);
      }
    }
    try {
      await leads.saveLeadAfterHours(id, afterHours);
    } catch (error) {
      // leadService ya deja el detalle en el log.
    }
    return result;
  }

  return { recordFirstContact };
}

const conversationMetrics = createConversationMetrics();
export default conversationMetrics;
