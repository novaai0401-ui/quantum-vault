/**
 * Unit tests for qv-server/security.mjs (headers + CORS).
 * Run: node --test qv-server/test/security.test.mjs
 */

import { test } from 'node:test';
import assert   from 'node:assert/strict';
import {
  loadSecurityConfig, applySecurityHeaders,
  loadCorsConfig, applyCors,
} from '../security.mjs';

function mockRes() {
  const headers = {};
  let status = null, ended = false, body = '';
  return {
    headers,
    get _status() { return status; },
    get _ended()  { return ended;  },
    get _body()   { return body;   },
    setHeader(k, v) { headers[k.toLowerCase()] = String(v); },
    removeHeader(k) { delete headers[k.toLowerCase()]; },
    writeHead(s, h) { status = s; if (h) Object.assign(headers, h); },
    end(b) { ended = true; body = String(b ?? ''); },
  };
}

// ─── Security header bundle ─────────────────────────────────────────────────

test('applySecurityHeaders: emits full default set', () => {
  const cfg = loadSecurityConfig({});
  const res = mockRes();
  applySecurityHeaders(res, cfg);
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal(res.headers['x-frame-options'], 'DENY');
  assert.equal(res.headers['referrer-policy'], 'no-referrer');
  assert.ok(res.headers['content-security-policy'].includes("default-src 'none'"));
  assert.ok(res.headers['content-security-policy'].includes("frame-ancestors 'none'"));
  assert.equal(res.headers['cross-origin-resource-policy'], 'same-origin');
  assert.equal(res.headers['cross-origin-opener-policy'],   'same-origin');
  assert.equal(res.headers['x-permitted-cross-domain-policies'], 'none');
  assert.ok(res.headers['strict-transport-security'].includes('max-age=31536000'));
  assert.ok(res.headers['strict-transport-security'].includes('includeSubDomains'));
});

test('applySecurityHeaders: HSTS disabled on request', () => {
  const cfg = loadSecurityConfig({ QV_HSTS_ENABLED: 'false' });
  const res = mockRes();
  applySecurityHeaders(res, cfg);
  assert.equal(res.headers['strict-transport-security'], undefined);
});

test('applySecurityHeaders: HSTS preload adds token', () => {
  const cfg = loadSecurityConfig({ QV_HSTS_PRELOAD: 'true' });
  const res = mockRes();
  applySecurityHeaders(res, cfg);
  assert.ok(res.headers['strict-transport-security'].includes('preload'));
});

test('applySecurityHeaders: HSTS excludes subdomains when requested', () => {
  const cfg = loadSecurityConfig({ QV_HSTS_INCLUDE_SUBDOMAINS: 'false' });
  const res = mockRes();
  applySecurityHeaders(res, cfg);
  assert.ok(!res.headers['strict-transport-security'].includes('includeSubDomains'));
});

test('loadSecurityConfig: rejects insane max-age', () => {
  assert.throws(() => loadSecurityConfig({ QV_HSTS_MAX_AGE: '99999999999' }), /QV_HSTS_MAX_AGE/);
  assert.throws(() => loadSecurityConfig({ QV_HSTS_MAX_AGE: '-1' }), /QV_HSTS_MAX_AGE/);
});

test('applySecurityHeaders: strips Server and X-Powered-By', () => {
  const cfg = loadSecurityConfig({});
  const res = mockRes();
  res.setHeader('server', 'Node.js/v24');
  res.setHeader('x-powered-by', 'Express');
  applySecurityHeaders(res, cfg);
  assert.equal(res.headers['server'], undefined);
  assert.equal(res.headers['x-powered-by'], undefined);
});

// ─── CORS ───────────────────────────────────────────────────────────────────

test('loadCorsConfig: empty = off', () => {
  assert.equal(loadCorsConfig({}).mode, 'off');
});

test('loadCorsConfig: wildcard', () => {
  assert.equal(loadCorsConfig({ QV_CORS_ORIGIN: '*' }).mode, 'wildcard');
});

