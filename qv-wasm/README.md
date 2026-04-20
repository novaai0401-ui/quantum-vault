# qv-wasm — WebAssembly Target

**Status:** Scaffold only. Compilation blocked upstream.

## Blocker

`getrandom` refuses to compile on `wasm32-unknown-unknown` without its
`js` feature, which pulls in `wasm-bindgen` — violating our sovereignty
rule (no runtime deps on JS glue crates).

## Planned fix (v4.0-γ)

Register a custom CSPRNG shim: the host (browser / Deno / wasmtime) passes
randomness in via an imported function `qv_host_random(ptr, len)`. We then:

1. Add `getrandom = { version = "0.2", features = ["custom"] }` to qv-core.
2. In `qv-wasm/src/lib.rs` implement
   `getrandom::register_custom_getrandom!(shim)` where `shim` calls
   `extern "C" { fn qv_host_random(ptr: *mut u8, len: u32); }`.
3. JS/Python/Go hosts wire that import to `crypto.getRandomValues`
   (browser) or `crypto.randomFillSync` (Node) or `os.urandom` (Python).

Long-term (v4.0-RC, vendored ML-DSA) the rand dep disappears entirely
and `wasm32-unknown-unknown` compiles cleanly.

## In the meantime

Every sovereign goal is met by `qv-ffi` (C ABI DLL/SO/DYLIB) — covers
every language that matters (Python, C, C#, Go, Java, Swift, Ruby, .NET,
Erlang, Julia, R, MATLAB) via FFI with zero HTTP, zero runtime.

The WASM path is a nice-to-have for browsers and edge workers, not a
blocker for shipping.
