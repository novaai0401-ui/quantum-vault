// durable.mjs — crash-safe file writes.
//
// Pattern: write to `<path>.tmp`, fsync the data, atomically rename to the
// final path, then fsync the containing directory so the rename itself is
// durable on POSIX. On win32, dir-fsync is a no-op (not supported); the
// NTFS rename is atomic and the user's filesystem handles metadata flush.
//
// Zero npm deps — Node stdlib only.

import {
  openSync, writeSync, fsyncSync, closeSync,
  renameSync, unlinkSync, existsSync
} from 'node:fs';
import { dirname } from 'node:path';

const IS_WIN = process.platform === 'win32';

/**
 * Durable write. On return, the bytes are on disk (barring hardware lies).
 *
 * @param {string} path       Absolute or cwd-relative target path.
 * @param {string|Uint8Array} data
 * @param {{ mode?: number, fsyncDir?: boolean }} [opts]
 */
export function writeFileDurable(path, data, opts = {}) {
  const mode = opts.mode ?? 0o600;
  const fsyncDir = opts.fsyncDir ?? true;
  const tmp = `${path}.tmp`;

  // 1. Write + fsync the data file.
  const fd = openSync(tmp, 'w', mode);
  try {
    writeSync(fd, data);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }

  // 2. Atomic rename (POSIX rename(2) is atomic; NTFS MoveFileEx is atomic
  //    for same-volume moves).
  renameSync(tmp, path);

  // 3. fsync the directory so the rename's metadata change is durable.
  //    Unsupported on win32 — skip silently.
  if (fsyncDir && !IS_WIN) {
    let dfd = -1;
    try {
      dfd = openSync(dirname(path), 'r');
      fsyncSync(dfd);
    } catch {
      // Some filesystems (tmpfs, certain NFS mounts) don't support dir fsync.
      // Best-effort; the data file fsync above is the load-bearing step.
    } finally {
      if (dfd >= 0) { try { closeSync(dfd); } catch {} }
    }
  }
}

/**
 * Best-effort cleanup of a stale `.tmp` sibling, if a prior crash left one.
 * Safe to call on startup before the first write.
 */
export function cleanupStaleTmp(path) {
  const tmp = `${path}.tmp`;
  if (existsSync(tmp)) {
    try { unlinkSync(tmp); } catch {}
  }
}
