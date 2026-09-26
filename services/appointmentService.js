import { createClient } from '@supabase/supabase-js';
import config from '../config/env.js';
import activeClinic, { findTreatment, getReceptionPhone } from '../config/clinic.config.js';
import whatsappService from './whatsappService.js';

// Agenda real con disponibilidad. Fechas y horas se guardan en la hora local de la clínica.

export const ACTIVE_STATUSES = ['pendiente', 'confirmada', 'reprogramada'];
export const STATUSES = [...ACTIVE_STATUSES, 'cancelada', 'asistio', 'no_asistio'];
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MIN_LEAD_MINUTES = Number(process.env.APPOINTMENT_MIN_LEAD_MINUTES || 60);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export class SlotTakenError extends Error {
  constructor(message = 'El horario ya está ocupado') {
    super(message);
    this.code = 'SLOT_TAKEN';
  }
}

// ---------- Helpers de fecha/hora (sin dependencias) ----------

const pad = (n) => String(n).padStart(2, '0');
export const toMinutes = (hhmm) => { const [h, m] = String(hhmm).slice(0, 5).split(':').map(Number); return h * 60 + m; };
export const toHHMM = (minutes) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

// Fecha (YYYY-MM-DD), minutos del día y día de la semana en la zona horaria dada.
export function localParts(timeZone, instant = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(instant).map((p) => [p.type, p.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return { date, minutes: Number(parts.hour) * 60 + Number(parts.minute), weekday: weekdayKey(date) };
}

export function weekdayKey(date) {
  return DAY_KEYS[new Date(`${date}T12:00:00Z`).getUTCDay()];
}

export function addDays(date, days) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Instante UTC de una fecha/hora local de la clínica (funciona con cualquier zona horaria).
export function toInstant(date, time, timeZone) {
  const guess = Date.parse(`${date}T${String(time).slice(0, 5)}:00Z`);
  const local = localParts(timeZone, new Date(guess));
  const localAsUtc = Date.parse(`${local.date}T${toHHMM(local.minutes)}:00Z`);
  return new Date(guess - (localAsUtc - guess));
}

export function formatDateEs(date) {
  return new Intl.DateTimeFormat('es-PE', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' })
    .format(new Date(`${date}T12:00:00Z`));
}

export function formatTimeEs(time) {
  const minutes = toMinutes(time);
  const h = Math.floor(minutes / 60);
  return `${h % 12 || 12}:${pad(minutes % 60)} ${h < 12 ? 'a. m.' : 'p. m.'}`;
}

export function slotLabel({ date, time }) {
  return `${formatDateEs(date)} a las ${formatTimeEs(time)}`;
}

const overlaps = (startA, durA, startB, durB) => startA < startB + durB && startB < startA + durA;

// ---------- Servicio ----------

let defaultClient = null;
function getDefaultClient() {
  if (defaultClient) return defaultClient;
  const url = config.supabase?.url;
  const key = config.supabase?.serviceRoleKey;
  if (!url || !key) return null;
  defaultClient = createClient(url, key);
  return defaultClient;
}

export function createAppointmentService({
  getClient = getDefaultClient,
  clinic = activeClinic,
  whatsapp = whatsappService,
  now = () => new Date(),
} = {}) {
  async function db() {
    const client = await getClient();
    if (!client) throw new Error('Supabase no configurado (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY)');
    return client;
  }

  function durationFor(treatment) {
    if (!treatment) return clinic.slotMinutes;
    const byKey = clinic.treatments.find((t) => t.key === treatment || t.name === treatment);
    return (byKey || findTreatment(treatment))?.durationMin || clinic.slotMinutes;
  }

  async function listActiveOn(date, { excludeId = null } = {}) {
    const client = await db();
    const { data, error } = await client.from('appointments')
      .select('id, appointment_time, duration_min, status')
      .eq('clinic_id', clinic.id)
      .eq('appointment_date', date)
      .in('status', ACTIVE_STATUSES);
    if (error) throw error;
    return (data || []).filter((a) => a.id !== excludeId);
  }

  function hasConflict(existing, time, duration) {
    const start = toMinutes(time);
    return existing.some((a) => overlaps(start, duration, toMinutes(a.appointment_time), a.duration_min || clinic.slotMinutes));
  }

  // Horarios libres ('HH:MM') de un día, según workingHours, slotMinutes, duración y citas existentes.
  async function getAvailableSlots(date, treatment, { existing = null } = {}) {
    if (!DATE_RE.test(String(date))) throw new Error(`Fecha inválida: ${date}`);
    const today = localParts(clinic.timezone, now());
    if (date < today.date) return [];
    const ranges = clinic.workingHours[weekdayKey(date)] || [];
    if (!ranges.length) return [];
    const duration = durationFor(treatment);
    const busy = existing || await listActiveOn(date);
    const minStart = date === today.date ? today.minutes + MIN_LEAD_MINUTES : 0;
    const slots = [];
    for (const [from, to] of ranges) {
      for (let start = toMinutes(from); start + duration <= toMinutes(to); start += clinic.slotMinutes) {
        if (start < minStart) continue;
        if (!hasConflict(busy, toHHMM(start), duration)) slots.push(toHHMM(start));
      }
    }
    return slots;
  }

  // Próximos `count` horarios concretos para ofrecer al paciente, separados al menos `minGapMinutes` el mismo día.
  async function findNextSlots(treatment, { count = 3, fromDate = null, maxDays = 14, minGapMinutes = 120 } = {}) {
    const start = fromDate || localParts(clinic.timezone, now()).date;
    const picked = [];
    for (let i = 0; i < maxDays && picked.length < count; i += 1) {
      const date = addDays(start, i);
      const free = await getAvailableSlots(date, treatment);
      let last = null;
      for (const time of free) {
        if (last !== null && toMinutes(time) - last < minGapMinutes) continue;
        picked.push({ date, time, label: slotLabel({ date, time }) });
        last = toMinutes(time);
        if (picked.length >= count) break;
      }
    }
    return picked;
  }

  async function saveAppointment({
    clinicId = clinic.id, senderPhone, patientName = null, treatment = null,
    appointmentDate, appointmentTime, durationMin = null, notes = null, source = 'whatsapp', adReferral = null,
  }) {
    const phone = String(senderPhone || '').replace(/\D/g, '');
    if (!phone) throw new Error('senderPhone es obligatorio');
    if (!DATE_RE.test(String(appointmentDate))) throw new Error(`appointmentDate inválida: ${appointmentDate}`);
    const time = String(appointmentTime || '').slice(0, 5);
    if (!TIME_RE.test(time)) throw new Error(`appointmentTime inválida: ${appointmentTime}`);
    const duration = durationMin || durationFor(treatment);

    const existing = await listActiveOn(appointmentDate);
    if (hasConflict(existing, time, duration)) throw new SlotTakenError();

    const client = await db();
    const { data, error } = await client.from('appointments').insert([{
      clinic_id: clinicId,
      sender_phone: phone,
      patient_name: patientName,
      treatment,
      appointment_date: appointmentDate,
      appointment_time: time,
      duration_min: duration,
      status: 'pendiente',
      source,
      ad_referral: adReferral,
      notes,
    }]).select().single();
    if (error) {
      if (error.code === '23505') throw new SlotTakenError();
      throw error;
    }
    return data;
  }

  async function updateStatus(id, status, changes = {}) {
    if (!STATUSES.includes(status)) throw new Error(`Estado inválido: ${status}`);
    const allowed = ['appointment_date', 'appointment_time', 'notes', 'reminder_24h_sent_at', 'reminder_2h_sent_at'];
    const patch = { status };
    for (const key of allowed) if (changes[key] !== undefined) patch[key] = changes[key];
    const client = await db();
    const { data, error } = await client.from('appointments')
      .update(patch).eq('id', id).eq('clinic_id', clinic.id).select().single();
    if (error) throw error;
    return data;
  }

  async function reschedule(id, { appointmentDate, appointmentTime, durationMin }) {
    const time = String(appointmentTime).slice(0, 5);
    const existing = await listActiveOn(appointmentDate, { excludeId: id });
    if (hasConflict(existing, time, durationMin || clinic.slotMinutes)) throw new SlotTakenError();
    try {
      return await updateStatus(id, 'reprogramada', { appointment_date: appointmentDate, appointment_time: time });
    } catch (error) {
      if (error?.code === '23505') throw new SlotTakenError();
      throw error;
    }
  }

  // Próxima cita activa (hoy o después) de un paciente.
  async function findUpcomingByPhone(senderPhone) {
    const phone = String(senderPhone || '').replace(/\D/g, '');
    if (!phone) return null;
    const today = localParts(clinic.timezone, now()).date;
    const client = await db();
    const { data, error } = await client.from('appointments')
      .select('*')
      .eq('clinic_id', clinic.id)
      .eq('sender_phone', phone)
      .in('status', ACTIVE_STATUSES)
      .gte('appointment_date', today)
      .order('appointment_date', { ascending: true })
      .order('appointment_time', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  }

  function receptionMessage(appointment, event) {
    const titles = {
      nueva: '🦷 Nueva solicitud de cita',
      reprogramada: '🔁 Cita reprogramada por el paciente',
      cancelada: '❌ Cita cancelada por el paciente',
    };
    const phone = String(appointment.sender_phone || '').replace(/\D/g, '');
    const lines = [
      `${titles[event] || titles.nueva} — ${clinic.name}`,
      `👤 ${appointment.patient_name || 'Sin nombre'}`,
      `📱 +${phone} (wa.me/${phone})`,
      `🩺 ${appointment.treatment || 'Evaluación'}`,
      `📅 ${slotLabel({ date: appointment.appointment_date, time: appointment.appointment_time })}`,
    ];
    const ad = appointment.ad_referral;
    if (ad && (ad.headline || ad.source_id)) lines.push(`📣 Anuncio: ${ad.headline || ad.source_id}`);
    if (event === 'nueva') lines.push('', 'Escríbele al paciente para confirmar la cita.');
    return lines.join('\n');
  }

  // Avisa a recepción por WhatsApp. Nunca lanza: si falla, deja el error en el log.
  async function notifyReception(appointment, { event = 'nueva' } = {}) {
    const to = getReceptionPhone();
    if (!to) {
      console.warn('[Appointments] RECEPTION_ALERT_PHONE no está definida; no se avisó a recepción.');
      return { sent: false, reason: 'missing_phone' };
    }
    try {
      await whatsapp.sendTextMessage(to, receptionMessage(appointment, event));
      return { sent: true };
    } catch (error) {
      console.error('[Appointments] No se pudo avisar a recepción:', error?.message || error);
      return { sent: false, reason: 'send_failed' };
    }
  }

  return {
    getAvailableSlots,
    findNextSlots,
    saveAppointment,
    updateStatus,
    reschedule,
    findUpcomingByPhone,
    notifyReception,
    durationFor,
  };
}

const appointmentService = createAppointmentService();
export default appointmentService;
