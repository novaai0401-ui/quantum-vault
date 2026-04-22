# Chapter 3 — Threat Model

## The story

Every security product has a threat model whether it publishes one or
not. The ones that don't publish theirs are lying about the set of
attackers they protect against. We would rather say the uncomfortable
things out loud than discover them during an incident.

## Who we defend against

### 1. Network adversaries on the wire

**Capability.** Passive capture of traffic between client and server,
active rewrite of traffic at a border router or transparent proxy.

**Our defence.**
- TLS is *required*, but we do not terminate it. That is the reverse
  proxy's job (Chapter 16). Inside the TLS tunnel our threat model is
  that the wire is trusted; outside, we assume it's not.
- Even against a successful TLS break (nation-state MITM), the token
  format itself protects confidentiality of claims because payloads
  are AEAD-encrypted *inside* the TLS tunnel. A TLS-only leak reveals
  ciphertext only.
- MutationChain makes tokens non-replayable. Capturing a valid token
  and re-sending it after the legitimate recipient consumes it fails
  with `MUTATION_CTR_STALE`.

### 2. Credential-stuffing and brute-force attackers

**Capability.** Large-scale automated requests with forged or leaked
credentials against `/v3/token/issue`, `/v3/keygen`, `/v3/metrics`.

**Our defence.**
- Admin bearer is mandatory (`auth.mjs` — Chapter 9).
- Comparisons are constant-time via `timingSafeEqual`.
- Failed auth requests drain a **separate** rate-limiter bucket
  (`authFail`) so legitimate admin traffic is not starved by a
  brute-force wave.
- Per-IP rate limiting (`ratelimit.mjs`) caps sustained load.
- CIDR allowlist (`cidr.mjs`) makes it impossible to reach admin
  endpoints from outside a whitelisted network, even with a valid
  token. **Defence in depth — belt and braces.**
- `no_token` and `bad_token` responses are byte-identical so the
  attacker cannot distinguish presence from validity.

### 3. Post-quantum adversaries (future tense)

**Capability.** A cryptographically-relevant quantum computer,
retroactive decryption of harvested ciphertext and signatures.

**Our defence.**
- NIST-standardised post-quantum signatures (ML-DSA-87 by default,
  Falcon variants by request).
- 256-bit symmetric key lengths (AES-256-GCM, ChaCha20-Poly1305 with
  256-bit keys) give ≥128-bit effective strength against Grover's
  algorithm.
- Per-key encryption key is *separate* from the signing key. An
  attacker who cracks the signature algorithm retroactively still
  cannot read claims without the encryption key.

### 4. Compromised filesystem (read-only)

**Capability.** An attacker who can read `<DATA_DIR>/` — via a
container escape, a backup dump, a log-pipe mistake, or a
misconfigured share.

**Our defence.**
- The keystore is never stored in the clear. Every signing key and
  encryption key is sealed under `master.key` via AES-256-GCM with the
  key's UUID as AAD. Without `master.key`, the keystore is noise.
- `master.key` lives at `<DATA_DIR>/master.key` with mode `0600`,
  or in the `QV_MASTER_KEY_HEX` env var (preferred for production
  because the filesystem is not the trust boundary).
- The audit log contains no secret material by construction — the
  auditor drops any field named `token`, `authorization`, `masterKey`,
  `privateKey`, `password`, or `cookie` before serialisation.

### 5. Compromised filesystem (read + write)

**Capability.** An attacker who can modify `<DATA_DIR>/`.

**Our defence.**
- Partial. If the attacker can tamper with `keystore.json` and the
  master key, they have control of the signing keys. This is
  unavoidable — that's what root access means.
- We do log every write via the audit log, which should be shipped
  off-host (via stdout → journald → log aggregator). A
  tamper-on-write is then detectable post-hoc by comparing
  aggregated logs against on-disk state.
- Revocation is append-only. A rolled-back `revoked.json` can be
  detected by comparing against the audit log.
- **Future work (R-4.4.5):** KMS/HSM integration removes the master
  key from local storage entirely.

### 6. Malicious client (authenticated)

**Capability.** A client with a valid `QV_ADMIN_TOKEN` trying to
exhaust resources, poison state, or discover other keys.

**Our defence.**
- Rate limits apply *regardless* of authentication. An authenticated
  flood of `/v3/keygen` calls hits the `admin` bucket first.
- Body-size caps (`QV_MAX_BODY_BYTES`, 64 KiB) and claims caps
  (`QV_MAX_CLAIMS_BYTES`, 16 KiB; plus structural caps from
  `claims.mjs`) mean no single request can cost more than bounded
  CPU.
- Verify-pool backpressure (`verify-pool.mjs`) caps queued verification
  work; a flood of batch-verify requests gets `503 POOL_OVERLOADED`
  rather than latency collapse.
- Keys are opaque UUIDs — enumerating them by guessing is infeasible.

### 7. Malicious worker (insider)

**Capability.** A developer or operator with production access who
wants to exfiltrate keys or forge tokens.

**Our defence.** Largely procedural and out of scope for the software,
but:
- The audit log is append-only (`O_APPEND`), timestamped, and
  structured. It should be shipped to an append-only store (S3 Object
  Lock, Loki with immutable TSDB).
- Master-key rotation is a single-file swap (`master.key`). Post-rotation,
  the old keystore is unreadable.
