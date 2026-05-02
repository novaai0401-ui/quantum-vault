import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

import { createChainStore, createFileChainStore } from '../chain-store.mjs';

function tdir() { return mkdtempSync(join(tmpdir(), 'qv-chainstore-')); }
function sha3(b) { return createHash('sha3-256').update(b).digest(); }

function deriveNext(prevState, postCtr) {
  const buf = Buffer.alloc(40);
  prevState.copy(buf, 0);
  buf.writeBigUInt64BE(postCtr - 1n, 32);
  return sha3(buf);
}

test('createChainStore: file is the default kind', () => {
  const d = tdir();
  const store = createChainStore({ chainDir: d });
  assert.equal(store.kind, 'file');
  rmSync(d, { recursive: true, force: true });
});

test('createChainStore: postgres / s3 / etcd are reserved (v4.4)', () => {
  for (const k of ['postgres', 's3', 'etcd']) {
    assert.throws(
      () => createChainStore({ kind: k, chainDir: '/tmp' }),
      /CHAIN_STORE_NOT_AVAILABLE/);
  }
});

test('createChainStore: unknown kind rejected', () => {
  assert.throws(
    () => createChainStore({ kind: 'mongodb', chainDir: '/tmp' }),
    /CHAIN_STORE_UNKNOWN/);
});

test('file backend: load empty returns counter=0 + state=seed', () => {
  const d = tdir();
  const seed = randomBytes(32);
  const store = createFileChainStore({ chainDir: d });
  const r = store.load('keyA', seed);
  assert.equal(r.counter, 0n);
  assert.equal(r.records, 0);
  assert.deepEqual([...r.state], [...seed]);
  rmSync(d, { recursive: true, force: true });
});

test('file backend: append + reload round-trip', () => {
  const d = tdir();
  const seed = randomBytes(32);
  const store = createFileChainStore({ chainDir: d });

  // Build the same chain in-memory the SDK would generate.
  let state = Buffer.from(seed);
  for (let i = 1; i <= 5; i++) {
    state = deriveNext(state, BigInt(i));
    store.append('keyA', BigInt(i), state);
  }

  const r = store.load('keyA', seed);
  assert.equal(r.counter, 5n);
  assert.equal(r.records, 5);
  assert.deepEqual([...r.state], [...state]);
  rmSync(d, { recursive: true, force: true });
});

test('file backend: load throws CHAIN_LOG_TAMPERED on corrupt link', () => {
  const d = tdir();
  const seed = randomBytes(32);
  const store = createFileChainStore({ chainDir: d });
  // Append a record whose state does not match the derivation.
  const fake = randomBytes(32);
  store.append('keyA', 1n, fake);
  assert.throws(() => store.load('keyA', seed), /CHAIN_LOG_TAMPERED/);
  rmSync(d, { recursive: true, force: true });
});

test('file backend: has() reflects existence', () => {
  const d = tdir();
  const seed = randomBytes(32);
  const store = createFileChainStore({ chainDir: d });
  assert.equal(store.has('keyA'), false);
  store.append('keyA', 1n, deriveNext(Buffer.from(seed), 1n));
  assert.equal(store.has('keyA'), true);
  rmSync(d, { recursive: true, force: true });
});

test('file backend: close is idempotent + does not throw', () => {
  const d = tdir();
  const store = createFileChainStore({ chainDir: d });
  store.close(); store.close();
  rmSync(d, { recursive: true, force: true });
});

test('file backend: fsync=false uses appendFileSync (test/CI mode)', () => {
  const d = tdir();
  const seed = randomBytes(32);
  const store = createFileChainStore({ chainDir: d, fsync: false });
  let state = Buffer.from(seed);
  state = deriveNext(state, 1n);
  store.append('keyA', 1n, state);
  // File still exists and reload verifies.
  const r = store.load('keyA', seed);
  assert.equal(r.counter, 1n);
  rmSync(d, { recursive: true, force: true });
});
