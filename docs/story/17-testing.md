# Chapter 17 — Testing Philosophy

## The story

195 tests. Run in ~18 seconds. Zero test dependencies. No framework,
no fixture library, no mock framework.

We use Node's built-in `node:test` and `node:assert/strict`. When we
need a spy, we write a closure. When we need a fixture, we write a
factory. When we need a mock worker thread, we write a 15-line
`.mjs` file.

This is the zero-dep oath extended into the test layer.

## Two kinds of tests

### Unit tests (~130 tests)

One module under test, zero I/O beyond tmpdir. Fast (< 50 ms each).
Run in parallel inside Node's test runner.

Examples:
- `test/auth.test.mjs` — bearer comparison, env validation.
- `test/ratelimit.test.mjs` — bucket math, sweep, categories.
- `test/claims.test.mjs` — structural caps across depth/keys/array/string.
- `test/verify-pool.test.mjs` — overload semantics with a mock worker.

### Integration tests (~65 tests)

Spawn a real `server-sovereign.mjs` in a child process. Hit it with
real `fetch()` calls. Assert on the actual HTTP semantics — status,
headers, bodies.

Integration tests each get a random port (20000+ offset) and a fresh
tmpdir. They run serially inside their file, parallel across files.

Examples:
- `test/integration.auth.test.mjs` — bearer end-to-end.
- `test/integration.claims.test.mjs` — 400 codes on bad claims.
- `test/integration.metrics.test.mjs` — Prometheus scrape.
- `test/integration.trace.test.mjs` — traceparent propagation.

## What we deliberately don't test

- **The output of `ML-DSA.sign` bit-by-bit.** That's PQClean's job.
  We test that *our* call round-trips through *our* verify.
- **Prometheus scrape format compatibility.** We test that the
  bytes match the spec's regex; we trust Prometheus to parse it.
- **Node's own APIs.** We don't unit-test `crypto.randomUUID`.
- **Race conditions we can't reproduce deterministically.** We
  prefer to prove absence by construction (bounded queues, atomic
  renames, constant-time compares).

## Running locally

```bash
cd qv-server
npm test           # all 195 tests
npm run test:unit  # unit tests only
npm run test:it    # integration tests only
```

## Running in CI

Same command. CI sets `CI=true` which Node's test runner uses to
format output for CI log aggregation. On win32, one integration test
is skipped (graceful-shutdown — see Chapter 12).

## Adding a new test

Rules:
1. No npm install. If you feel you need one, think harder.
2. One file per module under test.
3. Unit tests import directly: `import { foo } from '../foo.mjs'`.
4. Integration tests `spawn` the server; never `import` the server.
5. Use random high ports (20000+) to avoid CI flakes.
6. Use `mkdtempSync(tmpdir(), 'qv-<prefix>-')` for data dirs; clean
   up in `after()`.
7. Assert on stable error codes (`CLAIMS_TOO_DEEP`), not messages.

## The reliability loop

Every change goes through:

1. Code change.
2. `npm test`. All 195 pass.
3. Commit.
4. CI re-runs `npm test` on Linux + macOS + Windows.
5. On every push, security-review check (Claude) highlights new
   limitations.
6. Merge.

The 18-second test suite is a deliberate ceiling — we will not let
it grow beyond 60 s, because a slow test suite is a test suite people
skip.

## Property tests

`qv-core` (Rust) uses `proptest` for the wire format. Random claims
round-trip through every suite. This catches encoding/decoding
asymmetries that unit tests miss.

JS-land does not yet have property tests; candidates include
`fast-check`, but that would violate the zero-dep oath for the test
surface. We're watching Node's built-in property testing proposals.

## Mutation testing

Not today. Adding Stryker or similar would add dependencies. When we
move to per-module test packages (v5.0), mutation testing may live
in a separate subpackage.

## The evidence

Run it. The number at the bottom is the current truth:

```
ℹ tests 195
ℹ pass 195 (1 skipped on win32)
ℹ duration_ms ~18000
```

---

That's the whole book. Go build something that will still be
authoritative in 2035.