test('loadCorsConfig: wildcard + credentials is rejected', () => {
  assert.throws(
    () => loadCorsConfig({ QV_CORS_ORIGIN: '*', QV_CORS_ALLOW_CREDENTIALS: 'true' }),
    /incompatible/,
  );
});

test('loadCorsConfig: list of origins', () => {
  const cfg = loadCorsConfig({ QV_CORS_ORIGINS: 'https://a.com, https://b.com' });
  assert.equal(cfg.mode, 'list');
  assert.ok(cfg.origins.has('https://a.com'));
  assert.ok(cfg.origins.has('https://b.com'));
});

test('loadCorsConfig: rejects invalid origin syntax', () => {
  assert.throws(() => loadCorsConfig({ QV_CORS_ORIGINS: 'not-a-url' }),   /not a valid http/);
  assert.throws(() => loadCorsConfig({ QV_CORS_ORIGINS: 'https://*' }),   /not a valid http/);
  assert.throws(() => loadCorsConfig({ QV_CORS_ORIGINS: 'ftp://x.com' }), /not a valid http/);
});

test('applyCors: off mode emits nothing', () => {
  const cfg = loadCorsConfig({});
  const res = mockRes();
  const terminated = applyCors({ headers: { origin: 'https://a.com' }, method: 'GET' }, res, cfg);
  assert.equal(terminated, false);
  assert.equal(res.headers['access-control-allow-origin'], undefined);
});

test('applyCors: wildcard echoes *', () => {
  const cfg = loadCorsConfig({ QV_CORS_ORIGIN: '*' });
  const res = mockRes();
  applyCors({ headers: { origin: 'https://a.com' }, method: 'GET' }, res, cfg);
  assert.equal(res.headers['access-control-allow-origin'], '*');
  assert.equal(res.headers['access-control-allow-methods'], 'GET, POST, DELETE, OPTIONS');
});

test('applyCors: list allows matching origin, echoes it, sets Vary', () => {
  const cfg = loadCorsConfig({ QV_CORS_ORIGINS: 'https://a.com,https://b.com' });
  const res = mockRes();
  applyCors({ headers: { origin: 'https://a.com' }, method: 'GET' }, res, cfg);
  assert.equal(res.headers['access-control-allow-origin'], 'https://a.com');
  assert.equal(res.headers['vary'], 'origin');
});

test('applyCors: list rejects non-matching origin (no header set)', () => {
  const cfg = loadCorsConfig({ QV_CORS_ORIGINS: 'https://a.com' });
  const res = mockRes();
  applyCors({ headers: { origin: 'https://evil.com' }, method: 'GET' }, res, cfg);
  assert.equal(res.headers['access-control-allow-origin'], undefined);
});

test('applyCors: OPTIONS preflight for matching origin terminates 204', () => {
  const cfg = loadCorsConfig({ QV_CORS_ORIGINS: 'https://a.com' });
  const res = mockRes();
  const t = applyCors({ headers: { origin: 'https://a.com' }, method: 'OPTIONS' }, res, cfg);
  assert.equal(t, true);
  assert.equal(res._status, 204);
  assert.equal(res._ended, true);
});

test('applyCors: OPTIONS from non-whitelisted origin does NOT terminate', () => {
  const cfg = loadCorsConfig({ QV_CORS_ORIGINS: 'https://a.com' });
  const res = mockRes();
  const t = applyCors({ headers: { origin: 'https://evil.com' }, method: 'OPTIONS' }, res, cfg);
  assert.equal(t, false); // dispatcher will decide (typically 404)
});

test('applyCors: credentials flag emits Allow-Credentials', () => {
  const cfg = loadCorsConfig({ QV_CORS_ORIGINS: 'https://a.com', QV_CORS_ALLOW_CREDENTIALS: 'true' });
  const res = mockRes();
  applyCors({ headers: { origin: 'https://a.com' }, method: 'GET' }, res, cfg);
  assert.equal(res.headers['access-control-allow-credentials'], 'true');
});
