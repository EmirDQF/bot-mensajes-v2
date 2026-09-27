import { createClient } from '@supabase/supabase-js';
import config from '../config/env.js';
import activeClinic, { findTreatment, getOwnerPhone, getReceptionPhone } from '../config/clinic.config.js';
import TEMPLATES from '../config/whatsappTemplates.js';
import { addDays, formatDateEs, isWithinWorkingHours, localParts, toInstant } from './appointmentService.js';
import jobsService from './jobsService.js';
import { fetchAllRows } from './supabasePaging.js';
import { now as clockNow } from './clock.js';

// Reporte de resultados para el dueño (semana de garantía y seguimiento mensual).
// Todo sale de datos medidos por el sistema: mensajes, citas y pases a humano en Supabase.
// Lo nocturno se deduce de la hora de creación con el horario de la clínica, así el reporte
// funciona aunque falten las columnas after_hours de la migración 20260927.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NO_AD_LABEL = 'Orgánico / sin anuncio';
const CONFIRMED = ['confirmada', 'asistio'];
export const GUARANTEE_TARGET = Math.max(1, Number(process.env.GUARANTEE_MIN_CONFIRMED || 2));

let defaultClient = null;
function getDefaultClient() {
  if (defaultClient) return defaultClient;
  if (!config.supabase?.url || !config.supabase?.serviceRoleKey) return null;
  defaultClient = createClient(config.supabase.url, config.supabase.serviceRoleKey);
  return defaultClient;
}

const digits = (phone) => String(phone || '').replace(/\D/g, '');
const adName = (referral) => referral?.headline || referral?.source_id || NO_AD_LABEL;
const soles = (value) => `S/ ${Math.round(value).toLocaleString('es-PE')}`;

export function formatDuration(ms) {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return 'sin datos';
  if (ms < 60e3) return `${Math.max(1, Math.round(ms / 1000))} s`;
  if (ms < 3600e3) return `${Math.round(ms / 60e3)} min`;
  return `${(ms / 3600e3).toFixed(1)} h`;
}

export function guaranteeLine(confirmed, target = GUARANTEE_TARGET) {
  return `Citas de evaluación confirmadas: ${confirmed} / meta ${target} → ${confirmed >= target ? '✅ cumplido' : '⏳ pendiente'}`;
}

