/**
 * End-to-end test: server-sovereign.mjs with admin auth wired in.
 * Spawns the server in a child process, hits it via fetch, asserts.
 *
 * Run: node --test qv-server/test/integration.auth.test.mjs
 */

import { test, before, after } from 'node:test';
import assert                  from 'node:assert/strict';
import { spawn }               from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir }              from 'node:os';
import { join, dirname }       from 'node:path';
import { fileURLToPath }       from 'node:url';
import { createHash }          from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER    = join(__dirname, '..', 'server-sovereign.mjs');
const PORT      = 17733 + Math.floor(Math.random() * 1000);
const BASE      = `http://127.0.0.1:${PORT}`;
const TOKEN     = 'integration-test-admin-token-xxxxx'; // 34 chars
const SHA       = createHash('sha256').update(TOKEN, 'utf8').digest('hex');

let child, dataDir;

function waitFor(url, ms = 5000) {
  const deadline = Date.now() + ms;
  return (async function loop() {
    while (Date.now() < deadline) {
      try { const r = await fetch(url); if (r.ok) return true; } catch {}
      await new Promise(r => setTimeout(r, 100));
    }
    throw new Error(`server at ${url} did not come up in ${ms}ms`);
  })();
}

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'qv-it-'));
  child = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      QV_PORT:                String(PORT),
      QV_HOST:                '127.0.0.1',
      QV_DATA_DIR:            dataDir,
      QV_ADMIN_TOKEN_SHA256:  SHA,
      QV_WORKERS:             '0', // keep the test deterministic
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', b => process.stderr.write(`[server stderr] ${b}`));
  await waitFor(`${BASE}/v3/health`);
});

after(() => {
  try { child.kill('SIGKILL'); } catch {}
  try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
});

// ─── Public endpoints stay open ─────────────────────────────────────────────

test('GET /v3/health is public', async () => {
  const r = await fetch(`${BASE}/v3/health`);
  assert.equal(r.status, 200);
  const body = await r.json();
  // status transitioned from 'ok' → 'ready' in R-4.3.7 (health/readiness split).
  assert.ok(['ok', 'ready'].includes(body.status), `unexpected status: ${body.status}`);
});

test('GET /v3/spec is public', async () => {
  const r = await fetch(`${BASE}/v3/spec`);
  assert.equal(r.status, 200);
});

test('GET /v3/keys is public', async () => {
  const r = await fetch(`${BASE}/v3/keys`);
  assert.equal(r.status, 200);
});

// ─── Mutating endpoints reject anonymous callers ────────────────────────────

test('POST /v3/keygen with no auth → 401', async () => {
  const r = await fetch(`${BASE}/v3/keygen`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  });
  assert.equal(r.status, 401);
  assert.equal(r.headers.get('www-authenticate'), 'Bearer realm="qv-admin"');
  const body = await r.json();
  assert.equal(body.error.code, 'UNAUTHORIZED');
});

test('POST /v3/keygen with bad bearer → 401 same body shape', async () => {
  const r = await fetch(`${BASE}/v3/keygen`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer totally-wrong-token-value' },
    body: '{}',
  });
  assert.equal(r.status, 401);
});

test('POST /v3/token/issue with no auth → 401', async () => {
  const r = await fetch(`${BASE}/v3/token/issue`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ keyId: 'x', claims: { a: 1 } }),
  });
  assert.equal(r.status, 401);
});

test('DELETE /v3/keys/:id with no auth → 401', async () => {
  const r = await fetch(`${BASE}/v3/keys/anything`, { method: 'DELETE' });
  assert.equal(r.status, 401);
});

// ─── Happy path: full keygen → issue → verify → revoke cycle ────────────────

test('full flow with admin token works end-to-end', async () => {
  const authH = { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` };

  // keygen
  const kg = await fetch(`${BASE}/v3/keygen`, { method: 'POST', headers: authH, body: '{"label":"it-key"}' });
  assert.equal(kg.status, 201);
  const { keyId } = await kg.json();
  assert.ok(keyId);

  // issue
  const iss = await fetch(`${BASE}/v3/token/issue`, {
    method: 'POST', headers: authH,
    body: JSON.stringify({ keyId, claims: { sub: 'it-user', role: 'tester' }, ttl: 60 }),
  });
  assert.equal(iss.status, 200);
  const { tokenB64 } = await iss.json();
  assert.ok(tokenB64);

  // verify (public endpoint — no auth header needed)
  const ver = await fetch(`${BASE}/v3/token/verify`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ keyId, token: tokenB64 }),
  });
  assert.equal(ver.status, 200);
  const verBody = await ver.json();
  assert.equal(verBody.valid, true);
  assert.equal(verBody.claims.sub, 'it-user');

  // revoke
  const rev = await fetch(`${BASE}/v3/keys/${keyId}`, { method: 'DELETE', headers: authH });
  assert.equal(rev.status, 200);

  // verify after revoke → 410
  const ver2 = await fetch(`${BASE}/v3/token/verify`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ keyId, token: tokenB64 }),
  });
  assert.equal(ver2.status, 410);
});

test('issuing with bad admin token is rejected', async () => {
  const r = await fetch(`${BASE}/v3/keygen`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer nope-nope-nope-nope-nope-nope' },
    body: '{}',
  });
  assert.equal(r.status, 401);
});
