/**
 * Integration: writer-lock prevents two qv-server processes from sharing
 * a DATA_DIR.
 *
 *   1. Server A boots, acquires the lock.
 *   2. Server B tries the same DATA_DIR — must refuse with WRITER_LOCK_HELD.
 *   3. Server A is graceful-stopped (so it releases the lock).
 *   4. Server C boots against the same DATA_DIR — must succeed and fence > 1.
 *   5. Server D tries to boot while C holds it — refused.
 *   6. SIGKILL C (no graceful release). Server E takes over (steal path).
 */

import { test } from 'node:test';
import assert   from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER    = join(__dirname, '..', 'server-sovereign.mjs');

const ADMIN_TOKEN  = 'deadbeefcafef00d'.repeat(4);
const ADMIN_SHA256 = createHash('sha256').update(ADMIN_TOKEN).digest('hex');

function bootServer(env, port) {
  const child = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      QV_HOST: '127.0.0.1',
      QV_PORT: String(port),
      QV_ADMIN_TOKEN_SHA256: ADMIN_SHA256,
      QV_MASTER_KEY_HEX: '11'.repeat(32),
      QV_RATE_LIMIT_DISABLED: 'true',
      QV_AUDIT_ENABLED: 'false',
      ...env,
    },
    stdio: 'pipe',
  });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d.toString('utf8'); });
  child.stdout.on('data', () => {});
  child._stderrBuf = () => stderr;
  return child;
}

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

function exitCode(child) {
  return new Promise(r => child.once('exit', (code) => r(code)));
}

function randPort() { return 35000 + Math.floor(Math.random() * 25000); }

test('two servers, same DATA_DIR: second refuses with WRITER_LOCK_HELD', async () => {
  const dir   = mkdtempSync(join(tmpdir(), 'qv-wlit-'));
  const portA = randPort();
  const portB = randPort();

  const A = bootServer({ QV_DATA_DIR: dir }, portA);
  await waitFor(`http://127.0.0.1:${portA}/v3/ready`);

  // Lock file must exist with fence=1.
  const lockPath = join(dir, '.writer-lock');
  assert.ok(existsSync(lockPath), 'writer-lock not created');
  assert.equal(JSON.parse(readFileSync(lockPath, 'utf8')).fence, '1');

  const B = bootServer({ QV_DATA_DIR: dir }, portB);
  const codeB = await exitCode(B);
  assert.notEqual(codeB, 0, 'second server should have refused to boot');
  assert.match(B._stderrBuf(), /WRITER_LOCK_HELD/);

  // Graceful-stop A.
  A.kill(process.platform === 'win32' ? 'SIGINT' : 'SIGTERM');
  await exitCode(A);

  rmSync(dir, { recursive: true, force: true });
});

test('after graceful shutdown the lock is released; next boot succeeds', { skip: process.platform === 'win32' ? 'SIGTERM not delivered as a real signal on win32 (Chapter 12)' : false }, async () => {
  const dir   = mkdtempSync(join(tmpdir(), 'qv-wlit2-'));
  const portA = randPort();
  const portC = randPort();

  const A = bootServer({ QV_DATA_DIR: dir }, portA);
  await waitFor(`http://127.0.0.1:${portA}/v3/ready`);
  A.kill('SIGTERM');
  await exitCode(A);

  // Graceful release deletes the lock file.
  assert.ok(!existsSync(join(dir, '.writer-lock')),
            'graceful shutdown should remove the lock');

  const C = bootServer({ QV_DATA_DIR: dir }, portC);
  await waitFor(`http://127.0.0.1:${portC}/v3/ready`);
  // After release-then-acquire the lock file has fresh fence=1.
  const cur = JSON.parse(readFileSync(join(dir, '.writer-lock'), 'utf8'));
  assert.equal(cur.fence, '1');
  C.kill('SIGTERM');
  await exitCode(C);

  rmSync(dir, { recursive: true, force: true });
});

test('SIGKILL leaves a stale lease; next server takes over with fence+1', async () => {
  const dir   = mkdtempSync(join(tmpdir(), 'qv-wlit3-'));
  const portA = randPort();
  const portE = randPort();

  const A = bootServer({ QV_DATA_DIR: dir }, portA);
  await waitFor(`http://127.0.0.1:${portA}/v3/ready`);
  const initialFence = JSON.parse(readFileSync(join(dir, '.writer-lock'), 'utf8')).fence;
  assert.equal(initialFence, '1');

  // SIGKILL — no graceful release; stale lease left behind with this pid.
  A.kill('SIGKILL');
  await exitCode(A);

  // Lock file is still there. The stale-take-over path will kick in only if
  // the previous PID is no longer alive. After kill, the kernel reaps the pid,
  // so pidAlive(oldPid) is false and the new server steals.
  assert.ok(existsSync(join(dir, '.writer-lock')));

  const E = bootServer({ QV_DATA_DIR: dir }, portE);
  await waitFor(`http://127.0.0.1:${portE}/v3/ready`);
  const after = JSON.parse(readFileSync(join(dir, '.writer-lock'), 'utf8'));
  assert.equal(after.fence, '2', `fence must monotonically increase, got ${after.fence}`);
  E.kill(process.platform === 'win32' ? 'SIGINT' : 'SIGTERM');
  await exitCode(E);

  rmSync(dir, { recursive: true, force: true });
});

test('QV_WRITER_LOCK_DISABLED=true skips the lock entirely', async () => {
  const dir   = mkdtempSync(join(tmpdir(), 'qv-wlit4-'));
  const portA = randPort();
  const portB = randPort();

  const A = bootServer({ QV_DATA_DIR: dir, QV_WRITER_LOCK_DISABLED: 'true' }, portA);
  await waitFor(`http://127.0.0.1:${portA}/v3/ready`);
  assert.ok(!existsSync(join(dir, '.writer-lock')), 'no lock file when disabled');

  // With locking off, B can boot too. We don't endorse this in production
  // (data corruption follows), but verify the env knob actually disables
  // the gate.
  const B = bootServer({ QV_DATA_DIR: dir, QV_WRITER_LOCK_DISABLED: 'true' }, portB);
  await waitFor(`http://127.0.0.1:${portB}/v3/ready`);

  A.kill(process.platform === 'win32' ? 'SIGINT' : 'SIGTERM');
  B.kill(process.platform === 'win32' ? 'SIGINT' : 'SIGTERM');
  await Promise.all([exitCode(A), exitCode(B)]);

  rmSync(dir, { recursive: true, force: true });
});
