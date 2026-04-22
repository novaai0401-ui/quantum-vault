# Chapter 11 — Verify Pool + Backpressure

## The story

ML-DSA-87 verification takes ~250 µs on a modern x86 core. Falcon
verification takes ~40 µs. Both are CPU-bound and fully independent
— each token can be verified in isolation. Perfectly parallelisable.

Node.js has one event-loop thread. A 250 µs synchronous verify on
every `/v3/token/batch-verify` call would starve the event loop on
any concurrent traffic. So we ship verification out to a pool of
worker threads and feed them jobs via a bounded FIFO queue.

## The architecture

```
                                                 ┌──────────────┐
                                                 │  worker 1    │──┐
                                                 └──────────────┘  │
  HTTP handler  ┌────────────┐  ┌───────────┐   ┌──────────────┐  │
  ───(run)────> │  idle set  │  │   queue   │──>│  worker 2    │──┤
                └─────┬──────┘  └───────────┘   └──────────────┘  │
                      │ yes                      ┌──────────────┐  │
                      └──────direct dispatch────>│  worker N    │──┤
                                                 └──────────────┘  │
                                                                   ▼
                                                           response Promise
```

- `size` workers, pre-spun at init.
- Idle workers are dispatched to immediately.
- If no worker is idle, the job queues up to `queueMax`.
- If the queue is full, `run()` **resolves immediately** with
  `{ok: false, error: 'POOL_OVERLOADED'}` and bumps `rejects`.

## Why a bounded queue

Unbounded queues are a DoS. Here's the failure mode: the upstream
gets slow (or a worker thread wedges), jobs pile up in the queue,
memory grows without bound, every future verify is blocked behind
the backlog, latency collapses toward the queue depth × per-job time.
Eventually the process is OOM-killed.

A bounded queue *cannot* grow. When it's full, the system has three
options: (a) block the caller synchronously, (b) drop the caller, or
(c) shed load upstream. We pick **(b) drop** with a stable error and
an HTTP-level 503 + `Retry-After: 1`. The caller decides whether to
retry immediately, back off exponentially, or fail their own request.

## The HTTP surface

`/v3/token/batch-verify` has a pre-flight check:

```javascript
if (verifyPool) {
  const headroom = verifyPool.queueMax - verifyPool.queueDepth;
  if (items.length > headroom + verifyPool.size) {
    res.setHeader('retry-after', '1');
    return err(res, 503, 'POOL_OVERLOADED',
      `verify pool saturated (queue=${verifyPool.queueDepth}/${verifyPool.queueMax})`);
  }
}
```

If the caller submits a batch larger than available headroom +
workers, we reject **the whole batch** up front rather than enqueue
some and lose others mid-way. This keeps the HTTP contract clean —
either the whole batch processes or the caller retries.

## Sizing

- `QV_WORKERS` — default `max(2, cpus().length - 1)`. Set `0` to
  disable the pool entirely and verify in-thread (useful for tests
  or tiny deployments).
- `QV_VERIFY_QUEUE_MAX` — default 1024. Tune to
  `workers × average batch-size × peak-traffic-seconds`. If a worker
  handles 4 000 verifies/sec and you expect bursts of 2× steady
  state for 250 ms, a queue of 1 000 per worker is fine.

## Shutdown semantics

On graceful shutdown (Chapter 12):
1. HTTP server stops accepting new requests.
2. In-flight requests drain (including those whose verify is in the pool).
3. `verifyPool.shutdown()` terminates workers.
4. Any queued job that hadn't dispatched resolves with `POOL_SHUTDOWN`.
5. Any in-flight job that hadn't replied gets a `WORKER_ERROR`.

## Metrics

- `qv_verify_queue_depth` — gauge, updated on every scrape by
  reading `pool.queueDepth`.
- `qv_verify_queue_rejects_total` — counter, incremented per reject.

A graph of `qv_verify_queue_depth` with a horizontal line at
`QV_VERIFY_QUEUE_MAX` is the primary capacity-tuning view. A
sustained depth > 50 % of the max is a scale-up trigger.

## Why it's unit-testable

`VerifyPool` is in its own module (`verify-pool.mjs`). Tests use a
tiny `_mock-worker.mjs` that echoes the job back after a configurable
delay. This lets us deterministically test queuing, overload, and
shutdown without booting the whole server or running real crypto.

## The code

- `qv-server/verify-pool.mjs` — the class
- `qv-server/verify-worker.mjs` — the real verify worker
- `qv-server/test/_mock-worker.mjs` — the test mock
- `qv-server/test/verify-pool.test.mjs` — 6 unit tests

## The evidence

The unit tests cover: happy path, queueing, overload-reject,
rejects monotonic, queueDepth accuracy, shutdown-drain. All run in
< 2 s.

## The comparison

| Product | Verify parallelism | Backpressure | 503 on overload |
|---------|---------------------|--------------|-----------------|
| JWT libs (node-jsonwebtoken) | Synchronous, event-loop-bound | None | N/A |
| Auth0 | Managed | Unknown | Yes (429) |
| Keycloak | Thread pool | Unbounded queue | No |
| **QuantumVault** | **Worker threads** | **Bounded queue** | **Yes (503 POOL_OVERLOADED)** |

Next: Chapter 12, [Graceful Shutdown + Health](./12-lifecycle.md).
