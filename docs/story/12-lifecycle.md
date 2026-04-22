# Chapter 12 — Graceful Shutdown + Health

## The story

Kubernetes kills pods. Load balancers health-check. Cloud autoscalers
scale down. Deploy pipelines rolling-restart. Every long-running
service lives inside a control plane whose job is to terminate it
regularly. A service that handles termination badly drops connections,
serves 500s during deploys, and causes operational pain.

QuantumVault handles termination explicitly in three layers:

1. **Liveness** (`/v3/live`) — "is the process alive?"
2. **Readiness** (`/v3/ready`) — "should I send traffic?"
3. **Drain** — "stop accepting, wait for in-flight, then exit."

## Liveness (`/v3/live`)

Returns `200 {status:"alive"}` as long as the event loop is
responsive. This endpoint **never** returns 503 during drain —
draining is a readiness transition, not a liveness failure. If the
process is deadlocked or crash-looping, the event loop doesn't respond
and Kubernetes' liveness probe times out → pod restart.

The endpoint is extremely cheap: no disk reads, no crypto, no locks.
A broken liveness would misdiagnose the problem.

## Readiness (`/v3/ready`)

Returns:
- `503 {status:"loading"}` before the keystore and revocation list
  are loaded.
- `200 {status:"ready"}` once the boot sequence is complete.
- `503 {status:"draining"}` once a SIGTERM/SIGINT has been received.

Target this from Kubernetes' `readinessProbe`. When readiness flips to
503, the Kubernetes service removes the pod from the service endpoints
within ~1 second. In-flight requests continue; new requests go elsewhere.

## Back-compat: `/v3/health`

v4.2 clients polled `/v3/health`. We kept the route as an alias of
`/v3/ready`. The status string changed from `"ok"` to `"ready"`; the
old value is still accepted by tests so clients can migrate at their
own pace.

## The drain sequence

On `SIGTERM` or `SIGINT`:

```
  1. shutdownCtl.isDraining = true      (immediate)
  2. /v3/ready starts returning 503
  3. server.close() — stops accepting new connections
  4. Existing in-flight requests complete naturally
  5. verifyPool.shutdown() — workers terminate
  6. audit.close() — fd closed
  7. clearInterval(sweepTimer)
  8. process.exit(0)
```

A hard timeout (`QV_SHUTDOWN_TIMEOUT_MS`, default 30 000) fires
`process.exit(1)` if drain stalls. This covers the pathological case
where a handler hung on a worker thread that's not responding.

## Signal delivery on Windows

Node does not deliver POSIX signals to child processes on Windows —
`child.kill('SIGTERM')` calls `TerminateProcess` and bypasses graceful
drain entirely. Our integration test for drain is marked `skip` on
`win32`. In production on Windows, use the Windows Service shutdown
mechanism (NSSM, or the built-in Service Control Manager) which does
invoke the in-process handler.

## Tracking in-flight

Every dispatcher call goes through:

```javascript
shutdownCtl.trackRequest(req, res);
```

which increments `inflightCount` on entry and decrements on
`res.on('finish')` or `res.on('close')`. Both `finish` and `close`
can fire — the counter only decrements once.

`qv_inflight_requests` is this gauge. During normal operation it
hovers at ~0. During drain it goes to 0 monotonically.

## The `server.shutdown` audit trail

Each phase emits an audit event:

```json
{"event":"server.shutdown","phase":"signal","signal":"SIGTERM"}
{"event":"server.shutdown","phase":"draining","inflight":3}
{"event":"server.shutdown","phase":"drained","inflight":0}
{"event":"server.shutdown","phase":"teardown.workers"}
{"event":"server.shutdown","phase":"teardown.audit"}
{"event":"server.shutdown","phase":"exit","code":0}
```

Operators can grep `server.shutdown` to audit every termination.

## The code

- `qv-server/shutdown.mjs` — `createShutdown` + `trackRequest`
- `qv-server/server-sovereign.mjs` — signal handlers + `/v3/live`,
  `/v3/ready`, `/v3/health`

## The evidence

- `test/shutdown.test.mjs` — 8 unit tests (drain timing,
  idempotency, hard-timeout, track-increment, finish-and-close).
- `test/integration.health.test.mjs` — asserts the three endpoints'
  behaviour.
- `test/integration.shutdown.test.mjs` — end-to-end drain on POSIX
  (skipped on win32).

## The comparison

| Product | Liveness/readiness split | In-flight drain | Hard-timeout |
|---------|--------------------------|-----------------|--------------|
| Express default | No (one /health) | No | No |
| Fastify | Yes (with hooks) | Yes | Manual |
| Vault | Yes | Yes | Yes |
| Keycloak | Yes | Yes | Yes |
| **QuantumVault** | **Yes (out of box)** | **Yes (tracked)** | **Yes (30s default)** |

Next: Chapter 13, [Claims Validation](./13-claims.md).
