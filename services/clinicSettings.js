import crypto from 'crypto';
import clinic, {
  ACTIVE_CLINIC_ID, BASE_CLINIC, EDITABLE_FIELDS, applyClinicOverrides, mergeClinic, pickEditable, validateClinic,
} from '../config/clinic.config.js';
import { getSupabase } from './supabaseClient.js';
import liveEvents from './liveEvents.js';

// Configuración editable por el dueño desde el panel. La base es config/clinics/<id>.js; en Supabase
// (clinic_settings) se guardan solo los cambios, que pasan por el MISMO validador de la clínica.
// Caché en memoria: se recarga al guardar y, como mucho, cada 5 min cuando llega tráfico (sin temporizadores).
// Si Supabase falla o los cambios guardados no son válidos, el bot sigue con la base y lo deja en el log.

export const MEDIA_BUCKET = 'clinic-media';
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const TTL_MS = 5 * 60 * 1000;
const PHOTO_TYPES = {
  'image/jpeg': { ext: 'jpg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/png': { ext: 'png', magic: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/webp': { ext: 'webp', magic: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
};

const httpError = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// Tipo real del archivo según sus primeros bytes (no se confía en la extensión ni en el encabezado).
export function detectImageType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  return Object.entries(PHOTO_TYPES).find(([, t]) => t.magic(buffer))?.[0] || null;
}

// Teléfonos de solo lectura para el panel: "+51 9•• ••• 678".
export function maskPhone(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (!d) return null;
  return `+${d.slice(0, d.length - 9)} ${d.slice(-9, -8)}•• ••• ${d.slice(-3)}`.trim();
}

export function createClinicSettings({
  getClient = getSupabase, events = liveEvents, now = () => Date.now(), clinicId = ACTIVE_CLINIC_ID,
  apply = applyClinicOverrides, env = process.env,
} = {}) {
  let overrides = {};
  let meta = { updatedAt: null, updatedBy: null, source: 'base' };
  let loadedAt = 0;
  let loading = null;
  let bucketReady = false;
  let warned = false;

  async function load() {
    loadedAt = now();
    try {
      const client = await getClient();
      if (!client) return snapshot();
      const { data, error } = await client.from('clinic_settings').select('data, updated_at, updated_by')
        .eq('clinic_id', clinicId).maybeSingle();
      if (error) throw error;
      const saved = pickEditable(data?.data || {});
      const errors = apply(saved);
      if (errors.length) {
        console.error('[Config] Los cambios guardados en Supabase no son válidos; se usa la configuración base:', errors.join(' | '));
        apply({});
        overrides = {};
        meta = { updatedAt: data?.updated_at || null, updatedBy: data?.updated_by || null, source: 'base', invalid: errors };
      } else {
        overrides = saved;
        meta = { updatedAt: data?.updated_at || null, updatedBy: data?.updated_by || null, source: Object.keys(saved).length ? 'panel' : 'base' };
      }
      warned = false;
    } catch (error) {
      if (!warned) console.warn('[Config] No se pudo leer clinic_settings; se usa la configuración base (¿falta migrations/20260929_clinic_settings.sql?):', error?.message || error);
      warned = true;
    }
    return snapshot();
  }

  async function ensureFresh() {
    if (now() - loadedAt < TTL_MS) return;
    loading ||= load().finally(() => { loading = null; });
    await loading;
  }

  function snapshot() {
    return {
      base: BASE_CLINIC,
      overrides,
      effective: clinic,
      editable: EDITABLE_FIELDS,
      meta,
      phones: {
        CLINIC_PHONE: maskPhone(env.CLINIC_PHONE),
        RECEPTION_ALERT_PHONE: maskPhone(env.RECEPTION_ALERT_PHONE),
        OWNER_ALERT_PHONE: maskPhone(env.OWNER_ALERT_PHONE),
      },
    };
  }

  async function db() {
    const client = await getClient();
    if (!client) throw httpError(503, 'Supabase no está configurado: no se pueden guardar cambios.');
    return client;
  }

  async function persist(next, by, fields, before) {
    const client = await db();
    const at = new Date(now()).toISOString();
    const { error } = await client.from('clinic_settings')
      .upsert({ clinic_id: clinicId, data: next, updated_at: at, updated_by: by }, { onConflict: 'clinic_id' });
    if (error) throw httpError(503, `No se pudo guardar la configuración (${error.message || error.code}). ¿Ejecutaste migrations/20260929_clinic_settings.sql?`);
    const after = mergeClinic(BASE_CLINIC, next);
    const rows = fields.map((field) => ({ clinic_id: clinicId, changed_by: by, field, before: before[field] ?? null, after: after[field] ?? null, changed_at: at }));
    const { error: auditError } = await client.from('clinic_settings_audit').insert(rows);
    if (auditError) throw httpError(503, `El cambio no se aplicó: no se pudo registrar la auditoría (${auditError.message || auditError.code}).`);
    return at;
  }

  // Guarda cambios de uno o varios campos. Lo que queda igual a la base deja de ser un cambio.
  async function save(patch, by) {
    const changes = pickEditable(patch);
    const fields = Object.keys(changes);
    if (!fields.length) throw httpError(400, 'No hay cambios que guardar.');
    const next = { ...overrides };
    for (const field of fields) {
      const value = mergeClinic(BASE_CLINIC, { [field]: changes[field] })[field];
      if (same(value, BASE_CLINIC[field])) delete next[field];
      else next[field] = changes[field];
    }
    const after = mergeClinic(BASE_CLINIC, next);
    const errors = validateClinic(after);
    if (errors.length) throw httpError(400, 'Hay datos por corregir.', { errors });
    // Solo se registra (y se audita) lo que de verdad cambió.
    const changed = fields.filter((field) => !same(clinic[field], after[field]));
    if (!changed.length) return snapshot();
    const before = structuredClone(clinic);
    const at = await persist(next, by, changed, before);
    apply(next);
    overrides = next;
    meta = { updatedAt: at, updatedBy: by, source: Object.keys(next).length ? 'panel' : 'base' };
    loadedAt = now();
    events.publish('settings', { fields: changed, by });
    return snapshot();
  }

  // Restaurar valores base: de algunos campos o de todo.
  async function reset(fields, by) {
    const toReset = fields === 'all'
      ? Object.keys(overrides)
      : (Array.isArray(fields) ? fields : []).filter((f) => EDITABLE_FIELDS.includes(f));
    if (!toReset.length) return snapshot();
    const next = Object.fromEntries(Object.entries(overrides).filter(([key]) => !toReset.includes(key)));
    const before = structuredClone(clinic);
    const at = await persist(next, by, toReset, before);
    apply(next);
    overrides = next;
    meta = { updatedAt: at, updatedBy: by, source: Object.keys(next).length ? 'panel' : 'base' };
    events.publish('settings', { fields: toReset, by, reset: true });
    return snapshot();
  }

  async function auditLog(limit = 50) {
    const client = await db();
    const { data, error } = await client.from('clinic_settings_audit').select('*')
      .eq('clinic_id', clinicId).order('changed_at', { ascending: false }).limit(limit);
    if (error) throw httpError(503, `No se pudo leer el historial (${error.message || error.code}).`);
    return data || [];
  }

  async function ensureBucket(client) {
    if (bucketReady) return;
    const { data, error } = await client.storage.getBucket(MEDIA_BUCKET);
    if (!data || error) {
      const { error: createError } = await client.storage.createBucket(MEDIA_BUCKET, {
        public: true, fileSizeLimit: MAX_PHOTO_BYTES, allowedMimeTypes: Object.keys(PHOTO_TYPES),
      });
      if (createError && !/exist/i.test(createError.message || '')) throw httpError(503, `No se pudo crear el bucket ${MEDIA_BUCKET}: ${createError.message}`);
    }
    bucketReady = true;
  }

  // Sube una foto a clinic-media/<clinic_id>/ y devuelve su URL pública (Meta la descarga para enviarla).
  async function uploadPhoto({ buffer, contentType }) {
    if (!Buffer.isBuffer(buffer) || !buffer.length) throw httpError(400, 'No llegó ninguna imagen.');
    if (buffer.length > MAX_PHOTO_BYTES) throw httpError(413, 'La foto pesa más de 2 MB. Redúcela e intenta de nuevo.');
    const detected = detectImageType(buffer);
    if (!detected) throw httpError(415, 'Solo se aceptan fotos JPG, PNG o WEBP.');
    if (contentType && contentType.split(';')[0] !== detected) throw httpError(415, 'El archivo no coincide con su tipo declarado.');
    const client = await db();
    await ensureBucket(client);
    const path = `${clinicId}/${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${PHOTO_TYPES[detected].ext}`;
    const { error } = await client.storage.from(MEDIA_BUCKET).upload(path, buffer, { contentType: detected, upsert: false, cacheControl: '31536000' });
    if (error) throw httpError(502, `No se pudo subir la foto: ${error.message}`);
    const { data } = client.storage.from(MEDIA_BUCKET).getPublicUrl(path);
    return { url: data.publicUrl, path, contentType: detected };
  }

  return { load, ensureFresh, snapshot, save, reset, auditLog, uploadPhoto };
}

const clinicSettings = createClinicSettings();
export default clinicSettings;
