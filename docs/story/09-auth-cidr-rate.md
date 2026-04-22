# Chapter 9 — Authentication, CIDR, Rate Limiting

## The story

Three concentric rings, each one a complete defence on its own:

```
   ┌───────────────────────────────────────┐
   │  Ring 3: Rate limit                   │   (per-IP, per-category)
   │  ┌────────────────────────────────┐   │
   │  │  Ring 2: CIDR allowlist        │   │   (network identity)
   │  │  ┌───────────────────────────┐ │   │
   │  │  │  Ring 1: Bearer token     │ │   │   (cryptographic identity)
   │  │  │                           │ │   │
   │  │  │     Route handler         │ │   │
   │  │  └───────────────────────────┘ │   │
   │  └────────────────────────────────┘   │
   └───────────────────────────────────────┘
```

A defeated Ring 1 (token leak) is backed up by Ring 2 (the attacker
is not on the right network). A defeated Ring 2 (misconfigured
firewall) is backed up by Ring 3 (we throttle to near-zero if
authFail is high). A defeated Ring 3 (no rate limit because
`QV_RATE_LIMIT_DISABLED=true`) is backed up by Ring 1 (they still
need the token).

Any two of the three can fail and the system is still safe.

## Ring 1: Bearer token (`auth.mjs`)

### The provisioning choice

Two modes:
- `QV_ADMIN_TOKEN=<plaintext>` — simple, but the plaintext is in
  `/proc/self/environ` for the process's lifetime. Dev / small deploys.
- `QV_ADMIN_TOKEN_SHA256=<hex>` — the server only knows the digest.
  The plaintext is never at rest. **Recommended.**
- `QV_ALLOW_ANON=true` — disables auth entirely. A **three-argument,
  explicitly-named** opt-in because we want the "I forgot to set auth"
  case to be loud. Fail-closed.

If none of the three is set, `qv-server` refuses to start. This is
the single most important line of configuration discipline in the
codebase:

```javascript
if (!ADMIN_CFG.tokenSha256 && !ADMIN_CFG.allowAnon) {
  throw new Error('qv-server refuses to start without admin auth configured.');
}
```

### The comparison logic

```javascript
const providedDigest = createHash('sha256').update(provided).digest();
const expectedDigest = Buffer.from(ADMIN_CFG.tokenSha256, 'hex');
if (!timingSafeEqual(providedDigest, expectedDigest)) {
  deny('bad_token');
}
```

Both sides are the same 32-byte length, so `timingSafeEqual` doesn't
leak length. The digest-vs-digest comparison doesn't leak plaintext
length either.

### The oracle gap

A tempting mistake is to return different errors for "no token" vs
"bad token". An attacker can then distinguish presence from validity.
We return identical responses for both. The **audit log** distinguishes
them (`reason: "no_token"` vs `reason: "bad_token"`) because the
auditor is internal-only.

### Helper: `npm run mint-token`

Generates a fresh token and its SHA-256. Copy the plaintext to
wherever you're storing secrets; copy the hash to your env config.
No `openssl` invocation needed, which means no "`-hex` vs `-base64`
encoding confusion.

## Ring 2: CIDR allowlist (`cidr.mjs`)

### Why it exists

Because **token leaks are a first-class threat**. Auth0 publishes
postmortems routinely about customer admin tokens being leaked via
git commits, chat channels, or CI logs. A stolen token that the
attacker cannot *use from their workstation* is worth much less.

### What it allows

CIDR ranges in either family, combined freely:

```
QV_ADMIN_ALLOW_CIDRS="10.0.0.0/8,192.168.0.0/16,fd00::/8"
```

Single IPs without `/`: interpreted as `/32` (v4) or `/128` (v6).
IPv4-in-v6 `::ffff:1.2.3.4` decoded to the embedded v4 address.
IPv6 zone ids (`%eth0`) stripped.

### What it blocks

Any admin call whose client IP doesn't match the list. This is
enforced **after** rate-limit and **before** bearer-check, so:

1. Rate-limit still budgets the request (prevents amplification).
2. CIDR denial returns 403 without consulting the bearer (prevents
   the token itself becoming an oracle for "valid admin IP").
