import { describe, it } from 'node:test';
import assert from 'assert';
import { readdirSync } from 'node:fs';

process.env.PUBLIC_BASE_URL = 'https://bot.example.test';

const cfg = await import('../config/clinic.config.js');
const { extractPhotoTags, inferPhotoKeyFromMessage } = await import('./mediaTags.js');

describe('clinic.config', () => {
  it('loads Denvari by default and validates it', () => {
    assert.equal(cfg.ACTIVE_CLINIC_ID, 'denvari');
    assert.equal(cfg.clinic.name, 'Clínica Dental Denvari');
    assert.equal(cfg.clinic.botName, 'Camila');
    assert.deepEqual(cfg.validateClinic(cfg.clinic), []);
  });

  it('reports missing required fields', () => {
    const broken = { ...cfg.clinic, address: '', treatments: [], workingHours: { ...cfg.clinic.workingHours, mon: [['20:00', '09:00']] } };
    const errors = cfg.validateClinic(broken);
    assert.ok(errors.some((e) => e.includes('address')));
    assert.ok(errors.some((e) => e.includes('treatments')));
    assert.ok(errors.some((e) => e.includes('workingHours.mon')));
  });

  it('does not store phone numbers in clinic files', () => {
    const phoneLike = /\b(?:51)?9\d{8}\b/;
    assert.equal(phoneLike.test(JSON.stringify(cfg.clinic)), false);
    assert.equal('phone' in cfg.clinic, false);
  });

  it('reads alert phones only from environment variables', () => {
    const previous = process.env.RECEPTION_ALERT_PHONE;
    delete process.env.RECEPTION_ALERT_PHONE;
    assert.equal(cfg.getReceptionPhone(), null);
    assert.ok(cfg.missingPhoneVars().includes('RECEPTION_ALERT_PHONE'));
    process.env.RECEPTION_ALERT_PHONE = '912 345 678';
    assert.equal(cfg.getReceptionPhone(), '51912345678');
    if (previous === undefined) delete process.env.RECEPTION_ALERT_PHONE; else process.env.RECEPTION_ALERT_PHONE = previous;
  });

  it('builds absolute media URLs under /media/<clinicId>/ and every file exists', () => {
    assert.equal(cfg.mediaUrl('logo'), 'https://bot.example.test/media/denvari/logo.png');
    const files = readdirSync(new URL('../media/denvari/', import.meta.url));
    for (const file of Object.values(cfg.clinic.media)) assert.ok(files.includes(file), `falta media/denvari/${file}`);
  });

  it('resolves treatments by synonyms and typos', () => {
    assert.equal(cfg.findTreatment('quiero bravkets')?.key, 'ortodoncia');
    assert.equal(cfg.findTreatment('cuánto cuestan los frenillos?')?.key, 'ortodoncia');
    assert.equal(cfg.findTreatment('blanqueamento dental')?.key, 'blanqueamiento');
    assert.equal(cfg.findTreatment('me duele el nervio')?.key, 'endodoncia');
    assert.equal(cfg.findTreatment('hola buenas'), null);
  });
});

describe('mediaTags', () => {
  it('reads [ENVIAR_FOTO] and [ENVIAR_IMAGEN] tags from raw text and strips them', () => {
    const { keys, cleaned } = extractPhotoTags('Mira nuestros casos 😊 [ENVIAR_FOTO: ortodoncia] [ENVIAR_IMAGEN:blanqueamiento]');
    assert.deepEqual(keys, ['ortodoncia', 'blanqueamiento']);
    assert.equal(cleaned, 'Mira nuestros casos 😊');
  });

  it('accepts comma lists, the underscore-less variant and synonyms, without duplicates', () => {
    const { keys } = extractPhotoTags('Listo [ENVIARFOTO: brackets, fachada] [FOTO: ortodoncia] [ENVIAR_FOTO: dirección]');
    assert.deepEqual(keys, ['ortodoncia', 'fachada', 'ubicacion']);
  });

  it('ignores unknown categories', () => {
    const { keys, cleaned } = extractPhotoTags('Texto [ENVIAR_FOTO: promo_inexistente]');
    assert.deepEqual(keys, []);
    assert.equal(cleaned, 'Texto');
  });

  it('infers a photo from an explicit request when the model forgot the tag', () => {
    assert.equal(inferPhotoKeyFromMessage('me mandas fotos de bravkets?'), 'ortodoncia');
    assert.equal(inferPhotoKeyFromMessage('¿dónde están ubicados?'), 'ubicacion');
    assert.equal(inferPhotoKeyFromMessage('cuánto cuesta la limpieza'), null);
  });
});
