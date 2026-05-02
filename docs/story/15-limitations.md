# Chapter 15 — The Limitations We Ship With

## The story

Every security product is defined as much by what it *doesn't* do
as by what it does. We enumerate the known limitations honestly
because the alternative — discovering them in production — is worse
for everyone.

## Current limitations (v4.3, April 2026)

### L1 — Single-writer MutationChain (PARTIALLY MITIGATED v4.3)

**What.** The MutationChain update path is not multi-writer safe.
Two qv-server instances against the same keystore will produce
false `MUTATION_CTR_STALE` rejections.

**Mitigations shipped (v4.3):**
- Single-host writer-lock per DATA_DIR refuses to start if another
  live writer holds the lease (`writer-lock.mjs`).
- **Cross-host fence verification** on every chain write. If a peer
  steals the lease while we're running (NFS / EFS / SMB), we abort
  loud with `WRITER_LOCK_LOST` instead of corrupting the chain. See
  `qv-server/writer-lock.mjs:checkFence`. 4 unit tests.

**Workaround.** Run one qv-server per master-key scope; verify from
read-only replicas that sync the chain log.

**Fix.** Pluggable `ChainStore` (Postgres `SELECT … FOR UPDATE`,
etcd lease+watch, S3 conditional-put). ETA v4.4.

### L2 — No `kid` in token header (OPERATIONALLY MITIGATED v4.3)

**What.** Tokens do not embed the signing key id in their header.

**Mitigation shipped (v4.3):** Server-side **VK fingerprint map**
(`vkFpToKeyId`). A caller that holds a verifying key (from
`/v3/keys/{keyId}/vk.bin` or prior knowledge) can resolve its
`keyId` in O(1) via:

```
POST /v3/keys/identify
{ "vkB64u": "<base64url verifying key>" }
→ { "keyId": "...", "fingerprint": "<32 hex>", "revoked": false }
```

This closes the operational gap (verify-without-keyId) without a
wire-format change. The wire-format kid (real on-the-wire bytes) is
deferred to v5.0 because it requires coordinated SDK rollout across
qv-core, qv-sdk, qv-wasm, qv-python.

**Fix.** Add a new `0x80`-flagged suite bit that includes a 16-bit
`kid` prefix. Requires coordinated release of qv-core, qv-sdk,
qv-wasm, qv-py. ETA v5.0.

### L3 — Master key in env var or plaintext file

**What.** No KMS/HSM integration. `master.key` is either a local
0600 file or `QV_MASTER_KEY_HEX` in the env.

**Workaround.** Source `QV_MASTER_KEY_HEX` from your secrets manager
at container start (Vault, AWS Secrets Manager, Azure Key Vault).

**Fix.** KMS/HSM integration via a pluggable `MasterKeyProvider`
interface (R-4.4.5). ETA v4.4.

### L4 — No revocation fsync

**What.** `revoked.json` is `writeFileSync`-updated, which on Linux
hits the page cache. A power loss within seconds could lose the
most recent revocation.

**Workaround.** Acceptable for most deployments — the MutationChain
replay protection already prevents reuse of a stolen token even if
revocation is lost momentarily.

**Fix.** Explicit `fsync` after each revocation write (R-4.3.4).
Small; coming in a v4.3 minor.

### L5 — ~~CIDR allowlist~~ **RESOLVED v4.3**

Shipped. See Chapter 9.

### L6 — ~~Unstructured audit log~~ + ~~no rotation~~ **RESOLVED v4.3**

Both shipped. JSONL structured audit log (Chapter 10) and size-based
rotation (Chapter 10).

### L7 — ~~No OTLP exporter~~ **RESOLVED v4.3**

Shipped: zero-dep **OTLP/HTTP/JSON exporter** in `qv-server/otlp.mjs`.
Set `QV_OTLP_ENDPOINT=https://collector.example/v1/traces` and audit
events with `traceId/spanId` are batched as OTLP spans. Compatible
with otel-collector, Tempo, Honeycomb, Datadog. Bearer auth via
`QV_OTLP_TOKEN`. Best-effort — collector failures don't impact
request latency. 8 unit tests.

### L8 — ~~No traceparent~~ **RESOLVED v4.3**

