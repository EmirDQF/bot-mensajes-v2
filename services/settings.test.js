import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'assert';

process.env.NODE_ENV = 'test';

const clinicConfig = await import('../config/clinic.config.js');
const { default: clinic, BASE_CLINIC, mergeClinic, applyClinicOverrides, activePromotions, mediaUrl } = clinicConfig;
const { createClinicSettings, detectImageType, maskPhone, MEDIA_BUCKET } = await import('./clinicSettings.js');
const { createLiveEvents } = await import('./liveEvents.js');
const { buildSystemPrompt, removeForbiddenPhrases } = await import('./geminiService.js');
const { fakeDb } = await import('./testing/fakeSupabase.js');

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(40)]);

function fakeStorage() {
  const state = { buckets: new Set(), uploads: [], created: 0 };
  return {
    state,
    async getBucket(name) { return state.buckets.has(name) ? { data: { name }, error: null } : { data: null, error: { message: 'Bucket not found' } }; },
    async createBucket(name, options) { state.created += 1; state.buckets.add(name); state.options = options; return { data: { name }, error: null }; },
    from(bucket) {
      return {
        async upload(path, body, options) { state.uploads.push({ bucket, path, size: body.length, options }); return { data: { path }, error: null }; },
        getPublicUrl(path) { return { data: { publicUrl: `https://proyecto.supabase.co/storage/v1/object/public/${bucket}/${path}` } }; },
      };
    },
  };
}

function setup() {
  const db = fakeDb({ clinic_settings: [], clinic_settings_audit: [] });
  db.storage = fakeStorage();
  const events = createLiveEvents({ bootId: 't' });
  const published = [];
  events.subscribe((e) => published.push(e));
  const settings = createClinicSettings({ getClient: () => db, events, env: { CLINIC_PHONE: '51987654321' } });
  return { db, settings, published };
}

afterEach(() => applyClinicOverrides({}));

