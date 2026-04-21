/**
 * Unit tests for qv-server/ratelimit.mjs (R-4.3.9).
 * Run: node --test qv-server/test/ratelimit.test.mjs
 */

import { test } from 'node:test';
import assert   from 'node:assert/strict';
import {
  loadRateLimitConfig, createLimiter, extractClientIp,
  rateLimit, readJsonBounded, DEFAULTS, BODY_DEFAULTS,
} from '../ratelimit.mjs';
import { Readable } from 'node:stream';

// ─── loadRateLimitConfig ────────────────────────────────────────────────────

test('loadRateLimitConfig: defaults applied', () => {
  const c = loadRateLimitConfig({});
  assert.equal(c.disabled, false);
  assert.deepEqual(c.rpm, DEFAULTS);
  assert.equal(c.maxBodyBytes,   BODY_DEFAULTS.maxBodyBytes);
  assert.equal(c.maxClaimsBytes, BODY_DEFAULTS.maxClaimsBytes);
});

test('loadRateLimitConfig: env overrides', () => {
  const c = loadRateLimitConfig({
    QV_RATE_PUBLIC_RPM:  '100',
    QV_RATE_VERIFY_RPM:  '50',
    QV_RATE_ADMIN_RPM:   '20',
    QV_RATE_AUTHFAIL_RPM:'3',
    QV_MAX_BODY_BYTES:   '8192',
    QV_MAX_CLAIMS_BYTES: '512',
  });
  assert.equal(c.rpm.public, 100);
  assert.equal(c.rpm.verify, 50);
  assert.equal(c.rpm.admin, 20);
  assert.equal(c.rpm.authFail, 3);
  assert.equal(c.maxBodyBytes, 8192);
  assert.equal(c.maxClaimsBytes, 512);
});

test('loadRateLimitConfig: disabled bypass', () => {
  assert.equal(loadRateLimitConfig({ QV_RATE_LIMIT_DISABLED: 'true' }).disabled, true);
});

test('loadRateLimitConfig: rejects bad values', () => {
  assert.throws(() => loadRateLimitConfig({ QV_RATE_PUBLIC_RPM: '0' }), /positive integer/);
  assert.throws(() => loadRateLimitConfig({ QV_RATE_PUBLIC_RPM: '-5' }), /positive integer/);
  assert.throws(() => loadRateLimitConfig({ QV_RATE_PUBLIC_RPM: 'abc' }), /positive integer/);
  assert.throws(() => loadRateLimitConfig({ QV_MAX_BODY_BYTES: '64' }), /128/);
  assert.throws(() => loadRateLimitConfig({ QV_MAX_CLAIMS_BYTES: '10000000000' }), /QV_MAX_CLAIMS_BYTES/);
});

// ─── extractClientIp ────────────────────────────────────────────────────────

test('extractClientIp: X-Forwarded-For right-most wins', () => {
  assert.equal(extractClientIp({ headers: { 'x-forwarded-for': '1.1.1.1, 2.2.2.2, 3.3.3.3' } }), '3.3.3.3');
});

test('extractClientIp: single-entry XFF', () => {
  assert.equal(extractClientIp({ headers: { 'x-forwarded-for': '9.9.9.9' } }), '9.9.9.9');
});

test('extractClientIp: falls back to socket.remoteAddress', () => {
  assert.equal(extractClientIp({ headers: {}, socket: { remoteAddress: '127.0.0.1' } }), '127.0.0.1');
});

test('extractClientIp: unknown when nothing set', () => {
  assert.equal(extractClientIp({ headers: {} }), 'unknown');
});

// ─── Token bucket ──────────────────────────────────────────────────────────

test('limiter: allows up to capacity then denies', () => {
  const cfg = loadRateLimitConfig({ QV_RATE_PUBLIC_RPM: '5' });
  let t = 1_000_000;
  const lim = createLimiter(cfg, { now: () => t });
  for (let i = 0; i < 5; i++) {
    const v = lim.check('1.1.1.1', 'public');
    assert.equal(v.allowed, true, `req ${i+1} should pass`);
  }
  const denied = lim.check('1.1.1.1', 'public');
  assert.equal(denied.allowed, false);
  assert.equal(denied.reason, 'rate');
  assert.ok(denied.resetSec >= 1);
});

test('limiter: refills over time', () => {
  const cfg = loadRateLimitConfig({ QV_RATE_PUBLIC_RPM: '60' }); // 1/sec
  let t = 0;
  const lim = createLimiter(cfg, { now: () => t });
  // drain
  for (let i = 0; i < 60; i++) lim.check('ip', 'public');
  assert.equal(lim.check('ip', 'public').allowed, false);
  // advance 2s → 2 tokens back
  t += 2000;
  assert.equal(lim.check('ip', 'public').allowed, true);
  assert.equal(lim.check('ip', 'public').allowed, true);
  assert.equal(lim.check('ip', 'public').allowed, false);
});

test('limiter: categories are independent', () => {
  const cfg = loadRateLimitConfig({ QV_RATE_ADMIN_RPM: '2', QV_RATE_PUBLIC_RPM: '2' });
  let t = 0;
  const lim = createLimiter(cfg, { now: () => t });
  lim.check('ip', 'admin'); lim.check('ip', 'admin');
  assert.equal(lim.check('ip', 'admin').allowed, false);
  // public bucket untouched
  assert.equal(lim.check('ip', 'public').allowed, true);
});

test('limiter: IPs are independent', () => {
  const cfg = loadRateLimitConfig({ QV_RATE_PUBLIC_RPM: '1' });
  let t = 0;
  const lim = createLimiter(cfg, { now: () => t });
  assert.equal(lim.check('a', 'public').allowed, true);
  assert.equal(lim.check('a', 'public').allowed, false);
  assert.equal(lim.check('b', 'public').allowed, true);
});

