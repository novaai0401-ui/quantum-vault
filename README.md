# Sigvault

> Post-quantum (ML-DSA-87, Falcon-512/1024) cryptographic tokens for every
> ecosystem — **npm, crates.io, GitHub Releases, GHCR**. Usable from any
> language. Quantum-safe, authenticated, encrypted, replay-protected.

[![server: AGPL-3.0](https://img.shields.io/badge/server-AGPL--3.0-red.svg)](./LICENSE)
[![sdk: Apache-2.0](https://img.shields.io/badge/sdk-Apache--2.0-blue.svg)](./qv-sdk/LICENSE)
[![spec: CC BY 4.0](https://img.shields.io/badge/spec-CC%20BY%204.0-orange.svg)](./qv-spec/LICENSE)
![version](https://img.shields.io/badge/version-v4.3-7dd3fc.svg)
[![npm sdk](https://img.shields.io/npm/v/@sigvault/sdk?label=%40sigvault%2Fsdk)](https://www.npmjs.com/package/@sigvault/sdk)
[![npm wasm](https://img.shields.io/npm/v/@sigvault/wasm?label=%40sigvault%2Fwasm)](https://www.npmjs.com/package/@sigvault/wasm)
[![crates.io](https://img.shields.io/crates/v/qv-core.svg)](https://crates.io/crates/qv-core)
![server npm deps](https://img.shields.io/badge/server%20npm%20deps-0-success.svg)
![WASM size](https://img.shields.io/badge/WASM%20size-127%20KB-success.svg)

## Install

```bash
# JavaScript / TypeScript (Node, Deno, Bun, Cloudflare Workers)
npm install @sigvault/sdk

# Browsers / edge — 127 KB wasm
npm install @sigvault/wasm

# Python (REST client, zero deps)
pip install sigvault

# Rust
cargo add qv-core --features falcon

# REST server (zero npm deps, multi-arch)
docker run -p 7433:7433 \
  -e QV_MASTER_KEY_HEX=$(openssl rand -hex 32) \
  ghcr.io/007krcs/qv-server:4.2

# C / Go / C# / Swift — prebuilt libqv
curl -L https://github.com/007krcs/quantum-vault/releases/latest/download/libqv-$(uname -m)-$(uname -s | tr A-Z a-z).tar.gz | tar xz
```

## Supply-chain stance

After XZ-utils (CVE-2024-3094), npm `event-stream` (2018), and the
recurring axios prototype-pollution incidents, "just install it" is no
longer a defensible strategy. Sigvault's answer is structural:

- **`qv-server`** has **zero runtime npm dependencies**. The dependency
  graph is empty. Every line is from Node.js stdlib. CI rejects any
  commit that ships a `package-lock.json` or a non-empty
  `dependencies` field. (`qv-ops/scripts/dep-audit.mjs` enforces this.)
- **`qv-sdk`** has **exactly three** runtime deps, all in the
  audited Noble suite: `@noble/post-quantum`, `@noble/ciphers`,
  `@noble/hashes`. CI rejects anything outside this allowlist.
- **`qv-wasm`** has **zero** runtime deps; the wasm binary is
  self-contained.
- **`qv-python`** uses Python stdlib only — `urllib`, `json`,
  `dataclasses`. No `requests`, no `httpx`, no `pydantic`.
- **All other language adapters** (Go / Java / PHP / C# / Ruby) are
  single-file, stdlib-only. CI rejects vendored manifests
  (`go.mod`, `pom.xml`, `requirements.txt`, etc.) inside the adapter
  directories.
- **Docker base image** is pinned by **digest as well as tag**. A tag
  swap by a compromised registry cannot affect us.
- **Released images** are signed with **Sigstore cosign** (keyless
  OIDC) and attached with a **CycloneDX 1.5 SBOM**. Operators verify
  with `cosign verify --certificate-identity-regexp ...`.

If a future PR breaks any of these, CI fails before review. The cost
of a supply-chain compromise here would be every Sigvault token ever
issued, so the policy is enforced by code, not by convention.

## 30-second demo (JavaScript)

```js
import {
  generateKeypair, MutationChain,
  issueToken, verifyToken,
} from '@sigvault/sdk';

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

- **Installable everywhere.** npm (`@sigvault/sdk`, `@sigvault/wasm`),
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
qv-wasm/    WebAssembly build → npm (@sigvault/wasm)
qv-sdk/     JavaScript SDK → npm (@sigvault/sdk)
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

## Licensing

Sigvault is **multi-licensed** by component — pick the row matching what
you're using.

| Component | Path | Licence |
|-----------|------|---------|
| Server, core crate, CLI, FFI, WASM | `qv-server/`, `qv-core/`, `qv-cli/`, `qv-ffi/`, `qv-wasm/` | **AGPL-3.0-only** |
| SDK (npm + Python + Go + Java + PHP + C# + Ruby) | `qv-sdk/`, `qv-python/` | **Apache-2.0** |
| Specification + documentation | `qv-spec/`, `docs/` | **CC BY 4.0** |
| Helm chart, ops scripts | `qv-ops/` | **Apache-2.0** |

**Plain English:**

- **Operators** (running Sigvault inside your org) → no restrictions.
- **Application developers** (calling Sigvault from your service) →
  pull `@sigvault/sdk` (Apache-2.0). Your service's licence is unaffected.
- **SaaS vendors offering Sigvault to third parties** → AGPL §13
  applies; either release your modifications or get a commercial
  licence.
- **Hyperscalers** considering a managed Sigvault offering → AGPL §13
  applies. By design.

Full details, including the rationale and the rejected alternatives,
are in [LICENSING.md](./LICENSING.md).

Reporting a vulnerability? See [SECURITY.md](./SECURITY.md).
Contributing? See [CONTRIBUTING.md](./CONTRIBUTING.md).
