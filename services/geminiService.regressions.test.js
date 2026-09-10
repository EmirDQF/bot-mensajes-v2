import { describe, it, before } from 'node:test';
import assert from 'assert';

process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test';
process.env.GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';

let service;

before(async () => {
  service = await import('./geminiService.js');
});

describe('geminiService regressions', () => {
  it('does not claim a booking when the current message lacks booking data', async () => {
    const result = await service.obtenerRespuestaIA(
      '51990001111@s.whatsapp.net',
      '¿Cuánto cuesta el tratamiento?',
      { client: { async generate() { return { text: 'Tu cita ya quedó agendada para este lunes.' }; } } },
    );

    assert.equal(result.leadData?.ready_to_notify || false, false);
    assert.equal(/qued[oó] agendada/i.test(result.texto), false);
    assert.match(result.texto, /Nombre completo:/i);
    assert.match(result.texto, /Tratamiento de interés:/i);
    assert.match(result.texto, /Día y turno de preferencia/i);
  });

  it('preserves booked session data during casual follow-ups', async () => {
    const jid = '51990001102@s.whatsapp.net';
    const session = service.getOrCreateSession(jid);
    session.booked = true;
    session.leadSnapshot = {
      nombre: 'Sandra Perez',
      telefono: '999111222',
      motivo: 'limpieza',
      fecha_hora_texto: 'martes 11 de agosto a las 6:30 PM',
      fecha_hora_iso: '2026-08-11T23:30:00+00:00',
    };

    const result = await service.obtenerRespuestaIA(jid, 'gracias', {
      client: { async generate() { return { text: 'Gracias por la información.' }; } },
      skipDebounce: true,
    });

    assert.equal(result.leadData.nombre, 'Sandra Perez');
    assert.equal(result.leadData.fechaHoraISO, '2026-08-11T23:30:00+00:00');
    assert.equal(result.skipLeadPersistence, false);
  });

  it('resolves Lima dates consistently', () => {
    assert.equal(
      service.parseTextToLimaISO('11 de agosto a las 6:30pm'),
      '2026-08-11T23:30:00+00:00',
    );
  });
});
