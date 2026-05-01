# Chapter 10 — Observability: Metrics, Audit, Traces

## The story

An identity server that you cannot observe is an identity server you
cannot debug, tune, or defend. Observability is not a feature we
bolted on — it is threaded through every middleware.

Three surfaces:

1. **Prometheus metrics** at `/v3/metrics` — quantitative.
2. **Structured audit log** at `audit.log` — qualitative, searchable.
3. **W3C Trace Context** — correlation across services.

All three share one design rule: **no secret ever touches any of them.**
The audit auditor has an explicit blocklist. The metrics layer only
ever records enums and bounded-cardinality strings. The trace layer
only records the ids; claims and tokens are never in trace data.

## Prometheus metrics (`metrics.mjs`)

### Zero-dep Prometheus exposition

We emit the Prometheus text format v0.0.4 directly. No
`prom-client`, no `@opentelemetry/exporter-prometheus`. ~100 lines of
`metrics.mjs` handle counter/gauge/histogram types with label
escaping, cardinality truncation (128 chars max per label value), and
the `# HELP` / `# TYPE` header lines.

### The metric set

| Metric | Type | Labels | Purpose |
|--------|------|--------|---------|
| `qv_http_requests_total` | counter | method, path, status | Traffic |
| `qv_http_request_duration_seconds` | histogram | method, path | Latency |
| `qv_auth_denies_total` | counter | reason | Denial forensics |
| `qv_rate_limit_denies_total` | counter | category | Capacity planning |
| `qv_token_issue_total` | counter | suite, tokenType, result | Issuance rate |
| `qv_token_verify_total` | counter | result | Verify rate + failure % |
| `qv_keys_total` | gauge | — | Key population |
| `qv_revoked_total` | gauge | — | Revocation rate |
| `qv_inflight_requests` | gauge | — | Concurrency |
| `qv_process_uptime_seconds` | gauge | — | Boot time |
| `qv_verify_queue_depth` | gauge | — | Worker-pool backlog |
| `qv_verify_queue_rejects_total` | counter | — | Backpressure 503s |

### The cardinality rule

Labels come from a closed set. The `path` label is the **route
template** (`/v3/keys/:id`), not the raw URL. Raw URLs contain
opaque UUIDs which would generate unbounded label series. Every
handler sets `req._routeTemplate` at dispatch time; metric emission
reads from there. A test verifies that two different keyIds collapse
to a single `path="/v3/keys/:id"` series.

### The auth guard

`/v3/metrics` is admin-bearer protected by default. This matters
because metrics include enough signal to plan an attack (inflight
count, auth-fail rate). If you're behind a trusted mesh where
admin tokens are awkward to distribute, set `QV_METRICS_PUBLIC=true`.
The CIDR allowlist (Chapter 9) applies to metrics independently of
admin, via `QV_METRICS_ALLOW_CIDRS` (inherits from admin if unset).

### Sampling and disabling

`QV_METRICS_DISABLED=true` removes the route and skips instrumentation.
Useful for load tests and resource-constrained environments.

## Structured audit log (`audit.mjs`)

### JSONL, not text

One JSON object per line. Timestamp is ISO-8601 UTC. Fields are a
stable flat schema — no nested objects beyond primitives — so
`jq` / `grep` / `awk` handle it trivially.

```json
{"ts":"2026-04-22T14:35:21.204Z","level":"info","event":"http.request",
 "requestId":"7f3b2a1c","traceId":"4bf9...","spanId":"00f0...",
 "parentSpanId":"abcd...","traceInherited":true,
 "ip":"10.0.0.5","method":"POST","path":"/v3/token/issue",
 "template":"/v3/token/issue","status":200,"ms":4.12}
```

### Event vocabulary

| Event | Emitted when |
|-------|--------------|
| `http.request` | Every request, on response finish |
| `auth.deny` | Bearer failure, CIDR deny, rate-limit deny |
| `keygen` | Key created |
| `token.issue` | Token issued |
| `token.revoke` | Key revoked |
| `server.start` / `server.shutdown` | Lifecycle |

All events carry `requestId`, `traceId`, `spanId` for cross-reference.

### The sensitive-key blocklist

Before serialisation, the auditor drops any field whose key matches:

```
token, bearer, authorization, masterKey, master_key,
privateKey, private_key, secret, password, cookie
```

