// Tests for the Express/Fastify middlewares (local verify mode).
// Run: node --test qv-sdk/test/middleware.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import { generateKeypair, issueTokenWithStore, InMemoryChainStore } from '../src/index.mjs';
import { sigvaultExpress } from '../src/middleware/express.mjs';
import { sigvaultFastify } from '../src/middleware/fastify.mjs';
import { extractToken } from '../src/middleware/core.mjs';

const KEY_ID = 'mw-test-key';
const kp = generateKeypair();

async function freshToken(claims = { sub: 'alice', role: 'admin' }) {
  const { tokenHex } = await issueTokenWithStore({
    store: new InMemoryChainStore(),
    keyId: KEY_ID,
    signingKeySeed: kp.signingKey,
    encryptKey: kp.encryptKey,
    claims,
  });
  return tokenHex;
}

function mockRes() {
  const res = {
    statusCode: null,
    body: null,
    writeHead(status) { res.statusCode = status; },
    end(payload) { res.body = payload ? JSON.parse(payload) : null; },
  };
  return res;
}

function localOptions() {
  return {
    keyId: KEY_ID,
    verifyingKey: kp.verifyingKey,
    encryptKey: kp.encryptKey,
    store: new InMemoryChainStore(),
  };
}

test('express: valid bearer token passes and attaches req.sigvault', async () => {
  const mw = sigvaultExpress(localOptions());
  const token = await freshToken();
  const req = { headers: { authorization: `Bearer ${token}` } };
  const res = mockRes();
  let nexted = false;
  await mw(req, res, () => { nexted = true; });
  assert.equal(nexted, true);
  assert.equal(res.statusCode, null);
  assert.equal(req.sigvault.valid, true);
  assert.equal(req.sigvault.keyId, KEY_ID);
  assert.equal(req.sigvault.claims.sub, 'alice');
});

test('express: missing token → 401 TOKEN_MISSING', async () => {
  const mw = sigvaultExpress(localOptions());
  const req = { headers: {} };
  const res = mockRes();
  let nexted = false;
  await mw(req, res, () => { nexted = true; });
  assert.equal(nexted, false);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error.code, 'TOKEN_MISSING');
});

test('express: tampered token → 401, handler never runs', async () => {
  const mw = sigvaultExpress(localOptions());
  const token = await freshToken();
  const bad = token.slice(0, -4) + 'dead';
  const req = { headers: { authorization: `Bearer ${bad}` } };
  const res = mockRes();
  let nexted = false;
  await mw(req, res, () => { nexted = true; });
  assert.equal(nexted, false);
  assert.equal(res.statusCode, 401);
});

test('express: replayed token → 401 REPLAY on second use', async () => {
  const mw = sigvaultExpress(localOptions()); // one shared store across calls
  const token = await freshToken();
  const mk = () => ({ headers: { authorization: `Bearer ${token}` } });
  const res1 = mockRes(), res2 = mockRes();
  await mw(mk(), res1, () => {});
  assert.equal(res1.statusCode, null); // first use fine
  let nexted = false;
  await mw(mk(), res2, () => { nexted = true; });
  assert.equal(nexted, false);
  assert.equal(res2.statusCode, 401);
  assert.equal(res2.body.error.code, 'REPLAY');
});

test('express: custom header + empty scheme extraction', async () => {
  const mw = sigvaultExpress({ ...localOptions(), header: 'x-qv-token', scheme: '' });
  const token = await freshToken();
  const req = { headers: { 'x-qv-token': token } };
  const res = mockRes();
  let nexted = false;
  await mw(req, res, () => { nexted = true; });
  assert.equal(nexted, true);
  assert.equal(req.sigvault.claims.role, 'admin');
});

test('extractToken: rejects wrong scheme, trims whitespace', () => {
  assert.equal(extractToken({ headers: { authorization: 'Basic abc' } }), null);
  assert.equal(extractToken({ headers: { authorization: 'Bearer  abc ' } }), 'abc');
  assert.equal(extractToken({ headers: {} }), null);
});

test('fastify: preHandler hook verifies and 401s like express', async () => {
  // Minimal fastify stand-in: capture the preHandler hook.
  let hook = null;
  const fakeFastify = { addHook: (name, fn) => { assert.equal(name, 'preHandler'); hook = fn; } };
  await sigvaultFastify(fakeFastify, localOptions());
  assert.equal(typeof hook, 'function');

  const token = await freshToken();
  const mkReply = () => {
    const r = { statusCode: null, body: null };
    r.code = (s) => { r.statusCode = s; return r; };
    r.send = (b) => { r.body = b; return r; };
    return r;
  };

  const okReq = { headers: { authorization: `Bearer ${token}` } };
  const okReply = mkReply();
  await hook(okReq, okReply);
  assert.equal(okReply.statusCode, null);
  assert.equal(okReq.sigvault.claims.sub, 'alice');

  const badReply = mkReply();
  await hook({ headers: {} }, badReply);
  assert.equal(badReply.statusCode, 401);
  assert.equal(badReply.body.error.code, 'TOKEN_MISSING');
});

test('config validation: neither serverUrl nor local keys throws', () => {
  assert.throws(() => sigvaultExpress({}), /serverUrl.*or.*keyId|pass either/);
});
