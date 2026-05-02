import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir, hostname } from 'node:os';
import { join } from 'node:path';

import { acquireWriterLock, __testing__ } from '../writer-lock.mjs';
const { pidAlive } = __testing__;

function tdir() { return mkdtempSync(join(tmpdir(), 'qv-wlock-')); }
const HOST = hostname();

test('acquire on empty dir succeeds, fence=1', () => {
  const d = tdir();
  const lock = acquireWriterLock({ dataDir: d });
  assert.equal(lock.fence, 1n);
  assert.ok(existsSync(lock.path));
  const cur = JSON.parse(readFileSync(lock.path, 'utf8'));
  assert.equal(cur.fence, '1');
  assert.equal(cur.pid, process.pid);
  assert.equal(cur.hostname, HOST);
  lock.release();
  assert.ok(!existsSync(lock.path));
  rmSync(d, { recursive: true, force: true });
});

test('release is idempotent', () => {
  const d = tdir();
  const lock = acquireWriterLock({ dataDir: d });
  lock.release();
  lock.release(); // must not throw
  rmSync(d, { recursive: true, force: true });
});

test('two acquires in the same process: second refuses with WRITER_LOCK_HELD', () => {
  const d = tdir();
  const lock1 = acquireWriterLock({ dataDir: d });
  try {
    assert.throws(
      () => acquireWriterLock({ dataDir: d }),
      (err) => err.code === 'WRITER_LOCK_HELD');
  } finally {
    lock1.release();
    rmSync(d, { recursive: true, force: true });
  }
});

test('expired lease is stolen, fence increments', () => {
  const d = tdir();
  const path = join(d, '.writer-lock');
  // Plant an "expired by 1 minute" lease at fence=7 from a fake live pid.
  // To make the takeover safe, also use a non-existent pid.
  writeFileSync(path, JSON.stringify({
    fence:      '7',
    holderId:   '00000000-0000-0000-0000-000000000001',
    pid:        999999, // unlikely to be live
    hostname:   HOST,
    acquiredAt: new Date(Date.now() - 120_000).toISOString(),
    expiresAt:  new Date(Date.now() - 60_000).toISOString(),
  }));
  const lock = acquireWriterLock({ dataDir: d });
  assert.equal(lock.fence, 8n, 'fence must monotonically increase');
  lock.release();
  rmSync(d, { recursive: true, force: true });
});

test('unexpired but dead-pid lease is stolen', () => {
  const d = tdir();
  const path = join(d, '.writer-lock');
  // Future expiry, but pid 1 belongs to init/system — process.kill(1,0) on a
  // user shell yields EPERM (treated as alive) on POSIX, while on Windows
  // pid 1 is unusual. Use 999999 which is virtually never live.
  writeFileSync(path, JSON.stringify({
    fence:      '3',
    holderId:   'x',
    pid:        999999,
    hostname:   HOST,
    acquiredAt: new Date().toISOString(),
    expiresAt:  new Date(Date.now() + 60_000).toISOString(),
  }));
  const lock = acquireWriterLock({ dataDir: d });
  assert.equal(lock.fence, 4n);
  lock.release();
  rmSync(d, { recursive: true, force: true });
});

test('different-hostname lease is stolen (cross-host fail-safe)', () => {
  const d = tdir();
  const path = join(d, '.writer-lock');
  writeFileSync(path, JSON.stringify({
    fence:      '11',
    holderId:   'x',
    pid:        process.pid, // pretend a live pid…
    hostname:   'some-other-host', // …but a different host name
    acquiredAt: new Date().toISOString(),
    expiresAt:  new Date(Date.now() + 60_000).toISOString(),
  }));
  const lock = acquireWriterLock({ dataDir: d });
  assert.equal(lock.fence, 12n);
  lock.release();
  rmSync(d, { recursive: true, force: true });
});

test('corrupt JSON treated as no-prior; fence resets to 1', () => {
  const d = tdir();
  const path = join(d, '.writer-lock');
  writeFileSync(path, 'not-json{{{');
  const lock = acquireWriterLock({ dataDir: d });
  assert.equal(lock.fence, 1n);
  lock.release();
  rmSync(d, { recursive: true, force: true });
});

