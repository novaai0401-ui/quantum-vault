# Chapter 19 — The Single-Writer Lock

## The story

Chapter 6 explained why the MutationChain is single-writer by design.
Two qv-server processes pointing at the same `DATA_DIR` will:

- double-issue tokens at the same chain counter,
- race the chain log so records overlap, and
- silently corrupt the chain (Phase 1's `CHAIN_LOG_TAMPERED` would fire
  on the next restart, but the damage is already done).

Until v4.3 there was nothing in the binary that prevented this. We
just told operators "don't do that" in Chapter 16. That's not a
defence — it's an apology.

This chapter is the lock that makes the apology unnecessary.

## What it does

On boot, qv-server tries to acquire `$DATA_DIR/.writer-lock`. The
file is a small JSON document:

```json
{
  "fence":      "1",
  "holderId":   "<uuid>",
  "pid":        12345,
  "hostname":   "qv-prod-1",
  "acquiredAt": "2026-04-24T19:50:00.000Z",
  "expiresAt":  "2026-04-24T19:50:30.000Z"
}
```

Three outcomes are possible:

1. **No file** → write a fresh lock with `fence=1`. Boot proceeds.
2. **File present, owner is alive on this host, lease unexpired** →
   refuse to start. Print `WRITER_LOCK_HELD` with the offending PID
   and exit non-zero. The operator stops the other process and
   restarts.
3. **File present, but owner is dead OR lease expired OR hostname
   doesn't match** → steal the lock. Bump `fence` by one and
   continue.

On graceful shutdown the file is unlinked. On `SIGKILL` it stays — the
next start-up takes the steal path.

## Why fence-tokens

The fence is a monotonically increasing 64-bit integer. It exists
because of the classic lease-renewal hazard:

> Process A acquires the lease. The kernel pauses A for 60 seconds
> (e.g. swap thrashing). The lease expires. Process B steals it. A
> wakes up, thinks it still owns the lease, issues a token. Now the
> chain has two writers in lock-step.

In our protocol, A's `renew()` call reads the current lease back. If
the fence is no longer A's, A throws `WRITER_LOCK_LOST` and the
server aborts loud rather than continuing to write. The fence bound
is the formal version of "you're not the writer any more."

## What this lock does NOT promise

- **Cross-host safety on a shared filesystem.** NFS / SMB / EFS
  hosts may not honour `rename(2)` atomicity; lock files on shared
  mounts are notoriously unreliable. Two hosts that share a mount
  must use a real coordinator (Postgres, etcd, S3 conditional-put).
  v4.4 ships that.
- **Write fencing of the chain log.** The lease doesn't fence
  individual writes. If a writer is paused for longer than the lease
  TTL and another writer takes over, the paused writer's next
  `appendChain` would still hit the disk. Detection lives in
  Phase 1's chain-log linkage check (`CHAIN_LOG_TAMPERED`), not here.
  The lease is a *boot-time* mutual-exclusion device, not a
  runtime-fenced storage primitive.
- **Auto-rescue.** A `WRITER_LOCK_HELD` exits with non-zero. We do
  not retry, sleep, or wait. Operators decide what's correct.

## Configuration

| Env var | Default | Purpose |
|---------|---------|---------|
| `QV_WRITER_LOCK_DISABLED` | `false` | Skip the lock entirely. Use only when you've moved the chain log to a shared coordinator. |

The TTL (30 s) and renew interval (10 s) live in the source. They
were tuned to be much longer than any plausible GC pause and much
shorter than any human reaction time. Hardcoded by intent — env
sprawl is its own bug.

## Cost / benefit

| Property | Cost | Benefit |
|----------|------|---------|
| File-based, zero-dep | ~3 ms at boot | No new operational dependency |
| Stale-lease take-over | The risk that two writers temporarily co-exist if one is paused | Recovery without manual intervention from common cases (SIGKILL, OOM, hot restart) |
| Fence token | One extra disk read on renew | Loud failure if the lease is stolen during a GC pause |
| Refuse-to-start | A misconfigured deploy crash-loops | Better than silent corruption |

## Where it sits in the lifecycle

```
START
  │
  ├─ acquireWriterLock()   ←── refuses here on collision
  │
  ├─ load master key
  ├─ load keystore
  ├─ verify chain log linkage
  ├─ open verify pool
  ├─ open HTTP server
  │
  RUN
  │
  ├─ (per request) issue / verify
  │
  SIGTERM / SIGINT
  │
  ├─ stop accepting new conns
  ├─ drain in-flight
  ├─ shutdown verify pool
  ├─ close audit log
  ├─ release writer lock     ←── unlinks the file
  │
  EXIT 0
```

## The evidence

- `qv-server/writer-lock.mjs` — 130 lines, no deps.
- `test/writer-lock.test.mjs` — 14 unit tests covering acquire, renew,
  steal, fence advance, corrupt JSON, allowSteal=false, and `pidAlive`
  semantics.
- `test/integration.writer-lock.test.mjs` — 4 integration tests:
  collision-refuses, graceful-release-allows-rebind (POSIX), SIGKILL
  → fence-bumped takeover, env-disabled bypass.

## What's next

v4.4 swaps the FS lock for a pluggable `ChainStore` interface so the
same protocol works against:

- **Postgres**: `SELECT … FOR UPDATE NOWAIT` on a coordination row.
- **etcd**: a lease + watch.
- **S3**: conditional-put (If-None-Match) on the lock object.
- **Redis Cluster**: `SET NX PX` (Redlock — with caveats).

The fence model already accommodates each of those — only the
acquire/renew implementation changes. The rest of qv-server doesn't
care.
