/**
 * QuantumVault — Rate limiting + body-size enforcement (R-4.3.9)
 * =================================================================
 * Zero npm deps. Pure in-memory token bucket keyed on client IP.
 *
 * Four independently tunable buckets:
 *   public    — cheap reads (/v3/health, /v3/spec, /v3/keys, /v3/revoked)
 *   verify    — CPU-intensive ops (/v3/token/verify, /v3/token/inspect,
 *                                  /v3/token/batch-verify)
 *   admin     — admin-write (/v3/keygen, /v3/token/issue, DELETE /v3/keys/:id)
 *   authFail  — counted only on auth rejections; much stricter than admin
 *               rate itself — stops bearer-token brute-force.
 *
 * Override any limit with env:
 *   QV_RATE_PUBLIC_RPM     (default 600)
 *   QV_RATE_VERIFY_RPM     (default 120)
 *   QV_RATE_ADMIN_RPM      (default 60)
 *   QV_RATE_AUTHFAIL_RPM   (default 10)
 *   QV_RATE_LIMIT_DISABLED=true   — complete bypass for trusted meshes.
 *
 * Body-size cap (applied BEFORE JSON parsing):
 *   QV_MAX_BODY_BYTES      (default 65536 = 64 KiB)
 *   QV_MAX_CLAIMS_BYTES    (default 16384 = 16 KiB, enforced at issue time)
 *
 * Memory: bounded. Periodic sweep drops IP entries idle > 5 minutes. A hard
 * cap QV_RATE_MAX_IPS (default 100_000) refuses new IPs once hit — this is
 * DoS-resistant even against spoofed-IP floods on upstream hops.
 */

const CATEGORIES = ['public', 'verify', 'admin', 'authFail'];

export const DEFAULTS = {
  public:   600,
  verify:   120,
  admin:    60,
  authFail: 10,
};

export const BODY_DEFAULTS = {
  maxBodyBytes:   64 * 1024,
  maxClaimsBytes: 16 * 1024,
  maxIps:         100_000,
  idleSweepSec:   300,
};

// ─── Config ─────────────────────────────────────────────────────────────────
export function loadRateLimitConfig(env = process.env) {
  const cfg = {
    disabled:       env.QV_RATE_LIMIT_DISABLED === 'true',
    rpm:            { ...DEFAULTS },
    maxBodyBytes:   BODY_DEFAULTS.maxBodyBytes,
    maxClaimsBytes: BODY_DEFAULTS.maxClaimsBytes,
    maxIps:         BODY_DEFAULTS.maxIps,
    idleSweepSec:   BODY_DEFAULTS.idleSweepSec,
  };
  const envMap = {
    public:   'QV_RATE_PUBLIC_RPM',
    verify:   'QV_RATE_VERIFY_RPM',
    admin:    'QV_RATE_ADMIN_RPM',
    authFail: 'QV_RATE_AUTHFAIL_RPM',
  };
  for (const [cat, key] of Object.entries(envMap)) {
    if (env[key] !== undefined && env[key] !== '') {
      const n = Number(env[key]);
      if (!Number.isFinite(n) || n <= 0 || n > 1_000_000) {
        throw new Error(`${key} must be a positive integer ≤ 1_000_000 (got ${env[key]})`);
      }
      cfg.rpm[cat] = Math.floor(n);
    }
  }
  if (env.QV_MAX_BODY_BYTES !== undefined && env.QV_MAX_BODY_BYTES !== '') {
    const n = Number(env.QV_MAX_BODY_BYTES);
    if (!Number.isFinite(n) || n < 128 || n > 100 * 1024 * 1024) {
      throw new Error(`QV_MAX_BODY_BYTES must be 128 .. 100MiB (got ${env.QV_MAX_BODY_BYTES})`);
    }
    cfg.maxBodyBytes = Math.floor(n);
  }
  if (env.QV_MAX_CLAIMS_BYTES !== undefined && env.QV_MAX_CLAIMS_BYTES !== '') {
    const n = Number(env.QV_MAX_CLAIMS_BYTES);
    if (!Number.isFinite(n) || n < 64 || n > cfg.maxBodyBytes) {
      throw new Error(`QV_MAX_CLAIMS_BYTES must be 64 .. QV_MAX_BODY_BYTES (got ${env.QV_MAX_CLAIMS_BYTES})`);
    }
    cfg.maxClaimsBytes = Math.floor(n);
  }
  return cfg;
}

// ─── Client IP extraction ───────────────────────────────────────────────────
/**
 * Right-most X-Forwarded-For entry is the nearest proxy — left-most is the
 * original client, which the client could spoof. For rate-limiting purposes
 * the LAST hop (closest to us) is the most honest. When no XFF header,
 * fall back to socket remoteAddress.
 *
 * Note: in multi-proxy setups, operators must configure their outermost
 * trusted proxy to clear/rewrite XFF so we see only hops we trust. This is
 * documented in docs/deployment.md (TODO).
 */
