/**
 * Integration: master-key provider backends.
 *
 * Boots a real server with each backend (env, file, exec) and asserts that:
 *   - it comes up cleanly,
 *   - keygen + issue work,
 *   - the same backend on a second boot decrypts the keystore (proving the
 *     master key was deterministic, not random per boot).
 */

import { test } from 'node:test';
import assert   from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER    = join(__dirname, '..', 'server-sovereign.mjs');

function waitFor(url, ms = 8000) {
  const deadline = Date.now() + ms;
  return (async function loop() {
    while (Date.now() < deadline) {
      try { const r = await fetch(url); if (r.ok) return true; } catch {}
      await new Promise(r => setTimeout(r, 80));
    }
    throw new Error(`server at ${url} did not come up in ${ms}ms`);
  })();
}

const ADMIN_TOKEN  = 'deadbeefcafef00d'.repeat(4);
const ADMIN_SHA256 = createHash('sha256').update(ADMIN_TOKEN).digest('hex');

function bootServer(env, port) {
  const child = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      QV_HOST: '127.0.0.1',
      QV_PORT: String(port),
      QV_ADMIN_TOKEN_SHA256: ADMIN_SHA256,
      QV_RATE_LIMIT_DISABLED: 'true',
      QV_AUDIT_ENABLED: 'false',
      ...env,
    },
    stdio: 'pipe',
  });
  child.stderr.on('data', (d) => { if (process.env.DEBUG_MK) process.stderr.write(`[srv] ${d}`); });
  child.stdout.on('data', (d) => { if (process.env.DEBUG_MK) process.stderr.write(`[srv-out] ${d}`); });
  return child;
}

function randPort() { return 30000 + Math.floor(Math.random() * 30000); }

async function smokeTest(port) {
  const r = await fetch(`http://127.0.0.1:${port}/v3/keygen`, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${ADMIN_TOKEN}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ label: 'mk-probe' }),
  });
  assert.ok(r.status === 200 || r.status === 201, `keygen status ${r.status}`);
  const { keyId } = await r.json();
  assert.ok(keyId, 'no keyId returned');

  const issue = await fetch(`http://127.0.0.1:${port}/v3/token/issue`, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${ADMIN_TOKEN}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ keyId, claims: { sub: 'unit' }, ttl: 60 }),
  });
  assert.equal(issue.status, 200, `issue status ${issue.status}`);
  return { keyId };
}

async function killServer(child) {
  child.kill('SIGKILL');
  await new Promise(r => child.once('exit', r));
}

/* ── env backend: deterministic across reboots ────────────────────────── */

test('env backend: server boots, keygen+issue, second boot decrypts keystore', async () => {
  const dir  = mkdtempSync(join(tmpdir(), 'qv-mkenv-'));
  const port = randPort();
  const HEX  = '11'.repeat(32);

  const c1 = bootServer({
    QV_DATA_DIR: dir,
    QV_MASTER_KEY_PROVIDER: 'env',
    QV_MASTER_KEY_HEX: HEX,
  }, port);
  try {
    await waitFor(`http://127.0.0.1:${port}/v3/ready`);
    const { keyId } = await smokeTest(port);
    assert.ok(keyId);
  } finally {
    await killServer(c1);
  }

  // Reboot with the same env hex on the same data dir — keystore must
  // unseal (different hex would throw).
  const port2 = randPort();
  const c2 = bootServer({
    QV_DATA_DIR: dir,
    QV_MASTER_KEY_PROVIDER: 'env',
    QV_MASTER_KEY_HEX: HEX,
  }, port2);
  try {
    await waitFor(`http://127.0.0.1:${port2}/v3/ready`);
    const r = await fetch(`http://127.0.0.1:${port2}/v3/keys`, {
      headers: { 'Authorization': `Bearer ${ADMIN_TOKEN}` },
    });
    assert.equal(r.status, 200);
    const list = await r.json();
    assert.ok(Array.isArray(list.keys) && list.keys.length >= 1, 'keystore did not survive reboot');
  } finally {
    await killServer(c2);
  }

  rmSync(dir, { recursive: true, force: true });
});

