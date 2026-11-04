import { describe, it } from 'node:test';
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';

const { buildQuickDemoClinic, renderClinicSource, createQuickDemoFiles, demoIdFor } = await import('../scripts/quick-demo-clinic.js');
const { validateClinic, findTodos } = await import('../config/clinic.config.js');

const PROSPECT = {
  name: 'Clínica Dental Sonrisa Feliz',
  address: 'Av. Primavera 123, Surco, Lima',
  campaign: 'Brackets con inicial S/ 0 y evaluación sin costo',
  prices: { ortodoncia: 1500, implantes: 2900, limpieza: 70 },
};

describe('scripts/quick-demo-clinic.js (demo personalizada para un prospecto)', () => {
  it('arma una clínica válida, sin TODO, solo con los tratamientos y precios del prospecto', () => {
    const clinic = buildQuickDemoClinic(PROSPECT);
    assert.deepStrictEqual(validateClinic(clinic), []);
    assert.deepStrictEqual(findTodos(clinic), []);
    assert.strictEqual(clinic.id, 'demo-sonrisa-feliz');
    assert.deepStrictEqual(clinic.treatments.map((t) => [t.key, t.priceFrom]), [['ortodoncia', 1500], ['implantes', 2900], ['limpieza', 70]]);
    assert.match(clinic.welcomeCaption, /Sonrisa Feliz/);
    assert.match(clinic.welcomeCaption, /Brackets con inicial S\/ 0/);
    assert.deepStrictEqual(Object.values(clinic.campaign), [PROSPECT.campaign]);
    assert.ok(Object.keys(clinic.media).every((key) => ['logo', 'fachada', 'ubicacion', 'ortodoncia', 'implantes', 'limpieza'].includes(key)));
  });

  it('no arrastra datos de la clínica de demostración ni teléfonos', () => {
    const source = renderClinicSource(buildQuickDemoClinic(PROSPECT));
    assert.doesNotMatch(source, /Denvari|Orquídeas|S\/ 150|3D/i);
    assert.doesNotMatch(source, /\b9\d{8}\b|\b51\d{9}\b/);
    assert.doesNotMatch(source, /Yape|estacionamiento/i, 'no inventa medios de pago ni servicios');
  });

  it('las reglas de recomendación sin su tratamiento quedan sin precio (no apuntan a un tratamiento que no ofrece)', () => {
    const clinic = buildQuickDemoClinic(PROSPECT);
    const keys = new Set(clinic.treatments.map((t) => t.key));
    assert.ok(clinic.recommendationRules.every((rule) => !rule.treatmentKey || keys.has(rule.treatmentKey)));
  });

  it('falla con un mensaje claro si faltan datos o un precio no es válido', () => {
    assert.throws(() => buildQuickDemoClinic({ ...PROSPECT, name: '' }), /nombre/);
    assert.throws(() => buildQuickDemoClinic({ ...PROSPECT, prices: {} }), /al menos un precio/);
    assert.throws(() => buildQuickDemoClinic({ ...PROSPECT, prices: { ortodoncia: 'mil' } }), /ortodoncia/);
    assert.throws(() => buildQuickDemoClinic({ ...PROSPECT, prices: { botox: 300 } }), /botox/);
    assert.throws(() => buildQuickDemoClinic({ ...PROSPECT, campaign: 'TODO' }), /TODO/);
  });

  it('el id siempre empieza con demo- (archivos ignorados por git, nunca van a producción)', () => {
    assert.strictEqual(demoIdFor('Clínica Dental Ñandú & Cía'), 'demo-nandu-cia');
    assert.strictEqual(demoIdFor('Odontología Integral San Borja'), 'demo-odontologia-integral-san-borja');
  });

  it('escribe config/clinics/<id>.js y media/<id>/, sin sobrescribir una existente', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quick-demo-'));
    const result = createQuickDemoFiles(PROSPECT, { root });
    assert.ok(fs.existsSync(result.configPath));
    assert.ok(fs.existsSync(result.mediaDir));
    assert.match(fs.readFileSync(result.configPath, 'utf8'), /^\/\/ DEMO/);
    assert.throws(() => createQuickDemoFiles(PROSPECT, { root }), /Ya existe/);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