export function extractClientIp(req) {
  const xff = req?.headers?.['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    const parts = xff.split(',').map(s => s.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }
  const sock = req?.socket?.remoteAddress;
  return sock || 'unknown';
}

// ─── Token bucket ───────────────────────────────────────────────────────────
function newBucket(rpm, now) {
  return { tokens: rpm, lastRefill: now, capacity: rpm };
}

function refill(bucket, rpm, now) {
  const elapsedMs = now - bucket.lastRefill;
  if (elapsedMs <= 0) return;
  const add = (elapsedMs / 60_000) * rpm;
  if (add > 0) {
    bucket.tokens = Math.min(bucket.capacity, bucket.tokens + add);
    bucket.lastRefill = now;
  }
}

// ─── Limiter ────────────────────────────────────────────────────────────────
/**
 * createLimiter returns { check(ip, category) -> verdict, recordAuthFail(ip),
 *                         size(), sweep(now) }.
 * `now` is injectable for determinism in tests.
 */
export function createLimiter(config, { now = () => Date.now() } = {}) {
  const ips = new Map(); // ip -> { buckets: {public, verify, admin, authFail}, lastSeen }

  function ensureEntry(ip, t) {
    let e = ips.get(ip);
    if (e) return e;
    if (ips.size >= config.maxIps) {
      // Hard cap — new IPs get a synthetic deny. Keeps memory bounded.
      return null;
    }
    e = {
      lastSeen: t,
      buckets: {
        public:   newBucket(config.rpm.public,   t),
        verify:   newBucket(config.rpm.verify,   t),
        admin:    newBucket(config.rpm.admin,    t),
        authFail: newBucket(config.rpm.authFail, t),
      },
    };
    ips.set(ip, e);
    return e;
  }

  function check(ip, category) {
    if (config.disabled) {
      return { allowed: true, remaining: config.rpm[category] ?? 0, limit: config.rpm[category] ?? 0, resetSec: 0, bypass: true };
    }
    if (!CATEGORIES.includes(category)) {
      throw new Error(`unknown rate category: ${category}`);
    }
    const t = now();
    const e = ensureEntry(ip, t);
    if (!e) {
      // Global IP cap exceeded — refuse.
      return { allowed: false, remaining: 0, limit: config.rpm[category], resetSec: 60, bypass: false, reason: 'ip_cap' };
    }
    e.lastSeen = t;
    const rpm = config.rpm[category];
    const b   = e.buckets[category];
    refill(b, rpm, t);
    if (b.tokens >= 1) {
      b.tokens -= 1;
      const remaining = Math.floor(b.tokens);
      // resetSec: when does the bucket refill to capacity?
      const deficit = b.capacity - b.tokens;
      const resetSec = Math.ceil((deficit / rpm) * 60);
      return { allowed: true, remaining, limit: rpm, resetSec };
    }
    // denied — compute retry-after
    const retrySec = Math.max(1, Math.ceil((1 - b.tokens) * 60 / rpm));
    return { allowed: false, remaining: 0, limit: rpm, resetSec: retrySec, reason: 'rate' };
  }

  function recordAuthFail(ip) {
    // Count against the authFail bucket; this is separate from the admin
    // bucket so attackers can't drain admin-rate with wrong tokens.
    const t = now();
    const e = ensureEntry(ip, t);
    if (!e) return { allowed: false, remaining: 0, limit: config.rpm.authFail, resetSec: 60 };
    e.lastSeen = t;
    const rpm = config.rpm.authFail;
    const b = e.buckets.authFail;
    refill(b, rpm, t);
    if (b.tokens >= 1) { b.tokens -= 1; return { allowed: true, remaining: Math.floor(b.tokens), limit: rpm, resetSec: 0 }; }
    return { allowed: false, remaining: 0, limit: rpm, resetSec: Math.max(1, Math.ceil((1 - b.tokens) * 60 / rpm)) };
  }

  function sweep(nowMs = now()) {
    const cutoff = nowMs - config.idleSweepSec * 1000;
    let dropped = 0;
    for (const [ip, e] of ips) {
      if (e.lastSeen < cutoff) { ips.delete(ip); dropped++; }
    }
    return dropped;
  }

  function size() { return ips.size; }

  return { check, recordAuthFail, sweep, size };
}

// ─── Middleware glue ────────────────────────────────────────────────────────
/**
 * Wrap a route handler with a rate check. On deny, returns 429 with
 * Retry-After + X-RateLimit-* headers and a fixed error body.
 */
export function rateLimit(handler, limiter, category) {
  return async (req, res, m) => {
    const ip = extractClientIp(req);
    const v  = limiter.check(ip, category);
    setRateHeaders(res, v);
    if (!v.allowed) {
      const body = JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'too many requests' } });
      res.writeHead(429, {
        'content-type':   'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(body),
        'retry-after':    String(v.resetSec),
      });
      return res.end(body);
    }
    return handler(req, res, m);
  };
}

export function setRateHeaders(res, v) {
  try {
    res.setHeader('x-ratelimit-limit',     String(v.limit));
    res.setHeader('x-ratelimit-remaining', String(v.remaining));
    res.setHeader('x-ratelimit-reset',     String(v.resetSec));
  } catch {}
}

// ─── Body-size enforced JSON reader ─────────────────────────────────────────
/**
 * Drop-in replacement for the ad-hoc readJson in server-sovereign.mjs. Aborts
 * with BODY_TOO_LARGE before JSON.parse if the stream exceeds `max`.
 */
export async function readJsonBounded(req, max) {
  const chunks = [];
  let total = 0;
  for await (const c of req) {
    total += c.length;
    if (total > max) {
      // Drain not required — caller's response layer will close.
      const e = new Error('BODY_TOO_LARGE');
      e.status = 413;
      throw e;
    }
    chunks.push(c);
  }
  if (!total) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch {
    const e = new Error('INVALID_JSON');
    e.status = 400;
    throw e;
  }
}
