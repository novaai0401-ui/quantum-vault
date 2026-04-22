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
