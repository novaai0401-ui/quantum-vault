#!/usr/bin/env node
// harness.mjs — run vectors.json against an SDK-compatible verifier.
//
//   node qv-spec/test-vectors/harness.mjs              # uses bundled spec runners
//   node qv-spec/test-vectors/harness.mjs --vectors=path/to/vectors.json
//
// Exit codes:
//   0  all vectors pass
//   1  one or more vectors failed
//   2  vectors.json malformed or missing
//
// The harness is intentionally tiny so it ports trivially to other
// languages: parse JSON → dispatch on `kind` → compare to `expect`.
// Each kind has a `runner` that takes the vector and returns
// `{ ok: boolean, detail?: string }`.

import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Buffer } from 'node:buffer';

import { validateClaims, loadClaimsConfig } from '../../qv-server/claims.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_VECTORS = join(HERE, 'vectors.json');

/* ── argv parsing (zero-dep) ──────────────────────────────────────────── */

function arg(name, fallback) {
  const flag = `--${name}=`;
  const hit  = process.argv.find(a => a.startsWith(flag));
  return hit ? hit.slice(flag.length) : fallback;
}

/* ── decode helpers ───────────────────────────────────────────────────── */

function fromB64u(s) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  return Buffer.from(s.replaceAll('-','+').replaceAll('_','/') + pad, 'base64');
}

function sha3_256(...parts) {
  const h = createHash('sha3-256');
  for (const p of parts) h.update(p);
  return h.digest();
}

/* ── runners (one per vector.kind) ────────────────────────────────────── */

const runners = {
  'chain.advance': (v) => {
    const seed = fromB64u(v.input.seedB64u);
    let state = Buffer.from(seed);
    let preCtr = 0n;
    for (let i = 0; i < v.input.advances; i++) {
      const buf = Buffer.alloc(40);
      state.copy(buf, 0);
      buf.writeBigUInt64BE(preCtr, 32);
      state = sha3_256(buf);
      const postCtr = preCtr + 1n;
      const expected = v.expect.trace[i];
      if (postCtr.toString() !== expected.counter)
        return { ok: false, detail: `step ${i}: counter ${postCtr} vs ${expected.counter}` };
      const ok = Buffer.compare(state, fromB64u(expected.stateB64u)) === 0;
      if (!ok) return { ok: false, detail: `step ${i}: stateHash mismatch` };
      preCtr = postCtr;
    }
    if (state.toString('base64')
          .replaceAll('+','-').replaceAll('/','_').replaceAll('=','')
        !== v.expect.finalStateB64u)
      return { ok: false, detail: 'final state mismatch' };
    return { ok: true };
  },

  'claims.validation': (v) => {
    const cfg = v.input.config || loadClaimsConfig({});
    let actual;
    try {
      // Restore non-finite numbers if the vector's input encoded NaN/Infinity
      // as null (JSON limitation). The vector's id telegraphs the expected
      // case so we deterministically reconstitute.
      let claims = v.input.claims;
      if (v.id === 'claims.validation.bad-number-nan'
       || v.id === 'claims.validation.bad-number-inf') {
        claims = { x: v.id.endsWith('inf') ? Infinity : NaN };
      }
      validateClaims(claims, cfg);
      actual = { ok: true };
    } catch (e) {
      actual = { ok: false, code: e.code || 'CLAIMS_INVALID' };
    }
    if (JSON.stringify(actual) !== JSON.stringify(v.expect))
      return { ok: false, detail: `actual=${JSON.stringify(actual)} expect=${JSON.stringify(v.expect)}` };
    return { ok: true };
  },
};

/* ── main ─────────────────────────────────────────────────────────────── */

function main() {
  const path = resolve(arg('vectors', DEFAULT_VECTORS));
  if (!existsSync(path)) {
    process.stderr.write(`harness: vectors file not found at ${path}\n`);
    process.exit(2);
  }
  let doc;
  try { doc = JSON.parse(readFileSync(path, 'utf8')); }
  catch (e) {
    process.stderr.write(`harness: ${path} is not valid JSON: ${e.message}\n`);
    process.exit(2);
  }

  let pass = 0, fail = 0, skip = 0;
  const failures = [];
  for (const v of doc.vectors) {
    const runner = runners[v.kind];
    if (!runner) {
      skip++;
      process.stdout.write(`SKIP ${v.id} (no runner for kind=${v.kind})\n`);
      continue;
    }
    let r;
    try { r = runner(v); }
    catch (e) { r = { ok: false, detail: `runner threw: ${e.message}` }; }
    if (r.ok) {
      pass++;
      process.stdout.write(`PASS ${v.id}\n`);
    } else {
      fail++;
      failures.push({ id: v.id, detail: r.detail || 'no detail' });
      process.stdout.write(`FAIL ${v.id} — ${r.detail || ''}\n`);
    }
  }

  process.stdout.write(`\nharness: ${pass} pass, ${fail} fail, ${skip} skipped, `
    + `${doc.vectors.length} total (spec ${doc.spec_version})\n`);

  if (fail > 0) {
    process.stdout.write('\nFailures:\n');
    for (const f of failures) process.stdout.write(`  - ${f.id}: ${f.detail}\n`);
    process.exit(1);
  }
}

main();
