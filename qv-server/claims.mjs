/**
 * Claims structural validator (limitation #11).
 *
 * Complements the byte-size cap (QV_MAX_CLAIMS_BYTES) already enforced in
 * ratelimit.mjs. A 16 KiB JSON blob can still be pathological — 10 000
 * sibling keys, or a chain of 5 000 nested objects — and while the signer
 * will cope, it wastes CPU and blows the CBOR encoder's recursion stack.
 *
 * This module rejects such inputs BEFORE signing.
 *
 * Env:
 *   QV_CLAIMS_MAX_DEPTH   (default 8)   — deepest nested object/array
 *   QV_CLAIMS_MAX_KEYS    (default 64)  — keys per object
 *   QV_CLAIMS_MAX_ARRAY   (default 128) — elements per array
 *   QV_CLAIMS_MAX_STRING  (default 4096) — chars per string
 *   QV_CLAIMS_MAX_NODES   (default 1024) — total values in the tree
 *
 * Zero npm deps.
 */

function intEnv(env, name, def, min, max) {
  const raw = env[name];
  if (raw === undefined || raw === '') return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${name} must be integer in [${min}, ${max}]`);
  }
  return n;
}

export function loadClaimsConfig(env = process.env) {
  return {
    maxDepth:  intEnv(env, 'QV_CLAIMS_MAX_DEPTH',  8,    1, 64),
    maxKeys:   intEnv(env, 'QV_CLAIMS_MAX_KEYS',   64,   1, 4096),
    maxArray:  intEnv(env, 'QV_CLAIMS_MAX_ARRAY',  128,  1, 65536),
    maxString: intEnv(env, 'QV_CLAIMS_MAX_STRING', 4096, 1, 1_048_576),
    maxNodes:  intEnv(env, 'QV_CLAIMS_MAX_NODES',  1024, 1, 1_048_576),
  };
}

/**
 * Validate a claims object against structural caps.
 * Throws an Error with a stable `.code` (CLAIMS_*) on violation.
 * Returns true on success.
 */
export function validateClaims(claims, cfg = loadClaimsConfig()) {
  if (claims === null || typeof claims !== 'object' || Array.isArray(claims)) {
    const e = new Error('claims must be a JSON object');
    e.code = 'CLAIMS_NOT_OBJECT';
    throw e;
  }
  let nodes = 0;
  const walk = (v, depth) => {
    nodes += 1;
    if (nodes > cfg.maxNodes) {
      const e = new Error(`claims exceed max nodes (${cfg.maxNodes})`);
      e.code = 'CLAIMS_TOO_MANY_NODES';
      throw e;
    }
    if (depth > cfg.maxDepth) {
      const e = new Error(`claims exceed max depth (${cfg.maxDepth})`);
      e.code = 'CLAIMS_TOO_DEEP';
      throw e;
    }
    if (v === null) return;
    if (typeof v === 'string') {
      if (v.length > cfg.maxString) {
        const e = new Error(`claims string exceeds ${cfg.maxString} chars`);
        e.code = 'CLAIMS_STRING_TOO_LONG';
        throw e;
      }
      return;
    }
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) {
        const e = new Error('claims numbers must be finite');
        e.code = 'CLAIMS_BAD_NUMBER';
        throw e;
      }
      return;
    }
    if (typeof v === 'boolean') return;
    if (Array.isArray(v)) {
      if (v.length > cfg.maxArray) {
        const e = new Error(`claims array exceeds ${cfg.maxArray} elements`);
        e.code = 'CLAIMS_ARRAY_TOO_LARGE';
        throw e;
      }
      for (const el of v) walk(el, depth + 1);
      return;
    }
    if (typeof v === 'object') {
      const keys = Object.keys(v);
      if (keys.length > cfg.maxKeys) {
        const e = new Error(`claims object exceeds ${cfg.maxKeys} keys`);
        e.code = 'CLAIMS_TOO_MANY_KEYS';
        throw e;
      }
      for (const k of keys) {
        if (k.length > cfg.maxString) {
          const e = new Error(`claims key exceeds ${cfg.maxString} chars`);
          e.code = 'CLAIMS_KEY_TOO_LONG';
          throw e;
        }
        walk(v[k], depth + 1);
      }
      return;
    }
    const e = new Error(`claims contain unsupported type: ${typeof v}`);
    e.code = 'CLAIMS_BAD_TYPE';
    throw e;
  };
  walk(claims, 1);
  return true;
}
