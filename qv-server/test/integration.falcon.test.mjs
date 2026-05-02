/**
 * Integration: /v3/admin/falcon/sign + /v3/falcon/verify HTTP path.
 *
 * Skipped when qv-cli isn't built. The falcon bridge is operationally
 * optional (zero-Falcon deployments should pass without qv-cli on host).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER    = join(__dirname, '..', 'server-sovereign.mjs');
const REPO      = resolve(__dirname, '..', '..');

function findCli() {
  const exts = process.platform === 'win32' ? ['.exe', ''] : [''];
  for (const ext of exts) {
    for (const p of [
      join(REPO, 'target', 'release', 'qv' + ext),
      join(REPO, 'target', 'debug',   'qv' + ext),
    ]) if (existsSync(p)) return p;
  }
  return null;
}
const CLI = findCli();
const SKIP = !CLI;

async function waitFor(url, ms = 8000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try { const r = await fetch(url); if (r.ok) return; } catch {}
    await new Promise(r => setTimeout(r, 80));
  }
  throw new Error(`server at ${url} did not become ready in ${ms}ms`);
}

test('Falcon-512 sign + verify roundtrip via HTTP', { skip: SKIP }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qv-falcon-int-'));
  const port = 30000 + Math.floor(Math.random() * 30000);
  const token = 'f'.repeat(64);
  const sha256 = createHash('sha256').update(token).digest('hex');

  // Pre-mint Falcon keys via the CLI (the server doesn't store Falcon keys
  // — that's part of v4.4 SDK work).
  const skPath = join(dir, 'sk.bin');
  const vkPath = join(dir, 'vk.bin');
  const r = spawnSync(CLI, ['falcon-keygen', '--n', '512', '--sk-out', skPath, '--vk-out', vkPath]);
  assert.equal(r.status, 0);
  const sk = readFileSync(skPath);
  const vk = readFileSync(vkPath);

  const env = {
    ...process.env,
    QV_HOST: '127.0.0.1', QV_PORT: String(port),
    QV_DATA_DIR: dir,
    QV_ADMIN_TOKEN_SHA256: sha256,
    QV_MASTER_KEY_HEX: '88'.repeat(32),
    QV_AUDIT_ENABLED: 'false',
    QV_RATE_ADMIN_RPM: '10000',
    QV_CLI_BIN: CLI,
  };
  const child = spawn(process.execPath, [SERVER], { env, stdio: 'pipe' });
  child.stderr.on('data', () => {});
  child.stdout.on('data', () => {});
  const base = `http://127.0.0.1:${port}`;
  const auth = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

  try {
    await waitFor(`${base}/v3/ready`);

    const message = Buffer.from('the post-quantum lazy fox');
    // Sign via admin endpoint.
    const signR = await fetch(`${base}/v3/admin/falcon/sign`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({
        n: 512,
        signingKey: sk.toString('hex'),
        message: message.toString('hex'),
      }),
    });
    assert.equal(signR.status, 200);
    const signed = await signR.json();
    assert.equal(signed.n, 512);
    assert.match(signed.sigHex, /^[0-9a-f]+$/);
    assert.ok(signed.sigBytes > 0);

    // Verify via public endpoint — must be VALID.
    const vR = await fetch(`${base}/v3/falcon/verify`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        n: 512,
        verifyingKey: vk.toString('hex'),
        message: message.toString('hex'),
        signature: signed.sigHex,
      }),
    });
    assert.equal(vR.status, 200);
    const vBody = await vR.json();
    assert.equal(vBody.valid, true);

    // Verify with tampered message — must be INVALID (not error).
    const tampered = Buffer.from('the post-quantum lazy FOX');
    const vR2 = await fetch(`${base}/v3/falcon/verify`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        n: 512,
        verifyingKey: vk.toString('hex'),
        message: tampered.toString('hex'),
        signature: signed.sigHex,
      }),
    });
    assert.equal(vR2.status, 200);
    assert.equal((await vR2.json()).valid, false);

    // Bad n surfaces structured 400.
    const bad = await fetch(`${base}/v3/falcon/verify`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ n: 256, verifyingKey: 'aa', message: 'aa', signature: 'aa' }),
    });
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error.code, 'FALCON_BAD_N');

    // Sign without admin bearer is 401.
    const noAuth = await fetch(`${base}/v3/admin/falcon/sign`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ n: 512, signingKey: sk.toString('hex'), message: message.toString('hex') }),
    });
    assert.equal(noAuth.status, 401);
  } finally {
    child.kill('SIGKILL');
    await new Promise(r => child.once('exit', r));
    rmSync(dir, { recursive: true, force: true });
  }
});
