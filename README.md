# QuantumVault

> Post-quantum (ML-DSA-87, Falcon-512/1024) cryptographic tokens for every
> ecosystem — **npm, crates.io, GitHub Releases, GHCR**. Usable from any
> language. Quantum-safe, authenticated, encrypted, replay-protected.

[![Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)
![version](https://img.shields.io/badge/version-v4.2-7dd3fc.svg)
[![npm sdk](https://img.shields.io/npm/v/@quantumvault/sdk?label=%40quantumvault%2Fsdk)](https://www.npmjs.com/package/@quantumvault/sdk)
[![npm wasm](https://img.shields.io/npm/v/@quantumvault/wasm?label=%40quantumvault%2Fwasm)](https://www.npmjs.com/package/@quantumvault/wasm)
[![crates.io](https://img.shields.io/crates/v/qv-core.svg)](https://crates.io/crates/qv-core)
![server npm deps](https://img.shields.io/badge/server%20npm%20deps-0-success.svg)
![WASM size](https://img.shields.io/badge/WASM%20size-127%20KB-success.svg)

## Install

```bash
# JavaScript / TypeScript (Node, Deno, Bun, Cloudflare Workers)
npm install @quantumvault/sdk

# Browsers / edge — 127 KB wasm
npm install @quantumvault/wasm

# Rust
cargo add qv-core --features falcon

# REST server (zero npm deps, multi-arch)
docker run -p 7433:7433 \
  -e QV_MASTER_KEY_HEX=$(openssl rand -hex 32) \
  ghcr.io/007krcs/qv-server:4.2

# C / Go / C# / Swift — prebuilt libqv
curl -L https://github.com/007krcs/quantum-vault/releases/latest/download/libqv-$(uname -m)-$(uname -s | tr A-Z a-z).tar.gz | tar xz
```

## 30-second demo (JavaScript)

```js
import {
  generateKeypair, MutationChain,
  issueToken, verifyToken,
} from '@quantumvault/sdk';

const { signingKey, verifyingKey, encryptKey } = generateKeypair();
const chain = new MutationChain();

const { tokenHex } = issueToken({
  signingKeySeed: signingKey, encryptKey, chain,
  claims: { sub: 'user-123', role: 'admin' },
  ttl: 3600,
});

const { claims } = verifyToken({
  token: tokenHex, verifyingKey, encryptKey,
  chain: new MutationChain(chain.state),
});
// → { sub: 'user-123', role: 'admin' }
```

## What's in v4.2

- **Installable everywhere.** npm (`@quantumvault/sdk`, `@quantumvault/wasm`),
  crates.io (`qv-core`), Docker (`ghcr.io/007krcs/qv-server`), and prebuilt
  FFI binaries on GitHub Releases for 5 platforms.
- **Falcon dispatch** in `issue_token` / `verify_token`. Falcon-512 gives you
  656-byte signatures — **7.1× smaller than ML-DSA-87** and 6× faster to
  verify. New SuiteIds `0x10` (Falcon-512) and `0x11` (Falcon-1024) on the
  wire.
- **Offline builds restored.** `./vendor` now contains Falcon + all transitive
  crates; `cargo build` works air-gapped.
- **Docker image.** `ghcr.io/007krcs/qv-server` runs as non-root, multi-arch
  (amd64 + arm64), health-checked.

## Repo layout

```
qv-core/    Rust library → crates.io (qv-core)
qv-ffi/     C ABI wrapper → GitHub Releases (libqv.{so,dylib,dll})
qv-wasm/    WebAssembly build → npm (@quantumvault/wasm)
qv-sdk/     JavaScript SDK → npm (@quantumvault/sdk)
qv-server/  REST server → ghcr.io/007krcs/qv-server (Dockerfile included)
qv-cli/     Optional CLI
qv-docs/    Vite + React + tekivex-ui docs/demo site
vendor/     Vendored Rust source tree (offline-buildable)
.github/    release.yml — publishes everything on `git tag v*`
render.yaml Render blueprint — deploys docs + server in one click
```

## Language examples

See [`qv-ffi/examples/`](./qv-ffi/examples) for native FFI (C, Python, Go, C#)
and [`qv-sdk/`](./qv-sdk) for higher-level language wrappers (Java, Ruby, PHP,
Python, Go, C# — all talk to the REST server or the FFI binaries).

## Deploy to Render

```bash
# Push this repo to GitHub, then in Render: New → Blueprint → pick repo.
# render.yaml deploys two services:
#   - qv-docs   (static site)
#   - qv-server (Node web service, zero npm deps)
```

## License

Apache-2.0.
