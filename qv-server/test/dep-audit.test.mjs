// Run the repo-wide dep-audit script as a unit test. This is the
// load-bearing test for the zero-dependency claim across every language
// in the project. If anyone ever lands a runtime dep we don't allow,
// CI fails here.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO      = resolve(__dirname, '..', '..');
const AUDIT     = join(REPO, 'qv-ops', 'scripts', 'dep-audit.mjs');

test('dep-audit reports zero violations across all components', () => {
  if (!existsSync(AUDIT)) assert.fail(`dep-audit script missing at ${AUDIT}`);
  const r = spawnSync(process.execPath, [AUDIT], { cwd: REPO });
  const out = r.stdout.toString() + r.stderr.toString();
  assert.equal(r.status, 0, `dep-audit failed with exit ${r.status}\n${out}`);
  assert.match(out, /dep-audit: PASS/);
});
