// chain-log.mjs — mutation-chain append-log format + verifier.
//
// Record layout (40 bytes, fixed):
//   [0..8)   counter_after_advance  — big-endian u64 (the counter the
//                                     token being issued embeds)
//   [8..40)  state_after_advance    — 32-byte SHA3-256 state
//
// Invariant (cryptographic linkage):
//
//   For record i with (ctr_i, state_i), and the seed `seed` the chain was
//   created from:
//
//     state_0_pre = seed      (counter 0, not in the log)
//     ctr_0       = 1         (first advance bumps to 1)
//     state_i     = SHA3-256( state_{i-1}_after || ctr_i_pre )
//                 = SHA3-256( prev_state || (ctr_i - 1) )
//
//   Walking the log from record 0 with `prev_state = seed`, each record's
//   `state_i` must equal the re-derived value. Any mismatch means the log
//   was tampered with, truncated, or corrupted.
//
// Zero npm deps — Node stdlib only.

import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync, existsSync }    from 'node:fs';

export const CHAIN_RECORD_BYTES = 40;

function sha3_256(buf) {
  // Node crypto exposes sha3-256 since v12.
  return createHash('sha3-256').update(buf).digest();
}

/**
 * Re-derive the next state given prev_state and the counter the record claims.
 * The pre-advance counter is (ctr - 1). We serialise it big-endian u64 like
 * the SDK's MutationChain.advance() does.
 */
function deriveNext(prevState, postCounter) {
  const buf = Buffer.alloc(40);
  prevState.copy(buf, 0);
  const preCtr = postCounter - 1n;
  buf.writeBigUInt64BE(preCtr, 32);
  return sha3_256(buf);
}

/**
 * Verify chain log integrity + return the reload state.
 *
 * @param {string} path     Path to `<keyId>.log`.
 * @param {Buffer} seed     The 32-byte chain seed (derived from encryptKey).
 * @returns {{ counter: bigint, state: Buffer, records: number }}
 *          On an empty / missing log: counter=0, state=seed, records=0.
 * @throws  Error('CHAIN_LOG_CORRUPT') if length isn't a multiple of 40.
 * @throws  Error('CHAIN_LOG_TAMPERED') on linkage mismatch (with record
 *          index in the message).
 * @throws  Error('CHAIN_LOG_NON_MONOTONIC') if counters don't increase by 1.
 */
export function verifyAndLoadChainLog(path, seed) {
  if (!existsSync(path)) {
    return { counter: 0n, state: Buffer.from(seed), records: 0 };
  }
  const buf = readFileSync(path);
  if (buf.length === 0) {
    return { counter: 0n, state: Buffer.from(seed), records: 0 };
  }
  if (buf.length % CHAIN_RECORD_BYTES !== 0) {
    const err = new Error(
      `CHAIN_LOG_CORRUPT: ${path} length ${buf.length} is not a multiple of ${CHAIN_RECORD_BYTES}`);
    err.code = 'CHAIN_LOG_CORRUPT';
    throw err;
  }
  const nRecords = buf.length / CHAIN_RECORD_BYTES;

  let prevState = Buffer.from(seed);
  let expectedCtr = 1n;

  for (let i = 0; i < nRecords; i++) {
    const off    = i * CHAIN_RECORD_BYTES;
    const ctr    = buf.readBigUInt64BE(off);
    const state  = buf.subarray(off + 8, off + 40);

    if (ctr !== expectedCtr) {
      const err = new Error(
        `CHAIN_LOG_NON_MONOTONIC: record ${i} has counter ${ctr}, expected ${expectedCtr}`);
      err.code = 'CHAIN_LOG_NON_MONOTONIC';
      throw err;
    }

    const derived = deriveNext(prevState, ctr);
    if (derived.length !== state.length || !timingSafeEqual(derived, state)) {
      const err = new Error(
        `CHAIN_LOG_TAMPERED: record ${i} stateHash does not match derived value`);
      err.code = 'CHAIN_LOG_TAMPERED';
      throw err;
    }

    prevState = Buffer.from(state);
    expectedCtr++;
  }

  return {
    counter: BigInt(nRecords),
    state:   prevState,
    records: nRecords,
  };
}
