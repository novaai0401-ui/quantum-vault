// Run the qv-spec/test-vectors harness as a CI-gated test. Any vector
// failure means the server's behaviour drifted from the published
// conformance contract.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO      = resolve(__dirname, '..', '..');
const HARNESS   = join(REPO, 'qv-spec', 'test-vectors', 'harness.mjs');

test('qv-spec test-vectors harness passes all vectors', () => {
  if (!existsSync(HARNESS)) assert.fail(`harness missing at ${HARNESS}`);
  const r = spawnSync(process.execPath, [HARNESS], {
    cwd: REPO,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const out = r.stdout.toString() + r.stderr.toString();
  assert.equal(r.status, 0, `harness exited ${r.status}\n${out}`);
  assert.match(out, /\d+ pass, 0 fail/);
});
