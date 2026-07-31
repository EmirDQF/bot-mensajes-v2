import { parseFechaHora } from '../src/gemini.js';

const reference = new Date('2026-07-30T12:00:00.000Z'); // deterministic reference (2026-07-30)

const cases = [
  { input: 'mañana a las 3pm', expected: '2026-07-31T20:00:00.000Z' },
  { input: 'el jueves', expected: '2026-07-30T20:00:00.000Z' },
  { input: '15 de agosto', expected: '2026-08-15T20:00:00.000Z' },
  { input: 'hoy en la tarde', expected: '2026-07-30T21:00:00.000Z' },
  { input: 'cuando pueda', expected: null },
];

for (const c of cases) {
  try {
    const actualDate = parseFechaHora(c.input, reference);
    const actual = actualDate ? actualDate.toISOString() : null;
    const pass = (actual === c.expected);
    console.log(`INPUT: "${c.input}"\n  Expected: ${c.expected}\n  Actual:   ${actual}\n  RESULT: ${pass ? 'PASS' : 'FAIL'}\n`);
  } catch (e) {
    console.log(`INPUT: "${c.input}"\n  ERROR: ${e && e.message}\n  RESULT: FAIL\n`);
  }
}
