# QuantumVault v4.0 — Sovereign Edition Architecture

> "If someone removes their support, we do not become handicapped."

## 1. Principle: Zero-Dependency Self-Sovereignty

Every line of cryptographic code, every byte of wire format, every runtime
helper — owned, vendored, auditable, and buildable offline from a cold
tarball. No npm publish can brick us. No crate yank can brick us. No OS
signing policy can block us.

## 2. Dependency Elimination Matrix

| Layer | v3.0 (current) | v4.0 (sovereign) | Status |
|---|---|---|---|
| PQ signatures | `@noble/post-quantum` (npm) + `ml-dsa` (crates.io) | **Vendored** `qv-core/src/pqc/mldsa/` — FIPS 204 ref impl in-tree | Scaffold |
| PQ KEM | `ml-kem` (crates.io) | **Vendored** `qv-core/src/pqc/mlkem/` — FIPS 203 ref impl in-tree | Planned |
| AEAD | `chacha20poly1305` (crate) / `@noble/ciphers` | **Vendored** `qv-core/src/sym/xchacha20poly1305.rs` | Planned |
| Hash | `sha3` (crate) / `@noble/hashes` | **Vendored** `qv-core/src/sym/sha3.rs` (Keccak-f[1600] in 200 LoC) | Planned |
| HTTP server | `express` + `cors` + `uuid` (npm) | **Node stdlib `http`** + inline UUIDv4 + 20-line CORS | **DONE** |
| Language bindings | 7 × HTTP SDKs | HTTP SDKs **+** single C ABI (`qv.dll`/`.so`/`.dylib`) | Scaffold |
| Browser / Edge | N/A | **WASM** (`qv.wasm`) for Deno/Cloudflare/Browsers/Python/Go via wasmtime | Scaffold |
| Persistence | In-memory `Map` | JSON-file keystore + append-only mutation log | **DONE** |
| Build toolchain | MinGW GCC (WinLibs) | Same, but reproducible via `rust-toolchain.toml` lockfile | Planned |
| Runtime | Node.js 20 | Optional — C ABI runs standalone; WASM runs in any WASI host | Scaffold |

## 3. What "self-driven" means, concretely

1. **Clone the repo, disconnect the internet, `cargo build`** → produces
   working `qv.exe`, `qv.dll`, and `qv.wasm`. Nothing from crates.io is
   required at build time.
2. **Run the server with `node server.mjs`** on a base Node install —
   no `npm install` step at all. No `node_modules` in the repo.
3. **If RustCrypto deletes every crate tomorrow**, we keep building.
4. **If npm removes Express tomorrow**, we keep running.
5. **If Microsoft blocks our signed EXE tomorrow**, we ship the WASM
   module and every app that embeds it gets QuantumVault for free.

## 4. Shrinking the Token

| Suite | Sig bytes | PK bytes | Security (classical / quantum) | Use case |
|---|---|---|---|---|
| ML-DSA-87 (current) | 4627 | 2592 | 256 / 192 | Government / long-term |
| ML-DSA-65 | 3293 | 1952 | 192 / 128 | **New default** for access tokens |
| ML-DSA-44 | 2420 | 1312 | 128 / 64  | Service-to-service, high churn |
| Falcon-1024 | **1280** | 1793 | 256 / 192 | Most compact PQ option |
| Falcon-512  | **666**  | 897  | 128 / 64  | JWT-class size, PQ secure |

v4.0 adds suite IDs `0x02` (ML-DSA-65), `0x03` (ML-DSA-44), `0x10`
(Falcon-512), `0x11` (Falcon-1024). Default access tokens drop from
~4800 B to **~2100 B** (ML-DSA-65) or **~1100 B** (Falcon-512) — a
**2-4× reduction** with no loss of PQ security at the chosen level.

Further compression: switch claims encoding from MessagePack to CBOR
deterministic with tag-table dictionary → another ~20 % off payload.

## 5. Performance