A dedicated integration test writes a fake call with `authorization: "Bearer plaintext"`
in the body and greps `audit.log` to confirm the plaintext does not
appear. This test ran on every pre-commit during development.

### Rotation (limitation #6b)

Size-based rotation is built in. Default 64 MiB per file, 5 archives.
After every write, if `bytesWritten >= QV_AUDIT_ROTATE_BYTES`:
1. Close the fd.
2. `audit.log.4 → audit.log.5` (unlinking the old .5).
3. `audit.log.3 → audit.log.4`.
4. ... down to `audit.log → audit.log.1`.
5. Reopen a fresh fd at size 0.

Rotation is best-effort: any failure is logged to stderr and logging
continues. `QV_AUDIT_ROTATE_BYTES=0` disables rotation (e.g., when
an external log shipper will rotate for you).

### Destinations

- `QV_AUDIT_STDOUT=true` (default) — emit to stdout. Works well with
  systemd/Docker journalctl.
- `QV_AUDIT_FILE=true` (default) — emit to `<DATA_DIR>/audit.log`.
  Mode 0600.
- Both by default so either ingest path works without configuration.
- `QV_AUDIT_DISABLED=true` — kill both. Test-only.

## W3C Trace Context (`trace.mjs`)

### The protocol

W3C Trace Context is two HTTP headers:
- `traceparent`: `<version>-<trace-id>-<span-id>-<flags>` (hex).
- `tracestate`: opaque vendor-specific key-value list.

### What we do

Parse `traceparent` strictly:
- Version must be `00` (current spec).
- Trace-id must be 32 hex chars, non-zero.
- Span-id must be 16 hex chars, non-zero.
- Flags are two hex chars; low bit is `sampled`.

If valid, inherit the trace-id and mint a fresh span-id (16 random
bytes, hex-encoded). The caller's span-id becomes `parentSpanId`.

Emit a response `traceparent` `00-<inheritedTraceId>-<ourSpanId>-<flags>`
so a downstream service can continue the trace.

`tracestate` is passed through opaquely if it's ≤ 512 bytes of
printable ASCII. We don't mutate vendor-specific state.

### What we don't do

We don't run a full tracer. No OTLP exporter, no sampling decisions
(we honour the caller's), no span attributes beyond what the audit
log already captures. The audit log *is* our trace data. An external
collector can replay `audit.log` into Tempo / Jaeger / Honeycomb by
grouping on `traceId` and threading on `parentSpanId`.

### Why that's enough

Because we're a *server*, not a traced *service mesh*. The caller
has their own tracer. We just need to be a good citizen: inherit
the trace, mint a child, propagate `tracestate`, log with
correlatable ids.

## Putting it together

One request, `X-Request-Id: 7f3b2a1c`:

```bash
# Audit trail
grep 7f3b2a1c audit.log | jq
# → http.request, token.issue

# Metrics snapshot
curl -H "Authorization: Bearer $ADMIN" http://vault/v3/metrics | \
  grep -E 'token_issue|http_requests'

# Trace (via your tracer)
# Tempo / Jaeger query: trace_id=4bf9...
# → parent span (caller), our span, any downstream spans
```

## The code

- `qv-server/metrics.mjs` — Prometheus exposition + registry
- `qv-server/audit.mjs` — JSONL auditor + rotation + blocklist
- `qv-server/trace.mjs` — W3C Trace Context
- `qv-server/server-sovereign.mjs` → instrumentation

## The evidence

- `test/metrics.test.mjs`, `test/integration.metrics.test.mjs` —
  14 tests asserting format, cardinality, auth.
- `test/audit.test.mjs`, `test/integration.audit.test.mjs` — 25+ tests
  including the plaintext-token leak test.
- `test/trace.test.mjs`, `test/integration.trace.test.mjs` — 16 tests
  asserting parse, inherit, mint, echo.

## The comparison

| Product | Metrics format | Audit log | Trace context | Zero-dep |
|---------|----------------|-----------|---------------|----------|
| Auth0 | Proprietary | Proprietary | Proprietary | N/A |
| Keycloak | JMX (→ custom exporter) | DB-backed | Partial | No |
| Vault | Prometheus | Text | OpenTelemetry | No |
| **Sigvault** | **Prometheus (built-in)** | **JSONL + rotation** | **W3C v00** | **Yes** |

Next: Chapter 11, [Verify Pool + Backpressure](./11-verify-pool.md).
