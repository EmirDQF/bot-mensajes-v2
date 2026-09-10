import { describe, it, before } from 'node:test';
import assert from 'assert';

process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test';
process.env.GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';

let service;

before(async () => {
  service = await import('./geminiService.js');
});

describe('geminiService refinements', () => {
  it('builds a LUMINZU prompt without legacy placeholders', () => {
    const prompt = service.buildSystemPromptWithContext('51900000000@s.whatsapp.net');
    assert.equal(prompt.includes('[NOMBRE_CLINICA]'), false);
    assert.equal(prompt.includes('LUMINZU Clínica Dental'), true);
    assert.equal(prompt.includes('Huánuco'), true);
  });

  it('includes a patient name already present in the session', () => {
    const prompt = service.buildSystemPromptWithContext('51900000001@s.whatsapp.net', {
      history: [{ role: 'user', parts: [{ text: 'Me llamo Manuel' }] }],
    });
    assert.equal(prompt.includes('Manuel'), true);
  });

  it('uses the configured output token limit', async () => {
    const config = await import('../config/env.js');
    assert.equal(typeof config.default.gemini.maxOutputTokens, 'number');
    assert.ok(config.default.gemini.maxOutputTokens > 0);
  });

  it('merges recent messages within the configured conversation window', () => {
    const now = Date.now();
    const merged = service.mergeRecentUserMessages([
      { role: 'user', parts: [{ text: 'Me llamo Andre' }], at: now - 2000 },
      { role: 'user', parts: [{ text: 'vi su anuncio' }], at: now - 1000 },
    ]);
    assert.equal(merged.filter((entry) => entry.role === 'user').length, 1);
    assert.ok(merged[0].text.includes('vi su anuncio'));
  });
});
