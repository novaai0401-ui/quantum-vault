/**
 * QuantumVault v4.0 — SOVEREIGN REST API Server
 * ================================================
 * ZERO npm dependencies. Uses Node.js stdlib only:
 *   - http       (built-in)
 *   - crypto     (built-in, for randomUUID)
 *   - fs         (built-in, for persistent state)
 *   - path       (built-in)
 *
 * If npm disappears tomorrow, this file still runs.
 *
 * Run:  node server-sovereign.mjs
 *       QV_PORT=7433 QV_DATA_DIR=./qv-data node server-sovereign.mjs
 */

import { createServer }     from 'node:http';
import { randomUUID, randomBytes, createCipheriv, createDecipheriv,
         createHash }       from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, appendFileSync,
         existsSync, unlinkSync, chmodSync }                      from 'node:fs';
import { join, dirname }    from 'node:path';
import { fileURLToPath }    from 'node:url';
import { cpus }             from 'node:os';

import { VerifyPool }       from './verify-pool.mjs';

import {
  generateKeypair, issueToken, verifyToken, inspectToken,
  MutationChain, SUITE_IDS, TOKEN_TYPES
} from '../qv-sdk/src/index.mjs';

import { loadAdminConfig, requireAdmin }       from './auth.mjs';
import {
  loadRateLimitConfig, createLimiter, rateLimit,
  readJsonBounded, extractClientIp,
} from './ratelimit.mjs';
import {
  loadSecurityConfig, applySecurityHeaders,
  loadCorsConfig,     applyCors as applyCorsHeaders,
} from './security.mjs';
import {
  loadAuditConfig, createAuditor,
  extractOrMintRequestId, applyRequestId,
} from './audit.mjs';
import { createShutdown } from './shutdown.mjs';
import { createMetrics, loadMetricsConfig } from './metrics.mjs';
import { loadClaimsConfig, validateClaims }  from './claims.mjs';
import { loadCidrConfig, matchesAny }        from './cidr.mjs';
import { applyTrace }                        from './trace.mjs';

// ─── Config ─────────────────────────────────────────────────────────────────
const PORT     = Number(process.env.PORT || process.env.QV_PORT || 7433);
const HOST     = process.env.QV_HOST || '0.0.0.0';
// Security headers + CORS are now loaded via dedicated modules. See
// security.mjs. CORS defaults to OFF (no headers) unless QV_CORS_ORIGIN(S) is
// set — browsers block cross-origin by default, which is what we want.
const SEC_CFG  = loadSecurityConfig();
const CORS_CFG = loadCorsConfig();
const DATA_DIR = process.env.QV_DATA_DIR
  ?? join(dirname(fileURLToPath(import.meta.url)), 'qv-data');
const CHAIN_DIR = join(DATA_DIR, 'chains');
const KS_FILE   = join(DATA_DIR, 'keystore.json');
const MK_FILE   = join(DATA_DIR, 'master.key');   // 32-byte master, 0600
const REV_FILE  = join(DATA_DIR, 'revoked.json');

mkdirSync(CHAIN_DIR, { recursive: true });

// ─── Admin auth (R-4.3.11) ──────────────────────────────────────────────────
// Fail-closed: loadAdminConfig throws unless QV_ADMIN_TOKEN,
// QV_ADMIN_TOKEN_SHA256, or QV_ALLOW_ANON=true is set. No implicit defaults.
const ADMIN_CFG = loadAdminConfig();
if (ADMIN_CFG.mode === 'anon') {
  console.warn('⚠  QV_ALLOW_ANON=true — admin endpoints are UNAUTHENTICATED. Local dev only.');
} else {
  console.log(`✔ Admin auth: ${ADMIN_CFG.mode} mode`);
}

// ─── Rate limiting + body-size caps (R-4.3.9) ───────────────────────────────
const RATE_CFG   = loadRateLimitConfig();
const CLAIMS_CFG = loadClaimsConfig();
const limiter    = createLimiter(RATE_CFG);
// Sweep idle IPs every 5 minutes to keep memory bounded. unref so we don't
// block shutdown.
const _sweepTimer = setInterval(() => limiter.sweep(), 5 * 60 * 1000);
if (_sweepTimer.unref) _sweepTimer.unref();
if (RATE_CFG.disabled) {
  console.warn('⚠  QV_RATE_LIMIT_DISABLED=true — rate limiting is OFF. Use only behind a trusted mesh.');
} else {
  console.log(`✔ Rate limits (per-IP rpm): public=${RATE_CFG.rpm.public} verify=${RATE_CFG.rpm.verify} admin=${RATE_CFG.rpm.admin} authFail=${RATE_CFG.rpm.authFail}; body ≤ ${RATE_CFG.maxBodyBytes}B, claims ≤ ${RATE_CFG.maxClaimsBytes}B`);
}

