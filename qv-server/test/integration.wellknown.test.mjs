/**
 * Integration: /.well-known/sigvault-keys.json key discovery document.
 *
 * JWKS-equivalent (proprietary shape — no final JWK mapping exists for
 * ML-DSA-87 yet). Lists active keys with fingerprint + vkB64u; revoked
 * keys drop out of the document.
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

test('GET /.well-known/sigvault-keys.json lists active keys, drops revoked', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qv-wk-'));
  const { child, token } = mkServer(dir, port);
  try {
    await waitFor(`http://127.0.0.1:${port}/v3/ready`);
    const base = `http://127.0.0.1:${port}`;

    // Empty keystore → empty document.
    const empty = await fetch(`${base}/.well-known/sigvault-keys.json`);
    assert.equal(empty.status, 200);
    assert.match(empty.headers.get('cache-control'), /max-age/);
    const emptyBody = await empty.json();
    assert.deepEqual(emptyBody, { keys: [], count: 0 });

    // Two keys → both discoverable with fingerprint + vkB64u.
    const mkKey = async (label) => {
      const r = await fetch(`${base}/v3/keygen`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ label }),
      });
      return (await r.json()).keyId;
    };
    const k1 = await mkKey('wk-one');
    const k2 = await mkKey('wk-two');

    const doc = await fetch(`${base}/.well-known/sigvault-keys.json`);
    const body = await doc.json();
    assert.equal(body.count, 2);
    const ids = body.keys.map(k => k.keyId).sort();
    assert.deepEqual(ids, [k1, k2].sort());
    for (const k of body.keys) {
      assert.match(k.fingerprint, /^[0-9a-f]{32}$/);
      assert.ok(k.vkB64u.length > 1000, 'vkB64u should carry the full 2592-byte VK');
      assert.equal(k.algorithm, 'ML-DSA-87');
      assert.equal(k.suite, 'dilithium5');
      assert.equal(typeof k.createdAt, 'number');
    }

    // Cross-check: fingerprint from the doc resolves via /v3/keys/identify.
    const id = await fetch(`${base}/v3/keys/identify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fingerprint: body.keys[0].fingerprint }),
    });
    assert.equal(id.status, 200);
    assert.equal((await id.json()).keyId, body.keys[0].keyId);

    // Revoke one → it drops out of the document.
    const rv = await fetch(`${base}/v3/keys/${k1}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` },
    });
    assert.equal(rv.status, 200);
    const after = await (await fetch(`${base}/.well-known/sigvault-keys.json`)).json();
    assert.equal(after.count, 1);
    assert.equal(after.keys[0].keyId, k2);
  } finally {
    child.kill('SIGKILL');
    await new Promise(r => child.once('exit', r));
    rmSync(dir, { recursive: true, force: true });
  }
});
