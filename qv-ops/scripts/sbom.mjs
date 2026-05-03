#!/usr/bin/env node
// sbom.mjs — Generate a CycloneDX 1.5 SBOM for qv-server.
//
// Why this exists: qv-server is the rare zero-dependency Node app.
// "Zero deps" should be auditable, not just claimed. This script
// produces a CycloneDX JSON that any SCA tool (Trivy, Grype,
// Dependency-Track) can ingest, with hashes for every shipped file
// and an empty `dependencies` array — proving the claim.
//
// Run from the repo root:
//   node qv-ops/scripts/sbom.mjs > sbom.cdx.json

import { readFileSync, statSync, readdirSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE       = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT  = resolve(HERE, '..', '..');
const SERVER_DIR = join(REPO_ROOT, 'qv-server');

// Files that ship in the runtime image. Mirrors the Dockerfile's COPY list.
const SHIPPED = [
  'server-sovereign.mjs',
  'auth.mjs',
  'audit.mjs',
  'ratelimit.mjs',
  'security.mjs',
  'shutdown.mjs',
  'metrics.mjs',
  'claims.mjs',
  'cidr.mjs',
  'trace.mjs',
  'durable.mjs',
  'chain-log.mjs',
  'master-key.mjs',
  'writer-lock.mjs',
  'verify-pool.mjs',
  'verify-worker.mjs',
];

function sha256(buf)  { return createHash('sha256').update(buf).digest('hex'); }
function sha512(buf)  { return createHash('sha512').update(buf).digest('hex'); }

function pkg() {
  return JSON.parse(readFileSync(join(SERVER_DIR, 'package.json'), 'utf8'));
}

function fileComponent(rel) {
  const abs = join(SERVER_DIR, rel);
  const buf = readFileSync(abs);
  const st  = statSync(abs);
  return {
    type:    'file',
    'bom-ref': `file:${rel}`,
    name:    rel,
    version: 'tracked-via-git',
    hashes: [
      { alg: 'SHA-256', content: sha256(buf) },
      { alg: 'SHA-512', content: sha512(buf) },
    ],
    properties: [
      { name: 'qv:bytes',      value: String(st.size) },
      { name: 'qv:mtime',      value: st.mtime.toISOString() },
    ],
  };
}

function rootComponent(p) {
  return {
    type:    'application',
    'bom-ref': `pkg:generic/${p.name}@${p.version}`,
    name:    p.name,
    version: p.version,
    description: p.description,
    licenses: [{ license: { id: p.license || 'BUSL-1.1' } }],
    purl:    `pkg:generic/${p.name}@${p.version}`,
  };
}

function sbom() {
  const p = pkg();
  return {
    bomFormat:   'CycloneDX',
    specVersion: '1.5',
    serialNumber: `urn:uuid:${randomUUID()}`,
    version:     1,
    metadata: {
      timestamp: new Date().toISOString(),
      tools: [{
        vendor:  '007krcs',
        name:    'qv-ops/scripts/sbom.mjs',
        version: '1.0.0',
      }],
      component: rootComponent(p),
      properties: [
        { name: 'qv:zero-dependency', value: 'true' },
        { name: 'qv:runtime',         value: `node>=${(p.engines && p.engines.node) || '18'}` },
      ],
    },
    components: SHIPPED.map(fileComponent),
    // The single most important field of this SBOM: it's empty.
    // qv-server has no third-party runtime deps to declare.
    dependencies: [{
      ref: `pkg:generic/${p.name}@${p.version}`,
      dependsOn: [],
    }],
  };
}

process.stdout.write(JSON.stringify(sbom(), null, 2) + '\n');
