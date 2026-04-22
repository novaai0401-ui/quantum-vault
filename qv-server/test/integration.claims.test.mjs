/**
 * End-to-end test: claims structural limits rejected at /v3/token/issue.
 * Run: node --test qv-server/test/integration.claims.test.mjs
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
const PORT      = 20500 + Math.floor(Math.random() * 300);
const BASE      = `http://127.0.0.1:${PORT}`;
const TOKEN     = 'claims-test-admin-token-xxxxxxxxxx';
const SHA       = createHash('sha256').update(TOKEN, 'utf8').digest('hex');

let child, dataDir, keyId;

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
  dataDir = mkdtempSync(join(tmpdir(), 'qv-cl-'));
  child = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      QV_PORT: String(PORT), QV_HOST: '127.0.0.1',
      QV_DATA_DIR: dataDir, QV_ADMIN_TOKEN_SHA256: SHA,
      QV_WORKERS: '0', QV_AUDIT_STDOUT: 'false',
      QV_CLAIMS_MAX_KEYS: '4', QV_CLAIMS_MAX_DEPTH: '3',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', b => process.stderr.write(`[server stderr] ${b}`));
  await waitFor(`${BASE}/v3/live`);

  const r = await fetch(`${BASE}/v3/keygen`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ label: 'claims-tests' }),
  });
  ({ keyId } = await r.json());
});

after(() => {
  try { child.kill('SIGKILL'); } catch {}
  try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
});

test('rejects too-many-keys with 400 + stable code', async () => {
  const claims = { a: 1, b: 2, c: 3, d: 4, e: 5 };
  const r = await fetch(`${BASE}/v3/token/issue`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ keyId, claims, ttl: 60 }),
  });
  assert.equal(r.status, 400);
  const body = await r.json();
  assert.equal(body.error.code, 'CLAIMS_TOO_MANY_KEYS');
});

test('rejects too-deep with 400', async () => {
  let v = { x: 1 };
  for (let i = 0; i < 6; i++) v = { inner: v };
  const r = await fetch(`${BASE}/v3/token/issue`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ keyId, claims: v, ttl: 60 }),
  });
  assert.equal(r.status, 400);
  const body = await r.json();
  assert.equal(body.error.code, 'CLAIMS_TOO_DEEP');
});

test('accepts well-formed claims', async () => {
  const r = await fetch(`${BASE}/v3/token/issue`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ keyId, claims: { sub: 'x', role: 'user' }, ttl: 60 }),
  });
  assert.equal(r.status, 200);
});
