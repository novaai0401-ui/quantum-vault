// chain-store.mjs — pluggable backend for the MutationChain append-log.
//
// Why this exists
// ----------------
// Today the chain log is a per-keyId file under DATA_DIR/chains/. That is
// fine for single-writer deployments but blocks horizontal write scale
// (limitation #1). Roadmap v4.4 ships Postgres / etcd / S3 backends so a
// fleet of qv-server writers can advance the same chain coherently.
//
// This module defines the **interface** today and ships the **file
// backend** (functionally identical to v4.3 behaviour) as the default
// implementation. Future backends plug in via QV_CHAIN_STORE=file|postgres|s3
// and this file's `createChainStore()` factory.
//
// Contract
// --------
// Every backend MUST provide:
//
//   load(keyId, seed)
//     Reads any prior records for keyId, verifies cryptographic linkage
//     against `seed` (per chain-log.mjs), and returns
//     { counter, state, records }. On a fresh keyId returns
//     { counter: 0n, state: seed, records: 0 }.
//
//   append(keyId, counter, stateHash)
//     Atomically appends one (counter, stateHash) record. Returns when the
//     bytes are durable (fsync semantics for file; commit for Postgres;
//     conditional-put 200 OK for S3). Throws on conflict.
//
//   close()
//     Releases backend resources. Idempotent.
//
// Zero deps. Node stdlib only.

import {
  existsSync, openSync, writeSync, fsyncSync, closeSync, appendFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { verifyAndLoadChainLog } from './chain-log.mjs';

/**
 * File-backed ChainStore.
 *
 * Storage layout: <chainDir>/<keyId>.log, 40-byte fixed records, append-only.
 * Cryptographic linkage is verified on every load (see chain-log.mjs).
 *
 * fsync-by-default; opt out with `fsync: false`.
 */
export function createFileChainStore({ chainDir, fsync = true } = {}) {
  if (!chainDir) throw new Error('createFileChainStore: chainDir required');
  return {
    kind: 'file',
    chainDir,
    load(keyId, seed) {
      const path = join(chainDir, keyId + '.log');
      return verifyAndLoadChainLog(path, seed);
    },
    append(keyId, counter, stateHash) {
      const rec = Buffer.alloc(40);
      rec.writeBigUInt64BE(BigInt(counter), 0);
      Buffer.from(stateHash).copy(rec, 8);
      const path = join(chainDir, keyId + '.log');
      if (fsync) {
        const fd = openSync(path, 'a', 0o600);
        try { writeSync(fd, rec); fsyncSync(fd); }
        finally { closeSync(fd); }
      } else {
        appendFileSync(path, rec);
      }
    },
    close() { /* no resources */ },
    has(keyId) {
      return existsSync(join(chainDir, keyId + '.log'));
    },
  };
}

/**
 * Dispatcher. Reads `kind` from opts or QV_CHAIN_STORE env (default: file).
 *
 * `file` returns synchronously. `postgres` returns a Promise because the
 * connection + schema-ensure are async. Callers therefore must `await`
 * the return value, then continue. server-sovereign.mjs handles both
 * paths (sync + Promise) via a small await-or-pass-through bootstrap.
 */
export function createChainStore(opts = {}) {
  const kind = (opts.kind || process.env.QV_CHAIN_STORE || 'file').toLowerCase();
  switch (kind) {
    case 'file':
      return createFileChainStore(opts);
    case 'postgres': {
      // Lazy import — never load the postgres client unless asked. Keeps
      // the file backend's startup time and code-load surface unchanged.
      const url = opts.url || process.env.QV_CHAIN_STORE_URL;
      if (!url) {
        throw new Error('CHAIN_STORE_PG_URL_MISSING: set QV_CHAIN_STORE_URL '
                      + '(postgres://user:pass@host:port/db) or pass opts.url');
      }
      return import('./chain-store-postgres.mjs')
        .then(m => m.createPostgresChainStore({ url, table: opts.table }));
    }
    case 's3':
      throw new Error('CHAIN_STORE_NOT_AVAILABLE: s3 backend ships in v4.5');
    case 'etcd':
      throw new Error('CHAIN_STORE_NOT_AVAILABLE: etcd backend ships in v4.5');
    default:
      throw new Error(`CHAIN_STORE_UNKNOWN: ${kind} (allowed: file|postgres|s3|etcd)`);
  }
}