- `qv-server` has no "debug mode" that bypasses any of this. The code
  path on a dev laptop is the same as in production.

## What we explicitly don't protect against

### 1. Compromise of the Node.js runtime itself

If the Node.js binary is malicious (e.g., `apt-get install nodejs`
from a poisoned repository), qv-server is compromised. We don't
defend against this because we can't. Pin the Node version, verify
the checksum, use reproducible builds.

### 2. Kernel or hypervisor compromise

Same argument. If the kernel lies about `read()`, we can't detect it.
Use measured boot, vTPM, Confidential Computing platforms if this is
in your threat model.

### 3. Side-channel attacks on the signing worker

We use Node's native `node:crypto` for symmetric primitives and
constant-time compare; we rely on the upstream post-quantum
implementations (PQClean, reference implementations) for timing
safety of ML-DSA / Falcon. These are best-effort. If you need
timing-hardened implementations, you'll want an HSM (future work).

### 4. Denial of service at the network layer

A sufficiently large traffic flood exhausts the TCP stack before
reaching user-space. This is a reverse-proxy / anycast / DDoS-scrubbing
problem, not a qv-server problem.

### 5. Loss of the master key without backup

If `master.key` is deleted and not backed up, every sealed signing
key is permanently unrecoverable. This is **by design** — deleting
the master key is how you perform an emergency full-rotation. Back
it up. We don't back it up for you, because backing up secrets is a
policy decision.

### 6. Social engineering

We don't talk to users. We only talk to other services. Social
engineering is an identity-provider problem.

## How to use the threat model

Before shipping qv-server, walk through these seven rows and answer:

1. Where is TLS terminated, and does the path from termination to
   qv-server traverse any untrusted network?
2. Is `QV_ADMIN_TOKEN_SHA256` set (rather than `QV_ADMIN_TOKEN`)? Is
   the rate limiter enabled? Is CIDR allowlist configured?
3. Which post-quantum suite is your tenant defaulting to? Is that
   written down?
4. Where does `master.key` live? Who has read access? What's the
   rotation cadence?
5. Is there a write-integrity monitor on `<DATA_DIR>/`? If not,
   you're trusting the filesystem.
6. What are the rate-limit RPMs? Are they consistent with your
   actual legitimate traffic?
7. Where does `audit.log` get shipped? Is the shipper authenticated?

If you can't answer any of those, you're not ready to deploy. That's
OK — Chapter 16 walks through all seven.

## The design

The threat model is enforced by *layering* controls so no single
failure is catastrophic:

```
  Public internet
       │
  ┌────▼────┐
  │   TLS   │  (reverse proxy — your problem)
  └────┬────┘
       │
  ┌────▼──────────────────────────────────────┐
  │  Rate limit (per-IP, per-category)        │
  └────┬──────────────────────────────────────┘
       │
  ┌────▼──────────────────────────────────────┐
  │  Body / claims size caps                  │
  └────┬──────────────────────────────────────┘
       │
  ┌────▼──────────────────────────────────────┐
  │  Claims structural validation             │
  └────┬──────────────────────────────────────┘
       │
  ┌────▼──────────────────────────────────────┐
  │  CIDR allowlist (admin endpoints only)    │
  └────┬──────────────────────────────────────┘
       │
  ┌────▼──────────────────────────────────────┐
  │  Bearer-token auth (constant-time)        │
  └────┬──────────────────────────────────────┘
       │
  ┌────▼──────────────────────────────────────┐
  │  Route handler                            │
  │    - MutationChain counter bump           │
  │    - AEAD-encrypted claims                │
  │    - ML-DSA / Falcon signature            │
  └────┬──────────────────────────────────────┘
       │
  ┌────▼──────────────────────────────────────┐
  │  Audit log (JSONL, rotated, sealed)       │
  └───────────────────────────────────────────┘
```

Seven layers between the internet and the signing function. Any one
of them, if it fails open, is backed up by the next.

## The code

- `qv-server/auth.mjs` — bearer token auth
- `qv-server/ratelimit.mjs` — rate limiting + body caps
- `qv-server/claims.mjs` — structural claims validation
- `qv-server/cidr.mjs` — CIDR allowlist
- `qv-server/security.mjs` — response security headers
- `qv-server/audit.mjs` — structured audit log
- `qv-server/server-sovereign.mjs` — the dispatcher that threads them

## The evidence

Each layer has its own test file — see Chapter 17.

## The comparison

| Threat | JWT stack | Vault | Keycloak | **QuantumVault** |
|--------|-----------|-------|----------|------------------|
| Post-quantum sign forgery | No | No | No | **Yes (ML-DSA)** |
| Payload confidentiality at rest | No | Partial | No | **Yes (AEAD)** |
| Replay protection | Bolt-on | No | No | **Built-in** |
| Keystore sealed at rest | Depends | Yes | Yes | **Yes** |
| Constant-time auth compare | Depends | Yes | Yes | **Yes** |
| CIDR allowlist out of box | No | Yes (Enterprise) | No | **Yes** |
| Rate limit out of box | No | Yes | Partial | **Yes** |
| Separate auth-fail rate bucket | No | No | No | **Yes** |

Next: Chapter 4, [The Key Triplet](./04-key-triplet.md).
