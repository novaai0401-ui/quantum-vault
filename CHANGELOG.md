# Changelog

All notable changes to QuantumVault are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/)
(with the MAJOR-stability commitment beginning at v5.0 — see
[ROADMAP.md](./ROADMAP.md)).

## [Unreleased]

_Tracking v4.3 — see [ROADMAP.md](./ROADMAP.md#v43--production-ready-server-6-weeks)._

### Added

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
only way to use QuantumVault was `git clone`; as of this release every
major language ecosystem can install it natively.

### Added

- **Falcon-512 / Falcon-1024 dispatch** in `issue_token` / `verify_token`
  (suite bytes `0x10` and `0x11`). Falcon-512 signatures are **666 B
  — 7.1× smaller than ML-DSA-87** and verify 6× faster.
- **`@quantumvault/sdk`** on npm — Node 18+, Deno, Bun, Cloudflare
  Workers. Pure JavaScript, no post-install.
- **`@quantumvault/wasm`** on npm — 127 KB `.wasm` + a portable loader
  with auto-wired `qv_host_random` for every JS runtime.
- **`qv-core`** on crates.io — full Rust library with optional
  `falcon` feature (requires a C toolchain).
- **`quantumvault`** on PyPI — stdlib-only REST client, Python 3.8+,
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
  wire-format anatomy, error-code taxonomy, and a JWT-vs-QuantumVault
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
