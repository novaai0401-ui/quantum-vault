/**
 * Unit tests for qv-server/cidr.mjs
 * Run: node --test qv-server/test/cidr.test.mjs
 */
import { test } from 'node:test';
import assert   from 'node:assert/strict';
import { loadCidrList, matchesAny, loadCidrConfig } from '../cidr.mjs';

test('empty list = pass-through', () => {
  assert.equal(matchesAny('1.2.3.4', []), true);
  assert.equal(matchesAny('::1',     []), true);
});

test('v4 exact match (implicit /32)', () => {
  const l = loadCidrList('10.0.0.1');
  assert.equal(matchesAny('10.0.0.1', l), true);
  assert.equal(matchesAny('10.0.0.2', l), false);
});

test('v4 /24 subnet', () => {
  const l = loadCidrList('10.0.0.0/24');
  assert.equal(matchesAny('10.0.0.1',   l), true);
  assert.equal(matchesAny('10.0.0.255', l), true);
  assert.equal(matchesAny('10.0.1.0',   l), false);
});

test('v4 /8 subnet', () => {
  const l = loadCidrList('10.0.0.0/8');
  assert.equal(matchesAny('10.1.2.3', l), true);
  assert.equal(matchesAny('11.0.0.0', l), false);
});

test('multiple ranges', () => {
  const l = loadCidrList('10.0.0.0/8, 192.168.0.0/16');
  assert.equal(matchesAny('10.5.5.5',     l), true);
  assert.equal(matchesAny('192.168.1.1',  l), true);
  assert.equal(matchesAny('8.8.8.8',      l), false);
});

test('v6 /128 exact', () => {
  const l = loadCidrList('::1');
  assert.equal(matchesAny('::1', l), true);
  assert.equal(matchesAny('::2', l), false);
});

test('v6 /64 subnet', () => {
  const l = loadCidrList('fd00::/8');
  assert.equal(matchesAny('fd12::1', l), true);
  assert.equal(matchesAny('fe80::1', l), false);
});

test('v4-in-v6 (::ffff:a.b.c.d) matches v6 rules only', () => {
  const l = loadCidrList('::ffff:10.0.0.0/104'); // last 24 bits form 10.0.0.0/0
  assert.equal(matchesAny('::ffff:10.1.2.3', l), true);
});

test('cross-family never matches', () => {
  const lv4 = loadCidrList('10.0.0.0/8');
  assert.equal(matchesAny('::1', lv4), false);
  const lv6 = loadCidrList('::/0');
  assert.equal(matchesAny('1.2.3.4', lv6), false);
});

test('rejects invalid CIDR', () => {
  assert.throws(() => loadCidrList('nonsense'), /invalid CIDR/);
  assert.throws(() => loadCidrList('10.0.0.0/99'), /invalid CIDR mask/);
  assert.throws(() => loadCidrList('300.0.0.0/8'), /invalid CIDR/);
});

test('loadCidrConfig: metrics falls back to admin', () => {
  const c = loadCidrConfig({ QV_ADMIN_ALLOW_CIDRS: '10.0.0.0/8' });
  assert.equal(c.admin.length,   1);
  assert.equal(c.metrics.length, 1);
});

test('loadCidrConfig: explicit metrics empty string = empty', () => {
  const c = loadCidrConfig({ QV_ADMIN_ALLOW_CIDRS: '10.0.0.0/8', QV_METRICS_ALLOW_CIDRS: '' });
  assert.equal(c.admin.length,   1);
  assert.equal(c.metrics.length, 0);
});

test('ignores zone id / whitespace', () => {
  const l = loadCidrList('fe80::1/128');
  assert.equal(matchesAny('fe80::1%eth0', l), true);
});
