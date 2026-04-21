# Changelog

All notable changes to QuantumVault are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/)
(with the MAJOR-stability commitment beginning at v5.0 — see
[ROADMAP.md](./ROADMAP.md)).

## [Unreleased]

_Tracking v4.3 — see [ROADMAP.md](./ROADMAP.md#v43--production-ready-server-6-weeks)._

### Added

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
- Test suite: 107 tests (79 unit + 28 integration) under
  `qv-server/test/`. Run with `npm test`.

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
