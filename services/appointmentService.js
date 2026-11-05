import { getSupabase as getDefaultClient } from './supabaseClient.js';
import activeClinic, { findTreatment, getReceptionPhone, isHoliday } from '../config/clinic.config.js';
import whatsappService from './whatsappService.js';
import { now as clockNow } from './clock.js';
import liveEvents from './liveEvents.js';
import { testMode } from './testContext.js';
import crypto from 'crypto';

// Agenda real con disponibilidad. Fechas y horas se guardan en la hora local de la clínica.

export const ACTIVE_STATUSES = ['pendiente', 'confirmada', 'reprogramada'];
export const STATUSES = [...ACTIVE_STATUSES, 'cancelada', 'asistio', 'no_asistio'];
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MIN_LEAD_MINUTES = Number(process.env.APPOINTMENT_MIN_LEAD_MINUTES || 60);
// Columnas de migrations/20260927_after_hours_metrics.sql (opcionales hasta que se ejecute).
const METRIC_COLUMNS = ['confirmed_at', 'rescheduled_at'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export class SlotTakenError extends Error {
  constructor(message = 'El horario ya está ocupado') {
    super(message);
    this.code = 'SLOT_TAKEN';
  }
}

// Horario fuera de la atención de la clínica (p. ej. "a las 11 p. m." o un domingo) o ya pasado.
// Hereda de SlotTakenError para que el flujo ofrezca horarios alternativos igual que con un choque.
export class OutsideHoursError extends SlotTakenError {
  constructor(message = 'El horario está fuera de la atención de la clínica') {
    super(message);
    this.code = 'OUTSIDE_HOURS';
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

// PostgREST responde PGRST204 cuando se envía una columna que la tabla no tiene.
export const isMissingColumn = (error, column) => error?.code === 'PGRST204' || (error?.code === '42703' && String(error?.message || '').includes(column));

const overlaps = (startA, durA, startB, durB) => startA < startB + durB && startB < startA + durA;

// Rangos de atención de una fecha (AAAA-MM-DD): los feriados y días cerrados no tienen ninguno.
export function rangesFor(clinic, date) {
  if (isHoliday(date, clinic)) return [];
  return clinic.workingHours[weekdayKey(date)] || [];
}

// ¿La clínica atiende en este instante? Se calcula con la zona horaria de la clínica.
export function isWithinWorkingHours(clinic, instant = clockNow()) {
  const { date, minutes } = localParts(clinic.timezone, instant);
  return rangesFor(clinic, date).some(([from, to]) => minutes >= toMinutes(from) && minutes < toMinutes(to));
}

const WEEKDAY_WORDS = {
  domingo: 'sun', lunes: 'mon', martes: 'tue', miercoles: 'wed', jueves: 'thu', viernes: 'fri', sabado: 'sat',
};

// Día que pide el paciente ("hoy", "mañana", "pasado mañana", "el sábado") → 'YYYY-MM-DD', o null.
export function parseRequestedDay(text, today) {
  const value = String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (/\bpasado manana\b/.test(value)) return addDays(today, 2);
  // "por la mañana" es un turno, no el día siguiente.
  if (/\bmanana\b/.test(value.replace(/\b(?:en|por|de) la manana\b/g, ''))) return addDays(today, 1);
  if (/\bhoy\b/.test(value)) return today;
  const word = Object.keys(WEEKDAY_WORDS).find((name) => new RegExp(`\\b${name}\\b`).test(value));
  if (!word) return null;
  for (let i = 0; i < 7; i += 1) {
    if (weekdayKey(addDays(today, i)) === WEEKDAY_WORDS[word]) return addDays(today, i);
  }
  return null;
}

// ---------- Reserva directa (bookingMode = "confirmacion_directa") ----------

// Un trabajo a la vez por clave (clínica y día) dentro de este proceso; propaga el resultado o el error.
function createKeyedLock() {
  const tails = new Map();
  return async function withLock(key, work) {
    const previous = tails.get(key) || Promise.resolve();
    let release;
    const mine = new Promise((resolve) => { release = resolve; });
    const tail = previous.then(() => mine);
    tails.set(key, tail);
    await previous;
    try {
      return await work();
    } finally {
      release();
      if (tails.get(key) === tail) tails.delete(key);
    }
  };
}
const reservationLock = createKeyedLock();

// Código corto de la cita: prefijo de la clínica + 4 dígitos (ej. DV-0472). Es lo único que lleva el QR.
export function appointmentCode(clinic, random = () => crypto.randomInt(0, 10000)) {
  const prefix = clinic.appointmentCodePrefix || String(clinic.id || 'CT').replace(/[^a-z]/gi, '').slice(0, 2).toUpperCase() || 'CT';
  return `${prefix}-${String(random()).padStart(4, '0')}`;
}

const isMissingFunction = (error) => error?.code === 'PGRST202' || error?.code === '42883'
  || /could not find the function/i.test(String(error?.message || ''));
const DIRECT_COLUMNS = ['code', 'specialist', 'confirmed_by', 'confirmed_at'];
const isCodeConflict = (error) => error?.code === '23505' && /code/i.test(String(error?.message || ''));

// ---------- Servicio ----------

export function createAppointmentService({
  getClient = getDefaultClient,
  clinic = activeClinic,
  whatsapp = whatsappService,
  now = clockNow,
  events = liveEvents,
} = {}) {
  async function db() {
    const client = await getClient();
    if (!client) throw new Error('Supabase no configurado (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY)');
    return client;
  }
  // La función reserve_appointment no existe (migración pendiente): no se vuelve a intentar en este proceso.
  let rpcMissing = false;

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
    const ranges = rangesFor(clinic, date);
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
    appointmentDate, appointmentTime, durationMin = null, notes = null, source = 'whatsapp', adReferral = null, isTest = false,
    direct = null,
  }) {
    const phone = String(senderPhone || '').replace(/\D/g, '');
    if (!phone) throw new Error('senderPhone es obligatorio');
    if (!DATE_RE.test(String(appointmentDate))) throw new Error(`appointmentDate inválida: ${appointmentDate}`);
    const time = String(appointmentTime || '').slice(0, 5);
    if (!TIME_RE.test(time)) throw new Error(`appointmentTime inválida: ${appointmentTime}`);
    const duration = durationMin || durationFor(treatment);

    if (!isBookable(appointmentDate, time, duration)) throw new OutsideHoursError();
    const existing = await listActiveOn(appointmentDate);
    if (hasConflict(existing, time, duration)) throw new SlotTakenError();

    const client = await db();
    const row = {
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
      // Solicitud hecha con la clínica cerrada (se mide en el reporte semanal).
      after_hours: !isWithinWorkingHours(clinic, now()),
      ...(isTest || testMode()?.isTest ? { is_test: true } : {}),
      // Confirmación directa: la cita nace confirmada por el bot, con su código y especialista.
      ...(direct ? {
        status: 'confirmada', code: direct.code, specialist: direct.specialist || null, confirmed_by: 'bot', confirmed_at: now().toISOString(),
      } : {}),
    };
    let { data, error } = await client.from('appointments').insert([row]).select().single();
    if (error && direct && DIRECT_COLUMNS.some((column) => isMissingColumn(error, column))) {
      // Sin migrations/20261105_direct_booking.sql no hay dónde guardar el código: queda como solicitud.
      console.warn('[Appointments] Falta la columna appointments.code; ejecuta migrations/20261105_direct_booking.sql (la cita queda como solicitud)');
      const { code: _c, specialist: _s, confirmed_by: _b, confirmed_at: _a, ...requestRow } = row;
      ({ data, error } = await client.from('appointments').insert([{ ...requestRow, status: 'pendiente' }]).select().single());
    }
    if (error && (isMissingColumn(error, 'after_hours') || isMissingColumn(error, 'is_test'))) {
      // La migración 20260927_after_hours_metrics.sql aún no se ejecutó: la cita se guarda igual.
      console.warn('[Appointments] Falta la columna appointments.after_hours; ejecuta migrations/20260927_after_hours_metrics.sql');
      const { after_hours: _omitted, is_test: _test, ...legacyRow } = row;
      ({ data, error } = await client.from('appointments').insert([legacyRow]).select().single());
    }
    if (error) {
      if (isCodeConflict(error)) throw Object.assign(new Error('Código de cita repetido'), { code: 'CODE_TAKEN' });
      if (error.code === '23505') throw new SlotTakenError();
      throw error;
    }
    events.publish('appointment', { event: 'nueva', phone, appointment: data });
    return data;
  }

  // Reserva y confirma un horario (bookingMode = "confirmacion_directa"). Atómico: un candado por clínica y día
  // en este proceso y, si existe, la función reserve_appointment de Postgres (candado + chequeo de solapamiento
  // en la misma transacción). Si dos pacientes eligen el mismo horario, gana el primero; el otro recibe
  // SlotTakenError y el bot le ofrece horarios nuevos. Si falta la migración, la cita queda como solicitud.
  async function reserveSlot({ specialist = null, ...request }) {
    const date = request.appointmentDate;
    const time = String(request.appointmentTime || '').slice(0, 5);
    return reservationLock(`${request.clinicId || clinic.id}:${date}`, async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const code = appointmentCode(clinic);
        try {
          const viaRpc = await reserveViaRpc({ ...request, appointmentTime: time, code, specialist });
          if (viaRpc) return viaRpc;
          return await saveAppointment({ ...request, appointmentTime: time, direct: { code, specialist } });
        } catch (error) {
          if (error?.code !== 'CODE_TAKEN') throw error;
        }
      }
      throw new Error('No se pudo generar un código de cita único');
    });
  }

  // null si la función no existe (migración pendiente) o el cliente no la soporta (modo demo y tests).
  async function reserveViaRpc({ senderPhone, patientName = null, treatment = null, appointmentDate, appointmentTime, source = 'whatsapp', adReferral = null, code, specialist }) {
    const client = await db();
    if (rpcMissing || typeof client.rpc !== 'function') return null;
    const duration = durationFor(treatment);
    if (!isBookable(appointmentDate, appointmentTime, duration)) throw new OutsideHoursError();
    const { data, error } = await client.rpc('reserve_appointment', {
      p_clinic_id: clinic.id, p_sender_phone: String(senderPhone || '').replace(/\D/g, ''), p_patient_name: patientName,
      p_treatment: treatment, p_date: appointmentDate, p_time: appointmentTime, p_duration: duration, p_source: source,
      p_ad_referral: adReferral, p_code: code, p_specialist: specialist, p_after_hours: !isWithinWorkingHours(clinic, now()),
      p_is_test: Boolean(testMode()?.isTest),
    });
    if (error) {
      if (isMissingFunction(error)) {
        console.warn('[Appointments] Falta la función reserve_appointment; ejecuta migrations/20261105_direct_booking.sql (se usa el candado del proceso)');
        rpcMissing = true;
        return null;
      }
      if (/SLOT_TAKEN/.test(String(error.message || ''))) throw new SlotTakenError();
      if (isCodeConflict(error)) throw Object.assign(new Error('Código de cita repetido'), { code: 'CODE_TAKEN' });
      if (error.code === '23505') throw new SlotTakenError();
      throw error;
    }
    const row = Array.isArray(data) ? data[0] : data;
    events.publish('appointment', { event: 'nueva', phone: row?.sender_phone, appointment: row });
    return row;
  }

  // Cita por id (para el pase de cita del panel).
  async function findById(id) {
    const client = await db();
    const { data, error } = await client.from('appointments').select('*').eq('id', id).eq('clinic_id', clinic.id).maybeSingle();
    if (error) throw error;
    return data || null;
  }

  // Dentro del horario de atención, sin pasarse del cierre y no en el pasado (con la anticipación mínima).
  function isBookable(date, time, duration) {
    const ranges = rangesFor(clinic, date);
    const start = toMinutes(time);
    const inRange = ranges.some(([from, to]) => start >= toMinutes(from) && start + duration <= toMinutes(to));
    if (!inRange) return false;
    const today = localParts(clinic.timezone, now());
    if (date < today.date) return false;
    return date > today.date || start >= today.minutes + MIN_LEAD_MINUTES;
  }

  async function updateStatus(id, status, changes = {}) {
    if (!STATUSES.includes(status)) throw new Error(`Estado inválido: ${status}`);
    const allowed = [
      'appointment_date', 'appointment_time', 'notes', 'reminder_24h_sent_at', 'reminder_2h_sent_at',
      ...METRIC_COLUMNS,
    ];
    const patch = { status };
    for (const key of allowed) if (changes[key] !== undefined) patch[key] = changes[key];
    const client = await db();
    const run = (values) => client.from('appointments')
      .update(values).eq('id', id).eq('clinic_id', clinic.id).select().single();
    let { data, error } = await run(patch);
    if (error && METRIC_COLUMNS.some((column) => column in patch && isMissingColumn(error, column))) {
      // Sin la migración de métricas el cambio de estado se guarda igual, sin la marca de tiempo.
      console.warn('[Appointments] Faltan columnas de métricas; ejecuta migrations/20260927_after_hours_metrics.sql');
      ({ data, error } = await run(Object.fromEntries(Object.entries(patch).filter(([key]) => !METRIC_COLUMNS.includes(key)))));
    }
    if (error) throw error;
    events.publish('appointment', { event: status, phone: String(data?.sender_phone || '').replace(/\D/g, ''), appointment: data });
    return data;
  }

  // Recepción (panel) o el paciente (respuesta al recordatorio) confirman la cita. Cuenta para la garantía.
  async function confirm(id) {
    return updateStatus(id, 'confirmada', { confirmed_at: now().toISOString() });
  }

  async function reschedule(id, { appointmentDate, appointmentTime, durationMin }) {
    const time = String(appointmentTime).slice(0, 5);
    if (!isBookable(appointmentDate, time, durationMin || clinic.slotMinutes)) throw new OutsideHoursError();
    const existing = await listActiveOn(appointmentDate, { excludeId: id });
    if (hasConflict(existing, time, durationMin || clinic.slotMinutes)) throw new SlotTakenError();
    try {
      // Nueva fecha → los recordatorios de la fecha anterior ya no cuentan.
      return await updateStatus(id, 'reprogramada', {
        appointment_date: appointmentDate, appointment_time: time, reminder_24h_sent_at: null, reminder_2h_sent_at: null,
        rescheduled_at: now().toISOString(),
      });
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

  function receptionMessage(appointment, event, summary = null) {
    const titles = {
      nueva: '🦷 Nueva solicitud de cita',
      reprogramada: '🔁 Cita reprogramada por el paciente',
      cancelada: '❌ Cita cancelada por el paciente',
      confirmada: '✅ El paciente confirmó su asistencia',
    };
    const phone = String(appointment.sender_phone || '').replace(/\D/g, '');
    const botConfirmed = event === 'nueva' && appointment.status === 'confirmada' && appointment.confirmed_by === 'bot';
    const title = botConfirmed ? `✅ Nueva cita CONFIRMADA por el asistente${appointment.code ? ` (${appointment.code})` : ''}` : titles[event] || titles.nueva;
    const lines = [
      `${title} — ${clinic.name}`,
      `👤 ${appointment.patient_name || 'Sin nombre'}`,
      `📱 +${phone} (wa.me/${phone})`,
      `🩺 ${appointment.treatment || 'Evaluación'}`,
      `📅 ${slotLabel({ date: appointment.appointment_date, time: appointment.appointment_time })}`,
    ];
    const ad = appointment.ad_referral;
    if (ad && (ad.headline || ad.source_id)) lines.push(`📣 Anuncio: ${ad.headline || ad.source_id}`);
    // Resumen de 2 líneas de la conversación (geminiService.conversationSummary), para escribirle con contexto.
    if (summary?.length) lines.push('', '💬 Resumen:', ...summary.slice(0, 2));
    if (appointment.specialist) lines.splice(5, 0, `👩‍⚕️ ${appointment.specialist}`);
    if (botConfirmed) lines.push('', 'Ya está en la Agenda del panel y el paciente recibió su pase de cita.');
    else if (event === 'nueva') lines.push('', 'Escríbele al paciente para confirmar la cita.');
    return lines.join('\n');
  }

  // Avisa a recepción por WhatsApp. Nunca lanza: si falla, deja el error en el log.
  async function notifyReception(appointment, { event = 'nueva', summary = null } = {}) {
    const to = getReceptionPhone();
    if (!to) {
      console.warn('[Appointments] RECEPTION_ALERT_PHONE no está definida; no se avisó a recepción.');
      return { sent: false, reason: 'missing_phone' };
    }
    try {
      await whatsapp.sendTextMessage(to, receptionMessage(appointment, event, summary));
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
    reserveSlot,
    findById,
    updateStatus,
    confirm,
    reschedule,
    findUpcomingByPhone,
    notifyReception,
    durationFor,
    isBookable,
  };
}

const appointmentService = createAppointmentService();
export default appointmentService;
