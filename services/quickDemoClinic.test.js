import { describe, it } from 'node:test';
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';

process.env.NODE_ENV = 'test';

const {
  buildQuickDemoClinic, renderClinicSource, createQuickDemoFiles, demoIdFor, initialsFor, parseHours, hoursText, monogramSvg,
} = await import('../scripts/quick-demo-clinic.js');
const { validateClinic, findTodos } = await import('../config/clinic.config.js');
const { videoEnv, FAKE_PHONES } = await import('../scripts/demo-video.js');
const { isTestPhone } = await import('./testContext.js');

const PROSPECT = {
  name: 'Clínica Dental Sonrisa Feliz',
  address: 'Av. Primavera 123, Surco, Lima',
  hours: 'lun-vie 09:00-13:00,14:00-20:00; sab 09:00-14:00',
  campaign: 'Brackets con inicial S/ 0 y evaluación sin costo',
  prices: { ortodoncia: 1500, implantes: 2900, limpieza: 70 },
};
const FULL = {
  ...PROSPECT,
  colors: { primary: '#7c3aed', accent: '#f59e0b' },
  prices: { ortodoncia: 1500, carillas: 250 },
  pack: { title: 'Evaluación digital', includes: 'Radiografía panorámica, Plan de tratamiento', price: 60, bring: 'Solo trae tu DNI.' },
  promotion: { text: 'Evaluación sin costo', validUntil: '2026-12-15', packPrice: 0 },
  specialist: 'Dra. Ana Ruiz',
};
const tempRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'quick-demo-'));

