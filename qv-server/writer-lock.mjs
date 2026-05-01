// writer-lock.mjs — exclusive single-writer lock per DATA_DIR.
//
// Why this exists
// ----------------
// Sigvault's MutationChain is single-writer by design (Chapter 6). Two
// qv-server processes against the same DATA_DIR will produce false
// MUTATION_CTR_STALE rejections, double-issue tokens at the same counter,
// and silently corrupt the chain log. There is no in-process safeguard
// today — we rely on operators to scale only at verify-replica granularity.
//
// This module adds an explicit lease so that misconfiguration fails LOUD
// at boot instead of silent on the wire.
//
// Protocol (zero deps, just the filesystem)
// -----------------------------------------
//   - One file: $DATA_DIR/.writer-lock
//   - Format (JSON):
//       {
//         "fence":      <bigint as string>,    monotonic, only goes up
//         "holderId":   <uuid>,                this process
//         "pid":        <int>,                 process.pid
//         "hostname":   <string>,              os.hostname()
//         "acquiredAt": <ISO timestamp>,
//         "expiresAt":  <ISO timestamp>        absolute lease expiry
//       }
//   - Acquire:
//       1. cleanupStaleTmp(...)
//       2. Read lease if it exists.
//       3. If unexpired AND pid alive AND hostname matches → REFUSE (another
//          process owns the writer role).
//       4. Otherwise STEAL: durable-write a new lease with fence = old.fence+1.
//   - Renew (every TTL/3): rewrite with the same fence + new expiresAt.
//   - Release on shutdown: best-effort delete the file.
//
// Safety
// ------
// `fence` only ever increases. A holder whose lease was stolen sees its
// renew fail with a different fence — the server then aborts loudly rather
// than continuing to issue against a chain another writer now owns.
//
// Cross-host safety is NOT guaranteed by this primitive: two hosts that
// share the same NFS / SMB / EFS export must use a real coordinator
// (Postgres, etcd, S3 conditional-put). Roadmap v4.4 — see ROADMAP.md.

import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { hostname }   from 'node:os';
import { join }       from 'node:path';

import { writeFileDurable, cleanupStaleTmp } from './durable.mjs';

const DEFAULT_TTL_MS  = 30_000;
const DEFAULT_RENEW_MS = 10_000;

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (e) { return e.code === 'EPERM'; }   // EPERM = exists, owned by another user
}

/**
 * Try to acquire the writer lock for this DATA_DIR.
 *
 * @param {object} opts
 * @param {string} opts.dataDir
 * @param {number} [opts.ttlMs=30000]      lease lifetime
 * @param {boolean} [opts.allowSteal=true] take over expired/stale leases
 * @param {NodeJS.Process} [opts.proc=process]
 * @param {string} [opts.host=hostname()]
 * @returns {{ release(): void, renew(): bigint, fence: bigint, path: string }}
 * @throws  Error('WRITER_LOCK_HELD') if a live, same-host process owns it.
 */
export function acquireWriterLock(opts) {
  if (!opts || !opts.dataDir) throw new Error('acquireWriterLock: dataDir required');
  const path     = join(opts.dataDir, '.writer-lock');
  const ttlMs    = opts.ttlMs ?? DEFAULT_TTL_MS;
  const allowSteal = opts.allowSteal !== false;
  const proc     = opts.proc ?? process;
  const host     = opts.host ?? hostname();
  const myId     = randomUUID();

  cleanupStaleTmp(path);

  let priorFence = 0n;
  if (existsSync(path)) {
    try {
      const cur = JSON.parse(readFileSync(path, 'utf8'));
      const expiresAt = Date.parse(cur.expiresAt);
      const live = Number.isFinite(expiresAt) && expiresAt > Date.now()
                && cur.hostname === host && pidAlive(cur.pid);
      if (live) {
        const err = new Error(
          `WRITER_LOCK_HELD: ${path} owned by pid ${cur.pid} on ${cur.hostname} `
          + `until ${cur.expiresAt}; another qv-server is writing to this DATA_DIR. `
          + `Stop it before starting this one.`);
        err.code = 'WRITER_LOCK_HELD';
        throw err;
      }
      if (!allowSteal) {
        const err = new Error(`WRITER_LOCK_STALE: ${path} present but allowSteal=false`);
        err.code = 'WRITER_LOCK_STALE';
        throw err;
      }
      priorFence = BigInt(cur.fence ?? '0');
    } catch (e) {
      if (e.code === 'WRITER_LOCK_HELD' || e.code === 'WRITER_LOCK_STALE') throw e;
      // Corrupt JSON / partial write → treat as no-prior, take over.
      priorFence = 0n;
    }
  }

  const fence = priorFence + 1n;
  const writeLease = (ttl) => writeFileDurable(path, JSON.stringify({
    fence:      fence.toString(),
    holderId:   myId,
    pid:        proc.pid,
    hostname:   host,
    acquiredAt: new Date().toISOString(),
    expiresAt:  new Date(Date.now() + ttl).toISOString(),
  }), { mode: 0o600 });

  writeLease(ttlMs);

  let released = false;
  return {
    fence,
    path,
    /** Bump expiresAt; throw if our fence was overtaken (we lost the lease). */
    renew() {
      if (released) throw new Error('writer lock already released');
      const cur = JSON.parse(readFileSync(path, 'utf8'));
      const curFence = BigInt(cur.fence ?? '0');
      if (curFence !== fence || cur.holderId !== myId) {
        const err = new Error(
          `WRITER_LOCK_LOST: lease fence advanced from ${fence} to ${curFence} `
          + `(holder ${cur.holderId}); another writer stole it.`);
        err.code = 'WRITER_LOCK_LOST';
        throw err;
      }
      writeLease(ttlMs);
      return fence;
    },
    /** Best-effort release. Idempotent. */
    release() {
      if (released) return;
      released = true;
      try {
        const cur = JSON.parse(readFileSync(path, 'utf8'));
        if (cur.holderId === myId) unlinkSync(path);
      } catch {}
    },
  };
}

export const __testing__ = { pidAlive, DEFAULT_TTL_MS, DEFAULT_RENEW_MS };
