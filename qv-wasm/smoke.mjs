// Quick smoke test for the @sigvault/wasm loader. Not bundled in the
// published package — for local verification only.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadQV, loadQVFromModule } from './pkg/index.mjs';

const HERE  = dirname(fileURLToPath(import.meta.url));
const BYTES = readFileSync(join(HERE, 'pkg', 'qv_wasm.wasm'));

console.log('1. loadQV() default path');
const qv1 = await loadQV();
console.log('   exports:', Object.keys(qv1).length, 'symbols');

console.log('2. loadQV(Uint8Array)');
const qv2 = await loadQV(new Uint8Array(BYTES));
console.log('   exports:', Object.keys(qv2).length, 'symbols');

console.log('3. loadQVFromModule(WebAssembly.Module)');
const mod = await WebAssembly.compile(new Uint8Array(BYTES));
const qv3 = await loadQVFromModule(mod);
console.log('   exports:', Object.keys(qv3).length, 'symbols');

console.log('\nAll three loader paths work.');

// Bonus: exercise the random shim by calling keygen, which transitively
// invokes qv_host_random. If that returns non-zero (random failure) the
// wasm aborts and the call throws.
console.log('\n4. exercising qv_host_random via qv_wasm_keygen');
const out  = qv1.qv_wasm_keygen();
console.log('   keygen returned:', typeof out, '(non-zero return code = success layout)');
