import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'assert';

// Fase 6 (agente top): panel "Mi clínica" sin tocar código: campos nuevos, catálogo con fotos de Storage,
// promociones con fecha de inicio, indicador de configuración completa, vista previa y deshacer el último cambio.

process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test';

const {
  default: clinic, BASE_CLINIC, EDITABLE_FIELDS, validateClinic, applyClinicOverrides, activePromotions, isMediaRef, mediaFileUrl,
} = await import('../config/clinic.config.js');
const { readiness } = await import('./clinicReadiness.js');
const { createClinicSettings } = await import('./clinicSettings.js');
const { createLiveEvents } = await import('./liveEvents.js');
const { fakeDb } = await import('./testing/fakeSupabase.js');
const { createMemoryDb } = await import('./demo/memoryDb.js');
const { useInMemorySupabase, getSupabase } = await import('./supabaseClient.js');
const { createApp } = await import('../app.js');

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]);
const FULL_ENV = {
  CLINIC_PHONE: '51987654321', RECEPTION_ALERT_PHONE: '51987654322', OWNER_ALERT_PHONE: '51987654323',
  WHATSAPP_TOKEN: 'x', WHATSAPP_PHONE_NUMBER_ID: '1', WHATSAPP_APP_SECRET: 'x', WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'x',
  ENFORCE_WHATSAPP_SIGNATURE: 'true', GEMINI_API_KEY: 'x', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'x',
  CRON_SECRET: 'x', PUBLIC_BASE_URL: 'https://bot.onrender.com',
};

afterEach(() => applyClinicOverrides({}));

function setup() {
  const db = fakeDb({ clinic_settings: [], clinic_settings_audit: [] });
  const uploads = [];
  db.storage = {
    async getBucket() { return { data: { name: 'clinic-media' }, error: null }; },
    from(bucket) {
      return {
        async upload(path, body) { uploads.push({ path, size: body.length }); return { data: { path }, error: null }; },
        getPublicUrl(path) { return { data: { publicUrl: `https://p.supabase.co/storage/v1/object/public/${bucket}/${path}` } }; },
      };
    },
  };
  let t = Date.parse('2026-11-05T15:00:00Z');
  const settings = createClinicSettings({ getClient: () => db, events: createLiveEvents({ bootId: 't' }), env: FULL_ENV, now: () => (t += 1000) });
  return { db, settings, uploads };
}

describe('Mi clínica: campos editables nuevos', () => {
  it('el dueño puede editar ubicación, duración de cita, prefijo, calificación, especialistas, pack y seguimiento', () => {
    for (const f of ['addressReference', 'latitude', 'longitude', 'slotMinutes', 'appointmentCodePrefix', 'googleRating', 'specialists', 'evaluationPack', 'followUps', 'reminders', 'bookingMode']) {
      assert.ok(EDITABLE_FIELDS.includes(f), f);
    }
    assert.deepEqual(applyClinicOverrides({ slotMinutes: 45, latitude: -12.1, longitude: -77.03, addressReference: 'Frente al parque' }), []);
    assert.equal(clinic.slotMinutes, 45);
    assert.match(applyClinicOverrides({ latitude: -12.1, longitude: null }).join(), /latitude/);
  });

  it('promociones con fecha de inicio y de fin: solo se mencionan dentro del rango', () => {
    const c = { promotions: [{ title: 'Navidad', validFrom: '2026-12-01', validUntil: '2026-12-31' }] };
    assert.equal(activePromotions('2026-11-30', c).length, 0);
    assert.equal(activePromotions('2026-12-15', c).length, 1);
    assert.equal(activePromotions('2027-01-01', c).length, 0);
    assert.match(validateClinic({ ...structuredClone(BASE_CLINIC), promotions: [{ title: 'X', validFrom: '2026-12-31', validUntil: '2026-12-01' }] }).join(), /inicio es posterior/);
  });

  it('imágenes del catálogo: archivo local, Storage (https) o foto del demo; nunca rutas con ".."', () => {
    assert.ok(isMediaRef('catalogo/a.png'));
    assert.ok(isMediaRef('https://p.supabase.co/storage/v1/object/public/clinic-media/denvari/a.webp'));
    assert.ok(isMediaRef('/demo-media/clinic-media/denvari/1-abc.png'));
    assert.equal(isMediaRef('/demo-media/../../.env'), false);
    assert.match(mediaFileUrl('/demo-media/clinic-media/denvari/1.png'), /^http.+\/demo-media\/clinic-media\/denvari\/1\.png$/);
  });
});

describe('Configuración completa: X de Y', () => {
  it('la demo sin variables dice exactamente qué falta para conectar pacientes reales', () => {
    const r = readiness(BASE_CLINIC, {});
    assert.equal(r.complete, false);
    assert.equal(r.total, r.items.length);
    const missing = r.missing.map((i) => i.id);
    for (const id of ['phones', 'whatsapp', 'signature', 'gemini', 'supabase', 'cron']) assert.ok(missing.includes(id), id);
    for (const id of ['name', 'address', 'logo', 'hours', 'treatments', 'payments', 'faq', 'pack']) assert.ok(!missing.includes(id), id);
  });

  it('con todo configurado queda completa; sin tratamientos con precio o sin FAQ, no', () => {
    assert.equal(readiness(BASE_CLINIC, FULL_ENV).complete, true);
    const empty = { ...structuredClone(BASE_CLINIC), faq: [], treatments: BASE_CLINIC.treatments.map((t) => ({ ...t, priceFrom: 0 })) };
    const missing = readiness(empty, FULL_ENV).missing.map((i) => i.id);
    assert.deepEqual(missing.sort(), ['faq', 'treatments']);
  });

  it('nunca muestra el valor de una variable, solo si existe', () => {
    assert.doesNotMatch(JSON.stringify(readiness(BASE_CLINIC, FULL_ENV)), /51987654321|p\.supabase|bot\.onrender/);
  });
});

