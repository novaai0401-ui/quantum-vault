// chain-store-postgres.mjs — Postgres-backed ChainStore.
//
// Schema (created on first call to ensureSchema):
//
//   CREATE TABLE IF NOT EXISTS sigvault_chain (
//     key_id     text   NOT NULL,
//     counter    bigint NOT NULL,
//     state_hash bytea  NOT NULL,
//     PRIMARY KEY (key_id, counter)
//   );
//
// Why this works for multi-writer
// --------------------------------
// The PRIMARY KEY (key_id, counter) is the load-bearing constraint. If
// two writers both compute counter = N+1 from their local view of the
// chain and try to INSERT (keyId, N+1, ...), exactly one INSERT
// succeeds; the other fails with `23505 unique_violation`. The losing
// writer surfaces a CHAIN_LOG_CONFLICT to the caller, which means
// "you don't own this chain — refresh and retry."
//
// On `load`, we SELECT all records for the keyId in counter order and
// run them through the same chain-log linkage verifier the file backend
// uses, so tamper / fence-bypass attempts surface the same way.
//
// Connection lifecycle: one persistent connection per writer process.
// Reconnect is the operator's responsibility (process supervisor); the
// connection error surfaces as a normal load/append error so request
// handlers can react.
//
// Zero deps. Uses the in-tree `postgres.mjs` wire client.

import { createHash, timingSafeEqual } from 'node:crypto';

import { connect, parseBytea } from './postgres.mjs';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sigvault_chain (
  key_id     text   NOT NULL,
  counter    bigint NOT NULL,
  state_hash bytea  NOT NULL,
  PRIMARY KEY (key_id, counter)
);
SET bytea_output = 'hex';
`;

function deriveNext(prevState, postCtr) {
  const buf = Buffer.alloc(40);
  prevState.copy(buf, 0);
  buf.writeBigUInt64BE(postCtr - 1n, 32);
  return createHash('sha3-256').update(buf).digest();
}

/**
 * Parse a postgres connection URL.
 *   postgres://user:pass@host:5432/dbname
 *   postgresql://user:pass@host:5432/dbname?application_name=foo
 */
export function parseUrl(url) {
  if (!url) throw new Error('PG_URL_REQUIRED');
  const u = new URL(url);
  if (u.protocol !== 'postgres:' && u.protocol !== 'postgresql:') {
    throw new Error(`PG_URL_PROTOCOL: expected postgres://, got ${u.protocol}`);
  }
  return {
    host:     u.hostname,
    port:     Number(u.port || 5432),
    user:     decodeURIComponent(u.username || 'postgres'),
    password: decodeURIComponent(u.password || ''),
    database: (u.pathname || '/').slice(1) || (decodeURIComponent(u.username) || 'postgres'),
    applicationName: u.searchParams.get('application_name') || 'sigvault-server',
  };
}

/**
 * Create a Postgres-backed ChainStore.
 *
 * @param {object} opts
 * @param {string} opts.url      postgres://user:pass@host:port/dbname
 * @param {string} [opts.table]  override default table name
 * @returns {Promise<ChainStore>}
 */
export async function createPostgresChainStore(opts) {
  const cfg = parseUrl(opts.url);
  const table = (opts.table || 'sigvault_chain').replace(/[^a-zA-Z0-9_]/g, '');
  if (!table) throw new Error('PG_TABLE_INVALID');

  const client = await connect(cfg);
  // Ensure schema. Idempotent + cheap.
  await client.query(SCHEMA.replaceAll('sigvault_chain', table));

  return {
    kind:  'postgres',
    table,

    async load(keyId, seed) {
      const r = await client.exec(
        `SELECT counter, state_hash FROM ${table} WHERE key_id = $1 ORDER BY counter ASC`,
        [keyId],
      );
      let prevState = Buffer.from(seed);
      let expected  = 1n;
      let lastState = prevState;
      for (const [ctrStr, hashStr] of r.rows) {
        const ctr   = BigInt(ctrStr);
        const state = parseBytea(hashStr);
        if (ctr !== expected) {
          const e = new Error(
            `CHAIN_LOG_NON_MONOTONIC: keyId=${keyId} counter ${ctr} expected ${expected}`);
          e.code = 'CHAIN_LOG_NON_MONOTONIC'; throw e;
        }
        const derived = deriveNext(prevState, ctr);
        if (derived.length !== state.length || !timingSafeEqual(derived, state)) {
          const e = new Error(
            `CHAIN_LOG_TAMPERED: keyId=${keyId} record ${ctr} stateHash mismatch`);
          e.code = 'CHAIN_LOG_TAMPERED'; throw e;
        }
        prevState = state;
        lastState = state;
        expected++;
      }
      return {
        counter: BigInt(r.rows.length),
        state:   lastState,
        records: r.rows.length,
      };
    },

    async append(keyId, counter, stateHash) {
      try {
        await client.exec(
          `INSERT INTO ${table} (key_id, counter, state_hash) VALUES ($1, $2, $3)`,
          [keyId, BigInt(counter), Buffer.from(stateHash)],
        );
      } catch (e) {
        // 23505 = unique_violation → another writer beat us to this counter.
        if (e.pgCode === '23505') {
          const err = new Error(
            `CHAIN_LOG_CONFLICT: keyId=${keyId} counter=${counter} already taken — `
            + `another writer advanced the chain. Refresh and retry.`);
          err.code = 'CHAIN_LOG_CONFLICT';
          throw err;
        }
        throw e;
      }
    },

    async has(keyId) {
      const r = await client.exec(
        `SELECT 1 FROM ${table} WHERE key_id = $1 LIMIT 1`,
        [keyId],
      );
      return r.rows.length > 0;
    },

    close() {
      try { client.end(); } catch {}
    },
  };
}
