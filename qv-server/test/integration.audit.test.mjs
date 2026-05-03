/**
 * End-to-end test: Request-ID + structured JSONL audit log.
 * Run: node --test qv-server/test/integration.audit.test.mjs
 */

import { test, before, after } from 'node:test';
import assert                  from 'node:assert/strict';
import { spawn }               from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir }              from 'node:os';
import { join, dirname }       from 'node:path';
import { fileURLToPath }       from 'node:url';
import { createHash }          from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER    = join(__dirname, '..', 'server-sovereign.mjs');
const PORT      = 19100 + Math.floor(Math.random() * 500);
const BASE      = `http://127.0.0.1:${PORT}`;
const TOKEN     = 'integration-test-admin-token-xxxxx';
const SHA       = createHash('sha256').update(TOKEN, 'utf8').digest('hex');

let child, dataDir, logPath;

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

function readLog() {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
}

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'qv-au-'));
  logPath = join(dataDir, 'audit.log');
  child = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      QV_PORT:                String(PORT),
      QV_HOST:                '127.0.0.1',
      QV_DATA_DIR:            dataDir,
      QV_ADMIN_TOKEN_SHA256:  SHA,
      QV_AUDIT_STDOUT:        'false',
      QV_WORKERS:             '0',
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

// ─── Request-Id ─────────────────────────────────────────────────────────────

test('Request-Id: echoes caller-supplied id when safe', async () => {
  const r = await fetch(`${BASE}/v3/health`, {
    headers: { 'x-request-id': 'caller-test-id-001' },
  });
  assert.equal(r.headers.get('x-request-id'), 'caller-test-id-001');
});

test('Request-Id: mints UUID when caller omits', async () => {
  const r = await fetch(`${BASE}/v3/health`);
  const id = r.headers.get('x-request-id');
  assert.ok(id, 'x-request-id must be present');
  assert.match(id, /^[0-9a-f-]{36}$/);
});

test('Request-Id: rejects unsafe id, mints a fresh one', async () => {
  const r = await fetch(`${BASE}/v3/health`, {
    headers: { 'x-request-id': 'bad id with spaces & <script>' },
  });
  const id = r.headers.get('x-request-id');
  assert.notEqual(id, 'bad id with spaces & <script>');
  assert.match(id, /^[0-9a-f-]{36}$/);
});

// ─── Audit log contents ─────────────────────────────────────────────────────

test('audit log: http.request event written with status + ms + requestId', async () => {
  await fetch(`${BASE}/v3/health`, {
    headers: { 'x-request-id': 'audit-test-http-1' },
  });
  // Allow finish event to flush.
  await new Promise(r => setTimeout(r, 100));
  const events = readLog();
  const match = events.find(e => e.event === 'http.request' && e.requestId === 'audit-test-http-1');
  assert.ok(match, 'http.request event for audit-test-http-1 should exist');
  assert.equal(match.status, 200);
  assert.equal(match.method, 'GET');
  assert.equal(match.path, '/v3/health');
  assert.ok(typeof match.ms === 'number');
  assert.ok(match.ts, 'ts must be present');
});

test('audit log: auth.deny written on bad admin token', async () => {
  await fetch(`${BASE}/v3/keygen`, {
    method: 'POST',
    headers: {
      'content-type':   'application/json',
      authorization:    'Bearer wrong-token-xxxxxxxxxxxxxxxxxxxx',
      'x-request-id':   'audit-test-deny-1',
    },
    body: '{}',
  });
  await new Promise(r => setTimeout(r, 100));
  const events = readLog();
  const deny = events.find(e => e.event === 'auth.deny' && e.requestId === 'audit-test-deny-1');
  assert.ok(deny, 'auth.deny event should be logged');
  assert.equal(deny.reason, 'bad_token');
  assert.equal(deny.level, 'warn');
});

test('audit log: keygen event written on success', async () => {
  const r = await fetch(`${BASE}/v3/keygen`, {
    method: 'POST',
    headers: {
      'content-type':   'application/json',
      authorization:    `Bearer ${TOKEN}`,
      'x-request-id':   'audit-test-keygen-1',
    },
    body: JSON.stringify({ label: 'audit-test-key' }),
  });
  assert.equal(r.status, 201);
  await new Promise(r => setTimeout(r, 100));
  const events = readLog();
  const kg = events.find(e => e.event === 'keygen' && e.requestId === 'audit-test-keygen-1');
  assert.ok(kg, 'keygen event must be logged');
  assert.equal(kg.label, 'audit-test-key');
  assert.equal(kg.algorithm, 'ML-DSA-87');
  assert.ok(kg.keyId);
});

test('audit log: no admin token bytes leak into the log', async () => {
  // Hit every path that touches the token; verify the plaintext token never appears.
  await fetch(`${BASE}/v3/keygen`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization:  `Bearer ${TOKEN}`,
      'x-request-id': 'audit-test-leak-1',
    },
    body: JSON.stringify({ label: 'leak-check' }),
  });
  await new Promise(r => setTimeout(r, 100));
  const raw = existsSync(logPath) ? readFileSync(logPath, 'utf8') : '';
  assert.ok(!raw.includes(TOKEN), 'admin token plaintext MUST NOT appear in audit log');
  assert.ok(!raw.includes('Bearer '), 'Authorization header value MUST NOT appear');
});