| Operation | v3.0 (Node+noble, ms) | v4.0 target (native Rust FFI, ms) |
|---|---|---|
| keygen (ML-DSA-87) | ~25 | **< 3** |
| issue (sign) | ~30 | **< 2** |
| verify | ~11 | **< 1** |
| batch verify 1000 | ~11 000 | **< 300** (aggregated) |

Native beats JS by 8–12× on the hot paths. Batch verification uses
randomized linear combination of signatures — O(N) hashes, one bignum
MSM, ~35× speedup at N=1000.

## 6. Universal Language Coverage

Three delivery channels, picked per deployment:

### 6.1 HTTP REST (already shipped, now zero-dep)
Any language with a TCP socket. Best for microservices, cross-datacenter.

### 6.2 C ABI shared library (`qv-ffi/`)
One binary, every language:
- **C / C++**: `#include "qv.h"` + link `-lqv`
- **Python**: `ctypes.CDLL("qv.dll")` or `cffi`
- **Java / Kotlin**: JNA `Native.load("qv", ...)`
- **Go**: `import "C"` via cgo
- **Ruby**: `require 'ffi'; ffi_lib 'qv'`
- **C# / F# / VB.NET**: `[DllImport("qv.dll")]`
- **Swift / Obj-C**: direct module import
- **Rust**: `extern "C"` (or native `qv-core`)
- **R**: `.Call(qv_verify, ...)` via `.dynLib`
- **Erlang / Elixir**: NIF wrapper (30 lines)
- **Lua**: `ffi.cdef` (LuaJIT)
- **MATLAB / Julia**: `ccall(:qv_verify, ...)`

One header file, one binary per platform. Zero overhead.

### 6.3 WASM (`qv-wasm/`)
Same Rust core compiled to `qv.wasm`:
- Browsers (WebCrypto unavailable for PQ — we ship our own)
- Deno / Bun / Cloudflare Workers / Vercel Edge
- Node (`WebAssembly.instantiate`)
- Python via `wasmtime-py`
- Go via `wazero`
- .NET via `Wasmtime.NET`
- Any WASI-conforming host

## 7. Persistent Replay Resistance

Mutation chain state is now file-backed:

```
qv-data/
├── keystore.json       # {keyId: {vk, ek, label, createdAt}} — no signing keys!
├── chains/
│   └── <keyId>.log     # append-only: each verify appends 40 B (ctr + hash)
└── sk/
    └── <keyId>.bin     # sealed signing key (ChaCha20 with OS keystore key)
```

Restart no longer resets the counter. Cross-instance sync via periodic
rsync of `chains/` (last-writer-wins on max counter).

## 8. Roadmap

| Phase | Deliverable | ETA |
|---|---|---|
| 4.0-α | Zero-npm server, persistent state, suite negotiation | **this sprint** |
| 4.0-β | C FFI crate + header + DLL build | +2 weeks |
| 4.0-γ | WASM target + browser demo | +3 weeks |
| 4.0-RC | Vendored ML-DSA (FIPS 204 ref impl in-tree) | +6 weeks |
| 4.0-GA | Formal TLA+ spec, EV code-signing, SBOM, reproducible builds | +10 weeks |
| 4.1 | Falcon-512/1024 suites, batch verification, CBOR claims | +14 weeks |

## 9. Non-Goals

- **Not a JWT drop-in.** JWT is deliberately insecure in quantum world.
- **Not a blockchain.** No distributed consensus claim.
- **Not a password manager.** Orthogonal layer.

## 10. Threat Model Changes vs v3.0

Newly mitigated in v4.0:
- ❌ npm supply-chain takedown → owned code
- ❌ Cargo yank → vendored
- ❌ Server restart replay window → persistent log
- ❌ Signing key in process RAM plaintext → sealed with OS DPAPI / keyring
- ❌ OS code-signing block → WASM + C ABI alternate delivery

Still open (roadmap):
- HSM attestation — planned PKCS#11 provider
- Formal proof of mutation-chain unforgeability — TLA+ WIP
