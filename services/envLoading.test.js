import { describe, it } from 'node:test';
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { pathToFileURL } from 'url';

process.env.NODE_ENV = 'test';

const { loadDotEnv } = await import('../src/envLoader.js');
const ROOT = path.resolve(import.meta.dirname, '..');
const FAKE_URL = 'https://proyecto-de-prueba.supabase.co';

// Importa el script en un proceso aparte, con cwd en una carpeta que solo tiene un .env falso,
// y devuelve lo que config/env.js vio. Así se detecta si el script importa config/env.js antes del .env.
function supabaseUrlSeenBy(script) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'envload-'));
  fs.writeFileSync(path.join(dir, '.env'), `SUPABASE_URL=${FAKE_URL}\nSUPABASE_SERVICE_ROLE_KEY=clave-falsa\n`);
  const env = { ...process.env };
  for (const name of ['NODE_ENV', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) delete env[name];
  const code = `await import(${JSON.stringify(pathToFileURL(path.join(ROOT, script)).href)});
const { default: config } = await import(${JSON.stringify(pathToFileURL(path.join(ROOT, 'config/env.js')).href)});
console.log('URL=' + config.supabase.url);`;
  try {
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', code], { cwd: dir, env, encoding: 'utf8' });
    return out.match(/URL=(.*)/)?.[1];
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('carga del .env en los scripts (npm run db:print decía "Define SUPABASE_URL…" con el .env completo)', () => {
  for (const script of ['scripts/db.js', 'scripts/preflight.js', 'scripts/meta.js', 'scripts/crons-setup.js', 'scripts/smoke-prod.js']) {
    it(`${script} carga el .env antes de leer config/env.js`, () => {
      assert.equal(supabaseUrlSeenBy(script), FAKE_URL);
    });
  }
});

describe('loadDotEnv', () => {
  it('lee KEY=VALUE, quita comillas e ignora comentarios', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'envload-'));
    fs.writeFileSync(path.join(dir, '.env'), '# comentario\nA=1\r\nB="dos"\n\nSIN_IGUAL\n');
    const env = {};
    assert.equal(loadDotEnv({ cwd: dir, env }), 2);
    assert.deepEqual(env, { A: '1', B: 'dos' });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('no pisa variables ya definidas (Render manda sobre el .env)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'envload-'));
    fs.writeFileSync(path.join(dir, '.env'), 'A=del-archivo\n');
    const env = { A: 'de-render' };
    loadDotEnv({ cwd: dir, env });
    assert.equal(env.A, 'de-render');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('sin .env no hace nada', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'envload-'));
    assert.equal(loadDotEnv({ cwd: dir, env: {} }), 0);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
