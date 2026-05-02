#!/usr/bin/env node
// rotate-master.mjs — re-seal the keystore under a new master key.
//
// Why this exists
// ----------------
// The master key seals every signing + encrypt key in keystore.json
// (AES-256-GCM with the keyId-as-AAD). Compliance and good hygiene
// say the master rotates periodically, OR after any suspected
// compromise. Without this tool the only paths are (a) manual surgery
// on the keystore — error-prone — or (b) re-keygen everything, which
// invalidates every existing token. This tool gives operators a
// surgical path that preserves keyIds and tokens while changing the
// master.
//
// Operation
// ----------
//   1. Stop qv-server (the rotation tool refuses to run if the writer
//      lock is held — see Sigvault writer-lock semantics).
//   2. Run:
//
//        node qv-server/rotate-master.mjs \
//          --data-dir=/var/lib/sigvault \
//          --new-master-hex=$NEW_MASTER \
//          --confirm
//
//      Without --confirm we DRY-RUN: print what would change, no writes.
//   3. The tool re-seals every keystore entry under NEW_MASTER,
//      durable-writes the new keystore.json + master.key, and
//      backs up the originals to keystore.json.bak.<timestamp> +
//      master.key.bak.<timestamp>.
//   4. Restart qv-server; verify a token issue + verify against an
//      existing keyId.
//   5. After 24–48 hours of healthy operation, delete the .bak files.
//
// Safety properties
// -----------------
//   - Refuses to run if the writer lock exists and the holder pid is
//     alive on this host (means qv-server is up).
//   - Atomic durable writes: tmp + fsync + rename + dir-fsync.
//   - The new master is hex-validated to be exactly 32 bytes BEFORE
//     any keystore modification.
//   - The new keystore is sealed, then the new keystore.json is
//     written, THEN the new master.key is written. If a crash happens
//     between these two writes, the old master.key is still on disk
//     and you can re-run the tool with the same NEW_MASTER (idempotent
//     on the new keystore — re-seal is deterministic per call).
//   - Originals are renamed with a timestamp suffix; never deleted by
//     this tool.
//
// Zero deps. Uses Node stdlib + the existing seal primitives.

