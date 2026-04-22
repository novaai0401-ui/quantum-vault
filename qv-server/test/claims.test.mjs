/**
 * Unit tests for qv-server/claims.mjs
 * Run: node --test qv-server/test/claims.test.mjs
 */
import { test } from 'node:test';
import assert   from 'node:assert/strict';
import { loadClaimsConfig, validateClaims } from '../claims.mjs';

test('loadClaimsConfig: defaults', () => {
  const c = loadClaimsConfig({});
  assert.equal(c.maxDepth, 8);
  assert.equal(c.maxKeys, 64);
  assert.equal(c.maxArray, 128);
  assert.equal(c.maxString, 4096);
  assert.equal(c.maxNodes, 1024);
});

test('loadClaimsConfig: env overrides', () => {
  const c = loadClaimsConfig({ QV_CLAIMS_MAX_DEPTH: '3', QV_CLAIMS_MAX_KEYS: '10' });
  assert.equal(c.maxDepth, 3);
  assert.equal(c.maxKeys, 10);
});

test('loadClaimsConfig: rejects non-integer', () => {
  assert.throws(() => loadClaimsConfig({ QV_CLAIMS_MAX_DEPTH: 'abc' }), /integer/);
});

test('loadClaimsConfig: rejects out-of-range', () => {
  assert.throws(() => loadClaimsConfig({ QV_CLAIMS_MAX_DEPTH: '999' }), /\[1, 64\]/);
});

test('validateClaims: normal object passes', () => {
  assert.equal(validateClaims({ sub: 'alice', roles: ['admin','user'], meta: { ip: '127.0.0.1' } }), true);
});

test('validateClaims: rejects non-object root', () => {
  assert.throws(() => validateClaims('hello'), /CLAIMS_NOT_OBJECT|must be a JSON object/);
  assert.throws(() => validateClaims([1,2,3]), /must be a JSON object/);
  assert.throws(() => validateClaims(null), /must be a JSON object/);
});

test('validateClaims: rejects too deep', () => {
  let v = { a: 1 };
  for (let i = 0; i < 20; i++) v = { inner: v };
  assert.throws(() => validateClaims(v), /CLAIMS_TOO_DEEP|max depth/);
});

test('validateClaims: rejects too many keys', () => {
  const big = {};
  for (let i = 0; i < 100; i++) big['k' + i] = i;
  assert.throws(() => validateClaims(big), /CLAIMS_TOO_MANY_KEYS|max keys|64 keys/);
});

test('validateClaims: rejects oversized array', () => {
  const arr = new Array(200).fill(0);
  assert.throws(() => validateClaims({ arr }), /CLAIMS_ARRAY_TOO_LARGE|128 elements/);
});

test('validateClaims: rejects overlong string', () => {
  assert.throws(() => validateClaims({ s: 'x'.repeat(5000) }), /CLAIMS_STRING_TOO_LONG|4096 chars/);
});

test('validateClaims: rejects NaN / Infinity', () => {
  assert.throws(() => validateClaims({ x: NaN }), /finite/);
  assert.throws(() => validateClaims({ x: Infinity }), /finite/);
});

test('validateClaims: respects custom config', () => {
  const cfg = loadClaimsConfig({ QV_CLAIMS_MAX_KEYS: '2' });
  assert.throws(() => validateClaims({ a: 1, b: 2, c: 3 }, cfg), /2 keys/);
  assert.equal(validateClaims({ a: 1, b: 2 }, cfg), true);
});

test('validateClaims: rejects too many nodes', () => {
  const cfg = loadClaimsConfig({ QV_CLAIMS_MAX_NODES: '10' });
  const obj = { a: [1,2,3,4,5,6,7,8,9,10,11,12] };
  assert.throws(() => validateClaims(obj, cfg), /CLAIMS_TOO_MANY_NODES|max nodes/);
});

test('validateClaims: includes stable error code', () => {
  try { validateClaims({ arr: new Array(1000).fill(0) }); }
  catch (e) { assert.equal(e.code, 'CLAIMS_ARRAY_TOO_LARGE'); return; }
  assert.fail('should have thrown');
});
