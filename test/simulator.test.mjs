import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'child_process';
import path from 'path';

function runSimulator() {
  return new Promise((resolve) => {
    const script = path.resolve(process.cwd(), 'scripts', 'simulate-conversation.mjs');
    const child = spawn(process.execPath, [script], {
      env: { ...process.env, NODE_ENV: 'test' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (c) => { stdout += String(c); });
    child.stderr.on('data', (c) => { stderr += String(c); });

    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

test('simulator script runs and processes scenario', async () => {
  const { code, stdout, stderr } = await runSimulator();

  // Basic expectations
  assert.equal(code, 0, `Simulator exited with non-zero code. stderr:\n${stderr}`);

  // Expect the simulator to announce the listening port
  assert.ok(/Simulator webhook listening on http:\/\/localhost:4000\/webhook/.test(stdout), 'Did not find server listening message in stdout');

  // Expect at least one WhatsApp send log
  assert.ok(/>> \[WHATSAPP SEND\] to=51912345678 text=/.test(stdout), 'Did not find WhatsApp send logs');

  // Expect the HTTP POST to return 200 and EVENT_RECEIVED
  assert.ok(/HTTP POST status:\s*200/.test(stdout), 'Did not find HTTP POST 200 status');
  assert.ok(/HTTP POST response body:\s*EVENT_RECEIVED/.test(stdout), 'Did not find HTTP POST response body EVENT_RECEIVED');
});