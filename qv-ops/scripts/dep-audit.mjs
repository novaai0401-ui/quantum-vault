#!/usr/bin/env node
// dep-audit.mjs — enforces Sigvault's dependency policy in CI.
//
// Why this exists
// ----------------
// In 2024 a single malicious commit (XZ-utils CVE-2024-3094) almost
// compromised every Linux distribution that depended on liblzma. In 2018
// the maintainer-handover hijack of `event-stream` quietly stole bitcoin
// from npm Bitcoin wallets. Axios has had multiple prototype-pollution
// CVEs. left-pad bricked the entire JS ecosystem in 2016. Each of these
// happened because *somebody* added a transitive dep without looking.
//
// This script is the gate. It enforces:
//
//   1. qv-server has ZERO npm runtime deps. ZERO. None.
//      (No package-lock.json should exist; if one exists with non-empty
//      "packages", the run fails.)
//
//   2. qv-sdk's runtime deps are an exact allowlist (the Noble suite):
//        - @noble/ciphers
//        - @noble/hashes
//        - @noble/post-quantum
//      Any addition fails the run.
//
//   3. qv-wasm/pkg has ZERO runtime deps (the wasm bundle is self-contained).
//
//   4. qv-python pulls nothing at runtime — pyproject.toml's
//      [project].dependencies must be empty or absent.
//
//   5. Language adapters (qv-sdk/{go,java,php,csharp,ruby}/) must NOT
//      contain a vendored manifest (go.mod, pom.xml, requirements.txt,
//      composer.json, Gemfile, *.csproj with non-stdlib refs). They are
//      single-file stdlib-only adapters.
//
// Exit code 0 = clean, 1 = violation. CI runs this on every push.
//
// Zero deps. Node stdlib only.

import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

const NOBLE_ALLOWLIST = new Set([
  '@noble/ciphers',
  '@noble/hashes',
  '@noble/post-quantum',
]);

const violations = [];

function violate(msg) { violations.push(msg); }

function readJSON(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch { return null; }
}

/* ── 1. qv-server: zero deps ─────────────────────────────────────────── */

(() => {
  const pkgPath = join(REPO, 'qv-server', 'package.json');
  const pkg = readJSON(pkgPath);
  if (!pkg) { violate('qv-server/package.json missing or unreadable'); return; }
  const deps = pkg.dependencies || {};
  if (Object.keys(deps).length !== 0) {
    violate(`qv-server has ${Object.keys(deps).length} runtime deps; must be zero. Found: ${JSON.stringify(deps)}`);
  }
  // package-lock.json is allowed to exist but must reflect zero deps in "packages".
  const lockPath = join(REPO, 'qv-server', 'package-lock.json');
  if (existsSync(lockPath)) {
    const lock = readJSON(lockPath);
    if (!lock) { violate('qv-server/package-lock.json is malformed'); return; }
    const pkgs = lock.packages || {};
    const nonRoot = Object.keys(pkgs).filter(k => k !== '');
    if (nonRoot.length > 0) {
      violate(`qv-server/package-lock.json declares ${nonRoot.length} packages; must be zero (root entry only). Found: ${nonRoot.slice(0,5).join(', ')}`);
    }
  }
})();

/* ── 2. qv-sdk: Noble allowlist only ─────────────────────────────────── */

(() => {
  const pkg = readJSON(join(REPO, 'qv-sdk', 'package.json'));
  if (!pkg) { violate('qv-sdk/package.json missing'); return; }
  const deps = pkg.dependencies || {};
  for (const name of Object.keys(deps)) {
    if (!NOBLE_ALLOWLIST.has(name)) {
      violate(`qv-sdk dependency "${name}" not on Noble allowlist`);
    }
  }
  // devDeps allowed to exist (test runners etc) but flag anything weird.
  const dev = pkg.devDependencies || {};
  for (const name of Object.keys(dev)) {
    if (!NOBLE_ALLOWLIST.has(name) && !name.startsWith('@types/')) {
      // Fail-soft: warn but don't fail. Update if you find dev deps you trust.
      violate(`qv-sdk devDependency "${name}" — add to allowlist if intentional`);
    }
  }
})();