/* ── file backend: generate-on-miss, persist, reload ──────────────────── */

test('file backend: generates master.key, persists across reboot', async () => {
  const dir  = mkdtempSync(join(tmpdir(), 'qv-mkfile-'));
  const port = randPort();

  const c1 = bootServer({ QV_DATA_DIR: dir, QV_MASTER_KEY_PROVIDER: 'file' }, port);
  try {
    await waitFor(`http://127.0.0.1:${port}/v3/ready`);
    await smokeTest(port);
    assert.ok(existsSync(join(dir, 'master.key')), 'master.key not generated');
  } finally {
    await killServer(c1);
  }

  // Reboot — keystore must unseal (proves file persisted, not regenerated).
  const port2 = randPort();
  const c2 = bootServer({ QV_DATA_DIR: dir, QV_MASTER_KEY_PROVIDER: 'file' }, port2);
  try {
    await waitFor(`http://127.0.0.1:${port2}/v3/ready`);
    const r = await fetch(`http://127.0.0.1:${port2}/v3/keys`, {
      headers: { 'Authorization': `Bearer ${ADMIN_TOKEN}` },
    });
    const list = await r.json();
    assert.ok(list.keys.length >= 1, 'keystore did not survive reboot');
  } finally {
    await killServer(c2);
  }

  rmSync(dir, { recursive: true, force: true });
});

/* ── exec backend: stdout is the key ──────────────────────────────────── */

test('exec backend: provider command supplies master key', async () => {
  const dir  = mkdtempSync(join(tmpdir(), 'qv-mkexec-'));
  const port = randPort();
  const HEX  = '22'.repeat(32);
  const cmd  = `node -e "process.stdout.write('${HEX}')"`;

  const c1 = bootServer({
    QV_DATA_DIR: dir,
    QV_MASTER_KEY_PROVIDER: 'exec',
    QV_MASTER_KEY_EXEC: cmd,
  }, port);
  try {
    await waitFor(`http://127.0.0.1:${port}/v3/ready`);
    await smokeTest(port);
  } finally {
    await killServer(c1);
  }

  // Reboot with the SAME exec command — keystore must unseal.
  const port2 = randPort();
  const c2 = bootServer({
    QV_DATA_DIR: dir,
    QV_MASTER_KEY_PROVIDER: 'exec',
    QV_MASTER_KEY_EXEC: cmd,
  }, port2);
  try {
    await waitFor(`http://127.0.0.1:${port2}/v3/ready`);
    const r = await fetch(`http://127.0.0.1:${port2}/v3/keys`, {
      headers: { 'Authorization': `Bearer ${ADMIN_TOKEN}` },
    });
    const list = await r.json();
    assert.ok(list.keys.length >= 1, 'exec backend did not give a deterministic key');
  } finally {
    await killServer(c2);
  }

  rmSync(dir, { recursive: true, force: true });
});

/* ── exec backend: failure surfaces a startup error ───────────────────── */

test('exec backend: provider exit-non-zero fails boot', async () => {
  const dir  = mkdtempSync(join(tmpdir(), 'qv-mkexec2-'));
  const port = randPort();
  const cmd  = `node -e "process.stderr.write('vault sealed'); process.exit(2)"`;

  const child = bootServer({
    QV_DATA_DIR: dir,
    QV_MASTER_KEY_PROVIDER: 'exec',
    QV_MASTER_KEY_EXEC: cmd,
  }, port);

  // Capture stderr to verify the error propagated.
  let stderr = '';
  child.stderr.removeAllListeners('data');
  child.stderr.on('data', (d) => { stderr += d.toString('utf8'); });

  const code = await new Promise(r => child.once('exit', r));
  assert.notEqual(code, 0, 'server should refuse to start when exec provider fails');
  assert.match(stderr, /exec.*exited 2.*vault sealed/s);

  rmSync(dir, { recursive: true, force: true });
});
