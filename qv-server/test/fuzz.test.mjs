// Fuzz smoke test — runs the fuzz harness for 10 000 iterations on every
// CI run. Failures here mean a security parser regressed: it threw an
// unstructured error, returned a partial result, or exceeded a time cap.
//
// For a deeper run, set QV_FUZZ_ITERS in the environment when running
// `node fuzz.mjs` directly. Nightly should run 1 000 000.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FUZZ      = join(__dirname, '..', 'fuzz.mjs');

test('fuzz smoke — 10k iterations across all parsers', () => {
  const r = spawnSync(process.execPath, [FUZZ], {
    cwd: resolve(__dirname, '..'),
    env: { ...process.env, QV_FUZZ_ITERS: '10000', QV_FUZZ_SEED: '42' },
  });
  const out = r.stdout.toString() + r.stderr.toString();
  assert.equal(r.status, 0, `fuzz exited ${r.status}\n${out}`);
  assert.match(out, /fuzz: 10000 iterations/);
});
