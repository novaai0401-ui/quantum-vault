# @quantumvault/wasm

Portable WebAssembly build of QuantumVault. ~127 KB of `.wasm`, one host import
(`qv_host_random` — wired automatically by the loader). Runs in browsers,
Node 18+, Deno, Bun, and Cloudflare Workers.

```bash
npm install @quantumvault/wasm
```

## Node / Deno / Bun

```js
import { loadQV } from '@quantumvault/wasm';
const qv = await loadQV();
// qv.* exposes the raw qv-core entry points — see repo for high-level wrappers.
```

## Browser

```js
import { loadQV } from '@quantumvault/wasm';
const qv = await loadQV(new URL('./qv_wasm.wasm', import.meta.url));
```

## Cloudflare Workers

```js
import qvWasm from '@quantumvault/wasm/qv_wasm.wasm';
import { loadQVFromModule } from '@quantumvault/wasm';

const qv = await loadQVFromModule(qvWasm);
```

## Size

| Artifact | Bytes | gzip |
|---|---:|---:|
| `qv_wasm.wasm` | 127 KB | ~48 KB |
| Loader (`index.mjs`) | 3 KB | ~1 KB |

## License

Apache-2.0.
