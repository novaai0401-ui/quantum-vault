/**
 * @sigvault/wasm — portable WebAssembly loader.
 *
 * Works in:
 *   - Node 18+            (uses node:fs + node:crypto)
 *   - Browsers             (uses fetch + crypto.getRandomValues)
 *   - Deno / Bun          (same as browser path)
 *   - Cloudflare Workers  (import the .wasm module directly — see below)
 *
 * ── Node / Deno / Bun ────────────────────────────────────────────────────
 *   import { loadQV } from '@sigvault/wasm';
 *   const qv = await loadQV();
 *   const { vkPtr, vkLen } = qv.keygen();
 *   ...
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

/**
 * CSPRNG the wasm module calls into (`qv_host_random`).
 * Returns 0 on success, non-zero on error.
 */
function makeHostImports(memoryRef) {
  return {
    env: {
      qv_host_random: (ptr, len) => {
        try {
          const mem = new Uint8Array(memoryRef.memory.buffer, ptr, len);
          if (IS_NODE) {
            // Lazy import so browsers don't choke on `node:crypto`.
            // eslint-disable-next-line no-undef
            const { randomFillSync } = require('node:crypto');
            randomFillSync(mem);
          } else {
            crypto.getRandomValues(mem);
          }
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
 */
export async function loadQVFromModule(mod) {
  const memoryRef = {};
  const instance = await WebAssembly.instantiate(mod, makeHostImports(memoryRef));
  memoryRef.memory = instance.exports.memory;
  return instance.exports;
}

/**
 * Instantiate from bytes, a URL, a fetch Response, or no argument
 * (in which case we resolve ./qv_wasm.wasm next to this module).
 */
export async function loadQV(source) {
  const bytes = await resolveBytes(source);
  const { module, instance } = await WebAssembly.instantiate(
    bytes,
    makeHostImports({ memory: null })
  );
  // Inject memory reference post-instantiation so host imports can read it.
  const importsFinal = makeHostImports({ memory: instance.exports.memory });
  // Re-instantiate with correct memory wiring (first pass was to discover it).
  const { instance: finalInstance } = await WebAssembly.instantiate(module, importsFinal);
  return finalInstance.exports;
}

async function resolveBytes(source) {
  if (source instanceof Uint8Array) return source;
  if (source instanceof ArrayBuffer) return new Uint8Array(source);
  if (source instanceof Response)     return new Uint8Array(await source.arrayBuffer());

  if (typeof source === 'string' || source instanceof URL) {
    if (IS_NODE) {
      // eslint-disable-next-line no-undef
      const { readFile } = await import('node:fs/promises');
      // eslint-disable-next-line no-undef
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
    // eslint-disable-next-line no-undef
    const { readFile }        = await import('node:fs/promises');
    // eslint-disable-next-line no-undef
    const { fileURLToPath }   = await import('node:url');
    // eslint-disable-next-line no-undef
    const { dirname, join }   = await import('node:path');
    const here = dirname(fileURLToPath(import.meta.url));
    return new Uint8Array(await readFile(join(here, 'qv_wasm.wasm')));
  }
  const url = new URL('./qv_wasm.wasm', import.meta.url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`failed to fetch ${url}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

export default loadQV;
