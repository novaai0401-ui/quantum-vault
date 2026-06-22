#!/usr/bin/env node
// One-shot stale-link sweep: 007krcs → novaai0401-ui across docs/configs.
// Idempotent. Preserves CODEOWNERS @007krcs (still a valid GH user),
// AUTHORS.md (historical credit), and package-lock.json (3rd-party deps).

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const SKIP_FILES = new Set([
  'CODEOWNERS',
  'AUTHORS.md',
  'package-lock.json',
  'Cargo.lock',
  'fix-stale-007krcs.mjs',
]);
const SKIP_DIRS = new Set(['node_modules', 'target', '.git', 'dist', '.next']);

const RULES = [
  [/ghcr\.io\/007krcs\/qv-server/g,                  'ghcr.io/novaai0401-ui/qv-server'],
  [/ghcr\.io\/007krcs\/charts/g,                     'ghcr.io/novaai0401-ui/charts'],
  [/github\.com\/007krcs\/quantum-vault/g,           'github.com/novaai0401-ui/quantum-vault'],
  [/githubusercontent\.com\/007krcs\/quantum-vault/g,'githubusercontent.com/novaai0401-ui/quantum-vault'],
  [/^(\s*vendor:\s*)['"]007krcs['"]/gm,              "$1'Sigvault'"],
  [/(image\.vendor=")007krcs(")/g,                   '$1Sigvault$2'],
  [/(- name:\s*)007krcs/g,                           '$1novaai0401-ui'],
];

let scanned = 0, edited = 0;
const editedFiles = [];

function walk(dir) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name)) continue;
      walk(full);
      continue;
    }
    if (SKIP_FILES.has(ent.name)) continue;
    if (!/\.(md|mjs|js|ts|tsx|toml|yaml|yml|json|py|rs|sh|Dockerfile|html)$|^Dockerfile/.test(ent.name)) continue;
    scanned++;
    const before = readFileSync(full, 'utf8');
    let after = before;
    for (const [re, repl] of RULES) after = after.replace(re, repl);
    if (after !== before) {
      writeFileSync(full, after);
      edited++;
      editedFiles.push(full.slice(ROOT.length + 1));
    }
  }
}

walk(ROOT);
console.log(`scanned ${scanned} files, edited ${edited}`);
for (const f of editedFiles) console.log('  ', f);
