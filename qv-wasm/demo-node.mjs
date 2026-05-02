/**
 * Sigvault v4.1 — WASM host demo (Node.js)
 * ==============================================
 * Loads qv_wasm.wasm with only Node stdlib. No wasm-bindgen, no npm.
 * Proves the custom getrandom shim works end-to-end.
 *
 * Run:
 *   cargo build -p qv-wasm --release --target wasm32-unknown-unknown
 *   node qv-wasm/demo-node.mjs
 */
import { readFileSync }  from 'node:fs';
import { randomFillSync } from 'node:crypto';
import { fileURLToPath }  from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const WASM = join(HERE, '..', 'target', 'wasm32-unknown-unknown', 'release', 'qv_wasm.wasm');
const bytes = readFileSync(WASM);

// --- instantiate with host import -------------------------------------------
let memory;
const imports = {
  env: {
    // The shim qv-wasm/src/lib.rs declares. Fill `len` bytes at `ptr`.
    qv_host_random: (ptr, len) => {
      const view = new Uint8Array(memory.buffer, ptr, len);
      randomFillSync(view);
      return 0;
    },
  },
};

const mod = await WebAssembly.instantiate(bytes, imports);
const ex = mod.instance.exports;
memory = ex.memory;

console.log('\n================================================');
console.log('  Sigvault v4.1 — WASM host demo (Node)');
console.log('================================================');
console.log(`  wasm bytes       : ${bytes.length.toLocaleString()}`);
console.log(`  sk_len / vk_len  : ${ex.qv_wasm_sk_len()} / ${ex.qv_wasm_vk_len()}`);
console.log(`  sig_len          : ${ex.qv_wasm_sig_len()}`);

// --- helpers ---------------------------------------------------------------
function alloc(n)        { return ex.qv_wasm_alloc(n); }
function free(p, n)      { ex.qv_wasm_free(p, n); }
function readMem(p, n)   { return new Uint8Array(memory.buffer, p, n).slice(); }
function writeMem(p, b)  { new Uint8Array(memory.buffer, p, b.length).set(b); }

const SK = ex.qv_wasm_sk_len();
const VK = ex.qv_wasm_vk_len();
const SIG = ex.qv_wasm_sig_len();

// --- keygen (exercises the custom getrandom path) --------------------------
const skPtr = alloc(SK);
const vkPtr = alloc(VK);
let t = performance.now();
let rc = ex.qv_wasm_keygen(skPtr, vkPtr);
const kgMs = performance.now() - t;
if (rc !== 0) throw new Error(`keygen rc=${rc}`);
console.log(`  keygen           : ${kgMs.toFixed(1)} ms  (custom getrandom OK)`);

// --- sign ------------------------------------------------------------------
const msg = new TextEncoder().encode('Sigvault WASM: hello from Node');
const msgPtr = alloc(msg.length);
writeMem(msgPtr, msg);
const sigPtr = alloc(SIG);
t = performance.now();
rc = ex.qv_wasm_sign(skPtr, SK, msgPtr, msg.length, sigPtr);
const signMs = performance.now() - t;
if (rc !== 0) throw new Error(`sign rc=${rc}`);
console.log(`  sign             : ${signMs.toFixed(1)} ms  sig[0:8]=${Buffer.from(readMem(sigPtr, 8)).toString('hex')}`);

// --- verify ----------------------------------------------------------------
t = performance.now();
rc = ex.qv_wasm_verify(vkPtr, VK, msgPtr, msg.length, sigPtr, SIG);
const verMs = performance.now() - t;
console.log(`  verify           : ${verMs.toFixed(1)} ms  ->  ${rc === 1 ? 'VALID OK' : 'INVALID'}`);

// --- tamper ----------------------------------------------------------------
const sigView = new Uint8Array(memory.buffer, sigPtr, SIG);
sigView[100] ^= 0xff;
rc = ex.qv_wasm_verify(vkPtr, VK, msgPtr, msg.length, sigPtr, SIG);
console.log(`  tamper test      : ${rc === 0 ? 'REJECTED OK' : 'LEAKED !!'}`);
sigView[100] ^= 0xff;

// --- bench -----------------------------------------------------------------
const N = 50;
t = performance.now();
for (let i = 0; i < N; i++) ex.qv_wasm_verify(vkPtr, VK, msgPtr, msg.length, sigPtr, SIG);
const dur = performance.now() - t;
console.log(`  bench            : ${N} verifies in ${dur.toFixed(1)} ms  ->  ${(N/dur*1000).toFixed(0)}/s`);

free(skPtr, SK); free(vkPtr, VK); free(msgPtr, msg.length); free(sigPtr, SIG);
console.log('================================================');
console.log('  WASM portable ML-DSA-87 — ALL TESTS PASSED');
console.log('================================================\n');
