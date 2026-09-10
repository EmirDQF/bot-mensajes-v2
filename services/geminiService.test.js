import { describe, it, before } from 'node:test';
import assert from 'assert';

process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test';
process.env.GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';

let service;

before(async () => {
  service = await import('./geminiService.js');
});

function jid(counter) {
  return `519876540${String(counter).padStart(2, '0')}@s.whatsapp.net`;
}

function textClient(text) {
  return { async generate(prompt) { return { text }; } };
}

describe('geminiService current contract', () => {
  it('extracts lead fields heuristically from the current user message', async () => {
    const result = await service.obtenerRespuestaIA(
      jid(1),
      'Me llamo Shawmie, tratamiento: brackets, mi telefono es 987654321 y puedo el lunes 10 de agosto a las 2:00 PM',
      { client: textClient('Perfecto, revisaremos tu disponibilidad.') },
    );

    assert.equal(result.leadData.nombre, 'Shawmie');
    assert.equal(result.leadData.telefono, '987654321');
    assert.equal(result.leadData.motivo, 'brackets');
    assert.equal(result.leadData.fechaHoraISO, '2026-08-10T19:00:00+00:00');
    assert.equal(result.leadData.ready_to_notify, true);
  });

  it('extracts only usable text from the Gemini SDK response method', async () => {
    const result = await service.obtenerRespuestaIA(jid(2), '¿Dónde queda?', {
      client: {
        async generateContent(request) {
          assert.equal(request.systemInstruction.includes('LUMINZU'), true);
          return { response: { text: () => 'Estamos en Huánuco.' } };
        },
      },
    });

    assert.equal(result.texto, 'Estamos en Huánuco.');
  });

  it('does not duplicate system prompt or history in the current user turn', async () => {
    let request;
    await service.obtenerRespuestaIA(jid(3), 'mensaje actual', {
      client: {
        async generateContent(value) {
          request = value;
          return { response: { text: () => 'ok' } };
        },
      },
      messageParts: [{ type: 'text', content: 'mensaje actual' }],
    });

    assert.equal(request.contents.at(-1).role, 'user');
    assert.equal(request.contents.at(-1).parts[0].text, 'mensaje actual');
    assert.equal(request.contents.at(-1).parts[0].text.includes('DATOS ACTUALIZADOS'), false);
    assert.equal(request.contents.some((entry) => entry.parts[0].text.includes('DATOS ACTUALIZADOS')), false);
  });

  it('sanitizes invalid history roles and empty content before building requests', async () => {
    const session = service.getOrCreateSession(jid(4));
    session.history = [
      { role: '', text: null, parts: [{ text: null }] },
      { role: 'assistant', text: 'Respuesta previa' },
      { role: 'user', text: 'Pregunta previa' },
    ];
    let request;
    await service.obtenerRespuestaIA(jid(4), 'nueva pregunta', {
      client: {
        async generateContent(value) {
          request = value;
          return { response: { text: () => 'ok' } };
        },
      },
      skipDebounce: true,
    });

    assert.equal(request.contents.every((entry) => entry.role === 'user' || entry.role === 'model'), true);
    assert.equal(request.contents.some((entry) => entry.parts.some((part) => !part.text)), false);
  });

  it('sanitizes JSON response text without relying on LEAD_JSON markers', () => {
    assert.equal(
      service.sanitizeModelTextOutput('{"response":"Tu evaluación está confirmada."}'),
      'Tu evaluación está confirmada.',
    );
  });

  it('merges recent user messages and keeps explicit confirmation rules', () => {
    const now = Date.now();
    const merged = service.mergeRecentUserMessages([
      { role: 'user', parts: [{ text: 'Me llamo Andre' }], at: now - 2000 },
      { role: 'user', parts: [{ text: 'quiero brackets' }], at: now - 1000 },
    ]);

    assert.equal(merged.filter((entry) => entry.role === 'user').length, 1);
    assert.equal(service.isExplicitConfirmation('vale, pero prefiero otra hora'), false);
    assert.equal(service.isExplicitConfirmation('sí'), true);
  });

  it('retries transient failures and returns the successful response', async () => {
    let calls = 0;
    const result = await service.obtenerRespuestaIA(jid(5), 'hola', {
      client: {
        async generate() {
          calls += 1;
          if (calls === 1) throw new Error('network error');
          return { text: 'Respuesta recuperada' };
        },
      },
    });

    assert.equal(calls, 2);
    assert.equal(result.texto, 'Respuesta recuperada');
  });
});
