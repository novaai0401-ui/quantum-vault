# Chapter 8 — Request Lifecycle

## The story

One HTTP request. Thirteen conceptual stages, every one of them
measurable, auditable, and reversible. If you read only one chapter
after Chapter 1, read this one — it's the architecture in one walk-through.

## The walk-through

A client sends:

```
POST /v3/token/issue HTTP/1.1
Host: vault.example.com
Authorization: Bearer <admin-token>
X-Request-Id: 7f3b2a1c
Traceparent: 00-abc...-def...-01
Content-Type: application/json

{"keyId":"<uuid>","claims":{"sub":"alice"},"ttl":3600}
```

Here's what happens, step by step:

### 1. TCP / TLS acceptance

The reverse proxy (nginx, Caddy, Envoy — whoever you've chosen)
terminates TLS and forwards to `127.0.0.1:7433`. Node's `createServer`
accepts the socket. If `shutdownCtl.isDraining` is true (Chapter 12),
the response short-circuits to `503 draining`. Otherwise we proceed.

### 2. Request-Id extraction (`audit.mjs`)

`extractOrMintRequestId(req)` reads `X-Request-Id` from the headers.
If it matches `/^[A-Za-z0-9._-]{1,64}$/`, we keep it. Otherwise we
mint a fresh UUID. The id is written to the response as `X-Request-Id`
immediately — so clients always see one back.

The id is attached to `req.requestId` and threaded through every
audit event for this request.

### 3. Trace context (`trace.mjs`)

`applyTrace(req, res)` parses `traceparent` strictly (version 00,
non-zero trace-id, non-zero span-id, valid flags). If valid, we
inherit the `traceId` and mint a new child `spanId`. The response
echoes a fresh `traceparent`: `00-<inheritedTraceId>-<ourSpanId>-<flags>`.
Both `traceId` and `spanId` are attached to `req.trace` and included
in every audit event.

If the caller supplied no `traceparent`, we mint a fresh one. This
is important: even standalone deployments produce trace-able audit
output.

### 4. Timing start

`t0 = process.hrtime.bigint()`. We bind a `res.on('finish')` handler
that will compute latency and emit the `http.request` audit event +
Prometheus samples *after* the response is fully sent.

### 5. Security headers (`security.mjs`)

`applySecurityHeaders(res, SEC_CFG)` sets:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: no-referrer`
- `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'`
- `Cross-Origin-Resource-Policy: same-origin`
- `Cross-Origin-Opener-Policy: same-origin`
- `X-Permitted-Cross-Domain-Policies: none`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains` (unless disabled)

Strips `Server` and `X-Powered-By`. Every response. No exceptions.

### 6. CORS (`security.mjs`)

`applyCors(req, res, CORS_CFG)` checks the `Origin` header against
the allowlist. If matched, it echoes `Access-Control-Allow-Origin`
with `Vary: Origin`. A preflight `OPTIONS` from a matched origin is
terminated here with 204.

Default: CORS is **off**. A cross-origin browser request gets no
ACAO header and the browser will block it. Explicitly enable via
`QV_CORS_ORIGINS="https://a.example,https://b.example"`.

### 7. Unmatched OPTIONS

If method is `OPTIONS` and no CORS origin matched, we respond 204
with no body. No routing.

### 8. Route matching

The dispatcher walks the `routes` table:

```javascript
[
  ['GET',  /^\/v3\/health$/,   healthHandler],
  ['GET',  /^\/v3\/live$/,     liveHandler],
  ['GET',  /^\/v3\/ready$/,    readyHandler],
  ['GET',  /^\/v3\/metrics$/,  metricsHandler],
  ['POST', /^\/v3\/keygen$/,   admin(keygenHandler)],
  ['POST', /^\/v3\/token\/issue$/, admin(issueHandler)],
  ['POST', /^\/v3\/token\/verify$/, verifyRL(verifyHandler)],
  ['POST', /^\/v3\/token\/batch-verify$/, verifyRL(batchVerifyHandler)],
  ['DELETE', /^\/v3\/keys\/([^/]+)$/, admin(deleteHandler)],
  // ...
]
```

The matched route assigns `req._routeTemplate = '/v3/token/issue'` —
a stable string used for metrics. Raw URLs contain per-token IDs,
which would explode Prometheus cardinality. The template is always
bounded.

### 9. Rate-limit (`ratelimit.mjs`)

The admin wrapper invokes the `admin` bucket of the token-bucket
limiter (default 60 RPM). Failed attempts later will drain the
separate `authFail` bucket.

If the bucket is empty, respond `429 Too Many Requests` with
`Retry-After: N`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`,
`X-RateLimit-Reset`. Emits `qv_rate_limit_denies_total{category="admin"}`.

### 10. CIDR allowlist (`cidr.mjs`)

If `QV_ADMIN_ALLOW_CIDRS` is set, extract the client IP (from
`X-Forwarded-For` last hop, falling back to `socket.remoteAddress`)
and check against the list. On miss, respond `403 IP_NOT_ALLOWED`
and emit `auth.deny` + `qv_auth_denies_total{reason="cidr_denied"}`.

### 11. Bearer auth (`auth.mjs`)

Extract `Authorization: Bearer <token>`. Hash the provided token with
SHA-256. Compare constant-time against `QV_ADMIN_TOKEN_SHA256`.

- No token → `auth.deny{reason="no_token"}` → 401
- Bad token → `auth.deny{reason="bad_token"}` → 401 (same shape as no_token)

Both responses are byte-identical to prevent oracle attacks. On
success, the handler runs.

### 12. Handler execution

For `/v3/token/issue`:
1. Read body with `readJsonBounded` (64 KiB cap). On exceed: 413.
2. Validate claims shape via `validateClaims()`. On violation: 400 + stable code.
3. Look up the key in `keystore` Map and the chain state in `chains` Map.
4. Call `issueToken()`:
   - Advance MutationChain counter
   - CBOR-encode claims
   - AEAD-encrypt with the encryption key
   - ML-DSA sign the result
5. Append the new chain state to `<DATA_DIR>/chains/<keyId>.chain` (fsync
   deferred to v4.3.4).
6. Emit `token.issue` audit event + `qv_token_issue_total{suite,tokenType,result}`
   metric.
7. Return `200 OK` with `{ token: <hex>, expiresAt: <iso>, ... }`.

Every stage has a `try { ... } catch (e) { err(...) }` wrapper so a
runtime error becomes a 500 with a stable code, never an unhandled
rejection that crashes the process.

### 13. Response finalisation

`res.end()` fires `res.on('finish')`:
- Compute `durSecs = (hrtime.bigint() - t0) / 1e9`.
- Emit `http.request` audit event with `requestId`, `traceId`,
  `spanId`, `parentSpanId`, `traceInherited`, `ip`, `method`, `path`
  (the raw URL — template goes in `template`), `status`, `ms`.
- Increment `qv_http_requests_total{method,path,status}` where `path`
  is the **template**.
- Observe `qv_http_request_duration_seconds{method,path}` (template).
- Decrement `qv_inflight_requests`.

## Handler execution as a function composition

Every mutating handler is wrapped as:

```javascript
admin(handler)
  = metered('admin', adminCidr(requireAdmin(handler, ADMIN_CFG, ...)))
```

- `metered` is the rate-limit + metrics wrapper.
- `adminCidr` is the CIDR gate (no-op if `QV_ADMIN_ALLOW_CIDRS` is empty).
- `requireAdmin` is the bearer-token gate.
- `handler` is the actual route logic.

Composition order matters: rate-limit is outermost because we want
429s to never consume downstream work. Bearer-check is innermost
because we want the token to be validated only for requests that
cleared CIDR + rate-limit.

## The code

- `qv-server/server-sovereign.mjs` — the dispatcher. The middleware
  chain is ~40 lines of clear code. Read it.

## The evidence

A single request generates:
- One `http.request` audit record
- One `qv_http_requests_total` increment
- One `qv_http_request_duration_seconds` histogram observation
- Possibly `token.issue` / `auth.deny` / etc. event
- Possibly `qv_token_issue_total` etc. metrics

Grep a single `X-Request-Id` in `audit.log` to replay the entire
request from acceptance to finalisation.

## The comparison

| Product | Stages per request | Observable stages |
|---------|--------------------|--------------------|
| Express-based | Depends on middleware | Depends on logging setup |
| Keycloak | ~15 (Java servlet filters) | Via JMX |
| Auth0 | (opaque) | Via dashboards |
| **QuantumVault** | **13 named stages** | **All 13, every request** |

Next: Chapter 9, [Authentication, CIDR, Rate Limiting](./09-auth-cidr-rate.md).
