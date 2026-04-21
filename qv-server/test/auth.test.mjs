/**
 * Unit tests for qv-server/auth.mjs (R-4.3.11).
 * Zero npm deps — uses node:test and node:assert.
 *
 * Run:  node --test qv-server/test/auth.test.mjs
 */

import { test } from 'node:test';
import assert   from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  loadAdminConfig, extractBearer, checkAdmin, requireAdmin, mintAdminToken,
} from '../auth.mjs';

// ─── loadAdminConfig ────────────────────────────────────────────────────────

test('loadAdminConfig: refuses to start with no env', () => {
  assert.throws(() => loadAdminConfig({}), /refuses to start/);
});

test('loadAdminConfig: rejects both token + hash set', () => {
  assert.throws(
    () => loadAdminConfig({ QV_ADMIN_TOKEN: 'x'.repeat(32), QV_ADMIN_TOKEN_SHA256: 'ab'.repeat(32) }),
    /not both/,
  );
});

test('loadAdminConfig: rejects short static token', () => {
  assert.throws(() => loadAdminConfig({ QV_ADMIN_TOKEN: 'short' }), /at least 16 chars/);
});

test('loadAdminConfig: rejects short hash', () => {
  // 16 hex chars decodes to 8 bytes — not 32.
  assert.throws(
    () => loadAdminConfig({ QV_ADMIN_TOKEN_SHA256: 'aa'.repeat(16) }),
    /32 bytes/,
  );
});

test('loadAdminConfig: QV_ALLOW_ANON with token is rejected', () => {
  assert.throws(
    () => loadAdminConfig({ QV_ALLOW_ANON: 'true', QV_ADMIN_TOKEN: 'x'.repeat(32) }),
    /conflicts/,
  );
});

test('loadAdminConfig: anon mode accepted', () => {
  const cfg = loadAdminConfig({ QV_ALLOW_ANON: 'true' });
  assert.equal(cfg.mode, 'anon');
});

test('loadAdminConfig: static mode with valid token', () => {
  const cfg = loadAdminConfig({ QV_ADMIN_TOKEN: 'a'.repeat(32) });
  assert.equal(cfg.mode, 'static');
  assert.ok(Buffer.isBuffer(cfg.token));
});

test('loadAdminConfig: hashed mode with hex', () => {
  const cfg = loadAdminConfig({ QV_ADMIN_TOKEN_SHA256: 'ab'.repeat(32) });
  assert.equal(cfg.mode, 'hashed');
  assert.equal(cfg.tokenHash.length, 32);
});

// ─── extractBearer ──────────────────────────────────────────────────────────

test('extractBearer: no header returns null', () => {
  assert.equal(extractBearer({ headers: {} }), null);
});

test('extractBearer: malformed header returns null', () => {
  assert.equal(extractBearer({ headers: { authorization: 'Basic abc' } }), null);
  assert.equal(extractBearer({ headers: { authorization: 'Bearer' } }), null);
  assert.equal(extractBearer({ headers: { authorization: 'Bearer   ' } }), null);
  assert.equal(extractBearer({ headers: { authorization: 'bearer with space token' } }), null);
});

test('extractBearer: well-formed header returns token', () => {
  assert.equal(extractBearer({ headers: { authorization: 'Bearer abc.def' } }), 'abc.def');
  assert.equal(extractBearer({ headers: { authorization: 'bearer abc' } }), 'abc'); // case-insensitive scheme
});

// ─── checkAdmin ─────────────────────────────────────────────────────────────

test('checkAdmin: anon config accepts requests with no token', () => {
  const cfg = loadAdminConfig({ QV_ALLOW_ANON: 'true' });
  assert.deepEqual(checkAdmin({ headers: {} }, cfg), { ok: true, reason: 'anon' });
});

test('checkAdmin: static mode — good token accepted', () => {
  const token = 'correct-horse-battery-staple-32ch';
  const cfg = loadAdminConfig({ QV_ADMIN_TOKEN: token });
  const verdict = checkAdmin({ headers: { authorization: `Bearer ${token}` } }, cfg);
  assert.equal(verdict.ok, true);
  assert.equal(verdict.reason, 'ok');
});

test('checkAdmin: static mode — bad token rejected', () => {
  const cfg = loadAdminConfig({ QV_ADMIN_TOKEN: 'a'.repeat(32) });
  const verdict = checkAdmin({ headers: { authorization: 'Bearer b'.padEnd(39, 'b') } }, cfg);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, 'bad_token');
});

test('checkAdmin: static mode — missing token rejected with reason no_token', () => {
  const cfg = loadAdminConfig({ QV_ADMIN_TOKEN: 'a'.repeat(32) });
  const verdict = checkAdmin({ headers: {} }, cfg);
  assert.deepEqual(verdict, { ok: false, reason: 'no_token' });
});