test('limiter: disabled config bypasses everything', () => {
  const cfg = loadRateLimitConfig({ QV_RATE_LIMIT_DISABLED: 'true', QV_RATE_PUBLIC_RPM: '1' });
  const lim = createLimiter(cfg);
  for (let i = 0; i < 1000; i++) {
    assert.equal(lim.check('ip', 'public').allowed, true);
  }
});

test('limiter: unknown category throws', () => {
  const lim = createLimiter(loadRateLimitConfig({}));
  assert.throws(() => lim.check('ip', 'nonsense'), /unknown rate category/);
});

test('limiter: recordAuthFail uses authFail bucket, not admin', () => {
  const cfg = loadRateLimitConfig({ QV_RATE_AUTHFAIL_RPM: '2', QV_RATE_ADMIN_RPM: '100' });
  let t = 0;
  const lim = createLimiter(cfg, { now: () => t });
  assert.equal(lim.recordAuthFail('attacker').allowed, true);
  assert.equal(lim.recordAuthFail('attacker').allowed, true);
  assert.equal(lim.recordAuthFail('attacker').allowed, false);
  // admin bucket still full
  assert.equal(lim.check('attacker', 'admin').allowed, true);
});

test('limiter: IP cap enforced', () => {
  // Tiny cap for deterministic test.
  const cfg = { ...loadRateLimitConfig({}), maxIps: 2 };
  const lim = createLimiter(cfg);
  assert.equal(lim.check('a', 'public').allowed, true);
  assert.equal(lim.check('b', 'public').allowed, true);
  const cResult = lim.check('c', 'public');
  assert.equal(cResult.allowed, false);
  assert.equal(cResult.reason, 'ip_cap');
});

test('limiter: sweep evicts idle IPs', () => {
  const cfg = { ...loadRateLimitConfig({}), idleSweepSec: 60 };
  let t = 0;
  const lim = createLimiter(cfg, { now: () => t });
  lim.check('a', 'public');
  lim.check('b', 'public');
  assert.equal(lim.size(), 2);
  t += 120_000; // 2 min later
  const dropped = lim.sweep();
  assert.equal(dropped, 2);
  assert.equal(lim.size(), 0);
});

test('limiter: sweep keeps recent IPs', () => {
  const cfg = { ...loadRateLimitConfig({}), idleSweepSec: 60 };
  let t = 0;
  const lim = createLimiter(cfg, { now: () => t });
  lim.check('a', 'public');
  t += 30_000;
  lim.check('b', 'public');
  t += 40_000; // a is 70s old, b is 40s old
  lim.sweep();
  assert.equal(lim.size(), 1); // only b remains
});

// ─── rateLimit middleware ───────────────────────────────────────────────────

function mockReq(ip = '9.9.9.9') { return { headers: { 'x-forwarded-for': ip } }; }
function mockRes() {
  return {
    _status: null, _headers: {}, _body: '',
    setHeader(k, v) { this._headers[k.toLowerCase()] = v; },
    writeHead(s, h) { this._status = s; Object.assign(this._headers, h || {}); },
    end(b) { this._body = String(b ?? ''); },
  };
}

test('rateLimit middleware: sets X-RateLimit-* on allow', async () => {
  const cfg = loadRateLimitConfig({ QV_RATE_PUBLIC_RPM: '10' });
  const lim = createLimiter(cfg);
  let inner = false;
  const handler = rateLimit(async (_req, res) => { inner = true; res.writeHead(200, {}); res.end(''); }, lim, 'public');
  const res = mockRes();
  await handler(mockReq(), res);
  assert.equal(inner, true);
  assert.equal(res._headers['x-ratelimit-limit'], '10');
  assert.ok(res._headers['x-ratelimit-remaining']);
});

test('rateLimit middleware: 429 on deny with Retry-After', async () => {
  const cfg = loadRateLimitConfig({ QV_RATE_PUBLIC_RPM: '1' });
  const lim = createLimiter(cfg);
  const handler = rateLimit(async (_req, res) => { res.writeHead(200, {}); res.end(''); }, lim, 'public');
  await handler(mockReq('ip1'), mockRes()); // 1st ok
  const res = mockRes();
  await handler(mockReq('ip1'), res);
  assert.equal(res._status, 429);
  const body = JSON.parse(res._body);
  assert.equal(body.error.code, 'RATE_LIMITED');
  assert.ok(res._headers['retry-after']);
});

// ─── readJsonBounded ────────────────────────────────────────────────────────

function streamReq(bodyStr) {
  return Readable.from([Buffer.from(bodyStr)]);
}

test('readJsonBounded: parses normal body', async () => {
  const body = JSON.stringify({ a: 1 });
  const parsed = await readJsonBounded(streamReq(body), 1024);
  assert.deepEqual(parsed, { a: 1 });
});

test('readJsonBounded: empty body → empty object', async () => {
  const parsed = await readJsonBounded(Readable.from([]), 1024);
  assert.deepEqual(parsed, {});
});

test('readJsonBounded: oversize → BODY_TOO_LARGE with 413', async () => {
  const big = JSON.stringify({ x: 'a'.repeat(2000) });
  try {
    await readJsonBounded(streamReq(big), 1024);
    assert.fail('should have thrown');
  } catch (e) {
    assert.equal(e.message, 'BODY_TOO_LARGE');
    assert.equal(e.status, 413);
  }
});

test('readJsonBounded: bad JSON → INVALID_JSON with 400', async () => {
  try {
    await readJsonBounded(streamReq('{not-json'), 1024);
    assert.fail('should have thrown');
  } catch (e) {
    assert.equal(e.message, 'INVALID_JSON');
    assert.equal(e.status, 400);
  }
});
