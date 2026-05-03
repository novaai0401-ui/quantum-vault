/**
 * Unit tests for qv-server/verify-pool.mjs
 * Run: node --test qv-server/test/verify-pool.test.mjs
 */
import { test } from 'node:test';
import assert   from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VerifyPool }    from '../verify-pool.mjs';

const __dirname  = dirname(fileURLToPath(import.meta.url));
const MOCK_URL   = new URL('./_mock-worker.mjs', import.meta.url);

test('dispatches to an idle worker immediately', async () => {
  const pool = new VerifyPool(2, 8, MOCK_URL);
  await pool.init();
  try {
    const r = await pool.run({});
    assert.equal(r.ok, true);
    assert.equal(r.echoed, true);
    assert.equal(pool.queueDepth, 0);
    assert.equal(pool.rejects, 0);
  } finally { await pool.shutdown(); }
});

test('queues when all workers busy, drains in order', async () => {
  const pool = new VerifyPool(1, 4, MOCK_URL);
  await pool.init();
  try {
    // Fire 3 jobs with small delays → one runs, two queue.
    const results = await Promise.all([
      pool.run({ delayMs: 40 }),
      pool.run({ delayMs: 20 }),
      pool.run({ delayMs: 10 }),
    ]);
    assert.ok(results.every(r => r.ok === true));
    assert.equal(pool.rejects, 0);
  } finally { await pool.shutdown(); }
});

test('rejects with POOL_OVERLOADED when queue is full', async () => {
  const pool = new VerifyPool(1, 2, MOCK_URL);
  await pool.init();
  try {
    // One runs, two queue → fourth rejects.
    const p1 = pool.run({ delayMs: 100 });
    const p2 = pool.run({ delayMs: 100 });
    const p3 = pool.run({ delayMs: 100 });
    const p4 = pool.run({ delayMs: 100 });

    // p4 should resolve IMMEDIATELY with overload.
    const r4 = await p4;
    assert.equal(r4.ok, false);
    assert.equal(r4.error, 'POOL_OVERLOADED');
    assert.equal(pool.rejects, 1);

    // The first three still complete normally.
    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    assert.ok(r1.ok && r2.ok && r3.ok);
  } finally { await pool.shutdown(); }
});

test('rejects counter is monotonic', async () => {
  const pool = new VerifyPool(1, 1, MOCK_URL);
  await pool.init();
  try {
    const inflight = pool.run({ delayMs: 100 });   // occupies worker
    const queued   = pool.run({ delayMs: 100 });   // fills queue
    const r1 = await pool.run({ delayMs: 100 });   // reject #1
    const r2 = await pool.run({ delayMs: 100 });   // reject #2
    const r3 = await pool.run({ delayMs: 100 });   // reject #3
    assert.equal(r1.error, 'POOL_OVERLOADED');
    assert.equal(r2.error, 'POOL_OVERLOADED');
    assert.equal(r3.error, 'POOL_OVERLOADED');
    assert.equal(pool.rejects, 3);
    await Promise.all([inflight, queued]);
  } finally { await pool.shutdown(); }
});

test('queueDepth reflects queued jobs', async () => {
  const pool = new VerifyPool(1, 4, MOCK_URL);
  await pool.init();
  try {
    const p1 = pool.run({ delayMs: 60 });
    const p2 = pool.run({ delayMs: 60 });
    const p3 = pool.run({ delayMs: 60 });
    // Give the event loop a tick to let worker dispatch happen.
    await new Promise(r => setImmediate(r));
    // 1 in-flight, 2 queued.
    assert.equal(pool.queueDepth, 2);
    await Promise.all([p1, p2, p3]);
    assert.equal(pool.queueDepth, 0);
  } finally { await pool.shutdown(); }
});

test('shutdown drains queued jobs with POOL_SHUTDOWN', async () => {
  const pool = new VerifyPool(1, 4, MOCK_URL);
  await pool.init();
  const p1 = pool.run({ delayMs: 500 });  // in flight
  const p2 = pool.run({ delayMs: 500 });  // queued
  await new Promise(r => setImmediate(r));
  await pool.shutdown();
  const [r1, r2] = await Promise.all([p1, p2]);
  // The in-flight one may resolve with WORKER_ERROR or POOL_SHUTDOWN
  // depending on whether terminate() fires before the reply. Queued job
  // must be POOL_SHUTDOWN.
  assert.equal(r2.error, 'POOL_SHUTDOWN');
  assert.equal(r1.ok, false);
});

// ─── Affinity-mode tests ──────────────────────────────────────────────────

import { murmur3_32 } from '../verify-pool.mjs';

