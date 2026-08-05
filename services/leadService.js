import { createClient } from '@supabase/supabase-js';
import config from '../config/env.js';

// Supabase-backed lead service. For tests, call initSupabaseClient(mockClient) to inject a mock.
let supabase = null;
export function initSupabaseClient(client) {
  supabase = client;
}

function normalizeSupabaseUrl(url) {
  if (!url || typeof url !== 'string') return url;
  return url.replace(/\/rest\/v1\/?$/i, '').replace(/\/$/, '');
}

function getSupabaseClient() {
  if (supabase) return supabase;
  const rawUrl = config.supabase?.url || process.env.SUPABASE_URL;
  const key = config.supabase?.serviceRoleKey || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE;
  const url = normalizeSupabaseUrl(rawUrl);
  if (!url || !key) throw new Error('Supabase not configured (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required)');
  supabase = createClient(url, key);
  return supabase;
}

// Normalize phone to plain Peruvian digits (9 digits) or E.164-like +51... depending on input
function normalizePhone(telefono) {
  if (!telefono && telefono !== 0) return null;
  const raw = telefono.toString().trim();
  const onlyDigits = raw.replace(/\D/g, '');
  if (onlyDigits.length === 9) return onlyDigits; // local 9-digit
  if (onlyDigits.length === 11 && onlyDigits.startsWith('51')) return onlyDigits.slice(2);
  if (onlyDigits.length === 12 && onlyDigits.startsWith('+51')) return onlyDigits.replace('+51', '').replace(/\D/g, '');
  return onlyDigits || null;
}

function isLikelyDistrict(text) {
  if (!text || typeof text !== 'string') return false;
  const t = text.toLowerCase().trim();
  // reject lines that look like a question or a system prompt
  if (/\?|¿|\b(qué|cual|cuál|por favor|porfavor|por favor|dónde|donde)\b/i.test(t)) return false;
  if (/^\s*(?:de|del)\s+/i.test(t)) return true;
  if (/\b(?:soy de|vivo en|nací en|naci en)\b/i.test(t)) return true;
  if (/\bdistrit[oó]\b/i.test(t)) return true;
  if (/\b(?:los|san|santa|villa|sur|norte)\b\s+[a-záéíóúñü]+/i.test(t)) return true;
  // accept typical district names (single word or two words with letters and spaces)
  if (/^[a-záéíóúñü\s]{3,40}$/i.test(t)) return true;
  return false;
}

function isValidNormalizedPhone(normalized) {
  return Boolean(normalized && /^\d{9}$/.test(String(normalized)));
}

function isValidNameForNotify(name) {
  if (!name || typeof name !== 'string') return false;
  const n = name.trim();
  if (n.length < 2) return false;
  if (/^camila\b/i.test(n)) return false; // avoid assistant name
  if (/\b(qué|cuál|cuando|a este número|dónde|donde)\b/i.test(n)) return false;
  return true;
}

function isValidISODateString(s) {
  if (!s || typeof s !== 'string') return false;
  const d = new Date(s);
  return !Number.isNaN(d.getTime());
}

// validateLead: throws Error with descriptive message when required fields missing in strict mode
export function validateLead({ telefono, nombre, distrito, fechaHoraISO, fechaHoraTexto } = {}, options = { strict: false }) {
  if (!telefono) throw Object.assign(new Error('telefono is required'), { status: 400, expose: true });
  if (options.strict) {
    if (!nombre) throw Object.assign(new Error('nombre is required'), { status: 400, expose: true });
    if (!distrito) throw Object.assign(new Error('distrito is required'), { status: 400, expose: true });
    if (!fechaHoraISO && !fechaHoraTexto) throw Object.assign(new Error('fechaHora (ISO or texto) is required'), { status: 400, expose: true });
  }
  return true;
}

export async function getByPhone(phone) {
  const client = getSupabaseClient();
  const normalized = normalizePhone(phone);
  try {
    if (normalized) {
      const { data, error } = await client.from('leads').select('*').eq('telefono', normalized).order('created_at', { ascending: false }).limit(1);
      if (error) throw error;
      if (Array.isArray(data) && data.length) return data[0];
    }
    return null;
  } catch (e) {
    console.error('leadService.getByPhone error', e && e.message ? e.message : e);
    throw e;
  }
}

