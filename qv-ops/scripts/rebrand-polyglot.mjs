#!/usr/bin/env node
// Polyglot rebrand sweep — replaces remaining "Sigvault" tokens across
// Python, Rust, Java, Go, PHP, C#, Ruby, the docs site, and root-level
// governance files. Idempotent — running twice is a no-op.
//
// PRESERVES: directory names qv-* (internal), env-var prefix QV_*, and
// the wire-format magic 0x51564C54 ("QVLT") which is burned into every
// already-issued token.

import { readFileSync, writeFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const REPO = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

// File extensions we touch. Anything not in this list is skipped (binaries,
// PDFs, generated docs, etc.).
const TEXT_EXTS = new Set([
  '.md','.mjs','.js','.cjs','.ts','.tsx','.json','.yaml','.yml','.toml',
  '.py','.rs','.go','.java','.php','.cs','.rb','.h','.c','.html','.css',
]);

// Skip these directories entirely.
const SKIP_DIRS = new Set([
  'node_modules','target','dist','build','.git','vendor',
  '__pycache__','.next','.cargo',
]);

// Skip these specific paths (binary or already-handled-elsewhere).
const SKIP_PATHS = new Set([
  'qv-server/qv-data',
]);

// Replacements — order matters, most-specific first.
// Note: "QVLT", "QV_", "qv-*", "0x51564C54" are NOT touched.
const RULES = [
  [/SigvaultClient/g,      'SigvaultClient'],
  [/SigvaultException/g,   'SigvaultException'],
  [/sigvault\.io/g,        'sigvault.io'],
  [/sigvault\.dev/g,       'sigvault.dev'],
  [/sigvault\.com/g,       'sigvault.com'],
  [/@sigvault\/sdk/g,      '@sigvault/sdk'],
  [/@sigvault\b/g,         '@sigvault'],
  // Python module imports: "from sigvault" / "import sigvault"
  [/(\bfrom\s+)sigvault\b/g, '$1sigvault'],
  [/(\bimport\s+)sigvault\b/g, '$1sigvault'],
  // Rust crate names declared as sigvault
  [/\bquantumvault\b/g,        'sigvault'],
  [/Sigvault Sovereign/g,  'Sigvault Sovereign'],
  [/Sigvault Server/g,     'Sigvault Server'],
  [/Sigvault SDK/g,        'Sigvault SDK'],
  [/Sigvault token/g,      'Sigvault token'],
  [/Sigvault tokens/g,     'Sigvault tokens'],
  [/Sigvault Wire Format/g,'Sigvault Wire Format'],
  [/Sigvault Conformance/g,'Sigvault Conformance'],
  [/Sigvault\b/g,          'Sigvault'],
];

let scanned = 0, edited = 0;
const editedFiles = [];

function walk(dir) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, ent.name);
    const rel  = full.slice(REPO.length + 1).replaceAll('\\','/');
    if (SKIP_PATHS.has(rel)) continue;
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name)) continue;
      walk(full);
    } else if (ent.isFile()) {
      const ext = extname(ent.name).toLowerCase();
      if (!TEXT_EXTS.has(ext)) continue;
      // Skip files larger than 1 MiB (likely generated).
      try { if (statSync(full).size > 1024 * 1024) continue; } catch { continue; }
      try {
        const buf = readFileSync(full, 'utf8');
        let out = buf;
        for (const [re, to] of RULES) out = out.replace(re, to);
        scanned++;
        if (out !== buf) {
          writeFileSync(full, out);
          edited++;
          editedFiles.push(rel);
        }
      } catch {}
    }
  }
}

walk(REPO);
console.log(`scanned ${scanned} files, edited ${edited}`);
if (editedFiles.length > 0) {
  console.log('edited files:');
  for (const f of editedFiles) console.log(`  ${f}`);
}
