import { describe, it, after } from 'node:test';
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';

process.env.NODE_ENV = 'test';

const { buildClinicSource, createClinicFiles } = await import('../scripts/new-clinic.js');
const { validateClinic, findTodos } = await import('../config/clinic.config.js');

const importSource = async (source) => (await import(`data:text/javascript,${encodeURIComponent(source)}`)).default;

// Lo que haría el instalador: reemplazar cada TODO por el dato real.
const fillTodos = (source) => source
  .replace(/priceFrom: 'TODO'/g, 'priceFrom: 120')
  .replace(/TODO: campaña del mes[^\n]*/, 'Este mes la evaluación es sin costo.')
  .replace(/'TODO(?::[^'\n]*)?'/g, "'dato real'");

describe('nueva clínica en menos de 1 hora', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'new-clinic-'));
  after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('generates a clinic file that refuses to start while a TODO remains', async () => {
    const clinic = await importSource(buildClinicSource({ id: 'sonrisa-surco', name: 'Clínica Dental Sonrisa' }));
    assert.equal(clinic.id, 'sonrisa-surco');
    assert.equal(clinic.name, 'Clínica Dental Sonrisa');
    const errors = validateClinic(clinic);
    assert.match(errors[0], /datos por completar \(busca "TODO"/);
    for (const field of ['address', 'mapsUrl', 'workingHoursText', 'welcomeCaption', 'campaign.evaluation', 'treatments[0].priceFrom']) {
      assert.ok(findTodos(clinic).includes(field), field);
    }
    assert.ok(!JSON.stringify(clinic).includes('Denvari'), 'no arrastra datos de la demo');
    assert.ok(!/\b9\d{8}\b/.test(JSON.stringify(clinic)), 'sin teléfonos');
  });

  it('is valid once every TODO is filled in', async () => {
    const clinic = await importSource(fillTodos(buildClinicSource({ id: 'sonrisa-surco', name: 'Clínica Dental Sonrisa' })));
    assert.deepEqual(findTodos(clinic), []);
    assert.deepEqual(validateClinic(clinic), []);
  });

  it('creates config/clinics/<id>.js and media/<id>/ without overwriting', () => {
    const result = createClinicFiles({ id: 'demo-miraflores', name: 'Clínica Miraflores', root: tmp });
    assert.ok(fs.existsSync(path.join(tmp, 'config', 'clinics', 'demo-miraflores.js')));
    assert.ok(fs.statSync(path.join(tmp, 'media', 'demo-miraflores')).isDirectory());
    assert.ok(result.todos.length > 10);
    assert.ok(result.missingMedia.includes('logo.png'));
    assert.throws(() => createClinicFiles({ id: 'demo-miraflores', name: 'Otra', root: tmp }), /no se sobrescribe/);
  });

  it('rejects ids with spaces, accents or capitals', () => {
    for (const id of ['Sonrisa', 'sonrisa surco', 'clínica', '../denvari', '']) {
      assert.throws(() => createClinicFiles({ id, name: 'X', root: tmp }), /minúsculas/, id);
    }
  });
});
