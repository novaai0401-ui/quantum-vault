/**
 * End-to-end test: /v3/metrics Prometheus exposition.
 * Run: node --test qv-server/test/integration.metrics.test.mjs
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
const PORT      = 20100 + Math.floor(Math.random() * 300);
const BASE      = `http://127.0.0.1:${PORT}`;
const TOKEN     = 'metrics-test-admin-token-xxxxxxxxxx';
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
  dataDir = mkdtempSync(join(tmpdir(), 'qv-m-'));
  child = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      QV_PORT:                String(PORT),
      QV_HOST:                '127.0.0.1',
      QV_DATA_DIR:            dataDir,
      QV_ADMIN_TOKEN_SHA256:  SHA,
      QV_WORKERS:             '0',
      QV_AUDIT_STDOUT:        'false',
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

test('/v3/metrics: requires admin bearer by default', async () => {
  const r = await fetch(`${BASE}/v3/metrics`);
  assert.equal(r.status, 401);
});

test('/v3/metrics: returns Prometheus text with admin bearer', async () => {
  // Generate some traffic so the counters have values.
  await fetch(`${BASE}/v3/live`);
  await fetch(`${BASE}/v3/ready`);

  const r = await fetch(`${BASE}/v3/metrics`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type') || '', /text\/plain/);
  assert.match(r.headers.get('content-type') || '', /version=0\.0\.4/);
  const body = await r.text();

  // Standard metadata lines
  assert.match(body, /# TYPE qv_http_requests_total counter/);
  assert.match(body, /# TYPE qv_http_request_duration_seconds histogram/);
  assert.match(body, /# TYPE qv_keys_total gauge/);

  // Request counter must label by route template, never the raw URL.
  assert.match(body, /qv_http_requests_total\{[^}]*path="\/v3\/live"[^}]*\} \d+/);
  assert.match(body, /qv_http_requests_total\{[^}]*path="\/v3\/ready"[^}]*\} \d+/);

  // Histogram bucket lines present.
  assert.match(body, /qv_http_request_duration_seconds_bucket\{[^}]*le="0\.001"/);
  assert.match(body, /qv_http_request_duration_seconds_bucket\{[^}]*le="\+Inf"/);

  // Inflight + uptime gauges present.
  assert.match(body, /qv_inflight_requests \d+/);
  assert.match(body, /qv_process_uptime_seconds \d+/);
});

test('/v3/metrics: auth.deny counter increments on bad bearer', async () => {
  // Trigger a deny.
  await fetch(`${BASE}/v3/keygen`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer wrong-token-xxxxxxxxxxxxxxxxxxxx' },
    body: '{}',
  });
  const r = await fetch(`${BASE}/v3/metrics`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  const body = await r.text();
  assert.match(body, /qv_auth_denies_total\{reason="bad_token"\} \d+/);
});

test('/v3/metrics: token.issue counter increments', async () => {
  // Issue a key first.
  const kg = await fetch(`${BASE}/v3/keygen`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ label: 'metrics-probe' }),
  });
  assert.equal(kg.status, 201);
  const { keyId } = await kg.json();

  // Issue a token.
  const iss = await fetch(`${BASE}/v3/token/issue`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ keyId, claims: { sub: 'x' }, ttl: 60 }),
  });
  assert.equal(iss.status, 200);

  const r = await fetch(`${BASE}/v3/metrics`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  const body = await r.text();
  assert.match(body, /qv_token_issue_total\{[^}]*result="ok"[^}]*\} \d+/);
  assert.match(body, /qv_keys_total \d+/);
});

test('/v3/metrics: path label uses route TEMPLATE, not raw URL', async () => {
  // Keyed routes would explode cardinality if we used raw URLs. Hit an :id route.
  const kg = await fetch(`${BASE}/v3/keygen`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ label: 'template-probe' }),
  });
  const { keyId } = await kg.json();
  await fetch(`${BASE}/v3/keys/${keyId}`);
  await fetch(`${BASE}/v3/keys/another-fake-id`);

  const r = await fetch(`${BASE}/v3/metrics`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  const body = await r.text();
  // The two different keyIds should collapse under a single template label.
  const matches = body.match(/qv_http_requests_total\{[^}]*path="\/v3\/keys\/:id"[^}]*\}/g) || [];
  assert.ok(matches.length > 0, 'should have entries under :id template');
  // The raw keyId should never appear as a label value.
  assert.ok(!body.includes(`path="/v3/keys/${keyId}"`));
});
