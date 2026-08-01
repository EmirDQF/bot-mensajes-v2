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

// saveLead: uses Supabase. Dedup within last 24 hours by telefono (normalized). Returns { isNew, readyToNotify, lead }
export async function saveLead({ telefono, nombre, distrito, fechaHoraISO, fechaHoraTexto, fechaHoraConfirmada } = {}) {
  const client = getSupabaseClient();
  try {
    if (!telefono) throw Object.assign(new Error('telefono is required to save a lead'), { status: 400, expose: true });
    const normalized = normalizePhone(telefono);
    const now = new Date().toISOString();
    const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

    // Look for existing within 24 hours
    const { data: existingData, error: existingErr } = await client.from('leads')
      .select('*')
      .eq('telefono', normalized)
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false })
      .limit(1);
    if (existingErr) throw existingErr;

    if (Array.isArray(existingData) && existingData.length) {
      const existing = existingData[0];
      const wasReady = Boolean(existing.ready_to_notify);
      const wasNotified = !!existing.notified_at;

      const updates = {
        nombre: nombre || existing.nombre,
        distrito: distrito || existing.distrito,
        fecha_hora_texto: fechaHoraTexto ?? existing.fecha_hora_texto,
        fecha_hora_iso: fechaHoraISO ?? existing.fecha_hora_iso,
        // we'll set ready_to_notify in DB to real value; but return readyToNotify only if transitioning and not yet notified
        ready_to_notify: Boolean((nombre || existing.nombre) && (distrito || existing.distrito) && (fechaHoraISO || fechaHoraTexto || existing.fecha_hora_texto)),
        updated_at: now,
      };
      const updateRes = await client.from('leads').update(updates).eq('id', existing.id).select('*').limit(1);
      const updatedRows = updateRes && updateRes.data ? updateRes.data : (Array.isArray(updateRes) ? updateRes : null);
      const updateErr = updateRes && updateRes.error ? updateRes.error : null;
      if (updateErr) throw updateErr;
      const lead = Array.isArray(updatedRows) && updatedRows.length ? updatedRows[0] : existing;

      // Compute whether this save should signal readyToNotify to caller
      const nowReady = Boolean(lead.ready_to_notify);
      const shouldNotify = nowReady && !wasReady && !wasNotified;

      return { isNew: false, readyToNotify: !!shouldNotify, lead };
    }

    // Insert new
    const newRow = {
      nombre: nombre || null,
      telefono: normalized,
      distrito: distrito || null,
      fecha_hora_texto: fechaHoraTexto || null,
      fecha_hora_iso: fechaHoraISO || null,
      ready_to_notify: Boolean(nombre && distrito && (fechaHoraISO || fechaHoraTexto)),
      created_at: now,
      updated_at: now,
      notified_at: null,
    };

    const { data: inserted, error: insertErr } = await client.from('leads').insert([newRow]).select('*').limit(1);
    if (insertErr) throw insertErr;
    const lead = Array.isArray(inserted) && inserted.length ? inserted[0] : newRow;

    // For inserts, readyToNotify is true only if ready_to_notify and not notified (new rows have notified_at null)
    return { isNew: true, readyToNotify: !!lead.ready_to_notify, lead };
  } catch (error) {
    console.error('leadService.saveLead error:', error && error.message ? error.message : error);
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
