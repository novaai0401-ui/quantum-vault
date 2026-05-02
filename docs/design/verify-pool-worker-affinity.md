# Design: Verify-Pool Worker Affinity

**Status:** scoped, deferred to a follow-up PR.
**Owners:** core team.
**Tracking:** v4.4 ROADMAP.

## Summary

Today the verify-pool round-robins jobs across N worker threads (one
shared FIFO queue, N consumers). Each verify pays the cost of
re-importing the verifying key into the worker. With **affinity** —
hashing `keyId` to choose the worker — a hot key's verifying key stays
warm in one worker thread's heap, eliminating ~70% of the per-verify
ML-DSA-87 setup cost.

## Why this is not in v4.3

The design has three subtle correctness traps that need a careful
review pass with tests:

1. **Queue starvation.** A single noisy keyId targeted at one worker
   can fill that worker's queue while other workers idle. The naive
   per-worker queue with a global cap breaks the per-keyId fairness
   property the per-key rate limit gives us at the front door.
2. **Worker death.** When a worker dies (uncaught exception, OOM),
   the affinity map currently points half the live keys at a dead
   slot. We need either (a) a re-hash on worker replacement, OR
   (b) a fallback dispatch to any-worker that doesn't break ordering.
3. **Backpressure semantics.** The current `POOL_OVERLOADED` guarantee
   is "any worker can take this job." With affinity it becomes "the
   worker for this key is full" — which is a stricter contract that
   needs the verify-pool API to surface keyId-aware backpressure.

These are solvable but need real test coverage before merging.

## Proposed design

### Hash function

`workerIdx = murmur3_32(keyId) % nWorkers`. Stable across restarts. We
already require a non-cryptographic hash; SHA3-256 truncated to 32
bits is overkill. Keep zero-dep — implement murmur3 inline in
`verify-pool.mjs` (~30 LOC).

### Per-worker queue

Replace single FIFO with `queues: Array<Queue>` of length `nWorkers`.
Global queue depth = sum of all per-worker depths. Per-worker cap =
`QV_VERIFY_QUEUE_MAX / nWorkers` (rounded up).

### Backpressure

`POOL_OVERLOADED` fires when the **specific worker's** queue is full,
even if siblings have room. The new error envelope adds
`worker: <idx>` for ops debugging. Caller's retry must hit a
different keyId or wait — same key on retry will land on the same
worker.

### Worker replacement

On `worker.exit`:

1. Mark slot `dead`.
2. Spawn a replacement.
3. Drain the dead worker's pending queue and re-dispatch each job to
   its newly-hashed slot (which is the same slot if the slot index
   doesn't change). The `dead → alive` transition is a single atomic
   swap.

### Metrics

Add labels to existing counters:

- `qv_verify_queue_depth{worker="0..N"}` (replaces unlabelled gauge)
- `qv_verify_queue_rejects_total{worker="0..N"}`

Cardinality stays bounded (N ≤ `cpus().length`).

### Migration

- Phase 1 (this PR, deferred): ship the design doc.
- Phase 2: add affinity behind `QV_VERIFY_AFFINITY=true` (default
  off). Default-off lets us merge without changing observable
  behaviour. Operators with hot keys flip the bit.
- Phase 3: ship benchmarks demonstrating throughput uplift.
- Phase 4: flip the default to on after a release of bake time.

## Expected impact

Given the qv-server bench numbers (today ~78 verify/sec on Windows,
~600 verify/sec on Linux), the verifying-key import is roughly 30% of
the per-verify cost. Affinity should yield:

- **Hot-key workload** (one keyId, sustained traffic): ~30-40% verify
  throughput uplift; p99 latency ~25% lower because ML-DSA-87 setup
  cost amortises across batches.
- **Cold-key workload** (many short-lived keyIds, no reuse): no
  change. The amortisation has nothing to amortise across.
- **Multi-tenant warm workload** (10–50 keyIds, all active): biggest
  win. Each worker stays warm on its 1-5 keyIds; per-tenant fairness
  is preserved by the front-door per-key rate limit.

## Tests we'll need

Before this lands:

- Affinity stable: same keyId → same worker across N invocations.
- Worker death: replacement preserves dispatch correctness.
- Queue starvation: per-worker cap fires per-key, not globally.
- Bench delta: a microbenchmark showing the verify-pool throughput
  uplift on a hot-key workload.

## Open questions

- Should we expose the worker index in the audit event?
  (Operationally useful; no security implication.)
- Should the hash be stable across server restarts on a different
  host? Murmur3 with a fixed seed is — but if the operator changes
  `nWorkers`, all assignments shift. That's a feature on a hardware
  swap, a bug if the operator wants smooth rolling restart. Punt to
  the implementation PR.
