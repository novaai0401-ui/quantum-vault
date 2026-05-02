// Integration: Postgres ChainStore against a real Postgres.
//
// Skipped when QV_PG_TEST_URL is unset — operators run this against a
// throwaway database in CI:
//
//   docker run --rm -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres \
//     --name pg-sigvault-it postgres:16
//   QV_PG_TEST_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres \
//     node --test qv-server/test/integration.postgres.test.mjs
//
// All assertions exercise the load + append round-trip and the
// CHAIN_LOG_CONFLICT behaviour that's the load-bearing claim for
// multi-writer support.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

const PG_URL = process.env.QV_PG_TEST_URL;
const SKIP   = !PG_URL;

const sha3 = (b) => createHash('sha3-256').update(b).digest();
function deriveNext(prevState, postCtr) {
  const buf = Buffer.alloc(40);
  prevState.copy(buf, 0);
  buf.writeBigUInt64BE(postCtr - 1n, 32);
  return sha3(buf);
}

test('postgres ChainStore: load empty / append / reload round-trip', { skip: SKIP }, async () => {
  const { createPostgresChainStore } = await import('../chain-store-postgres.mjs');
  const tableName = 'sigvault_chain_test_' + randomBytes(4).toString('hex');
  const store = await createPostgresChainStore({ url: PG_URL, table: tableName });
  try {
    const keyId = randomUUID();
    const seed  = randomBytes(32);

    // Initial load is empty.
    const r0 = await store.load(keyId, seed);
    assert.equal(r0.counter, 0n);
    assert.equal(r0.records, 0);
    assert.deepEqual([...r0.state], [...seed]);

    // Append 5 records.
    let state = Buffer.from(seed);
    for (let i = 1; i <= 5; i++) {
      state = deriveNext(state, BigInt(i));
      await store.append(keyId, BigInt(i), state);
    }

    // Reload sees them and verifies linkage.
    const r1 = await store.load(keyId, seed);
    assert.equal(r1.counter, 5n);
    assert.equal(r1.records, 5);
    assert.deepEqual([...r1.state], [...state]);

    assert.equal(await store.has(keyId), true);
    assert.equal(await store.has(randomUUID()), false);
  } finally {
    store.close();
  }
});

test('postgres ChainStore: CHAIN_LOG_CONFLICT on duplicate counter', { skip: SKIP }, async () => {
  const { createPostgresChainStore } = await import('../chain-store-postgres.mjs');
  const tableName = 'sigvault_chain_test_' + randomBytes(4).toString('hex');
  const store = await createPostgresChainStore({ url: PG_URL, table: tableName });
  try {
    const keyId = randomUUID();
    const seed  = randomBytes(32);
    const state1 = deriveNext(Buffer.from(seed), 1n);
    await store.append(keyId, 1n, state1);
    // A second writer trying the same (keyId, counter) MUST fail loud.
    await assert.rejects(
      store.append(keyId, 1n, state1),
      (err) => err.code === 'CHAIN_LOG_CONFLICT');
  } finally {
    store.close();
  }
});

test('postgres ChainStore: tampered stateHash detected on load', { skip: SKIP }, async () => {
  const { createPostgresChainStore } = await import('../chain-store-postgres.mjs');
  const tableName = 'sigvault_chain_test_' + randomBytes(4).toString('hex');
  const store = await createPostgresChainStore({ url: PG_URL, table: tableName });
  try {
    const keyId = randomUUID();
    const seed  = randomBytes(32);
    // Insert a record with a state that does NOT match the SHA3 ratchet.
    await store.append(keyId, 1n, randomBytes(32));
    await assert.rejects(
      store.load(keyId, seed),
      (err) => err.code === 'CHAIN_LOG_TAMPERED');
  } finally {
    store.close();
  }
});
