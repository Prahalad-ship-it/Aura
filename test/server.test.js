import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
let serverProcess;
let baseUrl;

async function findAvailablePort() {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const { port } = probe.address();
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return port;
}

before(async () => {
  const port = await findAvailablePort();
  baseUrl = `http://127.0.0.1:${port}`;
  serverProcess = spawn(process.execPath, ['server.js'], {
    cwd: projectRoot,
    env: { ...process.env, PORT: String(port), NVIDIA_NIM_API_KEY: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await new Promise((resolve, reject) => {
    let output = '';
    const finish = (error) => {
      clearTimeout(timeout);
      serverProcess.stdout.off('data', onOutput);
      serverProcess.off('error', onError);
      serverProcess.off('exit', onExit);
      if (error) reject(error);
      else resolve();
    };
    const onOutput = (chunk) => {
      output += chunk.toString();
      if (output.includes('Aura is running at')) finish();
    };
    const onError = (error) => finish(error);
    const onExit = (code) => finish(new Error(`Server exited with code ${code}: ${output}`));
    const timeout = setTimeout(() => finish(new Error(`Server did not start: ${output}`)), 8_000);
    serverProcess.stdout.on('data', onOutput);
    serverProcess.once('error', onError);
    serverProcess.once('exit', onExit);
  });
});

after(() => {
  serverProcess?.kill();
});

async function postChat(body) {
  return fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('immediate danger bypasses NIM and requests the SOS drawer', async () => {
  const response = await postChat({ message: 'Someone is following me', history: [] });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    reply: "I'm glad you told me. Press SOS or call 911 now. Move toward a staffed or public place if you can do so safely.",
    emergency: true,
    ui_takeover: 'EMERGENCY_DRAWER_ACTIVE',
    trigger_911_hook: true,
  });
});

test('explicit safe-word activation requests the SOS drawer', async () => {
  const response = await postChat({ message: 'I need immediate help now.', safeWordActivated: true, history: [] });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.emergency, true);
  assert.equal(body.ui_takeover, 'EMERGENCY_DRAWER_ACTIVE');
  assert.equal(body.trigger_911_hook, true);
});

test('ordinary chat explains that a server-side NVIDIA key is required', async () => {
  const response = await postChat({ message: 'Help me say no politely.', history: [] });
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.match(body.error, /NVIDIA_NIM_API_KEY/);
});

test('privacy policy is served as a readable page', async () => {
  const response = await fetch(`${baseUrl}/privacy.html`);
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.match(body, /Privacy, in plain language/);
  assert.match(body, /Voice SOS/);
  assert.match(body, /NVIDIA NIM/);
});

test('recording analysis requires the server-side NVIDIA key', async () => {
  const response = await fetch(`${baseUrl}/api/analyze-recording`, {
    method: 'POST',
    headers: { 'Content-Type': 'audio/webm' },
    body: 'sample audio bytes',
  });
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.match(body.error, /NVIDIA_NIM_API_KEY/);
});