describe('configuración: base + cambios', () => {
  it('merges overrides over the clinic file without touching the base', () => {
    const merged = mergeClinic(BASE_CLINIC, { botName: 'Sofía', media: { logo: 'https://x.supabase.co/a.png' }, workingHours: { sun: [['09:00', '12:00']] }, id: 'otra' });
    assert.equal(merged.botName, 'Sofía');
    assert.equal(merged.media.logo, 'https://x.supabase.co/a.png');
    assert.equal(merged.media.fachada, BASE_CLINIC.media.fachada, 'las demás fotos se conservan');
    assert.deepEqual(merged.workingHours.mon, BASE_CLINIC.workingHours.mon);
    assert.deepEqual(merged.workingHours.sun, [['09:00', '12:00']]);
    assert.equal(merged.id, BASE_CLINIC.id, 'el id no es editable');
    assert.ok(Object.isFrozen(BASE_CLINIC));
  });

  it('the clinic name is editable (personalized demo per prospect) but never empty', () => {
    assert.deepEqual(applyClinicOverrides({ name: 'Clínica Sonrisa Prueba' }), []);
    assert.equal(clinic.name, 'Clínica Sonrisa Prueba');
    assert.ok(applyClinicOverrides({ name: '  ' }).some((e) => /name/.test(e)));
    assert.equal(clinic.name, 'Clínica Sonrisa Prueba', 'un cambio inválido no se aplica');
  });

  it('uses the same validator: invalid changes are rejected and nothing is applied', async () => {
    const { settings, db } = setup();
    await assert.rejects(settings.save({ tone: 'grosero', mapsUrl: 'no-es-un-enlace' }, 'dueno'), (error) => {
      assert.equal(error.status, 400);
      assert.ok(error.errors.some((e) => /tone/.test(e)));
      assert.ok(error.errors.some((e) => /mapsUrl/.test(e)));
      return true;
    });
    assert.equal(clinic.tone, BASE_CLINIC.tone);
    assert.equal(db.data.clinic_settings.length, 0);
    const broken = structuredClone(BASE_CLINIC.treatments);
    broken[0].priceFrom = 'mucho';
    assert.ok(applyClinicOverrides({ treatments: broken }).length > 0);
  });

  it('saves, audits who changed what, applies live and restores the base', async () => {
    const { settings, db, published } = setup();
    const treatments = structuredClone(BASE_CLINIC.treatments);
    treatments[0].priceFrom = 1500;
    await settings.save({ treatments, botName: 'Sofía' }, 'dueno');
    assert.equal(clinic.botName, 'Sofía');
    assert.equal(clinic.treatments[0].priceFrom, 1500);
    assert.match(buildSystemPrompt(), /desde S\/ 1,?500/, 'el precio editado llega al prompt');
    assert.deepEqual(db.data.clinic_settings_audit.map((r) => [r.field, r.changed_by]), [['treatments', 'dueno'], ['botName', 'dueno']]);
    assert.equal(db.data.clinic_settings_audit[1].before, BASE_CLINIC.botName);
    assert.equal(db.data.clinic_settings_audit[1].after, 'Sofía');
    assert.ok(published.some((e) => e.type === 'settings'));

    await settings.reset(['botName'], 'dueno');
    assert.equal(clinic.botName, BASE_CLINIC.botName);
    assert.equal(clinic.treatments[0].priceFrom, 1500, 'lo demás sigue cambiado');
    await settings.reset('all', 'dueno');
    assert.equal(clinic.treatments[0].priceFrom, BASE_CLINIC.treatments[0].priceFrom);
    assert.deepEqual(db.data.clinic_settings[0].data, {});
  });

  it('a value equal to the base is not stored as a change', async () => {
    const { settings } = setup();
    const snap = await settings.save({ botName: BASE_CLINIC.botName }, 'dueno');
    assert.deepEqual(snap.overrides, {});
  });

  it('falls back to the base when Supabase fails or the stored changes are invalid', async () => {
    const failing = createClinicSettings({ getClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ error: { message: 'down' } }) }) }) }) }) });
    await failing.load();
    assert.equal(clinic.botName, BASE_CLINIC.botName);
    const db = fakeDb({ clinic_settings: [{ clinic_id: BASE_CLINIC.id, data: { tone: 'raro' } }] });
    const invalid = createClinicSettings({ getClient: () => db });
    const snap = await invalid.load();
    assert.equal(snap.meta.source, 'base');
    assert.ok(snap.meta.invalid.length);
    assert.equal(clinic.tone, BASE_CLINIC.tone);
  });

  it('shows the phones masked and read-only', () => {
    const { settings } = setup();
    assert.equal(settings.snapshot().phones.CLINIC_PHONE, '+51 9•• ••• 321');
    assert.equal(maskPhone(''), null);
  });
});

describe('configuración: promociones, feriados y frases prohibidas', () => {
  it('never mentions an expired or inactive promotion', () => {
    applyClinicOverrides({
      promotions: [
        { title: 'Blanqueamiento 2x1', validUntil: '2026-09-30', active: true },
        { title: 'Promo de agosto', validUntil: '2026-08-31', active: true },
        { title: 'Promo apagada', active: false },
      ],
    });
    assert.deepEqual(activePromotions('2026-09-27').map((p) => p.title), ['Blanqueamiento 2x1']);
    const prompt = buildSystemPrompt(clinic, { today: '2026-09-27' });
    assert.match(prompt, /Blanqueamiento 2x1/);
    assert.doesNotMatch(prompt, /Promo de agosto|Promo apagada/);
    assert.doesNotMatch(buildSystemPrompt(clinic, { today: '2026-10-01' }), /Blanqueamiento 2x1/, 'vence al terminar su último día');
  });

  it('closes the agenda on holidays and lists them for the assistant', async () => {
    const { createAppointmentService, isWithinWorkingHours } = await import('./appointmentService.js');
    applyClinicOverrides({ holidays: [{ date: '2026-10-08', label: 'Combate de Angamos' }] });
    const service = createAppointmentService({ getClient: () => fakeDb({ appointments: [] }), now: () => new Date('2026-10-07T15:00:00Z') });
    assert.deepEqual(await service.getAvailableSlots('2026-10-08', 'limpieza'), []);
    assert.ok((await service.getAvailableSlots('2026-10-09', 'limpieza')).length > 0);
    assert.equal(isWithinWorkingHours(clinic, new Date('2026-10-08T15:00:00Z')), false);
    assert.match(buildSystemPrompt(clinic, { today: '2026-10-01' }), /Combate de Angamos/);
  });

  it('removes forbidden phrases even if the model writes them', () => {
    const cleaned = removeForbiddenPhrases('Es un tratamiento garantizado, sin dolor. ¿Te agendo?', ['garantizado', 'sin dolor']);
    assert.doesNotMatch(cleaned, /garantizado|sin dolor/);
    assert.equal(cleaned, 'Es un tratamiento. ¿Te agendo?');
    applyClinicOverrides({ forbiddenPhrases: ['100% garantizado'] });
    assert.match(buildSystemPrompt(), /Nunca escribas estas frases.*100% garantizado/);
  });
});

