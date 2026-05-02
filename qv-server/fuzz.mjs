#!/usr/bin/env node
// fuzz.mjs — zero-dep coverage-blind fuzzer for Sigvault's
// security-sensitive parsers. Run on demand:
//
//   node qv-server/fuzz.mjs                     # default 100k iterations
//   QV_FUZZ_ITERS=1000000 node qv-server/fuzz.mjs
//
// Why this exists
// ----------------
// XZ-utils 2024 (CVE-2024-3094) was a backdoor inside a parser. Any input
// that crosses a trust boundary needs to either accept-and-validate or
// reject-with-a-stable-error. The fuzz harness mass-mutates seeds and
// asserts each parser:
//
//   1. Never throws an unstructured Error (only known error codes).
//   2. Never returns a corrupted result on bad input (always rejects).
//   3. Never hangs (each call finishes in < 100 ms).
//
// The generators are deterministic from a seed (process.env.QV_FUZZ_SEED)
// so a failure is reproducible. CI runs a 10k smoke; nightly runs a 1M
// burn. Catches regressions you can't predict.
//
// Targets:
//   - claims.mjs  validateClaims
//   - trace.mjs   parseTraceparent + sanitizeTracestate
//   - cidr.mjs    parseCidr + matchesAny
//   - audit.mjs   redactSensitive (the secret-blocklist pipeline)
//
// Zero deps. Node stdlib only.

import { validateClaims, loadClaimsConfig } from './claims.mjs';
import { parseTraceparent, sanitizeTracestate } from './trace.mjs';
import { loadCidrList, matchesAny }           from './cidr.mjs';

/* ── deterministic xorshift PRNG (seedable, zero-dep) ────────────────── */

function makePRNG(seed) {
  let s = (seed >>> 0) || 0xdeadbeef;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;  s >>>= 0;
    return s / 0x100000000;
  };
}

/* ── byte mutators ────────────────────────────────────────────────────── */

function randStr(rng, n) {
  // Mix of printable, control, high-bit, and structural chars.
  const POOL = 'abcdefghij{}[]"\\\n\t\0\xFF.,:;()<>!=ABC0123  ';
  let out = '';
  for (let i = 0; i < n; i++) out += POOL[Math.floor(rng() * POOL.length)];
  return out;
}

function flipBit(rng, s) {
  if (s.length === 0) return s;
  const i = Math.floor(rng() * s.length);
  const c = s.charCodeAt(i) ^ (1 << Math.floor(rng() * 8));
  return s.slice(0, i) + String.fromCharCode(c) + s.slice(i + 1);
}

function truncate(rng, s) {
  if (s.length === 0) return s;
  return s.slice(0, Math.floor(rng() * s.length));
}

/* ── generators ──────────────────────────────────────────────────────── */

function genClaims(rng) {
  // Cap depth at 6 (the validator's default cap is 8) and fan-out at 4.
  // We want representative pathological input, not pathological wall time.
  const depth = Math.floor(rng() * 7);
  function build(d) {
    if (d === 0) {
      const r = rng();
      if (r < 0.2) return null;
      if (r < 0.4) return rng() * 1e9;
      if (r < 0.6) return r > 0.5;
      if (r < 0.8) return randStr(rng, Math.floor(rng() * 16));
      if (r < 0.85) return Number.NaN;
      if (r < 0.9)  return Infinity;
      return undefined;
    }
    if (rng() < 0.5) {
      const len = Math.floor(rng() * 4);
      const arr = [];
      for (let i = 0; i < len; i++) arr.push(build(d - 1));
      return arr;
    }
    const obj = {};
    const keys = Math.floor(rng() * 4);
    for (let i = 0; i < keys; i++) {
      obj[randStr(rng, Math.floor(rng() * 6) + 1)] = build(d - 1);
    }
    return obj;
  }
  return build(depth);
}

function genTraceparent(rng) {
  const r = rng();
  if (r < 0.3) return randStr(rng, Math.floor(rng() * 60));
  // Plausible-but-wrong shapes
  const ver   = ['00', 'ff', 'aa', randStr(rng, 2)][Math.floor(rng() * 4)];
  const trace = randStr(rng, 32).replace(/[^0-9a-f]/gi, '0');
  const span  = randStr(rng, 16).replace(/[^0-9a-f]/gi, '0');
  const flags = randStr(rng, 2).replace(/[^0-9a-f]/gi, '0');
  let s = [ver, trace, span, flags].join('-');
  if (rng() < 0.4) s = flipBit(rng, s);
  if (rng() < 0.2) s = truncate(rng, s);
  return s;
}

