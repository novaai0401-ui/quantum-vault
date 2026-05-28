/**
 * @sigvault/wasm — portable WebAssembly loader.
 *
 * Works in:
 *   - Node 18+            (uses node:crypto + node:fs)
 *   - Browsers             (uses crypto.getRandomValues + fetch)
 *   - Deno / Bun          (same as browser path)
 *   - Cloudflare Workers  (import the .wasm module directly — see below)
 *
 * ── Node / Deno / Bun ────────────────────────────────────────────────────
 *   import { loadQV } from '@sigvault/wasm';
 *   const qv = await loadQV();
 *   const { vkPtr, vkLen } = qv.keygen();
 *
 * ── Browser ──────────────────────────────────────────────────────────────
 *   import { loadQV } from '@sigvault/wasm';
 *   const qv = await loadQV(new URL('./qv_wasm.wasm', import.meta.url));
 *
 * ── Cloudflare Workers ───────────────────────────────────────────────────
 *   import qvWasm from '@sigvault/wasm/qv_wasm.wasm';
 *   import { loadQVFromModule } from '@sigvault/wasm';
 *   const qv = await loadQVFromModule(qvWasm);
 */

const IS_NODE =
  typeof process !== 'undefined' &&
  process.versions != null &&
  process.versions.node != null;

// ─── Random source ───────────────────────────────────────────────────────
//
// `qv_host_random` is called by the wasm SYNCHRONOUSLY (its caller, e.g.
// keygen, is a sync wasm export). We therefore cannot `await import` inside
// the callback — we have to resolve the random source eagerly here at module
// load. Top-level await is fine in ESM (Node 14+, all evergreen browsers).
//
// On Node we use crypto.randomFillSync; on every other runtime we use
// the WebCrypto getRandomValues. Both are synchronous and reentrant.
let _randomFill;
if (IS_NODE) {
  const { randomFillSync } = await import('node:crypto');
  _randomFill = (u8) => randomFillSync(u8);
} else {
  if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function') {
    throw new Error(
      '@sigvault/wasm: no CSPRNG available — this runtime ships neither ' +
      'WebCrypto.getRandomValues nor node:crypto. Cannot load.',
    );
  }
  _randomFill = (u8) => crypto.getRandomValues(u8);
}

/**
 * Build the host import object the wasm module links against.
 *
 * `memoryRef.memory` is read **lazily** on every `qv_host_random` invocation,
 * not captured at construction. This lets us wire imports BEFORE the wasm is
 * instantiated and have them resolve correctly afterwards — the host imports
 * point at a closure that reads through the (mutable) `memoryRef`.
 *
 * `instance.exports.memory.buffer` may change identity if the wasm grows its
 * memory; reading through `memoryRef.memory.buffer` each call handles that
 * case naturally.
 */
function makeHostImports(memoryRef) {
  return {
    env: {
      qv_host_random: (ptr, len) => {
        try {
          const mem = new Uint8Array(memoryRef.memory.buffer, ptr, len);
          _randomFill(mem);
          return 0;
        } catch {
          return 1;
        }
      },
    },
  };
}

/**
 * Instantiate from a WebAssembly.Module (already-compiled).
 * Preferred path in Workers / edge environments where .wasm is pre-bundled.
 *
 * `WebAssembly.instantiate(moduleObject, imports)` returns the Instance
 * directly (NOT a `{module, instance}` pair — that pair is only returned
 * by the `(bufferSource, imports)` overload).
 */
export async function loadQVFromModule(mod) {
  const memoryRef = { memory: null };
  const instance  = await WebAssembly.instantiate(mod, makeHostImports(memoryRef));
  memoryRef.memory = instance.exports.memory;
  return instance.exports;
}

/**
 * Instantiate from bytes, a URL, a fetch Response, or no argument
 * (in which case we resolve ./qv_wasm.wasm next to this module).
 *
 * Single-pass instantiation. The bug in v4.3.8 was a two-pass scheme that
 * tried to discover the memory via a throwaway first instantiation, then
 * destructured the second pass's return as `{ instance: finalInstance }`
 * — but `WebAssembly.instantiate(module, imports)` returns the Instance
 * directly, so the destructure produced `undefined`. The host imports
 * already read memory lazily through `memoryRef`, so a single instantiate
 * is the correct shape; we just assign the memory ref immediately after.
 */
export async function loadQV(source) {
  const bytes = await resolveBytes(source);
  const memoryRef = { memory: null };
  const { instance } = await WebAssembly.instantiate(bytes, makeHostImports(memoryRef));
  memoryRef.memory = instance.exports.memory;
  return instance.exports;
}

async function resolveBytes(source) {
  if (source instanceof Uint8Array)   return source;
  if (source instanceof ArrayBuffer)  return new Uint8Array(source);
  if (source instanceof Response)     return new Uint8Array(await source.arrayBuffer());

  if (typeof source === 'string' || source instanceof URL) {
    if (IS_NODE) {
      const { readFile }      = await import('node:fs/promises');
      const { fileURLToPath } = await import('node:url');
      const path = source instanceof URL ? fileURLToPath(source) : source;
      return new Uint8Array(await readFile(path));
    }
    const res = await fetch(source);
    if (!res.ok) throw new Error(`failed to fetch ${source}: ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  // Default: resolve ./qv_wasm.wasm relative to this module.
  if (IS_NODE) {
    const { readFile }      = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const here = dirname(fileURLToPath(import.meta.url));
    return new Uint8Array(await readFile(join(here, 'qv_wasm.wasm')));
  }
  const url = new URL('./qv_wasm.wasm', import.meta.url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`failed to fetch ${url}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

export default loadQV;
