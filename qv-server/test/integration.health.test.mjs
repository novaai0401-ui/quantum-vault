/**
 * End-to-end test: /v3/live, /v3/ready, /v3/health.
 * Run: node --test qv-server/test/integration.health.test.mjs
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
const PORT      = 19900 + Math.floor(Math.random() * 300);
const BASE      = `http://127.0.0.1:${PORT}`;
const TOKEN     = 'health-test-admin-token-xxxxxxxxxx';
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
  dataDir = mkdtempSync(join(tmpdir(), 'qv-h-'));
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

test('/v3/live: 200 with alive + pid + uptimeSecs', async () => {
  const r = await fetch(`${BASE}/v3/live`);
  assert.equal(r.status, 200);
  const b = await r.json();
  assert.equal(b.status, 'alive');
  assert.ok(typeof b.pid === 'number');
  assert.ok(typeof b.uptimeSecs === 'number');
});

test('/v3/ready: 200 with status=ready after boot', async () => {
  const r = await fetch(`${BASE}/v3/ready`);
  assert.equal(r.status, 200);
  const b = await r.json();
  assert.equal(b.ok, true);
  assert.equal(b.status, 'ready');
  assert.equal(b.draining, false);
  assert.ok(typeof b.keysLoaded === 'number');
});

test('/v3/health: kept as ready alias for v4.2 back-compat', async () => {
  const r = await fetch(`${BASE}/v3/health`);
  assert.equal(r.status, 200);
  const b = await r.json();
  assert.equal(b.ok, true);
  assert.equal(b.status, 'ready');
});

test('all three probes emit security headers', async () => {
  for (const p of ['/v3/live', '/v3/ready', '/v3/health']) {
    const r = await fetch(`${BASE}${p}`);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff', p);
    assert.equal(r.headers.get('x-frame-options'), 'DENY', p);
    assert.ok(r.headers.get('x-request-id'), p);
  }
});