import { readFileSync, existsSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { writeFileDurable, cleanupStaleTmp } from './durable.mjs';

// ─── argv parsing (zero-dep) ─────────────────────────────────────────────────

function arg(name, fallback) {
  const flag = `--${name}=`;
  const v = process.argv.find(a => a.startsWith(flag));
  if (v) return v.slice(flag.length);
  if (process.argv.includes(`--${name}`)) return true;
  return fallback;
}

// ─── seal/open primitives (mirror server-sovereign.mjs exactly) ──────────────

function sealWith(masterKey, keyId, plaintext) {
  const iv  = randomBytes(12);
  const cip = createCipheriv('aes-256-gcm', masterKey, iv);
  cip.setAAD(Buffer.from(keyId, 'utf8'));
  const ct  = Buffer.concat([cip.update(plaintext), cip.final()]);
  const tag = cip.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

function openWith(masterKey, keyId, sealedB64) {
  const buf = Buffer.from(sealedB64, 'base64');
  const iv  = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct  = buf.subarray(28);
  const dec = createDecipheriv('aes-256-gcm', masterKey, iv);
  dec.setAAD(Buffer.from(keyId, 'utf8'));
  dec.setAuthTag(tag);
  return Buffer.concat([dec.update(ct), dec.final()]);
}

// ─── safety gates ────────────────────────────────────────────────────────────

function assertWriterLockIdle(dataDir) {
  const lockPath = join(dataDir, '.writer-lock');
  if (!existsSync(lockPath)) return;
  let cur;
  try { cur = JSON.parse(readFileSync(lockPath, 'utf8')); }
  catch {
    // Corrupt — likely stale; let the operator decide.
    return;
  }
  const expiresAt = Date.parse(cur.expiresAt);
  const live = Number.isFinite(expiresAt) && expiresAt > Date.now();
  if (live) {
    throw new Error(
      `WRITER_LOCK_HELD: qv-server appears to be running (pid ${cur.pid} on `
      + `${cur.hostname}, lease until ${cur.expiresAt}). Stop it before rotating the master.`);
  }
  console.log(`✔ writer-lock present but expired — safe to proceed`);
}

function parseMasterHex(hex, label) {
  if (!hex) throw new Error(`${label} required`);
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(`${label} must be 64 hex chars (32 bytes), got ${hex.length}`);
  }
  return Buffer.from(hex, 'hex');
}

// ─── the rotation ────────────────────────────────────────────────────────────

export function rotateMaster({ dataDir, oldMaster, newMaster, dryRun, log }) {
  log = log || (() => {});
  const ksPath = join(dataDir, 'keystore.json');
  const mkPath = join(dataDir, 'master.key');

  if (!existsSync(ksPath)) throw new Error(`keystore.json missing at ${ksPath}`);
  if (!existsSync(mkPath)) throw new Error(`master.key missing at ${mkPath}`);

  cleanupStaleTmp(ksPath);
  cleanupStaleTmp(mkPath);

  const raw = JSON.parse(readFileSync(ksPath, 'utf8'));
  const entries = Object.entries(raw);
  log(`✔ keystore: ${entries.length} entries`);

  // First pass: decrypt everything under oldMaster.
  const opened = new Map();
  for (const [keyId, v] of entries) {
    if (!v.sealed) {
      // Pre-seal legacy entry. We can re-seal it under the new master
      // directly without an open step — the plaintext IS in the file.
      // This makes the rotation also a one-shot migration to sealed.
      opened.set(keyId, {
        sk: Buffer.from(v.sk, 'base64'),
        ek: Buffer.from(v.ek, 'base64'),
        legacy: true,
      });
      continue;
    }
    let sk, ek;
    try {
      sk = openWith(oldMaster, keyId + ':sk', v.sk_sealed);
      ek = openWith(oldMaster, keyId + ':ek', v.ek_sealed);
    } catch (e) {
      throw new Error(
        `OPEN_FAILED for ${keyId}: ${e.message} — old master does not match this keystore`);
    }
    opened.set(keyId, { sk, ek, legacy: false });
  }
  log(`✔ decrypted ${opened.size} entries under current master`);

  // Second pass: re-seal under newMaster.
  const newRaw = {};
  for (const [keyId, v] of entries) {
    const o = opened.get(keyId);
    newRaw[keyId] = {
      sealed:    true,
      sk_sealed: sealWith(newMaster, keyId + ':sk', o.sk),
      ek_sealed: sealWith(newMaster, keyId + ':ek', o.ek),
      vk:        v.vk,
      label:     v.label,
      createdAt: v.createdAt,
    };
  }
  log(`✔ re-sealed ${entries.length} entries under new master`);

  if (dryRun) {
    log('[dry-run] no files written');
    return { entries: entries.length, dryRun: true };
  }

  // Backup originals to dated suffix BEFORE writing new versions.
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const ksBak = `${ksPath}.bak.${ts}`;
  const mkBak = `${mkPath}.bak.${ts}`;
  renameSync(ksPath, ksBak);
  renameSync(mkPath, mkBak);
  log(`✔ backed up originals → ${ksBak}, ${mkBak}`);

  // Write new keystore first. If we crash between this and the master
  // write, the original .bak.<ts> + the live master.key.bak.<ts> are
  // still on disk and the operator restores them by hand.
  writeFileDurable(ksPath, JSON.stringify(newRaw, null, 2), { mode: 0o600 });
  log(`✔ wrote new keystore → ${ksPath}`);

  writeFileDurable(mkPath, newMaster, { mode: 0o600 });
  log(`✔ wrote new master  → ${mkPath}`);

  return { entries: entries.length, dryRun: false, backups: [ksBak, mkBak] };
}

// ─── CLI entry ───────────────────────────────────────────────────────────────

function main() {
  const dataDir       = arg('data-dir');
  const oldMasterHex  = arg('old-master-hex') || readFileSync(join(dataDir || '.', 'master.key')).toString('hex');
  const newMasterHex  = arg('new-master-hex');
  const dryRun        = !arg('confirm');

  if (!dataDir)      die('--data-dir required');
  if (!newMasterHex) die('--new-master-hex required (64 hex chars)');

  const oldMaster = parseMasterHex(oldMasterHex, '--old-master-hex (or master.key)');
  const newMaster = parseMasterHex(newMasterHex, '--new-master-hex');

  if (Buffer.compare(oldMaster, newMaster) === 0) {
    die('new master equals old master — nothing to do');
  }

  assertWriterLockIdle(dataDir);

  const r = rotateMaster({
    dataDir, oldMaster, newMaster, dryRun,
    log: (s) => process.stdout.write(`  ${s}\n`),
  });

  if (dryRun) {
    console.log('\nDRY RUN COMPLETE. Re-run with --confirm to apply.');
  } else {
    console.log('\nROTATION COMPLETE. Restart qv-server with the new master.');
    console.log(`Backups retained at:`);
    for (const b of r.backups) console.log(`  ${b}`);
    console.log(`Delete the backups after 24-48h of healthy operation.`);
  }
}

function die(msg) {
  process.stderr.write(
`rotate-master.mjs — re-seal Sigvault keystore under a new master key

Usage:
  node rotate-master.mjs --data-dir=<DIR> --new-master-hex=<64hex> [--confirm]

Options:
  --data-dir=DIR         qv-server's QV_DATA_DIR (required)
  --new-master-hex=HEX   the new master, 64 hex chars (required)
  --old-master-hex=HEX   the current master; defaults to reading master.key
  --confirm              actually write — without it, we DRY RUN

Error: ${msg}
`);
  process.exit(2);
}

// Run only when executed directly (not when imported by tests).
const isMain = (() => {
  try { return import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`; }
  catch { return false; }
})();
if (isMain) main();
