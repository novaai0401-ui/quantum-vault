#!/usr/bin/env node
// generate.mjs — produce the canonical conformance test-vectors JSON.
//
// Determinism: every random byte source is replaced by a SHAKE-256-driven
// PRG seeded from a fixed string. Run twice → byte-identical output.
//
//   node qv-spec/test-vectors/generate.mjs > qv-spec/test-vectors/vectors.json
//
// We do NOT depend on qv-sdk here. The generator implements just enough
// of the spec to emit deterministic vectors. The verifier inside qv-sdk
// is what consumers run against these vectors.
//
// Vector families covered today (v1.0):
//   - chain.advance
//   - claims.validation (covers every CLAIMS_* code)
//
// Token-issue vectors require the qv-sdk's full crypto stack (ML-DSA-87
// signing) and ship in a follow-up PR — see Chapter 21.

import { createHash } from 'node:crypto';
import { Buffer }     from 'node:buffer';

import { validateClaims, loadClaimsConfig } from '../../qv-server/claims.mjs';

const SPEC_VERSION = '1.0';

/* ── PRG ───────────────────────────────────────────────────────────────── */

function shake256stream(seed) {
  // Deterministic byte stream by chaining SHA3-512 (Node has no SHAKE).
  // Each block is sha3-512(seed || counter_be64). Good enough for fixtures.
  let counter = 0n;
  let pool = Buffer.alloc(0);
  return function take(n) {
    while (pool.length < n) {
      const ctr = Buffer.alloc(8);
      ctr.writeBigUInt64BE(counter++, 0);
      pool = Buffer.concat([pool, createHash('sha3-512').update(seed).update(ctr).digest()]);
    }
    const out = pool.subarray(0, n);
    pool = pool.subarray(n);
    return out;
  };
}
const prg = shake256stream(Buffer.from('qv-spec-test-vectors-v1.0'));

/* ── Helpers ───────────────────────────────────────────────────────────── */

function b64u(buf) {
  return Buffer.from(buf).toString('base64')
    .replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
}

function sha3_256(...parts) {
  const h = createHash('sha3-256');
  for (const p of parts) h.update(p);
  return h.digest();
}

/* ── chain.advance vectors ─────────────────────────────────────────────── */

function chainAdvance(seed, n) {
  // Mirrors qv-sdk's MutationChain.advance() exactly.
  let state = Buffer.from(seed);
  let preCtr = 0n;
  const trace = [];
  for (let i = 0; i < n; i++) {
    const input = Buffer.alloc(40);
    state.copy(input, 0);
    input.writeBigUInt64BE(preCtr, 32);
    state = sha3_256(input);
    const postCtr = preCtr + 1n;
    trace.push({ counter: postCtr.toString(), stateB64u: b64u(state) });
    preCtr = postCtr;
  }
  return trace;
}

function chainVectors() {
  const out = [];
  // Five seeds × three lengths.
  const seeds = ['00'.repeat(32), '01'.repeat(32), 'ab'.repeat(32),
                 'ff'.repeat(32), '11'.repeat(32)];
  const lens  = [1, 5, 16];
  let n = 1;
  for (const seedHex of seeds) {
    for (const len of lens) {
      const seed = Buffer.from(seedHex, 'hex');
      const trace = chainAdvance(seed, len);
      out.push({
        id:   `chain.advance.${String(n++).padStart(3, '0')}`,
        kind: 'chain.advance',
        description: `Advance ${len} steps from seed ${seedHex.slice(0,8)}…`,
        input:  { seedB64u: b64u(seed), advances: len },
        expect: { trace, finalCounter: String(len), finalStateB64u: trace[trace.length-1].stateB64u },
      });
    }
  }
  return out;
}

/* ── claims.validation vectors ─────────────────────────────────────────── */

function claimsVectors() {
  const cfg = loadClaimsConfig({});
  const cases = [
    { id: 'claims.validation.ok-empty',
      description: 'Empty object is valid',
      input: {},
      expect: { ok: true } },

    { id: 'claims.validation.ok-flat',
      description: 'A flat object with three keys is valid',
      input: { sub: 'alice', iat: 1, scope: 'read' },
      expect: { ok: true } },

    { id: 'claims.validation.not-object',
      description: 'Root must be an object',
      input: 'not-an-object',
      expect: { ok: false, code: 'CLAIMS_NOT_OBJECT' } },

    { id: 'claims.validation.too-deep',
      description: 'Depth > 8 is rejected',
      input: makeNested(9),
      expect: { ok: false, code: 'CLAIMS_TOO_DEEP' } },

    { id: 'claims.validation.too-many-keys',
      description: 'Object key count > 64 is rejected',
      input: Object.fromEntries(Array.from({length: 65}, (_, i) => [`k${i}`, 1])),
      expect: { ok: false, code: 'CLAIMS_TOO_MANY_KEYS' } },

    { id: 'claims.validation.array-too-large',
      description: 'Array length > 128 is rejected',
      input: { arr: Array.from({length: 129}, (_, i) => i) },
      expect: { ok: false, code: 'CLAIMS_ARRAY_TOO_LARGE' } },

    { id: 'claims.validation.string-too-long',
      description: 'String length > 4096 is rejected',
      input: { s: 'x'.repeat(4097) },
      expect: { ok: false, code: 'CLAIMS_STRING_TOO_LONG' } },

    { id: 'claims.validation.bad-number-nan',
      description: 'NaN is rejected',
      input: { x: NaN },
      expect: { ok: false, code: 'CLAIMS_BAD_NUMBER' } },

    { id: 'claims.validation.bad-number-inf',
      description: 'Infinity is rejected',
      input: { x: Infinity },
      expect: { ok: false, code: 'CLAIMS_BAD_NUMBER' } },
  ];

  const vectors = [];
  for (const c of cases) {
    let actual;
    try {
      validateClaims(c.input, cfg);
      actual = { ok: true };
    } catch (e) {
      actual = { ok: false, code: e.code || 'CLAIMS_INVALID' };
    }
    // Sanity: each case's `expect` matches the live behaviour of the
    // server-side validator. If they diverge, the generator output would
    // bake in a wrong vector — fail loud.
    if (JSON.stringify(actual) !== JSON.stringify(c.expect)) {
      throw new Error(
        `vector ${c.id}: expect=${JSON.stringify(c.expect)} but live=${JSON.stringify(actual)}`);
    }

    vectors.push({
      id:          c.id,
      kind:        'claims.validation',
      description: c.description,
      input:       { claims: c.input, config: cfg },
      expect:      c.expect,
    });
  }
  return vectors;

  function makeNested(depth) {
    let cur = { x: 1 };
    for (let i = 0; i < depth; i++) cur = { x: cur };
    return cur;
  }
}

/* ── Emit ──────────────────────────────────────────────────────────────── */

function main() {
  const vectors = [...chainVectors(), ...claimsVectors()];
  const doc = {
    spec_version: SPEC_VERSION,
    produced_by:  'qv-spec/test-vectors/generate.mjs',
    // produced_at is intentionally a fixed "epoch" string so vectors.json
    // is byte-stable across builds and reviewable in git diffs.
    produced_at:  '1970-01-01T00:00:00Z',
    note: 'NaN/Infinity are encoded as null by JSON.stringify; consumers '
        + 'should treat null in claims.validation.bad-number-* inputs as '
        + 'the corresponding non-finite value when re-running the case.',
    vectors,
  };
  process.stdout.write(JSON.stringify(doc, null, 2) + '\n');
}

main();
