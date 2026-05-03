// CI gate: the published spec (qv-spec/openapi.yaml + error-codes.md)
// must stay in lock-step with the implementation. A drift here means
// somebody added or removed a route or an error code without updating
// the contract — exactly the class of bug the spec exists to prevent.
//
// Run the gate yourself:
//   node qv-ops/scripts/openapi-sync.mjs --verbose

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO      = resolve(__dirname, '..', '..');
const SCRIPT    = join(REPO, 'qv-ops', 'scripts', 'openapi-sync.mjs');

test('openapi-sync gate passes — spec ↔ server in lock-step', () => {
  const r = spawnSync(process.execPath, [SCRIPT], {
    cwd: REPO,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const out = r.stdout.toString() + r.stderr.toString();
  assert.equal(r.status, 0, `openapi-sync FAILED:\n${out}`);
  assert.match(out, /openapi-sync: PASS/);
});