test('checkAdmin: hashed mode — good token accepted', () => {
  const raw = 'super-secret-admin-token-abcdef';
  const hash = createHash('sha256').update(raw, 'utf8').digest('hex');
  const cfg = loadAdminConfig({ QV_ADMIN_TOKEN_SHA256: hash });
  const verdict = checkAdmin({ headers: { authorization: `Bearer ${raw}` } }, cfg);
  assert.equal(verdict.ok, true);
});

test('checkAdmin: hashed mode — wrong token rejected', () => {
  const hash = createHash('sha256').update('real-token', 'utf8').digest('hex');
  const cfg = loadAdminConfig({ QV_ADMIN_TOKEN_SHA256: hash });
  const verdict = checkAdmin({ headers: { authorization: 'Bearer wrong-token' } }, cfg);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, 'bad_token');
});

test('checkAdmin: different-length wrong token does not crash, rejects', () => {
  const cfg = loadAdminConfig({ QV_ADMIN_TOKEN: 'a'.repeat(32) });
  for (const bad of ['', 'x', 'short', 'a'.repeat(1000)]) {
    const v = checkAdmin({ headers: { authorization: `Bearer ${bad}` } }, cfg);
    if (bad === '') {
      assert.equal(v.reason, 'no_token'); // empty strips to null in extractBearer
    } else {
      assert.equal(v.ok, false);
      assert.equal(v.reason, 'bad_token');
    }
  }
});

test('checkAdmin: null config returns misconfigured', () => {
  assert.deepEqual(checkAdmin({ headers: {} }, null), { ok: false, reason: 'misconfigured' });
});

// ─── requireAdmin (middleware) ──────────────────────────────────────────────

function mockRes() {
  const chunks = [];
  return {
    _status:  null,
    _headers: null,
    _body:    '',
    writeHead(status, headers) { this._status = status; this._headers = headers; },
    end(b) { this._body = String(b ?? ''); },
    setHeader() {},
  };
}

test('requireAdmin: rejects anonymous request with 401', async () => {
  const cfg = loadAdminConfig({ QV_ADMIN_TOKEN: 'a'.repeat(32) });
  let innerCalled = false;
  const handler = requireAdmin(async () => { innerCalled = true; }, cfg);
  const res = mockRes();
  await handler({ headers: {} }, res);
  assert.equal(res._status, 401);
  assert.equal(res._headers['www-authenticate'], 'Bearer realm="qv-admin"');
  const body = JSON.parse(res._body);
  assert.equal(body.error.code, 'UNAUTHORIZED');
  assert.equal(innerCalled, false);
});

test('requireAdmin: 401 body never reveals reason', async () => {
  const cfg = loadAdminConfig({ QV_ADMIN_TOKEN: 'a'.repeat(32) });
  const handler = requireAdmin(async () => {}, cfg);
  const resNoToken  = mockRes();  await handler({ headers: {} }, resNoToken);
  const resBadToken = mockRes();  await handler({ headers: { authorization: 'Bearer wrong-token-value-padded-out' } }, resBadToken);
  assert.equal(resNoToken._body, resBadToken._body,
    'no_token and bad_token responses must be byte-identical');
});

test('requireAdmin: passes through on valid creds', async () => {
  const cfg = loadAdminConfig({ QV_ADMIN_TOKEN: 'a'.repeat(32) });
  let innerCalled = false;
  const handler = requireAdmin(async (req, res) => {
    innerCalled = true;
    res.writeHead(200, {}); res.end('{"ok":true}');
  }, cfg);
  const res = mockRes();
  await handler({ headers: { authorization: 'Bearer ' + 'a'.repeat(32) } }, res);
  assert.equal(innerCalled, true);
  assert.equal(res._status, 200);
});

test('requireAdmin: onAuth hook fires on every decision', async () => {
  const cfg = loadAdminConfig({ QV_ADMIN_TOKEN: 'a'.repeat(32) });
  const events = [];
  const handler = requireAdmin(
    async (_req, res) => { res.writeHead(200, {}); res.end('{}'); },
    cfg,
    { onAuth: (_req, verdict) => events.push(verdict.reason) },
  );
  await handler({ headers: {} }, mockRes());
  await handler({ headers: { authorization: 'Bearer xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' } }, mockRes());
  await handler({ headers: { authorization: 'Bearer ' + 'a'.repeat(32) } }, mockRes());
  assert.deepEqual(events, ['no_token', 'bad_token', 'ok']);
});

// ─── mintAdminToken ─────────────────────────────────────────────────────────

test('mintAdminToken: returns raw + matching sha256', () => {
  const { token, sha256 } = mintAdminToken();
  assert.ok(token.length >= 40, 'base64url of 32 bytes is 43 chars');
  const expected = createHash('sha256').update(token, 'utf8').digest('hex');
  assert.equal(sha256, expected);
});