Shipped. See Chapter 10.

### L9 — Falcon dispatch not exposed on the HTTP surface

**What.** Falcon-512 / Falcon-1024 are implemented in `qv-core`
(Rust + PQClean C) but the JavaScript SDK on which `qv-server` is
built does not have a Falcon implementation. `/v3/token/issue` only
accepts `suite=dilithium5`.

**Why this is harder than it looks.**

Falcon's reference implementation is float-heavy NTT C code from
PQClean. Three integration paths exist; we honestly evaluated all
three and none is a "one-PR" change:

1. **Pure-JS Falcon.** Several thousand lines of float64-precision
   NTT arithmetic with strict timing-leak requirements. Writing it
   from scratch is multi-week and the side-channel review burden is
   significant. There is no audited zero-dep Noble-class JS Falcon
   today (as of v4.3).
2. **WASM Falcon.** `qv-wasm` already excludes Falcon at the
   `Cargo.toml` level because PQClean's C code does not compile on
   `wasm32-unknown-unknown` without a C toolchain. Building with
   `wasm32-wasip1` + Emscripten is feasible but requires CI changes
   and validation that timing properties survive the WASM JIT.
   Multi-day build-system work.
3. **Child-process bridge to `qv-cli`.** `qv-core` has Falcon in
   Rust; `qv-cli` does not currently expose it. We could add
   `qv-cli falcon-sign` / `qv-cli falcon-verify` subcommands and
   spawn a process per token. Process-startup latency is ~50–100 ms
   per op, ruling it out for the issue hot path; only viable as an
   admin-only, low-rate operation.

**Workaround today.** Call `qv-core` directly from your issuing
service if you need Falcon. The Rust SDK + qv-cli can both produce
Falcon tokens that `/v3/token/verify` will (eventually) accept once
verify-side support lands.

**Fix.** Tracked as v4.4. The likely path is option 2: ship a WASM
build that includes Falcon, host it inside the verify-pool worker
threads, and route `/v3/token/issue?suite=falcon{512,1024}` through
the worker. Wire format already reserves bytes `0x10` and `0x11`
(see `qv-spec/wire-format.md`), so no wire change is needed when the
crypto lands.

### L10 — No built-in TLS

**What.** qv-server speaks plain HTTP. TLS must be terminated
upstream.

**Workaround.** Run nginx / Caddy / Envoy in front. Docker Compose
examples ship in `qv-ops/`.

**Fix.** None planned. This is a design decision — TLS is mature,
operator-owned, and should live in the mesh.

### L11 — ~~Unbounded claims shape~~ **RESOLVED v4.3**

Shipped. See Chapter 13.

### L12 — ~~Unbounded verify-pool queue~~ **RESOLVED v4.3**

Shipped. See Chapter 11.

### L13 — No Helm chart

**What.** Kubernetes deploy requires writing your own manifests.

**Workaround.** `qv-ops/k8s/` ships example YAML (coming).

**Fix.** Helm chart + Operator (R-4.3.10). ETA v4.3.0 release.

### L14 — No managed SaaS offering

**What.** You run qv-server yourself.

**Workaround.** That's the point. See Chapter 14.

**Fix.** Optional managed tier in v5.0 for teams that don't want to
operate.

### L15 — Only JavaScript/TypeScript, Rust, Python, WASM, C FFI SDKs

**What.** Go, Java, .NET, Swift, Kotlin, Ruby, PHP SDKs are not
provided.

**Workaround.** The C FFI works from any language with an FFI
bridge. The REST API works from any HTTP client.

**Fix.** Community SDKs welcome; first-party Go SDK is scoped for v4.5.

## The philosophy

Three rules about limitations:

1. **Name them all.** Never hide a weakness to look stronger.
2. **Document the workaround.** An acknowledged limitation with a
   path forward is different from one without.
3. **Plan the fix.** Every limitation in this chapter has either a
   roadmap entry or an explicit "no fix planned" with a reason.

## How to tell us about a new limitation

Open an issue on GitHub with title `Limitation: <one-line>`. Tag
`security` if it's in the threat model's scope; `operational` if
it's a UX gap. We triage every week.

Next: Chapter 16, [Operations Cookbook](./16-operations.md).