/* ── 3. qv-wasm/pkg: zero deps ───────────────────────────────────────── */

(() => {
  const pkg = readJSON(join(REPO, 'qv-wasm', 'pkg', 'package.json'));
  if (!pkg) return; // ok if not built yet
  const deps = pkg.dependencies || {};
  if (Object.keys(deps).length !== 0) {
    violate(`qv-wasm/pkg has runtime deps: ${JSON.stringify(deps)}`);
  }
})();

/* ── 4. qv-python: stdlib-only at runtime ────────────────────────────── */

(() => {
  const tomlPath = join(REPO, 'qv-python', 'pyproject.toml');
  if (!existsSync(tomlPath)) return;
  const toml = readFileSync(tomlPath, 'utf8');
  // Crude TOML parsing — we don't ship a TOML lib (zero-dep). Look for the
  // deps array in [project].
  const m = toml.match(/\[project\][\s\S]*?(?=^\[|\Z)/m);
  if (!m) return;
  const block = m[0];
  const depsMatch = block.match(/^\s*dependencies\s*=\s*\[([\s\S]*?)\]/m);
  if (depsMatch) {
    const inner = depsMatch[1].trim();
    if (inner && inner !== '') {
      violate(`qv-python pyproject.toml [project].dependencies is non-empty: ${inner.slice(0, 200)}`);
    }
  }
  // requirements.txt must not exist as a runtime declaration.
  if (existsSync(join(REPO, 'qv-python', 'requirements.txt'))) {
    violate('qv-python/requirements.txt exists; runtime should be stdlib-only');
  }
})();

/* ── 5. Language adapters: no vendored manifests ─────────────────────── */

const FORBIDDEN_MANIFESTS = [
  'go.mod', 'go.sum',
  'pom.xml', 'build.gradle', 'build.gradle.kts',
  'requirements.txt', 'Pipfile',
  'composer.json', 'composer.lock',
  'Gemfile', 'Gemfile.lock',
];

const ADAPTER_DIRS = ['go','java','php','csharp','ruby','python'];

for (const sub of ADAPTER_DIRS) {
  const full = join(REPO, 'qv-sdk', sub);
  if (!existsSync(full)) continue;
  for (const ent of readdirSync(full)) {
    if (FORBIDDEN_MANIFESTS.includes(ent)) {
      violate(`qv-sdk/${sub}/${ent} present — adapters must be stdlib-only single-file`);
    }
    if (ent.endsWith('.csproj')) {
      const txt = readFileSync(join(full, ent), 'utf8');
      // PackageReference outside System.* / Microsoft.* is a third-party dep.
      const refs = [...txt.matchAll(/PackageReference\s+Include="([^"]+)"/g)].map(m => m[1]);
      const bad = refs.filter(r => !/^(System|Microsoft)\./.test(r));
      if (bad.length > 0) {
        violate(`qv-sdk/${sub}/${ent} pulls non-stdlib NuGet packages: ${bad.join(', ')}`);
      }
    }
  }
}

/* ── Report ──────────────────────────────────────────────────────────── */

if (violations.length === 0) {
  console.log('dep-audit: PASS');
  console.log('  qv-server:        zero npm deps');
  console.log('  qv-sdk:           Noble allowlist only');
  console.log('  qv-wasm/pkg:      zero npm deps');
  console.log('  qv-python:        stdlib only');
  console.log('  language adapters: stdlib only, no vendored manifests');
  process.exit(0);
}
console.error('dep-audit: FAIL — ' + violations.length + ' violation(s):');
for (const v of violations) console.error('  - ' + v);
process.exit(1);