export async function listLeads() {
  const client = getSupabaseClient();
  const { data, error } = await client.from('leads').select('*').order('created_at', { ascending: true });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function saveLead({ telefono, nombre, distrito, fechaHoraISO, fechaHoraTexto } = {}) {
  const client = getSupabaseClient();
  try {
    if (!telefono && telefono !== 0) {
      throw Object.assign(new Error('telefono is required to save a lead'), { status: 400, expose: true });
    }

    const normalized = normalizePhone(telefono);
    const now = new Date().toISOString();

    // 1. Intentar obtener si el lead ya existe y si ya fue notificado previamente
    let existingData = null;
    try {
      const baseQuery = client.from('leads').select('id, ready_to_notify, notified_at, nombre, distrito, fecha_hora_texto, fecha_hora_iso').eq('telefono', normalized);
      if (typeof baseQuery.maybeSingle === 'function') {
        const { data } = await baseQuery.maybeSingle();
        existingData = data || null;
      } else {
        // older mock clients may not support maybeSingle
        const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
        const { data } = await client.from('leads')
          .select('id, ready_to_notify, notified_at, nombre, distrito, fecha_hora_texto, fecha_hora_iso')
          .eq('telefono', normalized)
          .gte('created_at', cutoff)
          .order('created_at', { ascending: false })
          .limit(1);
        existingData = Array.isArray(data) && data.length ? data[0] : null;
      }
    } catch (e) {
      // If query shape is unexpected for mock, fallback to null and continue
      console.warn('leadService.saveLead: could not read existing lead with maybeSingle/fallback:', e && e.message ? e.message : e);
      existingData = null;
    }

    const wasReady = Boolean(existingData?.ready_to_notify);
    const wasNotified = Boolean(existingData?.notified_at);

    // 2. Construir el payload manteniendo datos previos si los nuevos vienen nulos
    // Preserve valid existing fields: do not overwrite nombre with a value that looks like a distrito
    const incomingNombre = typeof nombre === 'string' ? nombre.trim() : null;
    const incomingDistrito = typeof distrito === 'string' ? distrito.trim() : null;

    const finalNombre = (function() {
      if (incomingNombre && !isLikelyDistrict(incomingNombre) && incomingNombre.length > 1) return incomingNombre;
      if (existingData?.nombre && !isLikelyDistrict(existingData.nombre)) return existingData.nombre;
      return incomingNombre || null;
    })();

    const finalDistrito = (function() {
      if (incomingDistrito) return incomingDistrito;
      if (existingData?.distrito) return existingData.distrito;
      return null;
    })();

    const payload = {
      telefono: normalized,
      nombre: finalNombre,
      distrito: finalDistrito,
      fecha_hora_texto: fechaHoraTexto ?? existingData?.fecha_hora_texto ?? null,
      fecha_hora_iso: fechaHoraISO ?? existingData?.fecha_hora_iso ?? null,
      updated_at: now,
    };

    // Calcular estado ready_to_notify solo cuando ya contamos con una fecha/hora ISO válida y datos validados.
    const isNowReady = Boolean(
      payload.nombre && isValidNameForNotify(payload.nombre) &&
      payload.distrito && isLikelyDistrict(payload.distrito) &&
      payload.fecha_hora_iso && isValidISODateString(payload.fecha_hora_iso) &&
      isValidNormalizedPhone(normalized)
    );

    payload.ready_to_notify = isNowReady;

    // 3. Ejecutar UPSERT atómico en Supabase para evitar Race Conditions (si está disponible)
    let updatedLead = null;
    if (typeof client.from === 'function') {
      try {
        const testQuery = client.from('leads');
        if (testQuery && typeof testQuery.upsert === 'function') {
          const { data: upserted, error: upsertErr } = await client
            .from('leads')
            .upsert(payload, { onConflict: 'telefono' })
            .select('*')
            .single();
          if (upsertErr) throw upsertErr;
          updatedLead = upserted;
        } else {
          // Fallback for mocks that don't implement upsert(): update if existing, else insert
          if (existingData && existingData.id) {
            const { data: updatedRows, error: updateErr } = await client.from('leads').update(payload).eq('id', existingData.id).select('*').limit(1);
            if (updateErr) throw updateErr;
            updatedLead = Array.isArray(updatedRows) && updatedRows.length ? updatedRows[0] : updatedRows;
          } else {
            const newRow = Object.assign({ created_at: now, notified_at: null }, payload);
            const { data: inserted, error: insertErr } = await client.from('leads').insert([newRow]).select('*').limit(1);
            if (insertErr) throw insertErr;
            updatedLead = Array.isArray(inserted) && inserted.length ? inserted[0] : inserted;
          }
        }
      } catch (e) {
        throw e;
      }
    } else {
      throw new Error('Supabase client shape unexpected');
    }

    // 4. Evaluar si se debe disparar la notificación al administrador
    const shouldNotify = isNowReady && !wasReady && !wasNotified;

    return {
      isNew: !existingData,
      readyToNotify: shouldNotify,
      lead: updatedLead
    };

  } catch (error) {
    console.error('leadService.saveLead error:', error?.message || error);
    throw error;
  }
}

export async function markAsNotified(leadId) {
  const client = getSupabaseClient();
  try {
    const { data, error } = await client.from('leads').update({ notified_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', leadId).select('*').limit(1);
    if (error) throw error;
    return Array.isArray(data) && data.length ? data[0] : null;
  } catch (e) {
    console.error('leadService.markAsNotified error', e && e.message ? e.message : e);
    throw e;
  }
}

export default {
  saveLead,
  getByPhone,
  listLeads,
  validateLead,
  initSupabaseClient,
  _internals: { normalizePhone },
};
