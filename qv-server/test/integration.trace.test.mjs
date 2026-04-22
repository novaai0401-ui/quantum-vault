/**
 * End-to-end test: traceparent propagation.
 * Run: node --test qv-server/test/integration.trace.test.mjs
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
const PORT      = 21100 + Math.floor(Math.random() * 300);
const BASE      = `http://127.0.0.1:${PORT}`;
const TOKEN     = 'trace-test-admin-token-xxxxxxxxxxx';
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
  dataDir = mkdtempSync(join(tmpdir(), 'qv-tr-'));
  child = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      QV_PORT: String(PORT), QV_HOST: '127.0.0.1',
      QV_DATA_DIR: dataDir, QV_ADMIN_TOKEN_SHA256: SHA,
      QV_WORKERS: '0', QV_AUDIT_STDOUT: 'false',
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

test('mints traceparent when caller sends none', async () => {
  const r = await fetch(`${BASE}/v3/live`);
  const tp = r.headers.get('traceparent');
  assert.ok(tp, 'traceparent header must be present');
  assert.match(tp, /^00-[0-9a-f]{32}-[0-9a-f]{16}-(00|01)$/);
});

test('inherits traceId when caller sends traceparent', async () => {
  const traceId = 'a'.repeat(32);
  const spanId  = 'b'.repeat(16);
  const r = await fetch(`${BASE}/v3/live`, {
    headers: { traceparent: `00-${traceId}-${spanId}-01` },
  });
  const tp = r.headers.get('traceparent');
  assert.ok(tp.startsWith(`00-${traceId}-`), `expected inherited trace, got ${tp}`);
  // The server's span is a CHILD (different spanId).
  assert.ok(!tp.includes(spanId));
});

test('malformed traceparent → mints a fresh one', async () => {
  const r = await fetch(`${BASE}/v3/live`, {
    headers: { traceparent: 'nonsense' },
  });
  const tp = r.headers.get('traceparent');
  assert.match(tp, /^00-[0-9a-f]{32}-[0-9a-f]{16}-(00|01)$/);
  assert.ok(!tp.includes('nonsense'));
});

test('tracestate is echoed when valid', async () => {
  const r = await fetch(`${BASE}/v3/live`, {
    headers: {
      traceparent: '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01',
      tracestate:  'vendor=value,other=123',
    },
  });
  assert.equal(r.headers.get('tracestate'), 'vendor=value,other=123');
});
