# QuantumVault

> Post-quantum (ML-DSA-87, Falcon-512/1024) cryptographic tokens with
> three embedding surfaces — native FFI, portable WASM, and a
> zero-dependency REST server. Usable from any language.

[![Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)
![version](https://img.shields.io/badge/version-v4.1--γ-7dd3fc.svg)
![npm deps](https://img.shields.io/badge/server%20npm%20deps-0-success.svg)
![WASM size](https://img.shields.io/badge/WASM%20size-127%20KB-success.svg)

- **Docs & live demo:** see `qv-docs/` (deploys as a static site on Render).
- **REST API reference:** `qv-docs` → *REST API* page.
- **Language examples:** `qv-docs` → *Languages* page, sources under
  `qv-ffi/examples/` and `qv-wasm/demo-node.mjs`.

---

## Repo layout

```
qv-core/    Rust library. Tokens, claims, mutation chain, Falcon wrapper.
qv-ffi/     C ABI wrapper → qv.dll / libqv.so / libqv.dylib.
qv-wasm/    WebAssembly wrapper. Custom getrandom shim, one host import.
qv-sdk/     JavaScript SDK (Node stdlib only).
qv-server/  REST server — server-sovereign.mjs (zero npm deps).
qv-cli/     Optional CLI front-end.
qv-docs/    Vite + React + tekivex-ui docs/demo site.
vendor/     Vendored Rust source tree (offline-buildable).
render.yaml Render blueprint — deploys docs + server in one click.
```

## Quickstart

### Option A — REST server (fastest to see it work)

```bash
node qv-server/server-sovereign.mjs
curl -s http://localhost:7433/v3/health
```

### Option B — native FFI (Python via ctypes)

```bash
cargo build -p qv-ffi --release
python qv-ffi/examples/python/demo.py          # ML-DSA-87
python qv-ffi/examples/python/demo_falcon.py   # Falcon-512 + 1024
```

### Option C — WebAssembly (Node, browser, Workers, Deno)

```bash
rustup target add wasm32-unknown-unknown
cargo build -p qv-wasm --release --target wasm32-unknown-unknown
node qv-wasm/demo-node.mjs
```

### Option D — run the docs site locally

```bash
cd qv-docs
npm install
npm run dev      # http://localhost:5173
```

## What's in v4.1

- **Falcon-512 / Falcon-1024** through `qv-core`, `qv-ffi`, and Python
  demos. Falcon-512 signatures are 656 B — **7.1× smaller than ML-DSA-87**
  and verify 6× faster.
- **worker_threads batch-verify**. 4-worker pool → 558 verify/s
  end-to-end vs 158/s in-thread.
- **WASM unblocked.** Custom `getrandom` shim for v0.3/v0.4 custom
  backend plus v0.2 `register_custom_getrandom!`. 127 KB `.wasm`, one
  host import (`qv_host_random`).

See `SOVEREIGN_V4.md` for the full v4.x architecture notes.

## Deploy to Render

```bash
# Push this repo to GitHub, then in Render: New → Blueprint → pick repo.
# The render.yaml in this directory deploys two services:
#   - qv-docs   (static site)
#   - qv-server (Node web service, zero npm)
# After the server is live, set VITE_QV_API on the docs site to its
# public URL (or visit /demo?api=https://your-server for quick testing).
```

## License

Apache-2.0.
