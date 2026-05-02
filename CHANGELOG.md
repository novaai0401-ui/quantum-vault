# Changelog

All notable changes to Sigvault are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/)
(with the MAJOR-stability commitment beginning at v5.0 — see
[ROADMAP.md](./ROADMAP.md)).

## [Unreleased]

_Tracking v4.3 — see [ROADMAP.md](./ROADMAP.md#v43--production-ready-server-6-weeks)._

### Added

- **Falcon HTTP bridge — partial L9 closure.** A new `qv-server/falcon-bridge.mjs`
  spawns the `qv-cli` binary as a child process per call, delegating
  Falcon-512 / Falcon-1024 sign + verify to qv-core's PQClean
  implementation. Wired into two HTTP endpoints:
  - `POST /v3/admin/falcon/sign` — admin-only, signs operator-supplied
    bytes under operator-supplied Falcon SK. Returns hex signature.
  - `POST /v3/falcon/verify` — public (verify-bucket-rate-limited),
    returns `{ valid: boolean, n }`.
  Endpoints return `503 FALCON_BRIDGE_UNAVAILABLE` if the qv-cli
  binary is not on the host or was built without the `falcon`
  feature. Bridge has 30 s timeout per call, 16 MiB stdout cap, and
  cleans up its temp files. New audit event `falcon.sign`. Latency
  is high (~50–100 ms per spawn) so this is **not** the path for
  bulk Falcon issuance — that needs SDK-side Falcon support and stays
  on the v4.4 roadmap. This bridge is the substrate that v4.4 work
  will plug under.

  Operator override: `QV_CLI_BIN=/path/to/qv` to pin a specific
  binary; otherwise the bridge auto-discovers via `target/release`,
  `target/debug`, or `PATH`. Spec sync gate updated:
  `qv-spec/openapi.yaml` gained both endpoints; `qv-spec/error-codes.md`
  gained `FALCON_BRIDGE_UNAVAILABLE`, `FALCON_BAD_N`, `FALCON_SIGN_FAILED`,
  etc. 5 unit + 2 live integration tests (live tests skipped when
  qv-cli isn't present).
- **`qv-audit` forensic CLI** (`qv-server/qv-audit.mjs`). Operator tool
  that streams the JSONL audit log and filters by event, time range,
  request-id, trace-id, key-id, status family, IP, denial reason, or
  free-text grep. Three output formats (`human`, `json`, `tsv`) and a
  `--summary` mode that prints counts + p50/p95/p99 latency over the
  matching window. `--top events 10` for top-N field histograms.
  Reads stdin or `--file PATH` so it composes with shell pipelines.
  Replaces the typical `tail -f audit.log | jq | grep` recipe with a
  single typo-resistant tool. 14 unit tests.
- **`qv-cli` Falcon subcommands** (Rust). `qv falcon-keygen --n 512|1024`,
  `qv falcon-sign`, `qv falcon-verify`. Built with the new `falcon`
  feature flag (default on). Bridges qv-core's PQClean-backed Falcon
  to the CLI for ad-hoc signing. Sets up the v4.4 path for
  `/v3/token/issue?suite=falcon{512,1024}` (Falcon HTTP exposure).
  Default qv-cli builds now require `cargo build --features falcon`
  (or just `cargo build`); operators on platforms without a C
  toolchain can opt out with `--no-default-features`. End-to-end
  keygen/sign/verify roundtrip verified manually.
- **`/v3/health` enriched** with operationally-useful state: chain-store
  backend identity, writer-lock fence number, verify-pool queue
  depth, uptime seconds, Node version, key + revoked counts. Always
  returns 200 once the process is up — `/v3/ready` is the k8s-probe
  endpoint that 503s on startup. No secrets, safe to expose without
  bearer.
- **`GET /v3/keys/{keyId}/quota`** — read-only snapshot of a key's
  per-keyId rate-limit bucket (configured ceiling, override, current
  refilled token count). Doesn't consume a token; safe to expose
  without bearer (leaks no signing material). Powers ops dashboards
  and "is this tenant about to be throttled" runbook queries. 1
  integration test.
- **Verify-pool worker affinity design doc**
  (`docs/design/verify-pool-worker-affinity.md`). Scopes the v4.4
  optimisation that hashes keyId → worker so verifying-keys stay warm
  across batches. Documents the three correctness traps (queue
  starvation, worker death, backpressure semantics) and the migration
  plan (off by default, behind `QV_VERIFY_AFFINITY`, then default-on
  after a release of bake time). Implementation deferred to a
  separate PR.
- **OpenAPI ↔ server sync gate** (`qv-ops/scripts/openapi-sync.mjs`).
  Bidirectional invariant in CI: every `route(...)` in
  `server-sovereign.mjs` must appear under `paths:` in `qv-spec/openapi.yaml`
  with the right method, and every spec path must have a matching
  route. Same gate applies to error codes: every `err(res, …, 'CODE')`
  must be documented in `qv-spec/error-codes.md`. Boot-time / SDK-side
  codes already documented but not directly returned by an HTTP path
  surface as soft warnings (not failures). Caught real drift on first
  run: `/v3/keys/identify` and `/v3/token/verify-auto` were missing
  from the spec, plus 21 newer error codes were undocumented. All
  fixed in this commit.
- **`qv-spec/openapi.yaml` updated** with `/v3/keys/identify` and
  `/v3/token/verify-auto` (full request/response schemas).
- **`qv-spec/error-codes.md` extended** with the 400-family validation
  codes (`MISSING_KEY_ID`, `INVALID_VK`, `BATCH_TOO_LARGE`, etc.) and
  the new server codes (`RATE_LIMITED_PER_KEY`, `IP_NOT_ALLOWED`,
  `NO_KEY_MATCHED`, `ISSUE_FAILED`, `INSPECT_FAILED`, …).
- **CI workflow gated**: `.github/workflows/ci.yml` runs the sync gate
  alongside `dep-audit` and `conformance`. The full test matrix waits
  on all three. Drift is now structurally impossible to merge.
- **Per-keyId rate limits on `/v3/token/issue`**. A second dimension on
  top of per-IP throttling: a single noisy keyId can no longer drain
  the IP-level admin bucket and starve sibling keys on the same NAT
  egress. Toggle via `QV_RATE_PER_KEY_ISSUE_RPM` (0 = disabled, the
  default). Per-keyId overrides via `QV_RATE_PER_KEY_OVERRIDES` JSON
  map (0 in the override = unmetered for that specific key). Stable
  error code `RATE_LIMITED_PER_KEY` (429) with `Retry-After` and
  standard `X-RateLimit-*` headers. Audit event
  `ratelimit.deny{category="per_key"}`. Prometheus
  `qv_rate_limit_denies_total{category="per_key"}` (no per-key labels —
  cardinality stays bounded). 12 unit + 2 integration tests.
- **Master-key rotation tool** (`qv-server/rotate-master.mjs`).
  Compliance-driven shops need periodic master-key rotation; this is
  the surgical path that preserves keyIds and existing tokens. Dry-run
  by default; `--confirm` writes. Refuses to run while qv-server holds
  the writer-lock. Atomic durable writes for both `keystore.json` and
  `master.key`; originals retained as `.bak.<iso-ts>`. Re-seals every
  entry under the new master (AEAD-AAD bound to keyId). Migrates
  legacy plaintext entries to sealed in the same operation. 7 unit
  tests covering dry-run, re-seal correctness, backup creation,
  OPEN_FAILED on wrong master, missing keystore, legacy migration,
  idempotent round-trip. New chapter 22 in the storybook covers the
  ops protocol and crash-safety analysis.
- **Honest L9 documentation update.** L9 (Falcon HTTP exposure) is
  now correctly marked as v4.4 work with a three-option evaluation
  (pure-JS Falcon = multi-week + side-channel risk; WASM Falcon =
  C-toolchain build-system work; child-process bridge = 100ms
  per-op latency). Wire-format bytes 0x10 / 0x11 already reserved.
- **Postgres `ChainStore` backend (zero npm deps)** — closes limitation
  L1 (single-writer MutationChain). Implements just enough of the
  Postgres frontend wire-protocol v3.0 in `qv-server/postgres.mjs` to
  speak SCRAM-SHA-256 auth + simple/extended queries against any
  modern Postgres. No `pg`, no `pg-pool`, no `libpq` — supply-chain
  surface stays at zero. Backed by `qv-server/chain-store-postgres.mjs`
  which uses `PRIMARY KEY (key_id, counter)` so multi-writer races
  surface as `CHAIN_LOG_CONFLICT` (a deterministic 23505 unique
  violation), not silent corruption. Toggle with
  `QV_CHAIN_STORE=postgres` and `QV_CHAIN_STORE_URL=postgres://…`.
  Schema script `qv-ops/sql/sigvault_chain.sql`. Integration tests
  gated on `QV_PG_TEST_URL` (skipped without a live DB).
- **Async server bootstrap** so the Postgres ChainStore can connect +
  ensure schema before the keystore loads. File backend startup time
  unchanged.
- **Pluggable `ChainStore` interface** (`qv-server/chain-store.mjs`).
  Decouples the MutationChain append-log from the file backend so v4.4
  can swap in Postgres / etcd / S3 without touching call sites. Today
  ships the file backend (zero behaviour change from v4.3); the
  dispatcher rejects unknown backends with `CHAIN_STORE_UNKNOWN` and
  documents the v4.4 backends with `CHAIN_STORE_NOT_AVAILABLE`. Toggle:
  `QV_CHAIN_STORE=file|postgres|s3|etcd`. 9 new unit tests covering
  load/append round-trip, tamper rejection, fsync vs no-fsync, and the
  dispatcher contract.
- **`POST /v3/token/verify-auto`** — verify a token without supplying
  `keyId`. Server trial-verifies against every active (non-revoked)
  key. O(N) over keys; N is typically ≤10 in real deployments. Closes
  the operational UX gap when the caller has a token but not the keyId
  and prefers a single call over identify+verify. Returns `keyId` in
  the response body so callers can cache it.
- **`qv-server/bench.mjs`** — end-to-end throughput + p50/p95/p99/max
  latency benchmark against a freshly-spun-up server. Measures issue,
  verify, and identify hot paths. Tunable via `QV_BENCH_OPS` and
  `QV_BENCH_CONC`. Operator-facing — gives the real numbers for
  capacity planning.
- **Go SDK polish** (`qv-sdk/go/sigvault.go`):
  - Context-aware API (`*Client` methods take `ctx context.Context`).
  - Bearer admin token via `WithAdminToken(token)`.
  - New methods: `IdentifyByVK`, `IdentifyByFingerprint`, `VerifyAuto`,
    `Revoke`, `Live`, `Ready`.
  - Structured `*Error` type with `Status`, `Code`, `Message`.
  - SPDX-License-Identifier headers (Apache-2.0).
  - Demo (`main_demo.go`) updated to context API + verify-auto path.
- **Cross-host writer-lock fence verification.** Closes the worst
  silent-corruption hazard: two qv-server processes on different nodes
  sharing an NFS / EFS / SMB volume could both pass `pidAlive` and
  `hostname` and corrupt the chain log silently. Every chain write now
  re-reads the lease file and verifies our fence is still live;
  `WRITER_LOCK_LOST` aborts the write before damage. 4 new unit tests.
  See `qv-server/writer-lock.mjs:checkFence`.
- **VK fingerprint map for O(1) keyId lookup** (operationally closes
  L2). `POST /v3/keys/identify` accepts either a verifying-key (base64url)
  or a 32-hex SHA3-256 fingerprint and returns the `keyId`. A caller
  that has a token but not the keyId can now resolve it in one call,
  without scanning every active key. The wire-format `kid` change is
  still deferred to v5.0. 4 integration tests.
- **OTLP/HTTP-JSON exporter** (closes L7). New `qv-server/otlp.mjs`
  converts audit events with `traceId`/`spanId` into OTLP spans and
  POSTs batches to an operator-supplied collector. Toggle:
  `QV_OTLP_ENDPOINT`, `QV_OTLP_TOKEN`, `QV_OTLP_BATCH_MAX` (default
  128), `QV_OTLP_FLUSH_MS` (default 5000). Best-effort: collector
  failures never impact request latency. Wired in via a new auditor
  `sink` callback so `audit.mjs` stays uncoupled from the exporter.
  Zero deps — Node `http`/`https` only. 8 new unit tests.
- **Zero-dep fuzz harness** (`qv-server/fuzz.mjs`). XZ-utils 2024
  showed parsers are the soft underbelly of any cryptographic system;
  this is the gate. Mutates inputs against the four security-sensitive
  request-path parsers (`validateClaims`, `parseTraceparent`,
  `sanitizeTracestate`, `matchesAny`) and asserts: no unstructured
  errors, no partial returns, no >100 ms parses. CI runs a 10k smoke
  on every push; nightly should run 1M. ~64k iterations/second on
  modest hardware. Found two real fuzz-target bugs during development
  (parseTraceparent return-shape, sanitizeTracestate null-on-bad-input
  — both correct behaviour, fuzz expectations corrected). New
  `test/fuzz.test.mjs` gates 10k iterations in CI.
- **Distroless Docker variant** (`Dockerfile.distroless`). Optional
  build target using `gcr.io/distroless/nodejs20-debian12:nonroot` —
  no shell, no package manager, ~80 MB image with a much smaller
  vulnerable surface than the alpine variant. Defaults to uid 65532.
  Operators must pin `BASE_DIGEST` before production; CI gates that
  pin before publishing.
- **HARDENING.md** — defence-in-depth playbook for FedRAMP / PCI / HIPAA
  workloads. Master-key tier ladder, memory hardening, core-dump
  suppression, network surface (TLS termination + XFF stripping +
  cross-host writer-lock), supply-chain (digest pin + cosign verify +
  fuzz cadence), audit + observability (sensitive-key blocklist + OTLP
  forwarding), operational hygiene checklist, and the failure modes
  this document does NOT promise.
- **Auditor `sink` callback** (`audit.mjs`). Optional `(record) => void`
  fired after every audit event so exporters (OTLP today; Datadog /
  Splunk tomorrow) can subscribe without coupling `audit.mjs` to them.
  Sink failures are isolated — never propagate to the request handler.
- **Polyglot rebrand**: "QuantumVault" → "Sigvault" across every
  language and surface. Python module `quantumvault` → `sigvault`,
  SDK adapter classes (Go / Java / PHP / C# / Ruby /Python) all
  renamed to `SigvaultClient` / `SigvaultError`. Rust crates,
  WASM, FFI, CLI, docs site all rebranded. Wire-format magic
  `0x51564C54` ("QVLT"), env-var prefix `QV_*`, and directory
  names `qv-*` are deliberately preserved (operator + token
  compatibility).
- **Multi-licence policy** documented in `LICENSING.md`:
  - Server / core / CLI / FFI / WASM → **AGPL-3.0-only**
  - SDK packages (npm + Python + Go + Java + PHP + C# + Ruby) → **Apache-2.0**
  - Specification + docs → **CC BY 4.0**
  - Helm chart + ops → **Apache-2.0**
  Replaces the prior single Apache-2.0 file with a per-component
  split. AGPL was chosen over BUSL-1.1 because it is a standard
  SPDX licence with no custom drafting and no expiring grants.
- **Governance documents**: `CONTRIBUTING.md` (with explicit
  zero-dep + DCO sign-off rules), `CODE_OF_CONDUCT.md`,
  `.github/ISSUE_TEMPLATE/{bug_report,feature_request,security_concern}.md`,
  and `.github/PULL_REQUEST_TEMPLATE.md`.
- **`qv-ops/scripts/dep-audit.mjs`**: machine-enforced supply-chain
  policy. Asserts qv-server has zero npm deps, qv-sdk has only the
  3-package Noble allowlist, qv-wasm has zero deps, qv-python is
  stdlib-only, and language adapters carry no vendored manifests
  (`go.mod`, `pom.xml`, `requirements.txt`, etc.). Backed by
  `qv-server/test/dep-audit.test.mjs` so CI rejects any drift.
  Caught a stale 68-package `package-lock.json` left behind in
  `qv-server/` that the rest of the suite had been quietly tolerating.
- **CI workflow `.github/workflows/ci.yml`**: dep-audit, conformance
  harness, full test matrix (Linux + macOS + Windows × Node 20 + 22),
  and SBOM verification on every push and PR.
- **Docker base pinned by digest** (`node:20.18.1-alpine3.20@sha256:f857…
  244f`). A tag swap in a compromised registry cannot substitute the
  image.
- **Cosign keyless signing + SBOM attestation** in the release
  workflow. Each pushed image is signed against its OIDC identity
  (`repo:org/quantum-vault:ref:…`) and gets a CycloneDX 1.5 SBOM
  attached as an OCI artefact. Operators verify with
  `cosign verify --certificate-identity-regexp …` before deploy.
- **Phase 5 conformance harness**:
  - `qv-spec/test-vectors/harness.mjs` — zero-dep runner that loads
    `vectors.json`, dispatches on `vector.kind`, and compares results
    to `expect`. ~150 lines so other languages can port it
    mechanically. Exit code 0 = pass, 1 = fail, 2 = malformed input.
  - `qv-server/test/conformance.test.mjs` — gates the harness inside
    the unit-test suite. Any drift between the server's behaviour and
    the published vectors fails CI.
  - `docs/story/21-conformance-and-licensing.md` — the licence boundary,
    trademark strategy, and "Sigvault Verified" badge process.
- **Phase 4 packaging artefacts**:
  - `qv-spec/openapi.yaml` — OpenAPI 3.1 spec for the `/v3/*` HTTP surface.
  - `qv-spec/wire-format.md` — byte-level token layout (so any-language
    SDKs can be written from this doc alone).
  - `qv-spec/error-codes.md` — stable error-code registry. Clients
    branch on `error.code`, never on prose.
  - `qv-server/Dockerfile` — fixed: the prior version COPY'd only
    server-sovereign.mjs, leaving the image broken since v4.3 added
    13 sibling modules. New image is reproducible (pinned base,
    explicit COPY list, non-root uid/gid 10001, runAsNonRoot,
    readOnlyRootFilesystem-friendly).
  - `qv-ops/helm/quantum-vault/` — minimal Helm chart (StatefulSet,
    PVC, probes, Secret-driven env). `replicaCount=1` enforced by
    design until v4.4 multi-writer ChainStore lands.
  - `qv-ops/scripts/sbom.mjs` — CycloneDX 1.5 SBOM generator. Zero
    deps. Empty `dependencies[0].dependsOn` is the load-bearing claim;
    a unit test asserts it stays empty (any future npm install fails
    the build).
- **Single-writer lock per DATA_DIR (Phase 3, partial fix for L1)**. New
  `writer-lock.mjs` refuses to start if another live qv-server already
  owns the data dir on the same host. Lease format
  (`$DATA_DIR/.writer-lock`): JSON with `fence`, `holderId`, `pid`,
  `hostname`, `acquiredAt`, `expiresAt`. Stale leases (expired, dead
  pid, or different hostname) are stolen with `fence + 1`. Fence
  detects the GC-pause hazard: a paused writer that resumes finds its
  fence overtaken and aborts loud (`WRITER_LOCK_LOST`) rather than
  continuing to write. Released on graceful shutdown. Disabled with
  `QV_WRITER_LOCK_DISABLED=true` (only safe when you've moved chain
  state to an external coordinator). Cross-host safety on shared
  filesystems is NOT promised — see Chapter 19. 14 unit + 4 integration
  tests.
- **Pluggable `MasterKeyProvider` (Phase 2 / limitation #3)**. New
  `master-key.mjs` resolves the boot-time master key through one of
  three backends:
  - **env** — read from `QV_MASTER_KEY_HEX`,
  - **file** — read/generate `master.key` (durable + chmod 0600),
  - **exec** — run an operator-supplied command and treat the first
    64-char hex run on stdout as the key. Universal escape hatch for
    AWS KMS, HashiCorp Vault, Azure Key Vault, GCP KMS, 1Password,
    sops, etc. — recipes in `docs/story/18-secret-managers.md`.
  Auto mode selects env → exec → file. Explicit selection via
  `QV_MASTER_KEY_PROVIDER`. 21 unit + 4 integration tests.
- **Deterministic chain seed derived from encryptKey**. Fixes a latent
  bug where `new MutationChain()` used a random per-create seed but
  reload used `encryptKey.slice(0,32)` — so the chain's SHA3 ratchet
  was effectively re-seeded on every restart and the log's stateHash
  column was unverifiable. Now create + reload share the same seed
  and Phase 1's `CHAIN_LOG_TAMPERED` check is meaningful end-to-end.
- **Cryptographic chain-log linkage verification**. The mutation-chain
  append-log's `stateHash` column (previously dead weight) is now verified
  on load. `chain-log.mjs` walks every record, re-derives each state from
  the previous via `SHA3-256(prev_state || pre_counter)`, and aborts boot
  on any mismatch (`CHAIN_LOG_TAMPERED`), non-monotonic counter
  (`CHAIN_LOG_NON_MONOTONIC`), or partial write (`CHAIN_LOG_CORRUPT`). The
  reload also restores the real post-advance state — so future advances
  continue the same hash chain uninterrupted across restarts (previously
  the chain silently re-seeded, so post-restart stateHashes would not link
  to pre-restart ones). 8 new unit tests.
- **Chain-log fsync on every issue** (durability of mutation counter). A
  token that returned 200 now has its chain record on disk before the
  response leaves the socket. Prevents counter-collision after SIGKILL /
  power-loss. Opt-out via `QV_CHAIN_FSYNC=0` for test environments.
- **Durability integration tests** (SIGKILL survival). 3 new tests boot a
  real server, issue/revoke, `SIGKILL` it, and prove the on-disk state
  is consistent on relaunch.
- **Durable writes for master.key, keystore.json, revoked.json** (limitation #4,
  R-4.3.4). New `durable.mjs` module: write to `<path>.tmp`, `fsyncSync`
  the data, atomic `renameSync`, `fsyncSync` the directory (POSIX). A
  revocation or keygen that returns 2xx has survived a power-loss. Stale
  `.tmp` siblings from a prior crash are cleaned on load (partial writes
  are never promoted). On win32 the dir-fsync is skipped (unsupported);
  NTFS rename remains atomic. 7 new unit tests.
- **Audit log rotation** (limitation #6b). `audit.log` rotates by size so
  long-running instances cannot fill the disk. Default 64 MiB / 5 archives
  (`audit.log.1`…`audit.log.N`). Tunable via `QV_AUDIT_ROTATE_BYTES` (0
  disables) and `QV_AUDIT_ROTATE_KEEP`. Rotation is best-effort — failures
  are reported on stderr and logging continues. 5 new unit tests.
- **W3C Trace Context propagation** (limitation #8). Every response now
  carries a `traceparent` header so qv-server stitches into a caller's
  distributed trace without running a tracer. Inbound `traceparent` is
  parsed strictly (version `00` only, non-zero trace/span ids) and the
  trace-id is inherited while qv-server emits a fresh CHILD span-id.
  Audit events gain `traceId`, `spanId`, `parentSpanId`, and
  `traceInherited`. Malformed headers trigger a fresh trace. `tracestate`
  passes through when ≤512 bytes of printable ASCII. 12 unit + 4
  integration tests.
- **CIDR allowlist for admin + metrics** (limitation #5). Defence-in-depth
  on top of the bearer. Calls to `/v3/keygen`, `/v3/token/issue`,
  `DELETE /v3/keys/:id`, and `/v3/metrics` must originate from a
  whitelisted range (`QV_ADMIN_ALLOW_CIDRS`; `QV_METRICS_ALLOW_CIDRS`
  inherits). IPv4 + IPv6 CIDR, IPv4-in-v6, zone-id stripping. `X-Forwarded-For`
  last hop authoritative. Denials emit
  `qv_auth_denies_total{reason="cidr_denied"}` + `auth.deny` audit event.
  13 unit + 4 integration tests.
- **Claims structural limits** (limitation #11). Complements the 16 KiB
  byte cap with per-shape caps (depth ≤ 8, keys ≤ 64, array ≤ 128,
  string ≤ 4 096, total nodes ≤ 1 024) to reject pathological JSON before
  signing. All tunable via `QV_CLAIMS_MAX_*`. Stable 400 error codes:
  `CLAIMS_TOO_DEEP`, `CLAIMS_TOO_MANY_KEYS`, `CLAIMS_ARRAY_TOO_LARGE`,
  `CLAIMS_STRING_TOO_LONG`, `CLAIMS_KEY_TOO_LONG`, `CLAIMS_BAD_NUMBER`,
  `CLAIMS_BAD_TYPE`, `CLAIMS_TOO_MANY_NODES`, `CLAIMS_NOT_OBJECT`.
  13 unit + 3 integration tests.
- **Verify-pool bounded queue + backpressure** (limitation #12). VerifyPool
  extracted into `verify-pool.mjs` for unit testability. A bounded FIFO
  queue (`QV_VERIFY_QUEUE_MAX`, default 1024) sits in front of the worker
  pool; when saturated, `/v3/token/batch-verify` replies
  `503 POOL_OVERLOADED` with `Retry-After: 1`. New Prometheus series:
  `qv_verify_queue_depth` (gauge), `qv_verify_queue_rejects_total`
  (counter). 6 new unit tests using a mock worker.
- **Prometheus metrics at `/v3/metrics`** ([R-4.3.5], #5). Zero-dep in-process
  exposition in Prometheus text format v0.0.4. Initial metric set:
  `qv_http_requests_total{method,path,status}`,
  `qv_http_request_duration_seconds` histogram (buckets tuned for sub-ms
  verify latency),
  `qv_auth_denies_total{reason}`,
  `qv_rate_limit_denies_total{category}`,
  `qv_token_issue_total{suite,tokenType,result}`,
  `qv_token_verify_total{result}`,
  `qv_keys_total`, `qv_revoked_total`, `qv_inflight_requests`,
  `qv_process_uptime_seconds`.
  Path labels use the **route template** (e.g. `/v3/keys/:id`), never the
  raw URL — cardinality stays bounded no matter how many keys exist.
  The endpoint is **admin-bearer protected by default**; set
  `QV_METRICS_PUBLIC=true` to expose anonymously (use only behind a
  trusted mesh). Disable entirely with `QV_METRICS_DISABLED=true`.
  14 new tests (9 unit + 5 integration).
- **Liveness / readiness split** ([R-4.3.7], #7). Two new probes let
  Kubernetes (and any load balancer) distinguish "is the process
  alive" from "can this instance accept traffic":
  - `GET /v3/live` — cheap liveness. Returns 200 as long as the event
    loop is responsive. Never 503s during drain — draining is a
    readiness transition, not a liveness failure.
  - `GET /v3/ready` — functional readiness. 200 once keystore and
    revocation list are loaded; 503 before boot completes or while
    draining. Target this from `readinessProbe`.
  - `GET /v3/health` — kept as a back-compat alias of `/v3/ready` so
    v4.2 clients that polled it continue to work. Status string
    changed from `"ok"` to `"ready"` (old value still accepted by the
    test suite).
- **Graceful SIGTERM / SIGINT shutdown** ([R-4.3.8], #8). On signal the
  server stops accepting new connections, flips `/v3/health` to
  `503 draining` so load balancers steer traffic away, waits for
  in-flight requests to finish, then runs an ordered teardown — worker
  pool shutdown, audit fd close, sweep-timer clear — before exiting.
  A hard timeout (`QV_SHUTDOWN_TIMEOUT_MS`, default 30000) forces
  `exit(1)` if drain stalls. A `server.shutdown` event is emitted to
  the audit log at each phase so operators can grep the transition.
  Zero npm deps. 9 new tests (8 unit + 1 integration, the latter
  skipped on win32 where Node does not deliver signals to children).
- **Request-ID propagation + structured JSONL audit log** ([R-4.3.6], #6).
  Every response now carries an `X-Request-Id` header — echoed from the
  caller when it matches `^[A-Za-z0-9._-]{1,64}$`, otherwise a fresh
  UUID v4. The id is threaded through every audit event for that
  request so `grep` on a single id yields a full trace.
  Structured JSON-Lines audit events (`http.request`, `auth.deny`,
  `keygen`, `token.issue`, `token.revoke`) are written to
  `<DATA_DIR>/audit.log` (0600) and to stdout by default. Configurable
  via `QV_AUDIT_LOG`, `QV_AUDIT_STDOUT`, `QV_AUDIT_FILE`, and
  `QV_AUDIT_DISABLED`. Known-sensitive keys (`token`, `authorization`,
  `masterKey`, `privateKey`, `password`, `cookie`, …) are dropped by
  the auditor before serialisation; a targeted integration test
  confirms the plaintext admin token never reaches the log. Zero
  npm deps. 20 new tests (13 unit + 7 integration).
- **Security headers + CORS lockdown** ([R-4.3.12], #30). Every response now
  carries `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer`,
  `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'`,
  `Cross-Origin-Resource-Policy: same-origin`,
  `Cross-Origin-Opener-Policy: same-origin`,
  `X-Permitted-Cross-Domain-Policies: none`, and — by default —
  `Strict-Transport-Security: max-age=31536000; includeSubDomains`. The
  server actively strips `Server` and `X-Powered-By` so neither Node nor
  our framework surface leaks. HSTS tunable via `QV_HSTS_ENABLED`,
  `QV_HSTS_MAX_AGE` (0..63072000), `QV_HSTS_INCLUDE_SUBDOMAINS`,
  `QV_HSTS_PRELOAD`. CORS is off by default; enable with
  `QV_CORS_ORIGINS="https://a.example,https://b.example"` (whitelist,
  echo on match, `Vary: Origin`) or legacy `QV_CORS_ORIGIN="*"` for
  open mode. Wildcard combined with `QV_CORS_ALLOW_CREDENTIALS=true`
  is rejected at startup (browsers block it anyway). 25 new tests (18
  unit + 7 integration).
- **Per-IP rate limiting + body-size caps** ([R-4.3.9], #9). Token-bucket
  limiter keyed on `X-Forwarded-For` last hop (falls back to
  `socket.remoteAddress`). Four independent buckets — `public`, `verify`,
  `admin`, and `authFail` (separate so bearer brute-force can't exhaust
  the legit admin budget). All RPMs tunable via env:
  `QV_RATE_PUBLIC_RPM` (600), `QV_RATE_VERIFY_RPM` (120),
  `QV_RATE_ADMIN_RPM` (60), `QV_RATE_AUTHFAIL_RPM` (10).
  Set `QV_RATE_LIMIT_DISABLED=true` behind a trusted mesh.
  Responses carry `X-RateLimit-Limit`/`-Remaining`/`-Reset`; 429 includes
  `Retry-After`. Memory is bounded: 5-min idle sweep + hard cap
  `QV_RATE_MAX_IPS` (100k). Body cap `QV_MAX_BODY_BYTES` (64 KiB default)
  enforced before JSON parse → 413; claims cap
  `QV_MAX_CLAIMS_BYTES` (16 KiB) enforced before signing → 413.
- **Admin bearer-token auth on mutating endpoints** ([R-4.3.11], #29). `POST
  /v3/keygen`, `POST /v3/token/issue`, and `DELETE /v3/keys/:id` now require
  `Authorization: Bearer <token>`. Two modes via env:
  - `QV_ADMIN_TOKEN=<32+ chars>` — plaintext, dev/small deploys.
  - `QV_ADMIN_TOKEN_SHA256=<sha256 hex>` — recommended, token never in env.
  - `QV_ALLOW_ANON=true` — explicit opt-in for local dev.
  The server **refuses to start** without one of these set. Comparisons are
  constant-time (`timingSafeEqual` over SHA-256 digests); no_token and
  bad_token responses are byte-identical. Zero npm deps added.
- Helper: `npm run mint-token` prints a fresh `QV_ADMIN_TOKEN` + matching
  `QV_ADMIN_TOKEN_SHA256`.
- Test suite: 195 tests under `qv-server/test/` (1 skipped on win32).
  Run with `npm test`.

---

## [4.2.0] — 2026-04-20

First release distributed across **five registries**. Before v4.2 the
only way to use Sigvault was `git clone`; as of this release every
major language ecosystem can install it natively.

### Added

- **Falcon-512 / Falcon-1024 dispatch** in `issue_token` / `verify_token`
  (suite bytes `0x10` and `0x11`). Falcon-512 signatures are **666 B
  — 7.1× smaller than ML-DSA-87** and verify 6× faster.
- **`@sigvault/sdk`** on npm — Node 18+, Deno, Bun, Cloudflare
  Workers. Pure JavaScript, no post-install.
- **`@sigvault/wasm`** on npm — 127 KB `.wasm` + a portable loader
  with auto-wired `qv_host_random` for every JS runtime.
- **`qv-core`** on crates.io — full Rust library with optional
  `falcon` feature (requires a C toolchain).
- **`sigvault`** on PyPI — stdlib-only REST client, Python 3.8+,
  one universal `py3-none-any` wheel.
- **`ghcr.io/007krcs/qv-server`** on GHCR — multi-arch
  (`linux/amd64` + `linux/arm64`) Docker image, non-root, zero npm
  dependencies.
- **Prebuilt `libqv`** on GitHub Releases for five platforms:
  `x86_64-linux-gnu`, `aarch64-linux-gnu`, `x86_64-apple-darwin`,
  `aarch64-apple-darwin`, `x86_64-pc-windows-msvc`. Each archive ships
  the native library, the C header, `LICENSE`, and `README`.
- **Concepts & Glossary docs page** covering every protocol term,
  every suite byte, MutationChain mechanics, key-triplet semantics,
  wire-format anatomy, error-code taxonomy, and a JWT-vs-Sigvault
  feature matrix.
- **`.github/workflows/release.yml`** — single-tag fan-out to all
  five registries on `git tag v*.*.*`. Supports `dry_run=true` via
  `workflow_dispatch` for pre-tag validation.
- **`qv-server/Dockerfile`** — Alpine-based, non-root `qv` user,
  health-checked, `QV_*` env-var contract documented.
- **`render.yaml`** — one-click Render blueprint deploying both
  `qv-docs` (static) and `qv-server` (web service).

### Changed

- **Vendor tree restored.** `./vendor` contains every transitive
  crate including the PQClean Falcon sources; `cargo build` is
  offline / air-gap clean once more.
- **Quickstart docs** rewritten install-first, with five tabs
  (JavaScript, Browser, Python, Rust, Docker REST, C FFI) and three
  30-second demos.
- **Footer version** bumped `v4.1-γ` → `v4.2.0`.

### Fixed

- `Languages.tsx` Go cgo snippet no longer crashes Vite with
  `PROJECT_ROOT is not defined` (JSX template-literal interpolation
  now escaped).
- `.gitattributes` treats `vendor/**` as `-text` (binary), preventing
  line-ending rewrites from corrupting `cargo vendor` checksums on
  Linux CI.
- `.gitignore` un-ignores vendored test fixtures
  (`vendor/**/*.{pem,key,der,pyc}` + `__pycache__/`) so cargo's
  `.cargo-checksum.json` stays valid after checkout.
- `verify_non_sig_layers` in `qv-core` marked `#[cfg_attr(not(feature="falcon"), allow(dead_code))]`
  to keep wasm32-unknown-unknown builds green under `-D warnings`.
- CI `crates.io` job temporarily neutralizes repo-local
  `.cargo/config.toml` so `cargo publish` can reach the registry
  while the rest of the workspace still builds from `./vendor`.

### Known limitations

The full catalogue lives in [`ROADMAP.md`](./ROADMAP.md#known-limitations-in-v420).
Top three to know before deploying:

1. **MutationChain is single-writer.** Horizontal scaling breaks
   replay protection. Fix shipping in v4.3 (R-4.3.2).
2. **No `kid` in token header.** Key rotation scans every key. Fix
   shipping in v4.3 (R-4.3.3).
3. **Master key lives in an env var or plaintext file.** No KMS/HSM
   integration until v4.4 (R-4.4.5).

---

## [4.1] — 2026-03 *(pre-public-distribution)*

- ML-DSA-87 issue / verify pipeline.
- XChaCha20-Poly1305 AEAD over CBOR-encoded claims.
- MutationChain replay protection (single-writer).
- Entropy certification on nonces.
- `qv-server` sovereign Node implementation (zero npm deps).
- Initial `qv-docs` Vite + React + tekivex-ui site.

---

[Unreleased]: https://github.com/007krcs/quantum-vault/compare/v4.2.0...HEAD
[4.2.0]: https://github.com/007krcs/quantum-vault/releases/tag/v4.2.0