describe('guardar, validar y deshacer', () => {
  it('si falta algo obligatorio no se guarda y dice qué falta', async () => {
    const { settings } = setup();
    await assert.rejects(settings.save({ treatments: [] }, 'dueño'), (error) => error.status === 400 && error.errors.some((e) => /treatments/.test(e)));
  });

  it('guarda un tratamiento con imágenes del catálogo subidas a Storage', async () => {
    const { settings, uploads } = setup();
    const { url } = await settings.uploadPhoto({ buffer: PNG, contentType: 'image/png' });
    assert.equal(uploads.length, 1);
    const treatments = structuredClone(BASE_CLINIC.treatments);
    treatments[0].images = [{ file: url, caption: 'Antes y después (ilustración)' }];
    await settings.save({ treatments }, 'dueño');
    assert.equal(clinic.treatments[0].images[0].file, url);
  });

  it('rechaza archivos que no son imágenes por sus bytes, aunque digan image/png', async () => {
    const { settings } = setup();
    await assert.rejects(settings.uploadPhoto({ buffer: Buffer.from('<svg onload=alert(1)>aaaaaaaaaaaa'), contentType: 'image/png' }), (e) => e.status === 415);
    await assert.rejects(settings.uploadPhoto({ buffer: Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]), contentType: 'image/png' }), (e) => e.status === 413);
  });

  it('deshacer el último cambio vuelve a los valores anteriores y queda en el historial', async () => {
    const { db, settings } = setup();
    await settings.save({ botName: 'Sofía' }, 'dueño');
    await settings.save({ botName: 'Lucía', slotMinutes: 45 }, 'dueño');
    assert.equal(clinic.botName, 'Lucía');
    await settings.undoLast('dueño');
    assert.equal(clinic.botName, 'Sofía');
    assert.equal(clinic.slotMinutes, BASE_CLINIC.slotMinutes);
    assert.ok(db.data.clinic_settings_audit.some((r) => r.action === 'deshacer'));
  });

  it('sin cambios guardados no hay nada que deshacer', async () => {
    const { settings } = setup();
    await assert.rejects(settings.undoLast('dueño'), (e) => e.status === 400);
  });

  it('la respuesta del panel incluye el indicador de configuración', () => {
    const { settings } = setup();
    const snap = settings.snapshot();
    assert.equal(typeof snap.readiness.done, 'number');
    assert.equal(snap.readiness.complete, true);
  });
});

describe('API del panel: vista previa y deshacer', () => {
  let server;
  let base;
  const saved = { ...process.env };
  const owner = { Authorization: `Basic ${Buffer.from('dueno:clave-de-prueba-123').toString('base64')}`, 'Content-Type': 'application/json' };
  const reception = { Authorization: `Basic ${Buffer.from('recep:clave-recepcion-123').toString('base64')}`, 'Content-Type': 'application/json' };
  before(async () => {
    Object.assign(process.env, { PANEL_OWNER_USER: 'dueno', PANEL_OWNER_PASSWORD: 'clave-de-prueba-123', PANEL_USER: 'recep', PANEL_PASSWORD: 'clave-recepcion-123' });
    useInMemorySupabase(createMemoryDb({ clinic_settings: [], clinic_settings_audit: [] }));
    const app = createApp({ getSupabase });
    server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
    base = `http://127.0.0.1:${server.address().port}/api/panel`;
  });
  after(() => {
    server.close();
    useInMemorySupabase(null);
    for (const key of ['PANEL_OWNER_USER', 'PANEL_OWNER_PASSWORD', 'PANEL_USER', 'PANEL_PASSWORD']) {
      if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
    }
  });

  it('vista previa de la tarjeta del pack con lo escrito (sin guardar) y del pase de ejemplo', async () => {
    const draft = { evaluationPack: { title: 'Evaluación express', includes: ['Revisión'], price: 30 } };
    const pack = await fetch(`${base}/settings/preview`, { method: 'POST', headers: owner, body: JSON.stringify({ kind: 'pack', draft }) });
    assert.equal(pack.status, 200);
    assert.equal(pack.headers.get('content-type'), 'image/png');
    const pass = await fetch(`${base}/settings/preview`, { method: 'POST', headers: owner, body: JSON.stringify({ kind: 'pass', draft: {} }) });
    assert.equal(pass.status, 200);
    const incomplete = await fetch(`${base}/settings/preview`, { method: 'POST', headers: owner, body: JSON.stringify({ kind: 'pack', draft: { evaluationPack: null } }) });
    assert.equal(incomplete.status, 404);
    assert.equal(clinic.evaluationPack.title, BASE_CLINIC.evaluationPack.title, 'la vista previa no guarda nada');
  });

  it('solo el dueño puede usar Mi clínica', async () => {
    const res = await fetch(`${base}/settings/preview`, { method: 'POST', headers: reception, body: JSON.stringify({ kind: 'pack' }) });
    assert.equal(res.status, 403);
    assert.equal((await fetch(`${base}/settings/undo`, { method: 'POST', headers: reception, body: '{}' })).status, 403);
  });

  it('deshacer por la API', async () => {
    await fetch(`${base}/settings`, { method: 'PUT', headers: owner, body: JSON.stringify({ changes: { botName: 'Valeria' } }) });
    assert.equal(clinic.botName, 'Valeria');
    const res = await fetch(`${base}/settings/undo`, { method: 'POST', headers: owner, body: '{}' });
    assert.equal(res.status, 200);
    assert.equal(clinic.botName, BASE_CLINIC.botName);
  });
});
