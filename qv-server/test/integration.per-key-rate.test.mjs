/**
 * Integration: per-key rate limiting on /v3/token/issue.
 *
 * Boots a real qv-server with QV_RATE_PER_KEY_ISSUE_RPM=3 and confirms:
 *   1. The 4th issue against one keyId is 429 with code RATE_LIMITED_PER_KEY.
 *   2. A second keyId is unaffected (separate bucket).
 *   3. The override (key-vip → 100) raises the ceiling for one key.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER    = join(__dirname, '..', 'server-sovereign.mjs');

async function waitFor(url, ms = 8000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try { const r = await fetch(url); if (r.ok) return; } catch {}
    await new Promise(r => setTimeout(r, 80));
  }
  throw new Error(`server at ${url} did not become ready in ${ms}ms`);
}

test('per-key rate limit denies 4th issue against same keyId, allows other key', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qv-pkrate-'));
  const port = 30000 + Math.floor(Math.random() * 30000);
  const token = 'd'.repeat(64);
  const sha256 = createHash('sha256').update(token).digest('hex');
  const env = {
    ...process.env,
    QV_HOST: '127.0.0.1', QV_PORT: String(port),
    QV_DATA_DIR: dir,
    QV_ADMIN_TOKEN_SHA256: sha256,
    QV_MASTER_KEY_HEX: '44'.repeat(32),
    QV_AUDIT_ENABLED: 'false',
    // Keep IP-level admin bucket high so per-key is the throttle that fires.
    QV_RATE_ADMIN_RPM: '10000',
    QV_RATE_PER_KEY_ISSUE_RPM: '3',
  };
  const child = spawn(process.execPath, [SERVER], { env, stdio: 'pipe' });
  child.stderr.on('data', () => {});
  child.stdout.on('data', () => {});
  const base = `http://127.0.0.1:${port}`;
  const auth = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

  try {
    await waitFor(`${base}/v3/ready`);

    // Provision two keys.
    const k1 = await (await fetch(`${base}/v3/keygen`, {
      method: 'POST', headers: auth, body: JSON.stringify({ label: 'hot' }),
    })).json();
    const k2 = await (await fetch(`${base}/v3/keygen`, {
      method: 'POST', headers: auth, body: JSON.stringify({ label: 'cool' }),
    })).json();

    async function issue(kid) {
      return fetch(`${base}/v3/token/issue`, {
        method: 'POST', headers: auth,
        body: JSON.stringify({ keyId: kid, claims: { sub: 'probe' }, ttl: 60 }),
      });
    }

    // 3 issues against k1 — all succeed.
    for (let i = 0; i < 3; i++) {
      const r = await issue(k1.keyId);
      assert.equal(r.status, 200, `request ${i+1} should be 200`);
    }
    // 4th — 429 with our specific code.
    const r4 = await issue(k1.keyId);
    assert.equal(r4.status, 429);
    assert.equal(r4.headers.get('retry-after') !== null, true);
    assert.equal(r4.headers.get('x-ratelimit-limit'), '3');
    const body = await r4.json();
    assert.equal(body.error.code, 'RATE_LIMITED_PER_KEY');

    // Second key is unaffected (separate bucket).
    const rOther = await issue(k2.keyId);
    assert.equal(rOther.status, 200, 'other keyId must be unaffected');
  } finally {
    child.kill('SIGKILL');
    await new Promise(r => child.once('exit', r));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('per-key override raises the ceiling for a specific keyId', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qv-pkrate-vip-'));
  const port = 30000 + Math.floor(Math.random() * 30000);
  const token = 'e'.repeat(64);
  const sha256 = createHash('sha256').update(token).digest('hex');

  // We provision the override AFTER keygen. To do that we need the keyId
  // ahead of time. Approach: boot once, keygen, capture the id, then
  // restart with the override pinned. (Production operators do this from
  // a Helm value or systemd EnvironmentFile after the keys are minted.)

  // Phase 1: provision the key.
  const env1 = {
    ...process.env,
    QV_HOST: '127.0.0.1', QV_PORT: String(port),
    QV_DATA_DIR: dir,
    QV_ADMIN_TOKEN_SHA256: sha256,
    QV_MASTER_KEY_HEX: '55'.repeat(32),
    QV_AUDIT_ENABLED: 'false',
    QV_RATE_ADMIN_RPM: '10000',
  };
  let child = spawn(process.execPath, [SERVER], { env: env1, stdio: 'pipe' });
  child.stderr.on('data', () => {});
  child.stdout.on('data', () => {});
  const base = `http://127.0.0.1:${port}`;
  const auth = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

  let vipId;
  try {
    await waitFor(`${base}/v3/ready`);
    const k = await (await fetch(`${base}/v3/keygen`, {
      method: 'POST', headers: auth, body: JSON.stringify({ label: 'vip' }),
    })).json();
    vipId = k.keyId;
  } finally {
    child.kill('SIGKILL');
    await new Promise(r => child.once('exit', r));
  }

  // Phase 2: relaunch with default=2 + vip override=20.
  const env2 = {
    ...env1,
    QV_RATE_PER_KEY_ISSUE_RPM: '2',
    QV_RATE_PER_KEY_OVERRIDES: JSON.stringify({ [vipId]: 20 }),
  };
  child = spawn(process.execPath, [SERVER], { env: env2, stdio: 'pipe' });
  child.stderr.on('data', () => {});
  child.stdout.on('data', () => {});

  try {
    await waitFor(`${base}/v3/ready`);
    let allowed = 0;
    for (let i = 0; i < 10; i++) {
      const r = await fetch(`${base}/v3/token/issue`, {
        method: 'POST', headers: auth,
        body: JSON.stringify({ keyId: vipId, claims: { i }, ttl: 60 }),
      });
      if (r.status === 200) allowed++;
    }
    // VIP override should let us through 10 issues (well above default=2).
    assert.equal(allowed, 10, `expected 10 allowed for vip, got ${allowed}`);
  } finally {
    child.kill('SIGKILL');
    await new Promise(r => child.once('exit', r));
    rmSync(dir, { recursive: true, force: true });
  }
});