describe('configuración: fotos a Supabase Storage', () => {
  it('detects jpg, png and webp by their bytes', () => {
    assert.equal(detectImageType(JPG), 'image/jpeg');
    assert.equal(detectImageType(PNG), 'image/png');
    assert.equal(detectImageType(WEBP), 'image/webp');
    assert.equal(detectImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
  });

  it('creates the clinic-media bucket once and returns a public URL Meta can download', async () => {
    const { settings, db } = setup();
    const first = await settings.uploadPhoto({ buffer: PNG, contentType: 'image/png' });
    await settings.uploadPhoto({ buffer: JPG, contentType: 'image/jpeg' });
    assert.equal(db.storage.state.created, 1);
    assert.equal(db.storage.state.options.public, true);
    assert.match(first.url, new RegExp(`^https://.+/${MEDIA_BUCKET}/${BASE_CLINIC.id}/.+\\.png$`));
    applyClinicOverrides({ media: { ortodoncia: first.url } });
    assert.equal(mediaUrl('ortodoncia'), first.url);
  });

  it('rejects files that are not images, lie about their type or weigh more than 2 MB', async () => {
    const { settings } = setup();
    await assert.rejects(settings.uploadPhoto({ buffer: Buffer.from('MZ-ejecutable-que-no-es-foto'), contentType: 'image/png' }), (e) => e.status === 415);
    await assert.rejects(settings.uploadPhoto({ buffer: PNG, contentType: 'image/jpeg' }), (e) => e.status === 415);
    await assert.rejects(settings.uploadPhoto({ buffer: Buffer.concat([JPG, Buffer.alloc(2 * 1024 * 1024)]), contentType: 'image/jpeg' }), (e) => e.status === 413);
  });
});

describe('configuración: solo el dueño', () => {
  const ENV = { PANEL_USER: 'recepcion', PANEL_PASSWORD: 'clave-recepcion-123', PANEL_OWNER_USER: 'dueno', PANEL_OWNER_PASSWORD: 'clave-dueno-456' };
  const saved = {};
  let server;
  let base;
  const basic = (u, p) => ({ Authorization: `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}` });

  before(async () => {
    for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; process.env[k] = v; }
    const { createApp } = await import('../app.js');
    const app = createApp({ getSupabase: () => fakeDb() });
    await new Promise((resolve) => { server = app.listen(0, resolve); });
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => {
    server.close();
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });

  it('401 without a session, 403 for reception, 200 for the owner', async () => {
    assert.equal((await fetch(`${base}/api/panel/settings`)).status, 401);
    assert.equal((await fetch(`${base}/api/panel/settings`, { headers: basic('recepcion', 'clave-recepcion-123') })).status, 403);
    const owner = await fetch(`${base}/api/panel/settings`, { headers: basic('dueno', 'clave-dueno-456') });
    assert.equal(owner.status, 200);
    const body = await owner.json();
    assert.equal(body.effective.id, BASE_CLINIC.id);
    const upload = await fetch(`${base}/api/panel/settings/photo`, { method: 'POST', headers: { ...basic('recepcion', 'clave-recepcion-123'), 'content-type': 'image/png' }, body: PNG });
    assert.equal(upload.status, 403);
  });
});