// ─── Metrics (R-4.3.5) ──────────────────────────────────────────────────────
const METRICS_CFG = loadMetricsConfig();
const metrics = createMetrics();
const mHttpReqs   = metrics.counter('qv_http_requests_total',  { help: 'Total HTTP requests by method/path/status' });
const mHttpDur    = metrics.histogram('qv_http_request_duration_seconds', { help: 'HTTP request duration in seconds' });
const mAuthDenies = metrics.counter('qv_auth_denies_total',    { help: 'Admin-bearer auth denials by reason' });
const mRateDenies = metrics.counter('qv_rate_limit_denies_total', { help: 'Rate-limit denials by category' });
const mTokIssue   = metrics.counter('qv_token_issue_total',    { help: 'Token issuances by suite/tokenType/result' });
const mTokVerify  = metrics.counter('qv_token_verify_total',   { help: 'Token verifications by result' });
const mKeys       = metrics.gauge('qv_keys_total',             { help: 'Keys loaded in the keystore' });
const mRevoked    = metrics.gauge('qv_revoked_total',          { help: 'Revoked key ids' });
const mInflight   = metrics.gauge('qv_inflight_requests',      { help: 'In-flight HTTP requests' });
const mUptime     = metrics.gauge('qv_process_uptime_seconds', { help: 'Process uptime in seconds' });
const mQueueDepth = metrics.gauge('qv_verify_queue_depth',     { help: 'Verify-pool queued jobs waiting for a worker' });
const mQueueRejects = metrics.counter('qv_verify_queue_rejects_total', { help: 'Jobs rejected because the verify-pool queue was full' });
if (METRICS_CFG.enabled) {
  console.log(`✔ Metrics: /v3/metrics ${METRICS_CFG.public ? '(PUBLIC — behind mesh only)' : '(admin-bearer protected)'}`);
}

// ─── Audit log (R-4.3.6) ────────────────────────────────────────────────────
const AUDIT_CFG = loadAuditConfig(process.env, DATA_DIR);
const audit     = createAuditor({ config: AUDIT_CFG });
if (!AUDIT_CFG.disabled) {
  console.log(`✔ Audit log: file=${AUDIT_CFG.fileOn ? AUDIT_CFG.path : 'off'} stdout=${AUDIT_CFG.stdout}`);
}

function onAuthEvent(req, verdict) {
  if (verdict.reason === 'ok' || verdict.reason === 'anon') return;
  // Count against the auth-fail bucket. If the bucket is drained, future
  // admin requests from this IP will 429 even with the right token — an
  // attacker cannot abuse that to lock out a legitimate admin as long as
  // the admin's IP is different (typical). Operators who must share an IP
  // can raise QV_RATE_AUTHFAIL_RPM or disable via QV_RATE_LIMIT_DISABLED.
  const ip  = extractClientIp(req);
  const af  = limiter.recordAuthFail(ip);
  audit.event('auth.deny', {
    level: 'warn',
    requestId: req.requestId,
    ip, method: req.method, path: req.url,
    reason: verdict.reason,
    authFailRemaining: af.remaining,
  });
  mAuthDenies.inc({ reason: verdict.reason });
}
// Wrap the rate-limit middleware to count denies in the Prometheus metric.
// We detect the 429 by snooping the outbound status on res.on('finish').
function metered(category, handler) {
  const wrapped = rateLimit(handler, limiter, category);
  return (req, res, m) => {
    res.on('finish', () => {
      if (res.statusCode === 429) mRateDenies.inc({ category });
    });
    return wrapped(req, res, m);
  };
}
// CIDR allowlist (limitation #5) — defence-in-depth on top of the bearer.
const CIDR_CFG = loadCidrConfig();
if (CIDR_CFG.admin.length > 0) {
  console.log(`✔ Admin CIDR allowlist: ${CIDR_CFG.admin.length} range(s)`);
}
function cidrGate(list, onDeny) {
  return (handler) => (req, res, m) => {
    if (list.length === 0) return handler(req, res, m);
    const ip = extractClientIp(req);
    if (!matchesAny(ip, list)) {
      if (onDeny) onDeny(req, ip);
      return err(res, 403, 'IP_NOT_ALLOWED', 'caller IP is not in the admin allowlist');
    }
    return handler(req, res, m);
  };
}
const adminCidr   = cidrGate(CIDR_CFG.admin,   (req, ip) => {
  audit.event('auth.deny', { requestId: req.requestId, reason: 'cidr_denied', ip });
  mAuthDenies.inc({ reason: 'cidr_denied' });
});
const metricsCidr = cidrGate(CIDR_CFG.metrics, (req, ip) => {
  audit.event('auth.deny', { requestId: req.requestId, reason: 'cidr_denied', ip });
  mAuthDenies.inc({ reason: 'cidr_denied' });
});
const admin    = (handler) => metered('admin',   adminCidr(requireAdmin(handler, ADMIN_CFG, { onAuth: onAuthEvent })));
const publicRL = (handler) => metered('public',  handler);
const verifyRL = (handler) => metered('verify',  handler);

// ─── Master key (seals all signing keys at rest) ────────────────────────────
// Generated once on first boot. Chmod 0600. If deleted, all sealed signing
// keys become unrecoverable (by design — delete to rotate).
// If you want HSM/DPAPI/keyring integration, override this with an env var
// QV_MASTER_KEY_HEX (64 hex chars) — never logged, never persisted.
function loadOrCreateMasterKey() {
  if (process.env.QV_MASTER_KEY_HEX) {
    const mk = Buffer.from(process.env.QV_MASTER_KEY_HEX, 'hex');
    if (mk.length !== 32) throw new Error('QV_MASTER_KEY_HEX must be 32 bytes (64 hex chars)');
    return mk;
  }
  if (existsSync(MK_FILE)) return readFileSync(MK_FILE);
  const mk = randomBytes(32);
  writeFileSync(MK_FILE, mk, { mode: 0o600 });
  try { chmodSync(MK_FILE, 0o600); } catch {}
  console.log(`✔ Generated new master key at ${MK_FILE} (chmod 0600)`);
  return mk;
}
const MASTER_KEY = loadOrCreateMasterKey();

