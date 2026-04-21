/**
 * End-to-end test: graceful SIGTERM shutdown.
 * Run: node --test qv-server/test/integration.shutdown.test.mjs
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

function waitForExit(child, ms = 5000) {
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error(`process did not exit in ${ms}ms`)), ms);
    child.once('exit', (code) => { clearTimeout(to); resolve(code); });
  });
}

// Node on Windows does not deliver SIGTERM/SIGINT to child processes as real
// signals — it calls TerminateProcess, which bypasses our graceful-shutdown
// handler. Signal-based drain is validated by unit tests; this end-to-end
// test only runs on POSIX platforms where signals behave properly.
const SIGNAL_OK = process.platform !== 'win32';

test('graceful shutdown: /v3/health returns 503 during drain, then exits 0', { skip: !SIGNAL_OK && 'signals unsupported on win32' }, async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), 'qv-sd-'));
  const PORT = 19600 + Math.floor(Math.random() * 300);
  const BASE = `http://127.0.0.1:${PORT}`;
  const TOKEN = 'shutdown-test-admin-token-xxxxxxxx';
  const SHA   = createHash('sha256').update(TOKEN, 'utf8').digest('hex');

  const child = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      QV_PORT:                String(PORT),
      QV_HOST:                '127.0.0.1',
      QV_DATA_DIR:            dataDir,
      QV_ADMIN_TOKEN_SHA256:  SHA,
      QV_WORKERS:             '0',
      QV_AUDIT_STDOUT:        'false',
      QV_SHUTDOWN_TIMEOUT_MS: '2000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', b => process.stderr.write(`[server stderr] ${b}`));

  try {
    await waitFor(`${BASE}/v3/health`);

    // Normal health is 200.
    const ok = await fetch(`${BASE}/v3/health`);
    assert.equal(ok.status, 200);
    const okBody = await ok.json();
    assert.ok(['ok', 'ready'].includes(okBody.status), `unexpected status: ${okBody.status}`);

    // Trigger drain. On Windows, SIGTERM kills immediately via libuv, so we
    // use the more-portable `process.kill(pid, 'SIGINT')` and hope for a clean
    // exit — but on Win32, Node's SIGINT handler is honoured only in console
    // apps. For this test we send SIGINT; fall back to asserting exit code.
    const sig = process.platform === 'win32' ? 'SIGINT' : 'SIGTERM';
    child.kill(sig);

    // Poll health briefly; on platforms where graceful runs, we should see 503.
    // On platforms where the signal is hard-killing (Win SIGTERM), the
    // connection will error — that's still a valid shutdown, just not graceful.
    let sawDraining = false;
    const drainDeadline = Date.now() + 1500;
    while (Date.now() < drainDeadline) {
      try {
        const r = await fetch(`${BASE}/v3/health`);
        if (r.status === 503) {
          const body = await r.json();
          assert.equal(body.status, 'draining');
          sawDraining = true;
          break;
        }
      } catch { break; } // server already closed
      await new Promise(r => setTimeout(r, 50));
    }

    const code = await waitForExit(child, 5000);
    // Clean exit on signal-handling platforms → 0; hard-kill exit is platform-dependent.
    // Assert that at minimum the process terminated.
    assert.ok(code !== null, 'process must exit');

    if (process.platform !== 'win32') {
      assert.ok(sawDraining, '/v3/health should have returned 503 during drain');
      assert.equal(code, 0, 'graceful shutdown should exit 0');
    }
  } finally {
    try { child.kill('SIGKILL'); } catch {}
    try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
  }
});