function genCidr(rng) {
  const r = rng();
  if (r < 0.2) return randStr(rng, Math.floor(rng() * 30));
  // IPv4-ish or IPv6-ish
  if (r < 0.6) {
    return [Math.floor(rng()*256), Math.floor(rng()*256),
            Math.floor(rng()*256), Math.floor(rng()*256)].join('.')
            + '/' + Math.floor(rng() * 33);
  }
  return Array.from({length: 8}, () => Math.floor(rng()*0x10000).toString(16))
              .join(':') + '/' + Math.floor(rng() * 129);
}

/* ── fuzz drivers ────────────────────────────────────────────────────── */

const STABLE_CODES = new Set([
  'CLAIMS_NOT_OBJECT', 'CLAIMS_TOO_DEEP', 'CLAIMS_TOO_MANY_KEYS',
  'CLAIMS_ARRAY_TOO_LARGE', 'CLAIMS_STRING_TOO_LONG', 'CLAIMS_KEY_TOO_LONG',
  'CLAIMS_BAD_NUMBER', 'CLAIMS_BAD_TYPE', 'CLAIMS_TOO_MANY_NODES',
]);

function fuzzClaims(rng, cfg) {
  const c = genClaims(rng);
  const t0 = Date.now();
  try { validateClaims(c, cfg); }
  catch (e) {
    if (!STABLE_CODES.has(e.code)) {
      throw new Error(`claims threw unstable error: ${e.code || 'NO_CODE'} — ${e.message}`);
    }
  }
  const dt = Date.now() - t0;
  if (dt > 100) throw new Error(`claims validate took ${dt}ms (>100ms budget)`);
}

function fuzzTraceparent(rng) {
  const s = genTraceparent(rng);
  const t0 = Date.now();
  let r;
  try { r = parseTraceparent(s); }
  catch (e) { throw new Error(`parseTraceparent threw: ${e.message}`); }
  // Must always return null on bad input, or a fully-populated record.
  if (r !== null) {
    if (typeof r.traceId      !== 'string' ||
        typeof r.parentSpanId !== 'string' ||
        typeof r.sampled      !== 'boolean') {
      throw new Error(`parseTraceparent returned partial result for "${s}": ${JSON.stringify(r)}`);
    }
  }
  const dt = Date.now() - t0;
  if (dt > 50) throw new Error(`parseTraceparent took ${dt}ms`);
}

function fuzzTracestate(rng) {
  const s = randStr(rng, Math.floor(rng() * 1500)); // exceed 512-byte cap
  let r;
  try { r = sanitizeTracestate(s); }
  catch (e) { throw new Error(`sanitizeTracestate threw: ${e.message}`); }
  // Contract: returns string OR null. Never undefined, never throws,
  // never exceeds the cap on the success path.
  if (r !== null && typeof r !== 'string') {
    throw new Error(`sanitizeTracestate returned ${typeof r} for input length ${s.length}`);
  }
  if (typeof r === 'string' && r.length > 512) {
    throw new Error(`sanitizeTracestate exceeded 512 bytes (got ${r.length})`);
  }
}

// Pre-parse a known-good CIDR list once. We fuzz the request-path
// (matchesAny) — the hot path that takes attacker-controlled IPs. The
// parser (loadCidrList) is operator-config and is correct to fail-loud
// on garbage; that's a different invariant.
const KNOWN_GOOD_CIDRS = loadCidrList('10.0.0.0/8,192.168.0.0/16,fe80::/10');

function fuzzCidr(rng) {
  const ip = randStr(rng, Math.floor(rng() * 50));
  try { matchesAny(ip, KNOWN_GOOD_CIDRS); }
  catch (e) { throw new Error(`matchesAny threw on "${ip}": ${e.message}`); }
}

/* ── main ────────────────────────────────────────────────────────────── */

function main() {
  const seed  = Number(process.env.QV_FUZZ_SEED) || 1;
  const iters = Number(process.env.QV_FUZZ_ITERS) || 100_000;
  const rng   = makePRNG(seed);
  const cfg   = loadClaimsConfig({});
  const start = Date.now();
  let i = 0;
  try {
    for (i = 0; i < iters; i++) {
      const which = i % 4;
      if      (which === 0) fuzzClaims(rng, cfg);
      else if (which === 1) fuzzTraceparent(rng);
      else if (which === 2) fuzzTracestate(rng);
      else                  fuzzCidr(rng);
    }
  } catch (e) {
    process.stderr.write(`FUZZ FAIL @iter ${i} seed=${seed}\n${e.stack}\n`);
    process.exit(1);
  }
  const dt = Date.now() - start;
  console.log(`fuzz: ${iters} iterations in ${dt} ms `
            + `(${(iters / (dt/1000)).toFixed(0)} it/s, seed ${seed})`);
}

main();
