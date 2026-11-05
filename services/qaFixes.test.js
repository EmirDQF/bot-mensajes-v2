import { describe, it } from 'node:test';
import assert from 'assert';

// Correcciones encontradas con npm run simulate (Gemini real), agente top · paso 0.

process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test';

const { default: clinic } = await import('../config/clinic.config.js');
const { guardPrices, unconfiguredPrices, parseSoles } = await import('./priceGuard.js');
const { quickAnswer } = await import('./quickAnswers.js');
const gemini = await import('./geminiService.js');

const TODAY = '2026-11-05';
const SLOTS = [
  { date: '2026-11-06', time: '11:00', label: 'viernes, 6 de noviembre a las 11:00 a. m.' },
  { date: '2026-11-06', time: '15:00', label: 'viernes, 6 de noviembre a las 3:00 p. m.' },
];
const textClient = (text) => ({ async generate() { return { text }; } });

describe('freno de precios inventados', () => {
  it('lee montos peruanos: miles con coma o punto y decimales', () => {
    assert.equal(parseSoles('1,800'), 1800);
    assert.equal(parseSoles('1.800'), 1800);
    assert.equal(parseSoles('150'), 150);
    assert.equal(parseSoles('1,50'), 1.5);
  });

  it('acepta solo montos de la configuración (precios, cuotas, campaña y pack)', () => {
    assert.deepEqual(unconfiguredPrices('desde S/ 1,800, mensualidades desde S/ 150, inicial S/ 0, evaluación S/ 50', clinic, TODAY), []);
    assert.deepEqual(unconfiguredPrices('las mensualidades desde S/ 1,50 y la limpieza S/ 99', clinic, TODAY), ['1,50', '99']);
  });

  it('quita solo la frase con el monto inventado; si no queda nada usa la respuesta de respaldo', () => {
    const fixed = guardPrices('La ortodoncia está desde S/ 1,800. Las mensualidades van desde S/ 1,50. ¿A nombre de quién?', { clinic, today: TODAY });
    assert.equal(fixed.text, 'La ortodoncia está desde S/ 1,800. ¿A nombre de quién?');
    assert.equal(guardPrices('Cuesta S/ 99.', { clinic, today: TODAY, fallback: 'Respaldo' }).text, 'Respaldo');
    assert.equal(guardPrices('Desde S/ 80.', { clinic, today: TODAY }).replaced, false);
  });
});

describe('respuesta sin IA: no contestar otra cosa', () => {
  it('"¿atienden con seguro…?" no se responde con el horario (va a recepción)', () => {
    assert.equal(quickAnswer('¿Atienden con seguro Pacífico?', { clinic, today: TODAY }), null);
    assert.equal(quickAnswer('¿tienen convenio con EPS?', { clinic, today: TODAY }), null);
  });

  it('"¿atienden los sábados?" sí es una pregunta de horario', () => {
    assert.ok(quickAnswer('¿atienden los sábados?', { clinic, today: TODAY }).kinds.includes('horario'));
  });
});

describe('lista de horarios sin preguntas repetidas', () => {
  it('quita "¿Qué día y hora te acomodan? Toca el que prefieras 👇" (la lista ya lo dice)', async () => {
    const { withoutSlotQuestion } = await import('../controllers/webhookController.js');
    assert.equal(withoutSlotQuestion('Solo trae tu DNI.\n\n¿Qué día y hora te acomodan? Toca el que prefieras 👇'), 'Solo trae tu DNI.');
    assert.equal(withoutSlotQuestion('Desde S/ 80. ¿A nombre de quién registro la solicitud?'), 'Desde S/ 80. ¿A nombre de quién registro la solicitud?');
    assert.equal(withoutSlotQuestion('¿Qué horario te acomoda?'), '¿Qué horario te acomoda?', 'nunca deja el mensaje vacío');
  });
});

describe('agendamiento paso a paso', () => {
  it('recuerda el tratamiento aunque el historial del prompt ya no lo tenga', async () => {
    const jid = '51900099001@s.whatsapp.net';
    await gemini.obtenerRespuestaIA(jid, 'quiero una cita para limpieza', { client: textClient('¿A nombre de quién?'), availableSlots: SLOTS, skipDebounce: true });
    for (const msg of ['Ana Torres', 'Surco', 'ok', 'gracias', 'perfecto']) {
      await gemini.obtenerRespuestaIA(jid, msg, { client: textClient('Elige un horario de la lista.'), skipDebounce: true });
    }
    const result = await gemini.obtenerRespuestaIA(jid, '1', { client: textClient('x'), skipDebounce: true });
    assert.equal(result.appointmentRequest?.tratamiento, 'Limpieza dental (profilaxis)');
    assert.equal(result.appointmentRequest?.fecha, '2026-11-06');
  });

  it('si el modelo dice "tu solicitud quedó registrada" sin que exista, se corrige', async () => {
    const jid = '51900099002@s.whatsapp.net';
    const result = await gemini.obtenerRespuestaIA(jid, 'hola, quiero info', {
      client: textClient('¡Listo! Tu solicitud de cita quedó registrada para el jueves.'), skipDebounce: true,
    });
    assert.doesNotMatch(result.texto, /quedó registrada/);
    assert.equal(result.appointmentRequest, null);
  });
});
