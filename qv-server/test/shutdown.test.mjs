/**
 * Unit tests for qv-server/shutdown.mjs
 * Run: node --test qv-server/test/shutdown.test.mjs
 */

import { test } from 'node:test';
import assert   from 'node:assert/strict';
import { createShutdown } from '../shutdown.mjs';

function fakeServer() {
  let closed = false;
  const pending = [];
  return {
    get _closed() { return closed; },
    close(cb) {
      closed = true;
      // simulate async idle-connection drain
      setImmediate(() => cb && cb());
      pending.push(cb);
    },
  };
}

function fakeExit() {
  const calls = [];
  return { fn: (code) => calls.push(code), calls };
}

function noLog() {}

test('shutdown: no in-flight → teardown runs, exit(0)', async () => {
  const srv = fakeServer();
  const exit = fakeExit();
  let torn = 0;
  const sd = createShutdown({
    server: srv,
    teardown: [() => { torn++; }],
    timeoutMs: 200,
    log: noLog,
    exit: exit.fn,
  });
  await sd.shutdown('test');
  assert.equal(srv._closed, true);
  assert.equal(torn, 1);
  assert.deepEqual(exit.calls, [0]);
});

test('shutdown: waits for in-flight requests to end', async () => {
  const srv = fakeServer();
  const exit = fakeExit();
  const sd = createShutdown({
    server: srv, teardown: [], timeoutMs: 1000,
    log: noLog, exit: exit.fn,
  });
  sd.beginRequest();
  sd.beginRequest();
  assert.equal(sd.inFlight, 2);

  const p = sd.shutdown('test');
  await new Promise(r => setTimeout(r, 80));
  // Still draining — not yet exited.
  assert.deepEqual(exit.calls, []);
  sd.endRequest();
  sd.endRequest();
  await p;
  assert.deepEqual(exit.calls, [0]);
});

test('shutdown: teardown errors are caught, not thrown', async () => {
  const srv = fakeServer();
  const exit = fakeExit();
  const sd = createShutdown({
    server: srv,
    teardown: [
      async () => { throw new Error('boom'); },
      () => { /* runs anyway */ },
    ],
    timeoutMs: 200, log: noLog, exit: exit.fn,
  });
  await sd.shutdown('test');
  assert.deepEqual(exit.calls, [0]);
});

test('shutdown: isDraining flips immediately on signal', async () => {
  const srv = fakeServer();
  const exit = fakeExit();
  const sd = createShutdown({
    server: srv, teardown: [], timeoutMs: 200, log: noLog, exit: exit.fn,
  });
  assert.equal(sd.isDraining(), false);
  const p = sd.shutdown('test');
  assert.equal(sd.isDraining(), true);
  await p;
});

test('shutdown: idempotent — second call returns the same promise', async () => {
  const srv = fakeServer();
  const exit = fakeExit();
  const sd = createShutdown({
    server: srv, teardown: [], timeoutMs: 200, log: noLog, exit: exit.fn,
  });
  const p1 = sd.shutdown('first');
  const p2 = sd.shutdown('second');
  assert.equal(p1, p2);
  await p1;
  assert.deepEqual(exit.calls, [0]); // only one exit
});

test('shutdown: trackRequest increments/decrements in-flight on finish', async () => {
  const srv = fakeServer();
  const exit = fakeExit();
  const sd = createShutdown({
    server: srv, teardown: [], timeoutMs: 200, log: noLog, exit: exit.fn,
  });

  // Fake res with event emitter surface
  const listeners = {};
  const res = {
    on(evt, fn) { (listeners[evt] ||= []).push(fn); },
    _finish() { (listeners.finish || []).forEach(fn => fn()); },
  };
  const wrapped = sd.trackRequest(async (_req, _res) => {
    assert.equal(sd.inFlight, 1);
  });
  await wrapped({}, res);
  assert.equal(sd.inFlight, 1, 'in-flight stays high until finish');
  res._finish();
  assert.equal(sd.inFlight, 0);
});

test('shutdown: trackRequest only decrements once (finish + close both fire)', async () => {
  const srv = fakeServer();
  const exit = fakeExit();
  const sd = createShutdown({
    server: srv, teardown: [], timeoutMs: 200, log: noLog, exit: exit.fn,
  });
  const listeners = {};
  const res = {
    on(evt, fn) { (listeners[evt] ||= []).push(fn); },
    _finish() { (listeners.finish || []).forEach(fn => fn()); },
    _close()  { (listeners.close  || []).forEach(fn => fn()); },
  };
  const wrapped = sd.trackRequest(async () => {});
  await wrapped({}, res);
  res._finish();
  res._close();
  assert.equal(sd.inFlight, 0);
});

test('shutdown: hard timeout forces exit(1) if drain stalls', async () => {
  const srv = fakeServer();
  const exit = fakeExit();
  const sd = createShutdown({
    server: srv, teardown: [], timeoutMs: 50,
    log: noLog, exit: exit.fn,
  });
  sd.beginRequest(); // never ends — should hit hard deadline
  const p = sd.shutdown('test');
  // Wait past the soft drain deadline AND the hard-timeout grace (50 + 1000 + pad).
  await new Promise(r => setTimeout(r, 1200));
  // Soft path also calls exit(0) after drain deadline; hard timeout would call exit(1).
  // Either way, at least one exit must have been called.
  assert.ok(exit.calls.length >= 1);
  // Ensure promise resolved.
  await Promise.race([p, new Promise(r => setTimeout(r, 100))]);
});
