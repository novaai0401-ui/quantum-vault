/**
 * Integration: GET /v3/keys/{keyId}/quota — per-key rate-limit observability.
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

test('GET /v3/keys/{keyId}/quota reflects configured ceiling and consumed tokens', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qv-quota-'));
  const port = 30000 + Math.floor(Math.random() * 30000);
  const token = 'q'.repeat(64);
  const sha256 = createHash('sha256').update(token).digest('hex');
  const env = {
    ...process.env,
    QV_HOST: '127.0.0.1', QV_PORT: String(port),
    QV_DATA_DIR: dir,
    QV_ADMIN_TOKEN_SHA256: sha256,
    QV_MASTER_KEY_HEX: '66'.repeat(32),
    QV_AUDIT_ENABLED: 'false',
    QV_RATE_ADMIN_RPM: '10000',
    QV_RATE_PER_KEY_ISSUE_RPM: '5',
  };
  const child = spawn(process.execPath, [SERVER], { env, stdio: 'pipe' });
  child.stderr.on('data', () => {});
  child.stdout.on('data', () => {});
  const base = `http://127.0.0.1:${port}`;
  const auth = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

  try {
    await waitFor(`${base}/v3/ready`);

    // Provision a key.
    const k = await (await fetch(`${base}/v3/keygen`, {
      method: 'POST', headers: auth, body: JSON.stringify({ label: 'quota' }),
    })).json();

    // Quota before any issue: tokens = capacity.
    let r = await fetch(`${base}/v3/keys/${k.keyId}/quota`);
    assert.equal(r.status, 200);
    let body = await r.json();
    assert.equal(body.keyId, k.keyId);
    assert.equal(body.revoked, false);
    assert.equal(body.issue.configured, true);
    assert.equal(body.issue.effectiveRpm, 5);
    assert.equal(body.issue.defaultRpm, 5);
    assert.equal(body.issue.overrideRpm, null);
    assert.equal(body.issue.tokens, 5);

    // Issue 3 tokens.
    for (let i = 0; i < 3; i++) {
      const ir = await fetch(`${base}/v3/token/issue`, {
        method: 'POST', headers: auth,
        body: JSON.stringify({ keyId: k.keyId, claims: { i }, ttl: 60 }),
      });
      assert.equal(ir.status, 200);
    }

    // Quota now reflects consumption (within refill jitter — allow ≤3 tokens left).
    r = await fetch(`${base}/v3/keys/${k.keyId}/quota`);
    body = await r.json();
    assert.ok(body.issue.tokens <= 3,
      `expected ≤3 tokens after 3 issues, got ${body.issue.tokens}`);
    assert.equal(body.issue.firstSeen, true);

    // 404 on unknown keyId.
    const miss = await fetch(`${base}/v3/keys/${'a'.repeat(36)}/quota`);
    assert.equal(miss.status, 404);
  } finally {
    child.kill('SIGKILL');
    await new Promise(r => child.once('exit', r));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('GET /v3/health surfaces enriched fields', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qv-health-'));
  const port = 30000 + Math.floor(Math.random() * 30000);
  const env = {
    ...process.env,
    QV_HOST: '127.0.0.1', QV_PORT: String(port),
    QV_DATA_DIR: dir,
    QV_ADMIN_TOKEN_SHA256: 'a'.repeat(64),
    QV_MASTER_KEY_HEX: '77'.repeat(32),
    QV_AUDIT_ENABLED: 'false',
  };
  const child = spawn(process.execPath, [SERVER], { env, stdio: 'pipe' });
  child.stderr.on('data', () => {});
  child.stdout.on('data', () => {});
  const base = `http://127.0.0.1:${port}`;

  try {
    await waitFor(`${base}/v3/ready`);
    const r = await fetch(`${base}/v3/health`);
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.ok, true);
    assert.equal(body.chainStore, 'file');
    assert.equal(body.writerLock.held, true);
    assert.match(body.writerLock.fence, /^\d+$/);
    assert.ok(typeof body.uptimeSeconds === 'number');
    assert.equal(body.dependencies, 'zero-npm');
    assert.equal(body.keysLoaded, 0);
    assert.equal(body.keysRevoked, 0);
  } finally {
    child.kill('SIGKILL');
    await new Promise(r => child.once('exit', r));
    rmSync(dir, { recursive: true, force: true });
  }
});
