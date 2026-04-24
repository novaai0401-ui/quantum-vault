import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

import { verifyAndLoadChainLog, CHAIN_RECORD_BYTES } from '../chain-log.mjs';

function sha3(b) { return createHash('sha3-256').update(b).digest(); }

/**
 * Build a valid chain-log buffer of N records starting from `seed`.
 * Mirrors the MutationChain.advance() ratchet exactly so the verifier
 * serves as a cross-check against the SDK.
 */
function buildLog(seed, n) {
  const out  = Buffer.alloc(n * CHAIN_RECORD_BYTES);
  let state  = Buffer.from(seed);
  let preCtr = 0n;
  for (let i = 0; i < n; i++) {
    const input = Buffer.alloc(40);
    state.copy(input, 0);
    input.writeBigUInt64BE(preCtr, 32);
    state = sha3(input);
    const postCtr = preCtr + 1n;
    out.writeBigUInt64BE(postCtr, i * 40);
    state.copy(out, i * 40 + 8);
    preCtr = postCtr;
  }
  return { buf: out, finalState: state, finalCtr: BigInt(n) };
}

function tdir() { return mkdtempSync(join(tmpdir(), 'qv-chainlog-')); }

test('empty / missing log: counter=0, state=seed, records=0', () => {
  const d = tdir();
  const seed = randomBytes(32);
  const r = verifyAndLoadChainLog(join(d, 'missing.log'), seed);
  assert.equal(r.counter, 0n);
  assert.equal(r.records, 0);
  assert.deepEqual([...r.state], [...seed]);
  rmSync(d, { recursive: true, force: true });
});

test('zero-byte log behaves as empty', () => {
  const d = tdir();
  const p = join(d, 'zero.log');
  writeFileSync(p, Buffer.alloc(0));
  const seed = randomBytes(32);
  const r = verifyAndLoadChainLog(p, seed);
  assert.equal(r.counter, 0n);
  assert.equal(r.records, 0);
  rmSync(d, { recursive: true, force: true });
});

test('valid N-record log loads with matching state + counter', () => {
  const d = tdir();
  const seed = randomBytes(32);
  const { buf, finalState, finalCtr } = buildLog(seed, 10);
  const p = join(d, 'ok.log');
  writeFileSync(p, buf);
  const r = verifyAndLoadChainLog(p, seed);
  assert.equal(r.records, 10);
  assert.equal(r.counter, finalCtr);
  assert.deepEqual([...r.state], [...finalState]);
  rmSync(d, { recursive: true, force: true });
});

test('truncated (non-multiple-of-40) log rejected as CORRUPT', () => {
  const d = tdir();
  const seed = randomBytes(32);
  const { buf } = buildLog(seed, 3);
  const p = join(d, 'trunc.log');
  writeFileSync(p, buf.subarray(0, buf.length - 5)); // chop 5 bytes
  assert.throws(() => verifyAndLoadChainLog(p, seed), /CHAIN_LOG_CORRUPT/);
  rmSync(d, { recursive: true, force: true });
});

test('non-monotonic counter rejected', () => {
  const d = tdir();
  const seed = randomBytes(32);
  const { buf } = buildLog(seed, 3);
  // Corrupt record 1's counter to 99.
  buf.writeBigUInt64BE(99n, 40);
  const p = join(d, 'nonmono.log');
  writeFileSync(p, buf);
  assert.throws(() => verifyAndLoadChainLog(p, seed), /CHAIN_LOG_NON_MONOTONIC/);
  rmSync(d, { recursive: true, force: true });
});

test('tampered stateHash rejected with TAMPERED', () => {
  const d = tdir();
  const seed = randomBytes(32);
  const { buf } = buildLog(seed, 3);
  // Flip a bit in record 1's stateHash.
  buf[40 + 8 + 5] ^= 0x01;
  const p = join(d, 'tampered.log');
  writeFileSync(p, buf);
  assert.throws(() => verifyAndLoadChainLog(p, seed), /CHAIN_LOG_TAMPERED/);
  rmSync(d, { recursive: true, force: true });
});

test('linkage check is complete — wrong seed rejected', () => {
  const d = tdir();
  const realSeed = randomBytes(32);
  const { buf } = buildLog(realSeed, 3);
  const p = join(d, 'wrongseed.log');
  writeFileSync(p, buf);
  const otherSeed = randomBytes(32);
  assert.throws(() => verifyAndLoadChainLog(p, otherSeed), /CHAIN_LOG_TAMPERED/);
  rmSync(d, { recursive: true, force: true });
});

test('single-record log round-trips', () => {
  const d = tdir();
  const seed = randomBytes(32);
  const { buf, finalState } = buildLog(seed, 1);
  const p = join(d, 'one.log');
  writeFileSync(p, buf);
  const r = verifyAndLoadChainLog(p, seed);
  assert.equal(r.counter, 1n);
  assert.deepEqual([...r.state], [...finalState]);
  rmSync(d, { recursive: true, force: true });
});
