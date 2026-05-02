/**
 * @sigvault/wasm — type declarations.
 */

export interface QVExports {
  memory: WebAssembly.Memory;

  // Raw low-level entry points exported by qv_wasm. These call into
  // qv-core via the host shim. Pointer/length pairs refer to linear memory.
  // Refer to qv-wasm/src/lib.rs for the authoritative signatures — this
  // file only ships the loader types.
  [symbol: string]: any;
}

export type QVSource =
  | string
  | URL
  | Uint8Array
  | ArrayBuffer
  | Response
  | undefined;

/** Instantiate from bytes, a URL, a fetch Response, or `undefined` (auto-resolve). */
export function loadQV(source?: QVSource): Promise<QVExports>;

/** Instantiate from a pre-compiled WebAssembly.Module (Cloudflare Workers path). */
export function loadQVFromModule(mod: WebAssembly.Module): Promise<QVExports>;

export default loadQV;
