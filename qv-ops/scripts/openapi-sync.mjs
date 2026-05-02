#!/usr/bin/env node
// openapi-sync.mjs — CI gate that fails if the implementation drifts from
// the published spec (qv-spec/openapi.yaml + qv-spec/error-codes.md).
//
// Three checks:
//
// 1. Routes declared in server-sovereign.mjs (`route('METHOD', '<path>', …)`)
//    must appear under `paths:` in openapi.yaml with the right method,
//    and vice-versa. Path placeholders are normalised:
//        Express  /keys/:id     ↔  OpenAPI  /keys/{id}
//        regex    /^\/v3\/keys\/([^/]+)$/  ↔  /v3/keys/{id}
//
// 2. Error codes returned anywhere in qv-server (`err(res, NNN, 'CODE'`)
//    must be declared in qv-spec/error-codes.md so callers can branch
//    on stable strings.
//
// 3. (Soft warning, not hard-fail) Routes are listed in `tags` and the
//    operator's runbook references them. We don't gate on this yet.
//
// Zero deps. We do NOT parse YAML — instead extract `paths:` entries with
// regex tight enough that drift in YAML structure surfaces immediately.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, join }  from 'node:path';
import { fileURLToPath }           from 'node:url';

const REPO    = resolve(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const SERVER  = join(REPO, 'qv-server', 'server-sovereign.mjs');
const OPENAPI = join(REPO, 'qv-spec',   'openapi.yaml');
const ERRDOC  = join(REPO, 'qv-spec',   'error-codes.md');

const violations = [];
const warnings   = [];
const verbose    = process.argv.includes('--verbose');

function fatal(msg) { violations.push(msg); }
function warn(msg)  { warnings.push(msg); }

/* ── Server side: routes + error codes ────────────────────────────── */

function normaliseExpressPath(p) {
  // /keys/:id  →  /keys/{id}
  return p.replace(/:([A-Za-z][A-Za-z0-9_]*)/g, '{$1}');
}

function normaliseRegexLiteral(re) {
  // /^\/v3\/keys\/([^/]+)$/  →  /v3/keys/{keyId}
  // /^\/v3\/keys\/([^/]+)\/vk\.bin$/  →  /v3/keys/{keyId}/vk.bin
  let s = re.replace(/^\/\^/, '').replace(/\$\/$/, '');
  s = s.replace(/\\\//g, '/');         // unescape /
  s = s.replace(/\\\./g, '.');         // unescape .
  // Replace capture groups with the OpenAPI canonical name {keyId}. We
  // pick {keyId} unconditionally because every regex route in this
  // codebase parametrises a key identifier.
  s = s.replace(/\(\[\^\/\]\+\)/g, '{keyId}');
  return s;
}

function canonicalisePathParams(p) {
  // Both server and spec may use {id} vs {keyId} historically. Canonical
  // is {keyId} for every parameter that names a key. We don't have other
  // path params yet, so the rule is: any {…} → {keyId}.
  return p.replace(/\{[A-Za-z_][A-Za-z0-9_]*\}/g, '{keyId}');
}

function extractServerRoutes(src) {
  const routes = new Map(); // pathOpenApi → Set(METHOD)
  const reString = /route\(\s*'([A-Z]+)'\s*,\s*'([^']+)'/g;
  const reRegex  = /route\(\s*'([A-Z]+)'\s*,\s*(\/[^,]+\/)/g;
  function add(oapi, method) {
    const canon = canonicalisePathParams(oapi);
    if (!routes.has(canon)) routes.set(canon, new Set());
    routes.get(canon).add(method);
  }
  for (const m of src.matchAll(reString)) add(normaliseExpressPath(m[2]), m[1]);
  for (const m of src.matchAll(reRegex))  add(normaliseRegexLiteral(m[2]), m[1]);
  return routes;
}

function extractServerErrorCodes(src) {
  const codes = new Set();
  // err(res, 4XX, 'CODE_NAME', …) or 'CODE_NAME' literal
  const re = /\berr\(\s*[A-Za-z_][A-Za-z0-9_]*\s*,\s*\d+\s*,\s*['"]([A-Z][A-Z0-9_]*)['"]/g;
  for (const m of src.matchAll(re)) codes.add(m[1]);
  // Also pick up direct error envelope writes in batch-verify etc.
  const re2 = /code\s*:\s*['"]([A-Z][A-Z0-9_]+)['"]/g;
  for (const m of src.matchAll(re2)) codes.add(m[1]);
  return codes;
}

/* ── Spec side ────────────────────────────────────────────────────── */

function extractSpecPaths(yaml) {
  const paths = new Map();
  const m = yaml.match(/\npaths:\n([\s\S]*?)(?=\n[a-zA-Z]+:\n|$)/);
  if (!m) {
    fatal('openapi.yaml has no top-level `paths:` block');
    return paths;
  }
  const block = m[1];
  const lines = block.split(/\r?\n/);
  let curPath = null;
  for (const line of lines) {
    const pathLine   = line.match(/^  (\/[^\s:]+):\s*$/);
    const methodLine = line.match(/^    (get|post|put|delete|patch|head|options):/);
    if (pathLine) {
      curPath = canonicalisePathParams(pathLine[1]);
      if (!paths.has(curPath)) paths.set(curPath, new Set());
      continue;
    }
    if (curPath && methodLine) paths.get(curPath).add(methodLine[1].toUpperCase());
  }
  return paths;
}

function extractSpecErrorCodes(md) {
  const codes = new Set();
  const re = /`([A-Z][A-Z0-9_]{2,})`/g;
  for (const m of md.matchAll(re)) {
    const c = m[1];
    // Skip env-var names — they're documented next to the codes that
    // surface them but aren't error codes themselves.
    if (c.startsWith('QV_')) continue;
    // Skip licensing / standards tokens.
    if (c === 'TLS' || c === 'NIST' || c === 'AGPL' || c === 'BUSL' || c === 'CC') continue;
    codes.add(c);
  }
  return codes;
}

/* ── Run ─────────────────────────────────────────────────────────── */

function main() {
  if (!existsSync(SERVER))  fatal(`missing ${SERVER}`);
  if (!existsSync(OPENAPI)) fatal(`missing ${OPENAPI}`);
  if (!existsSync(ERRDOC))  fatal(`missing ${ERRDOC}`);
  if (violations.length) return done();

  const serverSrc = readFileSync(SERVER,  'utf8');
  const yaml      = readFileSync(OPENAPI, 'utf8');
  const md        = readFileSync(ERRDOC,  'utf8');

  const serverRoutes = extractServerRoutes(serverSrc);
  const specPaths    = extractSpecPaths(yaml);
  const serverCodes  = extractServerErrorCodes(serverSrc);
  const specCodes    = extractSpecErrorCodes(md);

  if (verbose) {
    process.stdout.write(`server routes (${serverRoutes.size}):\n`);
    for (const [p, ms] of [...serverRoutes].sort()) process.stdout.write(`  ${[...ms].join(',').padEnd(12)} ${p}\n`);
    process.stdout.write(`\nspec paths (${specPaths.size}):\n`);
    for (const [p, ms] of [...specPaths].sort()) process.stdout.write(`  ${[...ms].join(',').padEnd(12)} ${p}\n`);
    process.stdout.write(`\nserver error codes (${serverCodes.size}): ${[...serverCodes].sort().join(', ')}\n`);
    process.stdout.write(`spec error codes  (${specCodes.size}): ${[...specCodes].sort().join(', ')}\n`);
  }

  // ─── Routes ←→ paths ─────────────────────────────────────────────
  for (const [path, methods] of serverRoutes) {
    if (!specPaths.has(path)) {
      fatal(`server has route(s) for path "${path}" (${[...methods].join(',')}) `
          + `but openapi.yaml has no such path`);
      continue;
    }
    for (const m of methods) {
      if (!specPaths.get(path).has(m)) {
        fatal(`server has ${m} ${path} but openapi.yaml does not declare ${m} on ${path}`);
      }
    }
  }
  for (const [path, methods] of specPaths) {
    if (!serverRoutes.has(path)) {
      fatal(`openapi.yaml declares ${path} (${[...methods].join(',')}) but `
          + `server has no matching route(...) for it`);
      continue;
    }
    for (const m of methods) {
      if (!serverRoutes.get(path).has(m)) {
        fatal(`openapi.yaml declares ${m} ${path} but server has no route('${m}', '${path}')`);
      }
    }
  }

  // ─── Error codes ─────────────────────────────────────────────────
  // Codes the server returns must be documented. Known catch-all /
  // implementation-detail codes that don't need a spec entry can be
  // listed here; keep it short.
  const ALLOW_UNDOCUMENTED = new Set([
    // ML-DSA-87 verifier internals — surfaced verbatim.
    'TIMESTAMP_NOT_NUMERIC', 'CRYPTO_ERROR',
    // Uppercase tokens that look like codes but aren't error codes.
    'TLS', 'NIST', 'AGPL', 'CC',
  ]);
  for (const code of serverCodes) {
    if (ALLOW_UNDOCUMENTED.has(code)) continue;
    if (!specCodes.has(code)) {
      fatal(`server returns error code "${code}" but qv-spec/error-codes.md does not document it`);
    }
  }
  // Codes documented but never returned: a softer warning.
  for (const code of specCodes) {
    if (code.length < 4) continue;
    if (!serverCodes.has(code) && !ALLOW_UNDOCUMENTED.has(code)) {
      // Don't fail — error-codes.md may legitimately list codes from
      // the SDK or future endpoints. Surface as a warning only.
      warn(`error-codes.md declares "${code}" but no server code path returns it`);
    }
  }

  return done();
}

function done() {
  if (warnings.length && verbose) {
    process.stdout.write(`openapi-sync: ${warnings.length} warning(s)\n`);
    for (const w of warnings) process.stdout.write(`  ⚠ ${w}\n`);
  }
  if (violations.length === 0) {
    process.stdout.write(`openapi-sync: PASS\n`);
    process.exit(0);
  }
  process.stderr.write(`openapi-sync: FAIL — ${violations.length} violation(s):\n`);
  for (const v of violations) process.stderr.write(`  ✘ ${v}\n`);
  process.exit(1);
}

main();