describe('scripts/quick-demo-clinic.js (demo personalizada para un prospecto)', () => {
  it('arma una clínica válida, sin TODO, solo con los tratamientos, precios y horario del prospecto', () => {
    const clinic = buildQuickDemoClinic(PROSPECT);
    assert.deepStrictEqual(validateClinic(clinic), []);
    assert.deepStrictEqual(findTodos(clinic), []);
    assert.strictEqual(clinic.id, 'demo-sonrisa-feliz');
    assert.deepStrictEqual(clinic.treatments.map((t) => [t.key, t.priceFrom]), [['ortodoncia', 1500], ['implantes', 2900], ['limpieza', 70]]);
    assert.match(clinic.welcomeCaption, /^¡Hola! 👋 Te damos la bienvenida a \*Clínica Dental Sonrisa Feliz\*/);
    assert.match(clinic.welcomeCaption, /Brackets con inicial S\/ 0/);
    assert.deepStrictEqual(Object.values(clinic.campaign), [PROSPECT.campaign]);
    assert.deepStrictEqual(clinic.workingHours.mon, [['09:00', '13:00'], ['14:00', '20:00']]);
    assert.deepStrictEqual(clinic.workingHours.sun, []);
    assert.strictEqual(clinic.bookingMode, 'confirmacion_directa');
    assert.strictEqual(clinic.appointmentCodePrefix, 'SF');
  });

  it('no arrastra datos de la clínica de demostración ni teléfonos ni promociones inventadas', () => {
    const source = renderClinicSource(buildQuickDemoClinic(PROSPECT));
    assert.doesNotMatch(source, /Denvari|Orquídeas|S\/ 150|3D|ficticia/i);
    assert.doesNotMatch(source, /\b9\d{8}\b|\b51\d{9}\b/);
    assert.doesNotMatch(source, /Yape|estacionamiento/i, 'no inventa medios de pago ni servicios');
    const clinic = buildQuickDemoClinic(PROSPECT);
    assert.strictEqual(clinic.evaluationPack, undefined, 'sin datos del pack no hay tarjeta');
    assert.deepStrictEqual(clinic.promotions, []);
    assert.strictEqual(clinic.specialists, undefined);
  });

  it('con colores, pack, promoción con fecha de fin y especialista: todo sale de lo que dio el prospecto', () => {
    const clinic = buildQuickDemoClinic(FULL);
    assert.deepStrictEqual(validateClinic(clinic), []);
    assert.deepStrictEqual(clinic.colors, FULL.colors);
    assert.deepStrictEqual(clinic.evaluationPack, {
      title: 'Evaluación digital', includes: ['Radiografía panorámica', 'Plan de tratamiento'], price: 60, bring: 'Solo trae tu DNI.',
      promotion: { text: 'Evaluación sin costo', price: 0, validUntil: '2026-12-15' },
    });
    assert.deepStrictEqual(clinic.promotions, [{ title: 'Evaluación sin costo', active: true, validUntil: '2026-12-15' }]);
    assert.deepStrictEqual(clinic.specialists, [{ name: 'Dra. Ana Ruiz', treatments: ['ortodoncia', 'carillas'] }]);
    // Catálogo regenerado (ortodoncia y carillas), marcado como referencial.
    assert.deepStrictEqual(clinic.treatments.map((t) => t.images?.[0]?.file), ['catalogo/ortodoncia-metalicos-vs-zafiro.png', 'catalogo/carillas-antes-despues.png']);
    assert.ok(clinic.treatments.every((t) => /referencial/i.test(t.images[0].caption)));
  });

  it('las reglas de recomendación sin su tratamiento quedan sin precio (no apuntan a un tratamiento que no ofrece)', () => {
    const clinic = buildQuickDemoClinic(PROSPECT);
    const keys = new Set(clinic.treatments.map((t) => t.key));
    assert.ok(clinic.recommendationRules.every((rule) => !rule.treatmentKey || keys.has(rule.treatmentKey)));
  });

  it('falla con un mensaje claro si faltan datos o algo no es válido', () => {
    assert.throws(() => buildQuickDemoClinic({ ...PROSPECT, name: '' }), /nombre/);
    assert.throws(() => buildQuickDemoClinic({ ...PROSPECT, hours: '' }), /horario/);
    assert.throws(() => buildQuickDemoClinic({ ...PROSPECT, hours: 'todos los días' }), /No entiendo el horario/);
    assert.throws(() => buildQuickDemoClinic({ ...PROSPECT, hours: 'lun 20:00-09:00' }), /Horas inválidas/);
    assert.throws(() => buildQuickDemoClinic({ ...PROSPECT, prices: {} }), /al menos un precio/);
    assert.throws(() => buildQuickDemoClinic({ ...PROSPECT, prices: { ortodoncia: 'mil' } }), /ortodoncia/);
    assert.throws(() => buildQuickDemoClinic({ ...PROSPECT, prices: { botox: 300 } }), /botox/);
    assert.throws(() => buildQuickDemoClinic({ ...PROSPECT, campaign: 'TODO' }), /TODO/);
    assert.throws(() => buildQuickDemoClinic({ ...PROSPECT, colors: { primary: 'morado' } }), /#RRGGBB/);
    assert.throws(() => buildQuickDemoClinic({ ...PROSPECT, pack: { includes: '' } }), /al menos un ítem/);
    assert.throws(() => buildQuickDemoClinic({ ...PROSPECT, promotion: { text: 'X', validUntil: '15/12/2026' } }), /AAAA-MM-DD/);
  });

  it('horario: rangos de días, refrigerio, "cerrado" y texto legible', () => {
    const hours = parseHours('lun-vie 09:00-13:00,14:00-20:00; sab 9-14; dom cerrado');
    assert.deepStrictEqual(hours.sat, [['09:00', '14:00']]);
    assert.strictEqual(hoursText(hours), 'Lunes a viernes de 9:00 a. m. a 1:00 p. m. y de 2:00 p. m. a 8:00 p. m. y sábados de 9:00 a. m. a 2:00 p. m.');
  });

  it('el id siempre empieza con demo- (archivos ignorados por git) y las iniciales sirven de prefijo', () => {
    assert.strictEqual(demoIdFor('Clínica Dental Ñandú & Cía'), 'demo-nandu-cia');
    assert.strictEqual(demoIdFor('Odontología Integral San Borja'), 'demo-odontologia-integral-san-borja');
    assert.strictEqual(initialsFor('Clínica Dental Sonrisa Perfecta'), 'SP');
    assert.strictEqual(initialsFor('Dentalia'), 'DX');
  });

  it('escribe la configuración, el logo provisional y el catálogo con sus colores, sin sobrescribir una existente', () => {
    const root = tempRoot();
    const result = createQuickDemoFiles(FULL, { root });
    assert.ok(fs.existsSync(result.configPath));
    assert.match(fs.readFileSync(result.configPath, 'utf8'), /^\/\/ DEMO/);
    const logo = fs.readFileSync(path.join(result.mediaDir, 'logo.png'));
    assert.deepStrictEqual([...logo.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
    for (const file of result.catalog) assert.ok(fs.existsSync(path.join(result.mediaDir, file)), file);
    assert.ok(monogramSvg(result.clinic).includes('#7c3aed'));
    assert.throws(() => createQuickDemoFiles(FULL, { root }), /Ya existe/);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('el logo del prospecto se valida por sus bytes (no por la extensión)', () => {
    const root = tempRoot();
    const fake = path.join(root, 'logo.png');
    fs.writeFileSync(fake, 'esto no es una imagen, aunque se llame .png');
    assert.throws(() => createQuickDemoFiles({ ...PROSPECT, logo: fake }, { root }), /JPG, PNG o WebP/);
    const real = path.join(root, 'real.jpg');
    fs.writeFileSync(real, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)]));
    const result = createQuickDemoFiles({ ...PROSPECT, logo: real }, { root });
    assert.strictEqual(result.clinic.media.logo, 'logo.jpg');
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe('scripts/demo-video.js (Probador listo para grabar)', () => {
  it('usa la clínica pedida, modo demo y alertas a números falsos que no son celulares ni del Probador', () => {
    const env = videoEnv('demo-sonrisa-feliz', {}, 'clave');
    assert.strictEqual(env.ACTIVE_CLINIC, 'demo-sonrisa-feliz');
    assert.strictEqual(env.DEMO_MODE, 'true');
    assert.strictEqual(env.PANEL_OWNER_PASSWORD, 'clave');
    for (const phone of Object.values(FAKE_PHONES)) {
      assert.match(phone, /^510\d{8}$/, 'no es un número peruano válido (51 + 9 dígitos que empiezan en 9 o 1)');
      assert.strictEqual(isTestPhone(phone), false, 'no choca con los números del Probador');
    }
    assert.ok(Object.keys(FAKE_PHONES).every((name) => env[name] === FAKE_PHONES[name]));
  });

  it('nunca corre en producción', () => {
    assert.throws(() => videoEnv('denvari', { NODE_ENV: 'production' }), /production/);
  });

  it('la demo de un prospecto no recibe la promoción de ejemplo de la clínica ficticia', async () => {
    const { buildDemoData } = await import('./demo/seed.js');
    const { BASE_CLINIC } = await import('../config/clinic.config.js');
    const prospect = buildDemoData(buildQuickDemoClinic(PROSPECT)).clinic_settings[0].data;
    assert.strictEqual(prospect.promotions, undefined);
    assert.strictEqual(prospect.bookingMode, 'confirmacion_directa');
    assert.ok(buildDemoData(BASE_CLINIC).clinic_settings[0].data.promotions.length >= 1);
  });

  it('de noche, en confirmación directa, el aviso no promete que recepción confirmará', async () => {
    const { default: clinic } = await import('../config/clinic.config.js');
    const { afterHoursNotice, DEFAULT_AFTER_HOURS_NOTICE, DIRECT_AFTER_HOURS_NOTICE } = await import('../controllers/firstContact.js');
    const saved = { mode: clinic.bookingMode, notice: clinic.afterHoursNotice };
    try {
      clinic.afterHoursNotice = undefined;
      clinic.bookingMode = 'confirmacion_directa';
      assert.strictEqual(afterHoursNotice(), DIRECT_AFTER_HOURS_NOTICE);
      assert.doesNotMatch(afterHoursNotice(), /recepción te la confirma/);
      clinic.bookingMode = 'solicitud';
      assert.strictEqual(afterHoursNotice(), DEFAULT_AFTER_HOURS_NOTICE);
      clinic.afterHoursNotice = 'Texto del dueño';
      assert.strictEqual(afterHoursNotice(), 'Texto del dueño');
    } finally {
      clinic.bookingMode = saved.mode;
      clinic.afterHoursNotice = saved.notice;
    }
  });
});
