import { describe, it } from 'node:test';
import assert from 'assert';

// Revisión de la Fase 6: el logo subido desde el panel (Supabase Storage) también sale en el pack, el pase y el catálogo.

process.env.NODE_ENV = 'test';

const { prefetchImage, cachedImageDataUri, isClinicMediaUrl, MAX_REMOTE_BYTES } = await import('./cards/remoteImages.js');
const { localImageDataUri } = await import('./cards/render.js');
const { appointmentPassSvg } = await import('./cards/appointmentPass.js');
const { BASE_CLINIC } = await import('../config/clinic.config.js');

const ENV = { SUPABASE_URL: 'https://abcd.supabase.co' };
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]);
const url = (name) => `https://abcd.supabase.co/storage/v1/object/public/clinic-media/denvari/${name}`;
const okFetch = (body, headers = {}) => async () => ({ ok: true, headers: new Headers(headers), arrayBuffer: async () => body });

describe('logo del panel en las tarjetas (remoteImages)', () => {
  it('solo acepta URLs públicas del bucket clinic-media del propio Supabase', () => {
    assert.equal(isClinicMediaUrl(url('logo.png'), ENV), true);
    assert.equal(isClinicMediaUrl('https://evil.example/storage/v1/object/public/clinic-media/x.png', ENV), false);
    assert.equal(isClinicMediaUrl('http://abcd.supabase.co/storage/v1/object/public/clinic-media/x.png', ENV), false);
    assert.equal(isClinicMediaUrl('https://abcd.supabase.co/storage/v1/object/public/otro-bucket/x.png', ENV), false);
    assert.equal(isClinicMediaUrl('https://abcd.supabase.co/rest/v1/clinic_settings', ENV), false);
    assert.equal(isClinicMediaUrl(url('logo.png'), {}), false);
  });

  it('no descarga URLs ajenas', async () => {
    let calls = 0;
    const ok = await prefetchImage('https://evil.example/logo.png', { env: ENV, fetchImpl: async () => { calls += 1; } });
    assert.equal(ok, false);
    assert.equal(calls, 0);
  });

  it('guarda una imagen real y la usa al dibujar el pase de cita', async () => {
    assert.equal(await prefetchImage(url('logo-a.png'), { env: ENV, fetchImpl: okFetch(PNG) }), true);
    assert.match(cachedImageDataUri(url('logo-a.png')), /^data:image\/png;base64,/);
    assert.match(localImageDataUri('denvari', url('logo-a.png')), /^data:image\/png;base64,/);
    const svg = appointmentPassSvg(
      { code: 'DV-1', status: 'confirmada', patient_name: 'Ana', appointment_date: '2026-11-06', appointment_time: '10:00' },
      { ...BASE_CLINIC, media: { ...BASE_CLINIC.media, logo: url('logo-a.png') } },
    );
    assert.ok(svg.includes('data:image/png;base64,'));
  });

  it('rechaza lo que no es JPG/PNG/WebP por sus bytes (p. ej. un SVG) y lo que pesa demasiado', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    assert.equal(await prefetchImage(url('logo-b.png'), { env: ENV, fetchImpl: okFetch(svg) }), false);
    assert.equal(await prefetchImage(url('logo-c.png'), { env: ENV, fetchImpl: okFetch(PNG, { 'content-length': String(MAX_REMOTE_BYTES + 1) }) }), false);
    assert.equal(cachedImageDataUri(url('logo-b.png')), null);
  });

  it('si la descarga falla, no lanza: las tarjetas salen sin logo', async () => {
    const failing = async () => { throw new Error('red caída'); };
    assert.equal(await prefetchImage(url('logo-d.png'), { env: ENV, fetchImpl: failing }), false);
    assert.equal(localImageDataUri('denvari', url('logo-d.png')), null);
  });
});
