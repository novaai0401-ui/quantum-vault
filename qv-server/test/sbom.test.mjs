import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO      = resolve(__dirname, '..', '..');
const SCRIPT    = join(REPO, 'qv-ops', 'scripts', 'sbom.mjs');

test('sbom generator emits valid CycloneDX 1.5 with zero deps', () => {
  if (!existsSync(SCRIPT)) {
    assert.fail(`SBOM script missing at ${SCRIPT}`);
  }
  const r = spawnSync(process.execPath, [SCRIPT], {
    cwd: REPO,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.equal(r.status, 0, `sbom.mjs exited ${r.status}: ${r.stderr.toString()}`);
  const sbom = JSON.parse(r.stdout.toString());

  assert.equal(sbom.bomFormat, 'CycloneDX');
  assert.equal(sbom.specVersion, '1.5');
  assert.match(sbom.serialNumber, /^urn:uuid:/);
  assert.ok(Array.isArray(sbom.components) && sbom.components.length >= 14,
            `expected ≥14 file components, got ${sbom.components.length}`);

  // The load-bearing assertion: zero third-party deps.
  assert.ok(Array.isArray(sbom.dependencies) && sbom.dependencies.length === 1);
  assert.deepEqual(sbom.dependencies[0].dependsOn, []);

  // Every shipped file has SHA-256 + SHA-512 hashes.
  for (const c of sbom.components) {
    const algs = (c.hashes || []).map(h => h.alg);
    assert.ok(algs.includes('SHA-256'), `${c.name} missing SHA-256`);
    assert.ok(algs.includes('SHA-512'), `${c.name} missing SHA-512`);
  }

  // Zero-dep claim is also asserted as a property.
  const props = sbom.metadata.properties || [];
  assert.ok(props.some(p => p.name === 'qv:zero-dependency' && p.value === 'true'),
            'qv:zero-dependency=true property missing');
});