export function createReport({
  getClient = getDefaultClient,
  clinic = activeClinic,
  jobs = jobsService,
  now = clockNow,
} = {}) {
  async function db() {
    const client = await getClient();
    if (!client) throw new Error('Supabase no configurado (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY)');
    return client;
  }

  // Rango por defecto: los 7 días completos anteriores a hoy (lunes a domingo si se corre el lunes).
  function resolveRange({ from, to } = {}) {
    const today = localParts(clinic.timezone, now()).date;
    const end = DATE_RE.test(String(to || '')) ? to : addDays(today, -1);
    const start = DATE_RE.test(String(from || '')) ? from : addDays(end, -6);
    if (start > end) throw Object.assign(new Error('La fecha inicial es posterior a la final'), { status: 400 });
    if (addDays(start, 366) < end) throw Object.assign(new Error('El rango máximo es de un año'), { status: 400 });
    return { from: start, to: end };
  }

  const priceOf = (treatment) => {
    const match = clinic.treatments.find((t) => t.name === treatment || t.key === treatment) || findTreatment(treatment);
    return match?.priceFrom || 0;
  };

  // Tablas o columnas de migraciones aún no ejecutadas no deben tumbar el reporte.
  async function optional(run, fallback) {
    try {
      return await run();
    } catch (error) {
      console.warn('[Report] Dato no disponible:', error?.message || error);
      return fallback;
    }
  }

  async function buildReport(range = {}) {
    const { from, to } = resolveRange(range);
    const fromIso = toInstant(from, '00:00', clinic.timezone).toISOString();
    const toIso = toInstant(addDays(to, 1), '00:00', clinic.timezone).toISOString();
    const client = await db();
    const internal = new Set([getReceptionPhone(), getOwnerPhone()].filter(Boolean));

    // Conversaciones: pacientes que escribieron en el rango; "fuera de horario" si su primer mensaje fue con la clínica cerrada.
    const inbound = await fetchAllRows(() => client.from('messages').select('phone, created_at')
      .eq('role', 'user').gte('created_at', fromIso).lt('created_at', toIso).order('created_at', { ascending: true }));
    const firstByPhone = new Map();
    for (const m of inbound) {
      const phone = digits(m.phone);
      if (phone && !internal.has(phone) && !firstByPhone.has(phone)) firstByPhone.set(phone, new Date(m.created_at));
    }
    const conversationsAfterHours = [...firstByPhone.values()].filter((at) => !isWithinWorkingHours(clinic, at)).length;

    // Tiempo de primera respuesta medido por el bot (conversations.first_response_ms).
    const firstResponses = await optional(async () => (await fetchAllRows(() => client.from('conversations')
      .select('first_response_ms').gte('first_message_at', fromIso).lt('first_message_at', toIso)
      .order('first_message_at', { ascending: true })))
      .map((c) => c.first_response_ms).filter((ms) => typeof ms === 'number'), []);
    const avgFirstResponseMs = firstResponses.length ? firstResponses.reduce((a, b) => a + b, 0) / firstResponses.length : null;

    // Citas solicitadas en el rango (por fecha de creación).
    const appointments = await fetchAllRows(() => client.from('appointments').select('*')
      .eq('clinic_id', clinic.id).gte('created_at', fromIso).lt('created_at', toIso).order('created_at', { ascending: true }));
    const afterHoursOf = (a) => (typeof a.after_hours === 'boolean' ? a.after_hours : !isWithinWorkingHours(clinic, new Date(a.created_at)));
    const isConfirmed = (a) => Boolean(a.confirmed_at) || CONFIRMED.includes(a.status);
    const count = (fn) => appointments.filter(fn).length;
    const confirmed = count(isConfirmed);

    const byAd = new Map();
    for (const a of appointments) {
      const ad = adName(a.ad_referral);
      const row = byAd.get(ad) || { ad, requested: 0, confirmed: 0 };
      row.requested += 1;
      if (isConfirmed(a)) row.confirmed += 1;
      byAd.set(ad, row);
    }

    const urgencies = await optional(async () => (await fetchAllRows(() => client.from('handoffs').select('reason, created_at')
      .eq('clinic_id', clinic.id).gte('created_at', fromIso).lt('created_at', toIso).order('created_at', { ascending: true })))
      .filter((h) => h.reason === 'urgencia').length, null);

    const potentialValue = appointments.filter((a) => a.status !== 'cancelada').reduce((sum, a) => sum + priceOf(a.treatment), 0);

    return {
      clinic: { id: clinic.id, name: clinic.name },
      from,
      to,
      label: `${formatDateEs(from)} al ${formatDateEs(to)}`,
      conversations: firstByPhone.size,
      conversationsAfterHours,
      avgFirstResponseMs,
      firstResponseSamples: firstResponses.length,
      requested: appointments.length,
      requestedAfterHours: count(afterHoursOf),
      confirmed,
      attended: count((a) => a.status === 'asistio'),
      noShows: count((a) => a.status === 'no_asistio'),
      rescheduled: count((a) => Boolean(a.rescheduled_at) || a.status === 'reprogramada'),
      cancelled: count((a) => a.status === 'cancelada'),
      urgencies,
      byAd: [...byAd.values()].sort((x, y) => y.requested - x.requested),
      potentialValue,
      guarantee: { confirmed, target: GUARANTEE_TARGET, met: confirmed >= GUARANTEE_TARGET, line: guaranteeLine(confirmed) },
    };
  }

  // Mensaje corto y contundente para el dueño.
  function formatReportText(report, { panelUrl = null } = {}) {
    const topAd = report.byAd.find((row) => row.ad !== NO_AD_LABEL) || report.byAd[0];
    return [
      `📈 Reporte de ${report.clinic.name}`,
      `🗓️ ${report.label}`,
      '',
      `💬 Conversaciones: ${report.conversations} (🌙 ${report.conversationsAfterHours} fuera de horario)`,
      `⚡ Primera respuesta: ${formatDuration(report.avgFirstResponseMs)} en promedio`,
      `📅 Citas solicitadas: ${report.requested} (🌙 ${report.requestedAfterHours} con la clínica cerrada)`,
      `✅ Confirmadas: ${report.confirmed} · 🦷 Asistieron: ${report.attended} · 🚫 No asistieron: ${report.noShows}`,
      `🔁 Reprogramadas en vez de canceladas: ${report.rescheduled} · ❌ Canceladas: ${report.cancelled}`,
      `🚨 Urgencias derivadas: ${report.urgencies ?? 'sin datos'}`,
      `📣 Anuncio con más citas: ${topAd ? `${topAd.ad} (${topAd.requested})` : 'sin citas aún'}`,
      `💰 Valor potencial: ${soles(report.potentialValue)} (precio "desde" × citas no canceladas)`,
      '',
      `🎯 ${report.guarantee.line}`,
      ...(panelUrl ? [`Detalle: ${panelUrl}`] : []),
    ].join('\n');
  }

  async function runWeeklyReport(range = {}) {
    const report = await buildReport(range);
    const base = (process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '');
    const text = formatReportText(report, { panelUrl: base ? `${base}/panel` : null });
    const owner = getOwnerPhone();
    if (!owner) {
      console.warn('[Report] OWNER_ALERT_PHONE no está definida; el reporte no se envió.');
      return { sent: false, report, text };
    }
    const channel = await jobs.sendWithWindow(owner, {
      text,
      template: TEMPLATES.weeklyReport,
      params: TEMPLATES.weeklyReport.params({
        range: report.label,
        conversations: report.conversations,
        afterHours: report.conversationsAfterHours,
        requested: report.requested,
        confirmed: report.confirmed,
        guarantee: report.guarantee.line,
      }),
    });
    return { sent: true, channel, report, text };
  }

  return { resolveRange, buildReport, formatReportText, runWeeklyReport };
}

const reportService = createReport();
export default reportService;