3. Only matching IPs get to try the token.

### The X-Forwarded-For subtlety

We read the **last hop** from `X-Forwarded-For`, falling back to
`socket.remoteAddress`. Our reverse proxy is expected to strip any
client-supplied `X-Forwarded-For` and set its own. If you deploy
without a trusted reverse proxy, you must set
`QV_RATE_LIMIT_DISABLED=false` and `QV_ADMIN_ALLOW_CIDRS=""` and
rely only on the bearer, because an attacker can forge XFF.

### Metrics integration

Each CIDR denial emits `qv_auth_denies_total{reason="cidr_denied"}`
and an `auth.deny` audit record. Operators can alert on this.

## Ring 3: Rate limit (`ratelimit.mjs`)

### Token-bucket, four categories

- **`public`** — `/v3/live`, `/v3/ready`, `/v3/health`, `/v3/spec`.
  600 RPM default.
- **`verify`** — `/v3/token/verify`, `/v3/token/batch-verify`.
  120 RPM default.
- **`admin`** — `/v3/keygen`, `/v3/token/issue`, `DELETE /v3/keys/:id`,
  `/v3/metrics`. 60 RPM default.
- **`authFail`** — every bearer-auth failure drains this bucket. 10
  RPM default. **This is the non-obvious one.** It exists so that a
  brute-force attack on the bearer doesn't also exhaust the legit
  `admin` budget, and so admin ops continue to work for the real
  operator even under a credential-stuffing wave.

### Per-IP, not global

Each client IP has its own bucket per category. A flood from one IP
doesn't affect another. The book-keeping lives in a `Map<ip,
{public, verify, admin, authFail}>`.

### Bounded memory

Two safety rails:
- `QV_RATE_MAX_IPS` (100k default) — hard cap. Past this, new IPs
  are dropped into a no-op bucket that trivially denies.
- Idle sweep — every 5 minutes, IPs whose most recent activity is
  older than 5 minutes are evicted.

### Response headers

Every rate-limited request carries:
- `X-RateLimit-Limit: <tokens-per-minute>`
- `X-RateLimit-Remaining: <tokens-left>`
- `X-RateLimit-Reset: <epoch-seconds-until-full-refill>`

On 429: `Retry-After: <seconds>` plus the above.

### Metrics

`qv_rate_limit_denies_total{category}` per category. Tuning is then
a matter of watching that series per category vs your steady-state
traffic.

### Disabling

`QV_RATE_LIMIT_DISABLED=true` turns it all off. Only use behind a
trusted mesh with its own throttling (Envoy, Istio, linkerd). Logs
a warning on startup so this state is visible.

## The audit integration

Every denial — rate-limit, CIDR, bearer — emits an `auth.deny`
audit event with:
- `requestId`
- `traceId`, `spanId`
- `ip`
- `reason` (`rate_limited`, `cidr_denied`, `no_token`, `bad_token`)
- `category` (for rate-limit)

Grep `auth.deny` in `audit.log` to see every rejection in order.

## The code

- `qv-server/auth.mjs` — bearer
- `qv-server/cidr.mjs` — CIDR
- `qv-server/ratelimit.mjs` — limiter

## The evidence

- `test/auth.test.mjs` — constant-time compare, envelope validation.
- `test/cidr.test.mjs` — 13 tests, v4/v6/cross-family/malformed.
- `test/ratelimit.test.mjs` — buckets, refill, categories, sweep, caps.
- Integration tests spawn a real server and exercise each ring
  end-to-end.

## The comparison

| Product | Bearer | CIDR allowlist | Rate limit | Separate authFail bucket |
|---------|--------|----------------|------------|--------------------------|
| Auth0 | Yes | Plan-locked (Enterprise) | Yes | No |
| Keycloak | Yes | No built-in | Partial (per-realm) | No |
| Vault | Yes | Yes (Enterprise) | Yes | No |
| AWS IAM | Yes | VPC endpoint | Yes | No |
| **QuantumVault** | **Yes (constant-time)** | **Yes (OSS)** | **Yes** | **Yes** |

Next: Chapter 10, [Observability](./10-observability.md).
