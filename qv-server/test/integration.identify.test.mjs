/**
 * Integration: VK fingerprint → keyId lookup.
 *
 * Operationally closes limitation L2 (no kid in token header) — a caller
 * that has a verifying key but not the keyId can resolve it in one call.
 */

import { test } from 'node:test';
import assert  from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
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

function mkServer(dataDir, port) {
  const token  = 'feedfacecafebabe'.repeat(4);
  const sha256 = createHash('sha256').update(token).digest('hex');
  const env = {
    ...process.env,
    QV_HOST: '127.0.0.1', QV_PORT: String(port),
    QV_DATA_DIR: dataDir,
    QV_ADMIN_TOKEN_SHA256: sha256,
    QV_MASTER_KEY_HEX: '22'.repeat(32),
    QV_RATE_LIMIT_DISABLED: 'true',
    QV_AUDIT_ENABLED: 'false',
  };
  const child = spawn(process.execPath, [SERVER], { env, stdio: 'pipe' });
  child.stderr.on('data', () => {});
  child.stdout.on('data', () => {});
  return { child, token };
}

const port = 20000 + Math.floor(Math.random() * 40000);

test('POST /v3/keys/identify resolves vkB64u → keyId in O(1)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qv-id-'));
  const { child, token } = mkServer(dir, port);
  try {
    await waitFor(`http://127.0.0.1:${port}/v3/ready`);

    const kg = await fetch(`http://127.0.0.1:${port}/v3/keygen`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'identify-probe' }),
    });
    const { keyId, verifyingKeyB64 } = await kg.json();

    // Identify by vkB64u
    const id = await fetch(`http://127.0.0.1:${port}/v3/keys/identify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vkB64u: verifyingKeyB64 }),
    });
    assert.equal(id.status, 200);
    const idBody = await id.json();
    assert.equal(idBody.keyId, keyId);
    assert.equal(idBody.revoked, false);
    assert.match(idBody.fingerprint, /^[0-9a-f]{32}$/);

    // Identify by fingerprint round-trip
    const id2 = await fetch(`http://127.0.0.1:${port}/v3/keys/identify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fingerprint: idBody.fingerprint }),
    });
    assert.equal(id2.status, 200);
    const idBody2 = await id2.json();
    assert.equal(idBody2.keyId, keyId);

    // 404 on unknown fingerprint
    const miss = await fetch(`http://127.0.0.1:${port}/v3/keys/identify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fingerprint: 'a'.repeat(32) }),
    });
    assert.equal(miss.status, 404);
    const missBody = await miss.json();
    assert.equal(missBody.error.code, 'KEY_NOT_FOUND');

    // 400 on bad input
    const bad = await fetch(`http://127.0.0.1:${port}/v3/keys/identify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(bad.status, 400);
  } finally {
    child.kill('SIGKILL');
    await new Promise(r => child.once('exit', r));
    rmSync(dir, { recursive: true, force: true });
  }
});
