import { createClient } from '@supabase/supabase-js';
import config from '../config/env.js';
import activeClinic, { getOwnerPhone, getReceptionPhone } from '../config/clinic.config.js';
import TEMPLATES from '../config/whatsappTemplates.js';
import appointmentService, { addDays, formatDateEs, formatTimeEs, localParts } from './appointmentService.js';
import jobsService from './jobsService.js';
import { fetchAllRows } from './supabasePaging.js';
import { now as clockNow } from './clock.js';

// Datos del panel de recepción: agenda del día, cambio de estado y métricas.

export const PANEL_STATUSES = ['confirmada', 'asistio', 'no_asistio', 'cancelada'];
const NO_AD_LABEL = 'Orgánico / sin anuncio';

let defaultClient = null;
function getDefaultClient() {
  if (defaultClient) return defaultClient;
  if (!config.supabase?.url || !config.supabase?.serviceRoleKey) return null;
  defaultClient = createClient(config.supabase.url, config.supabase.serviceRoleKey);
  return defaultClient;
}

const digits = (phone) => String(phone || '').replace(/\D/g, '');
const adName = (referral) => referral?.headline || referral?.source_id || NO_AD_LABEL;

export function createPanelData({
  getClient = getDefaultClient,
  clinic = activeClinic,
  appointments = appointmentService,
  jobs = jobsService,
  now = clockNow,
} = {}) {
  async function db() {
    const client = await getClient();
    if (!client) throw new Error('Supabase no configurado (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY)');
    return client;
  }

  async function query(builder) {
    const { data, error } = await builder;
    if (error) throw error;
    return data || [];
  }

  // day: 'today' | 'tomorrow' | 'YYYY-MM-DD'
  async function getAgenda(day = 'today') {
    const today = localParts(clinic.timezone, now()).date;
    const date = day === 'tomorrow' ? addDays(today, 1) : /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : today;
    const rows = await query((await db()).from('appointments').select('*')
      .eq('clinic_id', clinic.id).eq('appointment_date', date)
      .order('appointment_time', { ascending: true }));
    return {
      date,
      label: formatDateEs(date),
      appointments: rows.map((a) => ({
        id: a.id,
        time: String(a.appointment_time).slice(0, 5),
        timeLabel: formatTimeEs(a.appointment_time),
        patientName: a.patient_name || 'Sin nombre',
        phone: digits(a.sender_phone),
        treatment: a.treatment || 'Evaluación',
        status: a.status,
        ad: a.ad_referral ? adName(a.ad_referral) : null,
        reminderSent: Boolean(a.reminder_24h_sent_at || a.reminder_2h_sent_at),
      })),
    };
  }

  // Cambia el estado desde el panel. "asistió" dispara el pedido de reseña si la clínica tiene reviewUrl.
  async function setAppointmentStatus(id, status) {
    if (!PANEL_STATUSES.includes(status)) throw Object.assign(new Error(`Estado no permitido: ${status}`), { status: 400 });
    const updated = status === 'confirmada' ? await appointments.confirm(id) : await appointments.updateStatus(id, status);
    if (status === 'asistio' && clinic.reviewUrl && updated?.sender_phone) {
      const data = { patient: String(updated.patient_name || '').split(' ')[0] || 'paciente', clinicName: clinic.name, reviewUrl: clinic.reviewUrl };
      const text = `¡Gracias por visitarnos, ${data.patient}! 🦷 Nos ayudaría mucho tu opinión: ${clinic.reviewUrl}`;
      try {
        await jobs.sendWithWindow(updated.sender_phone, { text, template: TEMPLATES.review, params: TEMPLATES.review.params(data) });
      } catch (error) {
        console.error('[Panel] No se pudo enviar el pedido de reseña:', error?.message || error);
      }
    }
    return updated;
  }

  async function getMetrics(days = 30) {
    const period = Math.min(Math.max(Number(days) || 30, 1), 365);
    const since = new Date(now() - period * 24 * 3600e3).toISOString();
    const client = await db();
    const internal = new Set([getReceptionPhone(), getOwnerPhone()].filter(Boolean));

    const inbound = await fetchAllRows(() => client.from('messages').select('phone')
      .eq('role', 'user').gte('created_at', since).order('created_at', { ascending: true }));
    const leads = new Set(inbound.map((m) => digits(m.phone)).filter((p) => p && !internal.has(p)));
    const appts = await fetchAllRows(() => client.from('appointments').select('sender_phone, status, ad_referral')
      .eq('clinic_id', clinic.id).gte('created_at', since).order('created_at', { ascending: true }));

    const bookedPhones = new Set(appts.map((a) => digits(a.sender_phone)));
    const attended = appts.filter((a) => a.status === 'asistio').length;
    const noShows = appts.filter((a) => a.status === 'no_asistio').length;
    const byAd = new Map();
    for (const a of appts) byAd.set(adName(a.ad_referral), (byAd.get(adName(a.ad_referral)) || 0) + 1);

    const pct = (part, total) => (total ? Math.round((part / total) * 100) : 0);
    return {
      days: period,
      leads: leads.size,
      appointments: appts.length,
      bookingRate: pct([...bookedPhones].filter((p) => leads.has(p)).length, leads.size),
      attended,
      noShows,
      noShowRate: pct(noShows, attended + noShows),
      byAd: [...byAd.entries()].map(([ad, count]) => ({ ad, count })).sort((a, b) => b.count - a.count),
    };
  }

  return { getAgenda, setAppointmentStatus, getMetrics };
}

const panelData = createPanelData();
export default panelData;