test('renew bumps expiresAt without changing fence', () => {
  const d = tdir();
  const lock = acquireWriterLock({ dataDir: d, ttlMs: 5_000 });
  const t1 = JSON.parse(readFileSync(lock.path, 'utf8')).expiresAt;
  // Sleep-busy a few ms so the new expiresAt strictly differs.
  const stop = Date.now() + 5;
  while (Date.now() < stop) { /* spin */ }
  const fenceAfter = lock.renew();
  assert.equal(fenceAfter, lock.fence);
  const t2 = JSON.parse(readFileSync(lock.path, 'utf8')).expiresAt;
  assert.notEqual(t1, t2, 'renew must update expiresAt');
  lock.release();
  rmSync(d, { recursive: true, force: true });
});

test('renew throws WRITER_LOCK_LOST when fence advances under us', () => {
  const d = tdir();
  const lock = acquireWriterLock({ dataDir: d });
  // Simulate a thief stealing the lock externally.
  const cur = JSON.parse(readFileSync(lock.path, 'utf8'));
  writeFileSync(lock.path, JSON.stringify({
    ...cur,
    fence:    String(BigInt(cur.fence) + 1n),
    holderId: 'thief-xx',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  }));
  assert.throws(() => lock.renew(), (err) => err.code === 'WRITER_LOCK_LOST');
  rmSync(d, { recursive: true, force: true });
});

test('release after a lost-lease does not unlink the thief\'s file', () => {
  const d = tdir();
  const lock = acquireWriterLock({ dataDir: d });
  const cur = JSON.parse(readFileSync(lock.path, 'utf8'));
  // Thief overwrites
  const thiefHolder = 'thief-id';
  writeFileSync(lock.path, JSON.stringify({
    ...cur, holderId: thiefHolder,
    fence: String(BigInt(cur.fence) + 1n),
  }));
  lock.release();
  // The file should still be present and still belong to thiefHolder.
  const after = JSON.parse(readFileSync(lock.path, 'utf8'));
  assert.equal(after.holderId, thiefHolder);
  rmSync(d, { recursive: true, force: true });
});

test('allowSteal=false refuses to take over a stale lease', () => {
  const d = tdir();
  const path = join(d, '.writer-lock');
  writeFileSync(path, JSON.stringify({
    fence: '1', holderId: 'x', pid: 999999, hostname: HOST,
    acquiredAt: new Date(Date.now() - 60_000).toISOString(),
    expiresAt:  new Date(Date.now() - 30_000).toISOString(),
  }));
  assert.throws(
    () => acquireWriterLock({ dataDir: d, allowSteal: false }),
    (err) => err.code === 'WRITER_LOCK_STALE');
  rmSync(d, { recursive: true, force: true });
});

test('checkFence: passes when our fence is still live', () => {
  const d = tdir();
  const lock = acquireWriterLock({ dataDir: d });
  assert.equal(lock.checkFence(), lock.fence);
  rmSync(d, { recursive: true, force: true });
});

test('checkFence: throws WRITER_LOCK_LOST when peer overtakes our fence', () => {
  const d = tdir();
  const lock = acquireWriterLock({ dataDir: d });
  // Simulate a peer (different host, different holderId) stealing the lease
  // while we were busy. This is the cross-host hazard.
  const cur = JSON.parse(readFileSync(lock.path, 'utf8'));
  writeFileSync(lock.path, JSON.stringify({
    ...cur,
    holderId: 'peer-on-other-host',
    fence: String(BigInt(cur.fence) + 1n),
    hostname: 'other-host',
    pid: 12345,
  }));
  assert.throws(() => lock.checkFence(), (err) => err.code === 'WRITER_LOCK_LOST');
  rmSync(d, { recursive: true, force: true });
});

test('checkFence: throws WRITER_LOCK_LOST after release', () => {
  const d = tdir();
  const lock = acquireWriterLock({ dataDir: d });
  lock.release();
  assert.throws(() => lock.checkFence(), (err) => err.code === 'WRITER_LOCK_LOST');
  rmSync(d, { recursive: true, force: true });
});

test('checkFence: throws WRITER_LOCK_LOST when lease file vanished', () => {
  const d = tdir();
  const lock = acquireWriterLock({ dataDir: d });
  unlinkSync(lock.path);
  assert.throws(() => lock.checkFence(), (err) => err.code === 'WRITER_LOCK_LOST');
  rmSync(d, { recursive: true, force: true });
});

test('pidAlive: own pid is alive', () => {
  assert.equal(pidAlive(process.pid), true);
});

test('pidAlive: implausibly large pid is dead', () => {
  assert.equal(pidAlive(2_000_000_000), false);
});

test('pidAlive: invalid input is dead', () => {
  assert.equal(pidAlive(0), false);
  assert.equal(pidAlive(-1), false);
  assert.equal(pidAlive(NaN), false);
  assert.equal(pidAlive('x'), false);
});
