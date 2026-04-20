# Changelog

All notable changes to QuantumVault are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/)
(with the MAJOR-stability commitment beginning at v5.0 — see
[ROADMAP.md](./ROADMAP.md)).

## [Unreleased]

_Tracking v4.3 — see [ROADMAP.md](./ROADMAP.md#v43--production-ready-server-6-weeks)._

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
