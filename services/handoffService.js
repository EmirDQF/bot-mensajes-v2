import { createClient } from '@supabase/supabase-js';
import config from '../config/env.js';
import activeClinic, { getReceptionPhone } from '../config/clinic.config.js';
import whatsappService from './whatsappService.js';
import { isWithinWorkingHours } from './appointmentService.js';

// Pase a humano: pausa el bot en una conversación y avisa a recepción.
// El estado vive en conversations.status ('human' = bot pausado), así sobrevive a reinicios de Render
// y el panel puede listar primero las conversaciones que esperan a una persona.

const URGENCY = /\b(?:dolor\s+(?:muy\s+)?(?:fuerte|intenso|insoportable|terrible|horrible)|mucho\s+dolor|me\s+duele\s+(?:much[oí]simo|mucho|demasiado|horrible)|no\s+aguanto\s+el\s+dolor|sangr\w*|hinch\w*|inflamad\w*|absceso|pus|fiebre|golpe|traumatismo|accidente|se\s+me\s+(?:cay[oó]|rompi[oó]|parti[oó])\s+(?:un|el|mi)?\s*diente|emergencia|urgencia|urgente)\b/i;
const HUMAN = /\b(?:hablar|comunicarme|conversar|atender(?:me)?)\s+(?:con\s+)?(?:una\s+|un\s+|alguien|la\s+|el\s+)?(?:persona|humano|asesor[a]?|recepci[oó]n|doctor[a]?|odont[oó]log[oa]|especialista|alguien)\b|\b(?:persona\s+real|un\s+humano|agente\s+humano)\b|^\s*(?:asesor|humano|recepci[oó]n)\s*[.!?]*\s*$/i;

// 'urgencia' | 'humano' | null
export function detectHandoff(text) {
  const value = String(text || '');
  if (URGENCY.test(value)) return 'urgencia';
  if (HUMAN.test(value)) return 'humano';
  return null;
}

export function patientHandoffReply(reason) {
  if (reason === 'urgencia') {
    return 'Lamento que estés con esa molestia 🙏. Ya avisé a nuestro equipo clínico y te escribirán de inmediato por este chat. '
      + 'Por aquí no puedo darte diagnóstico ni indicarte medicamentos. Si el dolor, el sangrado o la hinchazón aumentan, '
      + `acude a la clínica (${activeClinic.address}) o a emergencias.`;
  }
  return '¡Claro! Ya avisé a nuestro equipo; una persona te escribirá en unos minutos por este mismo chat. 📲';
}

let defaultClient = null;
function getDefaultClient() {
  if (defaultClient) return defaultClient;
  if (!config.supabase?.url || !config.supabase?.serviceRoleKey) return null;
  defaultClient = createClient(config.supabase.url, config.supabase.serviceRoleKey);
  return defaultClient;
}

const CACHE_MS = 60 * 1000;
const digits = (phone) => String(phone || '').replace(/\D/g, '');

export function createHandoffService({
  getClient = getDefaultClient, whatsapp = whatsappService, clinic = activeClinic, now = () => Date.now(),
} = {}) {
  const cache = new Map();

  async function isPaused(phone) {
    const id = digits(phone);
    const cached = cache.get(id);
    if (cached && now() - cached.at < CACHE_MS) return cached.paused;
    let paused = cached?.paused || false;
    try {
      const client = await getClient();
      if (client) {
        const { data, error } = await client.from('conversations').select('status').eq('conversation_id', id).maybeSingle();
        if (error) throw error;
        paused = data?.status === 'human';
      }
    } catch (error) {
      console.error('[Handoff] No se pudo leer el estado del bot:', error?.message || error);
    }
    cache.set(id, { paused, at: now() });
    return paused;
  }

  async function setPaused(phone, paused) {
    const id = digits(phone);
    cache.set(id, { paused, at: now() });
    try {
      const client = await getClient();
      if (client) {
        const { error } = await client.from('conversations').upsert({
          conversation_id: id, phone: id, contact_number: id,
          status: paused ? 'human' : 'active', updated_at: new Date(now()).toISOString(),
        }, { onConflict: 'conversation_id' });
        if (error) throw error;
      }
    } catch (error) {
      console.error('[Handoff] No se pudo guardar el estado del bot:', error?.message || error);
    }
    return paused;
  }

  async function toggle(phone) {
    return setPaused(phone, !(await isPaused(phone)));
  }

  // Registro para el reporte semanal ("urgencias derivadas"). Sin la tabla handoffs solo queda en el log.
  async function logHandoff(phone, reason) {
    try {
      const client = await getClient();
      if (!client) return;
      const { error } = await client.from('handoffs').insert([{
        clinic_id: clinic.id, phone: digits(phone), reason,
        after_hours: !isWithinWorkingHours(clinic, new Date(now())),
      }]);
      if (error) throw error;
    } catch (error) {
      console.error('[Handoff] No se pudo registrar el pase a humano (¿falta migrations/20260927_after_hours_metrics.sql?):', error?.message || error);
    }
  }

  // Pausa el bot y avisa a RECEPTION_ALERT_PHONE. Nunca lanza.
  async function handoff({ phone, reason, message = '', contactName = null }) {
    await setPaused(phone, true);
    await logHandoff(phone, reason);
    const to = getReceptionPhone();
    if (!to) {
      console.warn('[Handoff] RECEPTION_ALERT_PHONE no está definida; no se avisó a recepción.');
      return { notified: false };
    }
    const id = digits(phone);
    const title = reason === 'urgencia' ? '🚨 URGENCIA — responder de inmediato' : '🙋 Un paciente pide hablar con una persona';
    const text = [
      `${title} (${clinic.name})`,
      `👤 ${contactName || 'Paciente'} · +${id} (wa.me/${id})`,
      `💬 "${String(message).slice(0, 300)}"`,
      '',
      'El bot quedó en pausa en esta conversación. Reactívalo desde el panel cuando termines.',
    ].join('\n');
    try {
      await whatsapp.sendTextMessage(to, text);
      return { notified: true };
    } catch (error) {
      console.error('[Handoff] No se pudo avisar a recepción:', error?.message || error);
      return { notified: false };
    }
  }

  return { isPaused, setPaused, toggle, handoff };
}

const handoffService = createHandoffService();
export default handoffService;