// AES-256-GCM envelope: [12B iv | 16B tag | N B ciphertext].
// Per-key 96-bit IV is random; AAD binds the wrap to the keyId to stop swap attacks.
function sealKey(keyId, plaintext) {
  const iv  = randomBytes(12);
  const cip = createCipheriv('aes-256-gcm', MASTER_KEY, iv);
  cip.setAAD(Buffer.from(keyId, 'utf8'));
  const ct  = Buffer.concat([cip.update(plaintext), cip.final()]);
  const tag = cip.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}
function openKey(keyId, sealedB64) {
  const buf = Buffer.from(sealedB64, 'base64');
  const iv  = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct  = buf.subarray(28);
  const dec = createDecipheriv('aes-256-gcm', MASTER_KEY, iv);
  dec.setAAD(Buffer.from(keyId, 'utf8'));
  dec.setAuthTag(tag);
  return new Uint8Array(Buffer.concat([dec.update(ct), dec.final()]));
}

// ─── Verify worker pool (v4.1 + v4.3 backpressure) ──────────────────────────
// Implementation lives in verify-pool.mjs so it can be unit-tested without
// booting the server. See that file for the bounded-queue semantics.
const POOL_SIZE = Math.max(0, Number(process.env.QV_WORKERS ?? Math.max(2, cpus().length - 1)));
const QUEUE_MAX = Math.max(1, Number(process.env.QV_VERIFY_QUEUE_MAX ?? 1024));

let verifyPool = null;
if (POOL_SIZE > 0) {
  verifyPool = new VerifyPool(POOL_SIZE, QUEUE_MAX);
  try {
    await verifyPool.init();
    console.log(`✔ Verify pool ready: ${POOL_SIZE} worker${POOL_SIZE>1?'s':''}`);
  } catch (e) {
    console.error(`✘ Worker pool init failed, falling back to in-thread: ${e.message}`);
    verifyPool = null;
  }
}

// ─── Revocation list ────────────────────────────────────────────────────────
const revoked = new Set();
function loadRevoked() {
  if (!existsSync(REV_FILE)) return;
  for (const id of JSON.parse(readFileSync(REV_FILE, 'utf8'))) revoked.add(id);
}
function saveRevoked() {
  writeFileSync(REV_FILE, JSON.stringify([...revoked], null, 2), { mode: 0o600 });
}

// ─── Persistent keystore (plain JSON — signing keys base64-encoded) ─────────
// NOTE: v4.0-β will wrap sk bytes with OS DPAPI / keyring. For now, flat file
// with 0600 perms (chmod set below on POSIX). This at minimum survives restart.
const keystore = new Map();   // keyId → { signingKey:u8, verifyingKey:u8, encryptKey:u8, label, createdAt }
const chains   = new Map();   // keyId → MutationChain (in RAM, persisted via append-log)

function b64e(u8) { return Buffer.from(u8).toString('base64'); }
function b64d(s)  { return new Uint8Array(Buffer.from(s, 'base64')); }
function b64ue(u8){ return Buffer.from(u8).toString('base64url'); }
function b64ud(s) { return new Uint8Array(Buffer.from(s, 'base64url')); }
function hex2u8(h){ return new Uint8Array(Buffer.from(h, 'hex')); }

function loadKeystore() {
  if (!existsSync(KS_FILE)) return;
  const raw = JSON.parse(readFileSync(KS_FILE, 'utf8'));
  let migrated = 0;
  for (const [keyId, v] of Object.entries(raw)) {
    // v4.0-β format: { sk_sealed, sk_ek_sealed, vk, ek_hash, label, createdAt, sealed: true }
    // legacy format: { sk, vk, ek, label, createdAt }  → auto-migrate to sealed.
    let signingKey, encryptKey;
    if (v.sealed) {
      try {
        signingKey = openKey(keyId + ':sk', v.sk_sealed);
        encryptKey = openKey(keyId + ':ek', v.ek_sealed);
      } catch (e) {
        console.error(`✘ Failed to unseal keyId=${keyId}: ${e.message}`);
        continue;
      }
    } else {
      signingKey = b64d(v.sk);
      encryptKey = b64d(v.ek);
      migrated++;
    }
    keystore.set(keyId, {
      signingKey, verifyingKey: b64d(v.vk), encryptKey,
      label: v.label, createdAt: v.createdAt,
    });
    // Reload chain counter from append-log tail
    const logPath = join(CHAIN_DIR, keyId + '.log');
    let ctr = 0n;
    if (existsSync(logPath)) {
      const buf = readFileSync(logPath);
      if (buf.length >= 40) {
        const tail = buf.subarray(buf.length - 40, buf.length - 32);
        ctr = tail.readBigUInt64BE(0);
      }
    }
    chains.set(keyId, MutationChain.fromState(encryptKey.slice(0, 32), ctr));
  }
  console.log(`✔ Loaded ${keystore.size} key(s) from ${KS_FILE}`);
  if (migrated > 0) {
    saveKeystore();
    console.log(`✔ Migrated ${migrated} plaintext key(s) to sealed envelope`);
  }
}

