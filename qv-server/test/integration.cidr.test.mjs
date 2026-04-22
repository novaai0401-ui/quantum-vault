/**
 * End-to-end test: CIDR allowlist rejects admin/metrics from off-list IPs.
 * Run: node --test qv-server/test/integration.cidr.test.mjs
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
const PORT      = 20800 + Math.floor(Math.random() * 300);
const BASE      = `http://127.0.0.1:${PORT}`;
const TOKEN     = 'cidr-test-admin-token-xxxxxxxxxxx';
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
  dataDir = mkdtempSync(join(tmpdir(), 'qv-cidr-'));
  // Allowlist contains 10.0.0.0/8 only — we bind to 127.0.0.1, so
  // all requests arrive from 127.0.0.1 and should be denied.
  child = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      QV_PORT: String(PORT), QV_HOST: '127.0.0.1',
      QV_DATA_DIR: dataDir, QV_ADMIN_TOKEN_SHA256: SHA,
      QV_WORKERS: '0', QV_AUDIT_STDOUT: 'false',
      QV_ADMIN_ALLOW_CIDRS: '10.0.0.0/8',
      QV_METRICS_ALLOW_CIDRS: '10.0.0.0/8',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', b => process.stderr.write(`[server stderr] ${b}`));
  await waitFor(`${BASE}/v3/live`);
});

after(() => {
  try { child.kill('SIGKILL'); } catch {}
  try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
});

test('admin endpoint: valid token but wrong IP → 403 IP_NOT_ALLOWED', async () => {
  const r = await fetch(`${BASE}/v3/keygen`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ label: 'x' }),
  });
  assert.equal(r.status, 403);
  const body = await r.json();
  assert.equal(body.error.code, 'IP_NOT_ALLOWED');
});

test('metrics: wrong IP → 403 IP_NOT_ALLOWED even with bearer', async () => {
  const r = await fetch(`${BASE}/v3/metrics`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  assert.equal(r.status, 403);
});

test('public endpoints still reachable from any IP', async () => {
  const r = await fetch(`${BASE}/v3/live`);
  assert.equal(r.status, 200);
});

test('X-Forwarded-For is honoured (10.0.0.5 is allowed)', async () => {
  const r = await fetch(`${BASE}/v3/keygen`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${TOKEN}`,
      'x-forwarded-for': '10.0.0.5',
    },
    body: JSON.stringify({ label: 'xff-allowed' }),
  });
  assert.equal(r.status, 201);
});
