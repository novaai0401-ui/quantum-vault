/**
 * QuantumVault — Admin authentication (R-4.3.11)
 * ================================================
 * Zero npm deps — uses Node's `node:crypto` stdlib only.
 *
 * Two modes:
 *   - static  : plaintext QV_ADMIN_TOKEN in env, compared with timingSafeEqual.
 *   - hashed  : sha256(presented) compared with QV_ADMIN_TOKEN_SHA256 (hex or
 *               base64). This mode is strongly preferred — the plaintext token
 *               never touches the server's environment.
 *
 * Bypass for local dev: set QV_ALLOW_ANON=true. The server refuses to start
 * otherwise when neither env is present.
 *
 * All comparisons are constant-time. There is no branch that depends on token
 * contents, and every failure returns the same error code and shape.
 */

import { createHash, timingSafeEqual, randomBytes } from 'node:crypto';

// ─── Config loader ──────────────────────────────────────────────────────────
/**
 * Load and validate admin-auth config from `env` (defaults to process.env).
 * Throws a clear error if the config is ambiguous or unsafe.
 *
 * @returns {{mode:'static'|'hashed'|'anon', token?:Buffer, tokenHash?:Buffer}}
 */
export function loadAdminConfig(env = process.env) {
  const anon        = env.QV_ALLOW_ANON === 'true';
  const rawToken    = env.QV_ADMIN_TOKEN || '';
  const rawHashHex  = env.QV_ADMIN_TOKEN_SHA256 || '';

  if (anon) {
    if (rawToken || rawHashHex) {
      throw new Error(
        'QV_ALLOW_ANON=true conflicts with QV_ADMIN_TOKEN/QV_ADMIN_TOKEN_SHA256. Pick one.',
      );
    }
    return { mode: 'anon' };
  }

  if (rawToken && rawHashHex) {
    throw new Error(
      'Set either QV_ADMIN_TOKEN or QV_ADMIN_TOKEN_SHA256, not both.',
    );
  }

  if (rawHashHex) {
    const tokenHash = decodeHashCandidate(rawHashHex);
    if (tokenHash.length !== 32) {
      throw new Error(
        `QV_ADMIN_TOKEN_SHA256 must decode to 32 bytes (got ${tokenHash.length}).`,
      );
    }
    return { mode: 'hashed', tokenHash };
  }

  if (rawToken) {
    if (rawToken.length < 16) {
      throw new Error(
        'QV_ADMIN_TOKEN must be at least 16 chars. Generate one with `openssl rand -hex 32` or `qv admin-token`.',
      );
    }
    return { mode: 'static', token: Buffer.from(rawToken, 'utf8') };
  }

  throw new Error(
    'qv-server refuses to start without admin auth configured. Set one of:\n' +
    '  QV_ADMIN_TOKEN=<32+ random chars>              (dev)\n' +
    '  QV_ADMIN_TOKEN_SHA256=<sha256 hex of token>    (prod, recommended)\n' +
    '  QV_ALLOW_ANON=true                             (local only — DANGEROUS)',
  );
}

function decodeHashCandidate(s) {
  // Accept hex (64 chars) or base64/base64url (44 chars with padding, 43 without).
  if (/^[0-9a-fA-F]{64}$/.test(s)) return Buffer.from(s, 'hex');
  // base64 / base64url — strip padding for tolerant compare.
  try { return Buffer.from(s, 'base64'); }
  catch { return Buffer.alloc(0); }
}

// ─── Request parser ─────────────────────────────────────────────────────────
/**
 * Extract the bearer token from an incoming HTTP request's Authorization
 * header. Returns null if absent or malformed. Never throws.
 *
 * Accepts: "Authorization: Bearer <token>"     (case-insensitive scheme)
 * Rejects: Basic, Digest, missing, malformed, or anything with whitespace in
 *          the token itself.
 */
export function extractBearer(req) {
  const h = req && req.headers && (req.headers.authorization || req.headers.Authorization);
  if (!h || typeof h !== 'string') return null;
  const m = /^\s*Bearer\s+(\S+)\s*$/i.exec(h);
  return m ? m[1] : null;
}

// ─── Core check ─────────────────────────────────────────────────────────────
/**
 * Decide whether a request presents valid admin credentials. Constant-time
 * against the configured secret. Never throws.
 *
 * @param {object} req     Node IncomingMessage (only `.headers` is used).
 * @param {object} config  Output of loadAdminConfig().
 * @returns {{ok:boolean, reason?:string}}
 *   reason is one of: 'anon', 'no_token', 'bad_token', 'ok'
 *   (Callers should NEVER return reason to the client — only to the audit log.)
 */
export function checkAdmin(req, config) {
  if (!config) return { ok: false, reason: 'misconfigured' };
  if (config.mode === 'anon') return { ok: true, reason: 'anon' };

  const presented = extractBearer(req);
  if (!presented) return { ok: false, reason: 'no_token' };

  // Force all paths to do the same amount of work: always compute the sha256
  // of the presented token AND do one 32-byte timingSafeEqual. This keeps the
  // "bad token" and "wrong length token" paths indistinguishable by timing.
  const presentedBuf  = Buffer.from(presented, 'utf8');
  const presentedHash = createHash('sha256').update(presentedBuf).digest();

  let target;
  if (config.mode === 'hashed') {
    target = config.tokenHash;
  } else if (config.mode === 'static') {
    // Hash the configured token too so we're always comparing equal-length
    // 32-byte digests — avoids the length-exposure side-channel of comparing
    // the raw strings.
    target = createHash('sha256').update(config.token).digest();
  } else {
    return { ok: false, reason: 'misconfigured' };
  }

  const eq = safeEqual(presentedHash, target);
  return eq ? { ok: true, reason: 'ok' } : { ok: false, reason: 'bad_token' };
}

function safeEqual(a, b) {
  if (!Buffer.isBuffer(a) || !Buffer.isBuffer(b)) return false;
  if (a.length !== b.length) {
    // Still do a constant-work compare so timing does not reveal length.
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

// ─── Utility for ops ────────────────────────────────────────────────────────
/**
 * Generate a new 32-byte (256-bit) random admin token and print both the raw
 * token and its sha256 hex. Ops uses the hex to populate
 * QV_ADMIN_TOKEN_SHA256 on servers; gives the raw to clients.
 */
export function mintAdminToken() {
  const raw  = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(raw, 'utf8').digest('hex');
  return { token: raw, sha256: hash };
}

// ─── Framework glue ─────────────────────────────────────────────────────────
/**
 * Returns a route handler that runs `checkAdmin` and, on failure, writes a
 * 401 with a fixed error shape. Non-failure: invokes `inner(req, res, m)`.
 * The server's audit log hook (set later in Phase 1 Step 4) observes every
 * auth decision via the `onAuth` callback.
 */
export function requireAdmin(inner, config, { onAuth } = {}) {
  return async (req, res, m) => {
    const verdict = checkAdmin(req, config);
    if (onAuth) { try { onAuth(req, verdict); } catch {} }
    if (!verdict.ok) {
      const body = JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'admin credentials required' } });
      res.writeHead(401, {
        'content-type':     'application/json; charset=utf-8',
        'content-length':   Buffer.byteLength(body),
        'www-authenticate': 'Bearer realm="qv-admin"',
      });
      return res.end(body);
    }
    return inner(req, res, m);
  };
}
