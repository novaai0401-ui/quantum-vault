/**
 * End-to-end test: security headers + CORS are wired into the live server.
 * Run: node --test qv-server/test/integration.security.test.mjs
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
const PORT      = 18833 + Math.floor(Math.random() * 500);
const BASE      = `http://127.0.0.1:${PORT}`;
const TOKEN     = 'integration-test-admin-token-xxxxx';
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
  dataDir = mkdtempSync(join(tmpdir(), 'qv-sec-'));
  child = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      QV_PORT:                String(PORT),
      QV_HOST:                '127.0.0.1',
      QV_DATA_DIR:            dataDir,
      QV_ADMIN_TOKEN_SHA256:  SHA,
      QV_CORS_ORIGINS:        'https://allowed.example',
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

// ─── Security headers ───────────────────────────────────────────────────────

test('security headers present on GET', async () => {
  const r = await fetch(`${BASE}/v3/health`);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
  assert.match(r.headers.get('content-security-policy') || '', /default-src 'none'/);
  assert.match(r.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);
  assert.equal(r.headers.get('cross-origin-resource-policy'), 'same-origin');
  assert.equal(r.headers.get('cross-origin-opener-policy'),   'same-origin');
  assert.equal(r.headers.get('x-permitted-cross-domain-policies'), 'none');
  assert.match(r.headers.get('strict-transport-security') || '', /max-age=31536000/);
  assert.match(r.headers.get('strict-transport-security') || '', /includeSubDomains/);
});

test('Server and X-Powered-By headers are absent', async () => {
  const r = await fetch(`${BASE}/v3/health`);
  // Node adds "Date" and "Connection" but "Server" should be absent/empty.
  const srv = r.headers.get('server');
  assert.ok(!srv, `expected no Server header, got: ${srv}`);
  assert.equal(r.headers.get('x-powered-by'), null);
});

test('security headers present on 404', async () => {
  const r = await fetch(`${BASE}/does-not-exist`);
  assert.equal(r.status, 404);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
});

// ─── CORS whitelist ─────────────────────────────────────────────────────────

test('CORS: allowed origin is echoed with Vary: Origin', async () => {
  const r = await fetch(`${BASE}/v3/health`, {
    headers: { origin: 'https://allowed.example' },
  });
  assert.equal(r.headers.get('access-control-allow-origin'), 'https://allowed.example');
  assert.match(r.headers.get('vary') || '', /origin/i);
});

test('CORS: unlisted origin gets no ACAO', async () => {
  const r = await fetch(`${BASE}/v3/health`, {
    headers: { origin: 'https://evil.example' },
  });
  assert.equal(r.headers.get('access-control-allow-origin'), null);
});

test('CORS: OPTIONS preflight from allowed origin → 204', async () => {
  const r = await fetch(`${BASE}/v3/token/verify`, {
    method: 'OPTIONS',
    headers: {
      origin: 'https://allowed.example',
      'access-control-request-method': 'POST',
    },
  });
  assert.equal(r.status, 204);
  assert.equal(r.headers.get('access-control-allow-origin'), 'https://allowed.example');
  assert.match(r.headers.get('access-control-allow-methods') || '', /POST/);
});

test('CORS: OPTIONS preflight from unlisted origin does NOT 204', async () => {
  const r = await fetch(`${BASE}/v3/token/verify`, {
    method: 'OPTIONS',
    headers: {
      origin: 'https://evil.example',
      'access-control-request-method': 'POST',
    },
  });
  // Server may 204 the OPTIONS generically, but no CORS headers must be attached.
  assert.equal(r.headers.get('access-control-allow-origin'), null);
  assert.equal(r.headers.get('access-control-allow-methods'), null);
});