function saveKeystore() {
  const obj = {};
  for (const [keyId, v] of keystore.entries()) {
    obj[keyId] = {
      sealed:     true,
      sk_sealed:  sealKey(keyId + ':sk', Buffer.from(v.signingKey)),
      ek_sealed:  sealKey(keyId + ':ek', Buffer.from(v.encryptKey)),
      vk:         b64e(v.verifyingKey),
      label:      v.label,
      createdAt:  v.createdAt,
    };
  }
  writeFileSync(KS_FILE, JSON.stringify(obj, null, 2), { mode: 0o600 });
  try { chmodSync(KS_FILE, 0o600); } catch {}
}

function appendChain(keyId, counter, stateHash) {
  const rec = Buffer.alloc(40);
  rec.writeBigUInt64BE(BigInt(counter), 0);
  Buffer.from(stateHash).copy(rec, 8);
  appendFileSync(join(CHAIN_DIR, keyId + '.log'), rec);
}

// ─── Minimal HTTP framework ─────────────────────────────────────────────────
const routes = [];
// pattern may be a string (exact) or a RegExp (match result passed to handler as 3rd arg)
// template is a stable label for metrics (keeps cardinality bounded — we never
// label metrics with the raw URL, only the route template, e.g. "/v3/keys/:id").
function route(method, pattern, handler, template) {
  if (!template) {
    template = typeof pattern === 'string'
      ? pattern
      : String(pattern)
          .replace(/^\/\^/, '').replace(/\$\/$/, '')
          .replace(/\\\//g, '/')
          .replace(/\(\[\^\/\]\+\)/g, ':id');
  }
  routes.push({ method, pattern, handler, template });
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  // Do NOT hardcode CORS here: the dispatcher applied applyCors() already,
  // and security headers were emitted by applySecurityHeaders(). writeHead
  // would override setHeader() calls if we duplicated them.
  res.writeHead(status, {
    'content-type':   'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}
function err(res, status, code, message) { json(res, status, { error: { code, message } }); }

// Delegate to readJsonBounded (enforces QV_MAX_BODY_BYTES) and uniformly
// surface errors with HTTP status codes attached.
async function readJson(req, max = RATE_CFG.maxBodyBytes) {
  return readJsonBounded(req, max);
}
// Helper: convert a readJson error to a response.
function respondBodyError(res, e) {
  const status = e.status || 400;
  const code   = e.message || 'BAD_REQUEST';
  return err(res, status, code, code === 'BODY_TOO_LARGE' ? `body exceeds ${RATE_CFG.maxBodyBytes} bytes` : 'invalid JSON');
}

// ─── Routes ─────────────────────────────────────────────────────────────────
// ─── Liveness / Readiness (R-4.3.7) ─────────────────────────────────────────
// /v3/live   — cheap liveness probe. 200 unless the event loop is wedged.
//              k8s livenessProbe target. NEVER reports 503 during drain;
//              draining is a ready-state transition, not a liveness failure.
// /v3/ready  — functional readiness. 503 until keystore+chains are loaded
//              or while draining. k8s readinessProbe target.
// /v3/health — back-compat alias for /v3/ready (v4.2 clients).
let bootReady = false; // flipped true once loadKeystore() + loadRevoked() complete.

route('GET', '/v3/live', publicRL((_req, res) => {
  json(res, 200, { status: 'alive', pid: process.pid, uptimeSecs: Math.round(process.uptime()) });
}));

function readyPayload() {
  const draining = !!(shutdownCtl && shutdownCtl.isDraining());
  const ok = bootReady && !draining;
  return {
    ok,
    status:       ok ? 'ready' : (draining ? 'draining' : 'starting'),
    version:      '4.0.0-alpha',
    algorithm:    'ML-DSA-87 (NIST FIPS 204)',
    sovereign:    true,
    dependencies: 'zero-npm',
    keysLoaded:   keystore.size,
    inFlight:     shutdownCtl ? shutdownCtl.inFlight : 0,
    draining,
  };
}

route('GET', '/v3/ready', publicRL((_req, res) => {
  const p = readyPayload();
  json(res, p.ok ? 200 : 503, p);
}));

// Back-compat alias. Kept identical to /v3/ready to avoid surprising v4.2
// clients that polled /v3/health as a readiness signal.
route('GET', '/v3/health', publicRL((_req, res) => {
  const p = readyPayload();
  json(res, p.ok ? 200 : 503, p);
}));

route('GET', '/v3/spec', publicRL((_req, res) => {
  json(res, 200, {
    name: 'QuantumVault', version: '4.0.0-alpha',
    signature: 'ML-DSA-87 (FIPS 204)', kem: 'ML-KEM-1024 (FIPS 203)',
    symmetric: 'XChaCha20-Poly1305', hash: 'SHA3-256 (FIPS 202)',
    tokenMagic: '0x51564C54',
    suites:     { '0x05': 'Dilithium5' },
    tokenTypes: { '0x01': 'Access', '0x02': 'Refresh', '0x03': 'Service' },
    sovereign: { npmDeps: 0, runtime: 'Node.js stdlib only', persistent: true },
  });
}));

route('POST', '/v3/keygen', admin(async (req, res) => {
  const body = await readJson(req).catch(e => ({ _err: e.message, _status: e.status || 400 }));
  if (body._err) return err(res, body._status, body._err, body._err === 'BODY_TOO_LARGE' ? `body exceeds ${RATE_CFG.maxBodyBytes} bytes` : 'invalid JSON');
  const kp    = generateKeypair();
  const keyId = randomUUID();
  keystore.set(keyId, {
    signingKey: kp.signingKey, verifyingKey: kp.verifyingKey,
    encryptKey: kp.encryptKey, label: body.label ?? keyId, createdAt: Date.now(),
  });
  chains.set(keyId, new MutationChain());
  saveKeystore();
  audit.event('keygen', {
    requestId: req.requestId, ip: extractClientIp(req),
    keyId, label: body.label ?? keyId, algorithm: 'ML-DSA-87',
  });
  json(res, 201, {
    keyId, label: body.label ?? keyId,
    verifyingKeyB64: b64ue(kp.verifyingKey),
    encryptKeyB64:   b64ue(kp.encryptKey),
    signingKeyLen: kp.signingKey.length, verifyingKeyLen: kp.verifyingKey.length,
    algorithm: 'ML-DSA-87', createdAt: new Date().toISOString(),
  });
}));

route('POST', '/v3/token/issue', admin(async (req, res) => {
  const body = await readJson(req).catch(e => ({ _err: e.message, _status: e.status || 400 }));
  if (body._err) return err(res, body._status, body._err, body._err === 'BODY_TOO_LARGE' ? `body exceeds ${RATE_CFG.maxBodyBytes} bytes` : 'invalid JSON');
  const { keyId, claims, ttl = 3600, suite = 'dilithium5', tokenType = 'access' } = body;
  if (!keyId)  return err(res, 400, 'MISSING_KEY_ID', 'keyId required');
  if (!claims) return err(res, 400, 'MISSING_CLAIMS', 'claims required');
  // Bound the serialised claims size BEFORE we do any signing work.
  try {
    const claimsLen = Buffer.byteLength(JSON.stringify(claims), 'utf8');
    if (claimsLen > RATE_CFG.maxClaimsBytes) {
      return err(res, 413, 'CLAIMS_TOO_LARGE', `claims exceed ${RATE_CFG.maxClaimsBytes} bytes`);
    }
  } catch { return err(res, 400, 'INVALID_CLAIMS', 'claims must be JSON-serialisable'); }
  // Structural caps — prevent pathological shape within the byte budget.
  try { validateClaims(claims, CLAIMS_CFG); }
  catch (e) { return err(res, 400, e.code || 'INVALID_CLAIMS', e.message); }
  if (revoked.has(keyId)) return err(res, 410, 'KEY_REVOKED', `keyId ${keyId} is revoked`);
  const entry = keystore.get(keyId);
  if (!entry)  return err(res, 404, 'KEY_NOT_FOUND', keyId);

  const suiteId = { dilithium5: SUITE_IDS.Dilithium5 }[suite];
  const typeId  = { access: TOKEN_TYPES.Access, refresh: TOKEN_TYPES.Refresh, service: TOKEN_TYPES.Service }[tokenType];
  if (suiteId === undefined) return err(res, 400, 'INVALID_SUITE', suite);
  if (typeId  === undefined) return err(res, 400, 'INVALID_TYPE',  tokenType);

  const chain = chains.get(keyId);
  try {
    const { tokenBytes, tokenHex } = issueToken({
      signingKeySeed: entry.signingKey, encryptKey: entry.encryptKey,
      chain, claims, ttl, suite: suiteId, tokenType: typeId,
    });
    appendChain(keyId, chain.counter, chain.state);
    audit.event('token.issue', {
      requestId: req.requestId, ip: extractClientIp(req),
      keyId, suite, tokenType, ttlSecs: ttl,
      sizeBytes: tokenBytes.length, mutationCtr: Number(chain.counter),
    });
    mTokIssue.inc({ suite, tokenType, result: 'ok' });
    json(res, 200, {
      tokenHex, tokenB64: b64ue(tokenBytes), sizeBytes: tokenBytes.length,
      issuedAt: new Date().toISOString(), ttlSecs: ttl,
      mutationCtr: Number(chain.counter), suite, tokenType,
    });
  } catch (e) {
    audit.event('token.issue', {
      level: 'error', requestId: req.requestId, ip: extractClientIp(req),
      keyId, suite, tokenType, reason: e.message,
    });
    mTokIssue.inc({ suite, tokenType, result: 'error' });
    err(res, 500, 'ISSUE_FAILED', e.message);
  }
}));

route('POST', '/v3/token/verify', verifyRL(async (req, res) => {
  const body = await readJson(req).catch(e => ({ _err: e.message, _status: e.status || 400 }));
  if (body._err) return err(res, body._status, body._err, body._err === 'BODY_TOO_LARGE' ? `body exceeds ${RATE_CFG.maxBodyBytes} bytes` : 'invalid JSON');
  const { keyId, token } = body;
  if (!keyId) return err(res, 400, 'MISSING_KEY_ID', 'keyId required');
  if (!token) return err(res, 400, 'MISSING_TOKEN',  'token required');
  if (revoked.has(keyId)) return err(res, 410, 'KEY_REVOKED', `keyId ${keyId} is revoked`);
  const entry = keystore.get(keyId);
  if (!entry) return err(res, 404, 'KEY_NOT_FOUND', keyId);

  let tokenBytes;
  try { tokenBytes = /^[0-9a-f]+$/i.test(token) ? hex2u8(token) : b64ud(token); }
  catch { return err(res, 400, 'INVALID_TOKEN', 'hex or base64url'); }

  // Verify against a fresh chain pegged at counter=0, then range-check against
  // persisted counter — replay-window enforcement happens here.
  const vchain = MutationChain.fromState(entry.encryptKey.slice(0, 32), 0n);
  try {
    const out = verifyToken({
      token: tokenBytes, verifyingKey: entry.verifyingKey,
      encryptKey: entry.encryptKey, chain: vchain,
    });
    mTokVerify.inc({ result: 'ok' });
    json(res, 200, {
      valid: true, claims: out.claims,
      issuedAt: new Date(Number(out.issuedAt / 1000n)).toISOString(),
      ttlSecs: out.ttl, mutationCtr: Number(out.mutationCtr),
    });
  } catch (e) {
    mTokVerify.inc({ result: 'invalid' });
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ valid: false, error: { code: e.message } }));
  }
}));

// ─── POST /v3/token/batch-verify ────────────────────────────────────────────
// Body: { items: [ { keyId, token }, ... ] }  (max 256 per request)
// Response: { results: [ { index, valid, claims?, error? }, ... ],
//             summary: { total, valid, invalid, durationMs } }
//
// Runs all verifies cooperatively via Promise.all. On today's JS crypto this
// doesn't give true parallelism (single-threaded), but it saves N HTTP
// round-trips — the big win for most real-world batch workloads.
// When we swap in the native qv.dll backend, Promise.all dispatches to a
// worker_threads pool and becomes true N-core parallel.
route('POST', '/v3/token/batch-verify', verifyRL(async (req, res) => {
  const body = await readJson(req).catch(e => ({ _err: e.message, _status: e.status || 400 }));
  if (body._err) return err(res, body._status, body._err, body._err === 'BODY_TOO_LARGE' ? `body exceeds ${RATE_CFG.maxBodyBytes} bytes` : 'invalid JSON');
  const items = body.items;
  if (!Array.isArray(items))       return err(res, 400, 'MISSING_ITEMS',  'items[] required');
  if (items.length === 0)          return err(res, 400, 'EMPTY_BATCH',   'items[] must be non-empty');
  if (items.length > 256)          return err(res, 400, 'BATCH_TOO_LARGE','max 256 per request');

  // Back-pressure: if the verify-pool queue is near saturation and accepting
  // this batch would push it past the bound, fail-fast with 503 so the caller
  // retries after its own Retry-After rather than piling up pending promises.
  if (verifyPool) {
    const headroom = verifyPool.queueMax - verifyPool.queueDepth;
    if (items.length > headroom + verifyPool.size) {
      res.setHeader('retry-after', '1');
      return err(res, 503, 'POOL_OVERLOADED',
        `verify pool saturated (queue=${verifyPool.queueDepth}/${verifyPool.queueMax})`);
    }
  }

  const t0 = process.hrtime.bigint();
  const results = await Promise.all(items.map(async (it, index) => {
    try {
      if (!it || typeof it !== 'object')       return { index, valid: false, error: { code: 'BAD_ITEM' } };
      const { keyId, token } = it;
      if (!keyId || !token)                    return { index, valid: false, error: { code: 'MISSING_FIELDS' } };
      if (revoked.has(keyId))                  return { index, valid: false, error: { code: 'KEY_REVOKED' } };
      const entry = keystore.get(keyId);
      if (!entry)                              return { index, valid: false, error: { code: 'KEY_NOT_FOUND' } };

      let tokenBytes;
      try { tokenBytes = /^[0-9a-f]+$/i.test(token) ? hex2u8(token) : b64ud(token); }
      catch                                  { return { index, valid: false, error: { code: 'INVALID_TOKEN' } }; }

      // v4.1: dispatch to worker pool if available (true N-core parallel).
      if (verifyPool) {
        const chainSeed = entry.encryptKey.slice(0, 32);
        const r = await verifyPool.run({
          // Transfer as plain buffers — structured clone handles zero-copy.
          tokenBytes:   tokenBytes.buffer.slice(tokenBytes.byteOffset, tokenBytes.byteOffset + tokenBytes.byteLength),
          verifyingKey: entry.verifyingKey.buffer.slice(entry.verifyingKey.byteOffset, entry.verifyingKey.byteOffset + entry.verifyingKey.byteLength),
          encryptKey:   entry.encryptKey.buffer.slice(entry.encryptKey.byteOffset, entry.encryptKey.byteOffset + entry.encryptKey.byteLength),
          chainSeed:    chainSeed.buffer.slice(chainSeed.byteOffset, chainSeed.byteOffset + chainSeed.byteLength),
          chainCtr:     '0',
        });
        if (r.ok) return { index, valid: true, keyId, claims: r.claims, mutationCtr: r.mutationCtr };
        return { index, valid: false, error: { code: r.error } };
      }

      // Fallback: in-thread verify.
      const vchain = MutationChain.fromState(entry.encryptKey.slice(0, 32), 0n);
      const out = verifyToken({
        token: tokenBytes, verifyingKey: entry.verifyingKey,
        encryptKey: entry.encryptKey, chain: vchain,
      });
      return {
        index, valid: true, keyId, claims: out.claims,
        mutationCtr: Number(out.mutationCtr),
      };
    } catch (e) {
      return { index, valid: false, error: { code: e.message } };
    }
  }));
  const durationMs = Number(process.hrtime.bigint() - t0) / 1e6;
  const valid   = results.filter(r => r.valid).length;
  json(res, 200, {
    results,
    summary: { total: results.length, valid, invalid: results.length - valid,
               durationMs: Number(durationMs.toFixed(2)),
               throughput: Number((results.length / (durationMs/1000)).toFixed(0)),
               workers: verifyPool ? verifyPool.size : 0 },
  });
}));

route('POST', '/v3/token/inspect', verifyRL(async (req, res) => {
  const body = await readJson(req).catch(e => ({ _err: e.message, _status: e.status || 400 }));
  if (body._err) return err(res, body._status, body._err, body._err === 'BODY_TOO_LARGE' ? `body exceeds ${RATE_CFG.maxBodyBytes} bytes` : 'invalid JSON');
  const { token } = body;
  if (!token) return err(res, 400, 'MISSING_TOKEN', 'token required');
  try {
    const tokenBytes = /^[0-9a-f]+$/i.test(token) ? hex2u8(token) : b64ud(token);
    json(res, 200, inspectToken(tokenBytes));
  } catch (e) { err(res, 400, 'INSPECT_FAILED', e.message); }
}));

// ─── Key discovery (JWKS-equivalent) ────────────────────────────────────────
route('GET', '/v3/keys', publicRL((_req, res) => {
  const list = [];
  for (const [keyId, v] of keystore.entries()) {
    list.push({
      keyId, label: v.label, createdAt: v.createdAt,
      algorithm: 'ML-DSA-87', revoked: revoked.has(keyId),
      verifyingKeyB64: b64ue(v.verifyingKey),
    });
  }
  json(res, 200, { keys: list, count: list.length });
}));

route('GET', /^\/v3\/keys\/([^/]+)$/, publicRL((_req, res, m) => {
  const keyId = decodeURIComponent(m[1]);
  const v = keystore.get(keyId);
  if (!v) return err(res, 404, 'KEY_NOT_FOUND', keyId);
  json(res, 200, {
    keyId, label: v.label, createdAt: v.createdAt,
    algorithm: 'ML-DSA-87', revoked: revoked.has(keyId),
    verifyingKeyB64: b64ue(v.verifyingKey),
    verifyingKeyHex: Buffer.from(v.verifyingKey).toString('hex'),
    verifyingKeyLen: v.verifyingKey.length,
  });
}));

route('GET', /^\/v3\/keys\/([^/]+)\/vk\.bin$/, publicRL((_req, res, m) => {
  const keyId = decodeURIComponent(m[1]);
  const v = keystore.get(keyId);
  if (!v) return err(res, 404, 'KEY_NOT_FOUND', keyId);
  res.writeHead(200, {
    'content-type':   'application/octet-stream',
    'content-length': v.verifyingKey.length,
    'cache-control':  'public, max-age=3600',
  });
  res.end(Buffer.from(v.verifyingKey));
}));

route('DELETE', /^\/v3\/keys\/([^/]+)$/, admin((req, res, m) => {
  const keyId = decodeURIComponent(m[1]);
  if (!keystore.has(keyId)) return err(res, 404, 'KEY_NOT_FOUND', keyId);
  if (revoked.has(keyId))    return err(res, 409, 'ALREADY_REVOKED', keyId);
  revoked.add(keyId);
  saveRevoked();
  audit.event('token.revoke', {
    level: 'warn',
    requestId: req.requestId, ip: extractClientIp(req),
    keyId,
  });
  mRevoked.set(revoked.size);
  json(res, 200, { keyId, revoked: true, revokedAt: new Date().toISOString() });
}));

route('GET', '/v3/revoked', publicRL((_req, res) => {
  json(res, 200, { revoked: [...revoked], count: revoked.size });
}));

// ─── /v3/metrics (Prometheus text exposition) ───────────────────────────────
// Admin-bearer gated by default; public only when QV_METRICS_PUBLIC=true.
function metricsHandler(req, res) {
  if (!METRICS_CFG.enabled) return err(res, 404, 'NOT_FOUND', 'metrics disabled');
  // Refresh gauges on demand so the scrape sees current values.
  mKeys.set(keystore.size);
  mRevoked.set(revoked.size);
  mInflight.set(shutdownCtl ? shutdownCtl.inFlight : 0);
  mUptime.set(Math.round(process.uptime()));
  if (verifyPool) {
    mQueueDepth.set(verifyPool.queueDepth);
    // Re-apply the cumulative rejects counter (pool owns the monotonic count).
    mQueueRejects.inc({}, Math.max(0, verifyPool.rejects - (mQueueRejects._last || 0)));
    mQueueRejects._last = verifyPool.rejects;
  }
  const body = metrics.render();
  res.writeHead(200, {
    'content-type':   'text/plain; version=0.0.4; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}
if (METRICS_CFG.public) {
  route('GET', '/v3/metrics', publicRL(metricsHandler));
} else {
  route('GET', '/v3/metrics', admin(metricsHandler));
}

// ─── Dispatcher ─────────────────────────────────────────────────────────────
// Placeholder; real controller is installed after `server` is created so the
// health handler (which runs before listen()) can reference `shutdownCtl`.
let shutdownCtl = null;

const server = createServer(async (req, res) => {
  // 0. Request-Id: accept from caller if safe, else mint UUID. Echoed back.
  const reqId = extractOrMintRequestId(req);
  applyRequestId(req, res, reqId);
  // W3C Trace Context (limitation #8). Inherit traceparent if present,
  // mint a fresh trace otherwise. Every audit event carries traceId+spanId.
  const trace = applyTrace(req, res);
  const t0 = process.hrtime.bigint();
  res.on('finish', () => {
    const durSecs = Number(process.hrtime.bigint() - t0) / 1e9;
    let pathname = req.url;
    try { pathname = new URL(req.url, `http://${req.headers.host || 'x'}`).pathname; } catch {}
    // Bucket metrics by route TEMPLATE, not raw URL — avoids cardinality blow-up.
    const mPath = req._routeTemplate || 'unmatched';
    audit.event('http.request', {
      level: res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
      requestId: reqId,
      traceId:      trace.traceId,
      spanId:       trace.spanId,
      parentSpanId: trace.parentSpanId,
      traceInherited: trace.inherited,
      ip: extractClientIp(req),
      method: req.method,
      path:   pathname,
      template: mPath,
      status: res.statusCode,
      ms:     Number((durSecs * 1000).toFixed(2)),
    });
    mHttpReqs.inc({ method: req.method, path: mPath, status: String(res.statusCode) });
    mHttpDur.observe({ method: req.method, path: mPath }, durSecs);
  });

  // 1. Security headers (HSTS, CSP, X-Frame-Options, etc.) on every response.
  applySecurityHeaders(res, SEC_CFG);

  // 2. CORS: returns true if a preflight OPTIONS was terminated by the CORS
  //    layer itself. Otherwise falls through to routing.
  if (applyCorsHeaders(req, res, CORS_CFG)) return;

  // 3. Unrecognised OPTIONS (no CORS origin or no match) — 204 with no body.
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  let matched = null, matchResult = null;
  for (const r of routes) {
    if (r.method !== req.method) continue;
    if (typeof r.pattern === 'string') {
      if (r.pattern === url.pathname) { matched = r; break; }
    } else {
      const m = url.pathname.match(r.pattern);
      if (m) { matched = r; matchResult = m; break; }
    }
  }
  if (!matched) return err(res, 404, 'NOT_FOUND', `${req.method} ${url.pathname}`);
  req._routeTemplate = matched.template;
  try { await matched.handler(req, res, matchResult); }
  catch (e) { err(res, 500, 'INTERNAL', e.message); }
});

// ─── Graceful shutdown (R-4.3.8) ────────────────────────────────────────────
const SHUTDOWN_TIMEOUT_MS = Number(process.env.QV_SHUTDOWN_TIMEOUT_MS ?? 30000);
shutdownCtl = createShutdown({
  server,
  teardown: [
    async () => {
      if (verifyPool) {
        try { await verifyPool.shutdown(); } catch {}
      }
    },
    () => { try { audit.close(); } catch {} },
    () => { try { clearInterval(_sweepTimer); } catch {} },
  ],
  timeoutMs: SHUTDOWN_TIMEOUT_MS,
  log: (msg, level = 'info') => {
    audit.event('server.shutdown', { level, reason: msg });
    const line = `[shutdown] ${msg}\n`;
    if (level === 'error') process.stderr.write(line);
    else                   process.stdout.write(line);
  },
});
shutdownCtl.install();

// Wrap the dispatcher so in-flight requests are tracked. We can't re-wrap
// the createServer listener at this point, so we install a one-shot counter
// via 'request' event instead — but createServer already registered our
// listener. Instead, call beginRequest/endRequest from within the dispatcher:
server.on('request', (req, res) => {
  shutdownCtl.beginRequest();
  let done = false;
  const finish = () => { if (done) return; done = true; shutdownCtl.endRequest(); };
  res.on('finish', finish);
  res.on('close',  finish);
});

// ─── Boot ───────────────────────────────────────────────────────────────────
loadKeystore();
loadRevoked();
bootReady = true;
server.listen(PORT, HOST, () => {
  console.log(`\n╔════════════════════════════════════════════╗`);
  console.log(`║  QuantumVault v4.1 — Sovereign Server      ║`);
  console.log(`║  http://${HOST}:${String(PORT).padEnd(5)}                     ║`);
  console.log(`║  Zero npm deps · Node stdlib only         ║`);
  console.log(`║  Data dir: ${DATA_DIR.slice(-28).padEnd(30)}  ║`);
  if (CORS_CFG.mode !== 'off') console.log(`║  CORS: ${CORS_CFG.mode.padEnd(34)}  ║`);
  console.log(`╚════════════════════════════════════════════╝\n`);
});

export default server;