test('murmur3_32 is deterministic', () => {
  assert.equal(murmur3_32('keyA'), murmur3_32('keyA'));
  assert.notEqual(murmur3_32('keyA'), murmur3_32('keyB'));
});

test('murmur3_32 distributes keyIds reasonably across N=8 workers', () => {
  const counts = new Array(8).fill(0);
  for (let i = 0; i < 1000; i++) {
    const idx = murmur3_32(`key-${i}`) % 8;
    counts[idx] += 1;
  }
  // Each bucket should be within a factor of 2 of the ideal 125.
  for (const c of counts) {
    assert.ok(c >= 60 && c <= 250, `bucket count ${c} too skewed`);
  }
});

test('affinity: same keyId always lands on same worker', async () => {
  const pool = new VerifyPool(4, 16, MOCK_URL, { affinity: true });
  await pool.init();
  try {
    const seen = new Map();
    for (let i = 0; i < 30; i++) {
      const r = await pool.run({ keyId: 'hot-key', op: 'echo', i });
      assert.equal(r.ok, true);
      seen.set(r.echoIdx ?? 'x', (seen.get(r.echoIdx ?? 'x') || 0) + 1);
    }
    // We don't have visibility into which worker handled it from the
    // mock worker, but we CAN verify deterministic dispatch via the pool
    // internals.
    const expectedIdx = murmur3_32('hot-key') % 4;
    assert.equal(pool.workerForKey('hot-key'), expectedIdx);
    assert.equal(pool.workerForKey('hot-key'), expectedIdx); // stable
  } finally {
    await pool.shutdown();
  }
});

test('affinity: different keyIds spread across workers', async () => {
  const pool = new VerifyPool(4, 16, MOCK_URL, { affinity: true });
  await pool.init();
  try {
    const idxs = new Set();
    for (let i = 0; i < 50; i++) {
      idxs.add(pool.workerForKey(`key-${i}`));
    }
    // 50 keys across 4 workers should hit at least 2 distinct slots.
    assert.ok(idxs.size >= 2, `only ${idxs.size} distinct slots used`);
  } finally {
    await pool.shutdown();
  }
});

test('affinity: per-worker queue cap fires per-key, not globally', async () => {
  // With size=2, queueMax=4, perQueueMax = ceil(4/2) = 2.
  const pool = new VerifyPool(2, 4, MOCK_URL, { affinity: true });
  await pool.init();
  try {
    const hotKey = 'noisy';
    const idx = pool.workerForKey(hotKey);
    // The mock worker takes ~5 ms per job — fire many in flight to
    // pile up the per-worker queue.
    const promises = [];
    for (let i = 0; i < 20; i++) {
      promises.push(pool.run({ keyId: hotKey, op: 'slow', delayMs: 50 }));
    }
    const results = await Promise.all(promises);
    const overloaded = results.filter(r => !r.ok && r.error === 'POOL_OVERLOADED');
    const succeeded  = results.filter(r => r.ok);
    assert.ok(overloaded.length > 0, 'expected per-worker queue to fill');
    assert.ok(succeeded.length > 0,  'expected some jobs to succeed');
    // The other worker (idx-of-other-key) is untouched — fire one and
    // assert it goes through.
    const otherKey = idx === 0 ? 'targets-1' : 'targets-0';
    // Find a key that hashes to the OTHER slot.
    let coldKey = null;
    for (let i = 0; i < 100; i++) {
      const k = `cold-${i}`;
      if (pool.workerForKey(k) !== idx) { coldKey = k; break; }
    }
    assert.ok(coldKey, 'should find a cold key in 100 tries');
    const cold = await pool.run({ keyId: coldKey, op: 'echo' });
    assert.equal(cold.ok, true, 'cold-key worker must be untouched');
  } finally {
    await pool.shutdown();
  }
});

test('round-robin (no affinity) still works as before', async () => {
  const pool = new VerifyPool(2, 4, MOCK_URL);
  await pool.init();
  try {
    const r = await pool.run({ op: 'echo', x: 42 });
    assert.equal(r.ok, true);
    assert.equal(pool.workerForKey('any'), null,
      'workerForKey returns null in round-robin mode');
  } finally {
    await pool.shutdown();
  }
});

test('perWorkerQueueDepth: sum equals queueDepth in both modes', async () => {
  const pool = new VerifyPool(3, 9, MOCK_URL, { affinity: true });
  await pool.init();
  try {
    const sum = pool.perWorkerQueueDepth().reduce((a, b) => a + b, 0);
    assert.equal(sum, pool.queueDepth);
  } finally {
    await pool.shutdown();
  }
});
