/**
 * Unit tests for qv-server/audit.mjs
 * Run: node --test qv-server/test/audit.test.mjs
 */

import { test } from 'node:test';
import assert   from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join }   from 'node:path';
import {
  extractOrMintRequestId, applyRequestId,
  loadAuditConfig, createAuditor,
} from '../audit.mjs';

function mockRes() {
  const headers = {};
  return {
    headers,
    setHeader(k, v) { headers[k.toLowerCase()] = String(v); },
  };
}

// ─── Request-Id ─────────────────────────────────────────────────────────────

test('extractOrMintRequestId: accepts valid incoming id', () => {
  const id = extractOrMintRequestId({ headers: { 'x-request-id': 'abc_123.def-XYZ' } });
  assert.equal(id, 'abc_123.def-XYZ');
});

test('extractOrMintRequestId: rejects bad id → mints UUID', () => {
  const id = extractOrMintRequestId({ headers: { 'x-request-id': 'bad id with spaces' } });
  assert.match(id, /^[0-9a-f-]{36}$/);
});

test('extractOrMintRequestId: rejects 65+ char id', () => {
  const long = 'a'.repeat(65);
  const id = extractOrMintRequestId({ headers: { 'x-request-id': long } });
  assert.notEqual(id, long);
  assert.match(id, /^[0-9a-f-]{36}$/);
});

test('extractOrMintRequestId: no header → mints UUID', () => {
  const id = extractOrMintRequestId({ headers: {} });
  assert.match(id, /^[0-9a-f-]{36}$/);
});

test('applyRequestId: sets response header + attaches to req', () => {
  const req = { headers: {} };
  const res = mockRes();
  applyRequestId(req, res, 'my-id-1');
  assert.equal(res.headers['x-request-id'], 'my-id-1');
  assert.equal(req.requestId, 'my-id-1');
});

// ─── Config ─────────────────────────────────────────────────────────────────

test('loadAuditConfig: defaults', () => {
  const cfg = loadAuditConfig({}, '/tmp/x');
  assert.equal(cfg.disabled, false);
  assert.equal(cfg.stdout, true);
  assert.equal(cfg.fileOn, true);
  assert.equal(cfg.path, '/tmp/x/audit.log');
});

test('loadAuditConfig: env overrides', () => {
  const cfg = loadAuditConfig({
    QV_AUDIT_LOG: '/var/log/qv.log',
    QV_AUDIT_STDOUT: 'false',
    QV_AUDIT_FILE: 'false',
  }, '/tmp/x');
  assert.equal(cfg.path, '/var/log/qv.log');
  assert.equal(cfg.stdout, false);
  assert.equal(cfg.fileOn, false);
});

test('loadAuditConfig: disabled flag', () => {
  const cfg = loadAuditConfig({ QV_AUDIT_DISABLED: 'true' }, '/tmp/x');
  assert.equal(cfg.disabled, true);
});

// ─── Auditor ────────────────────────────────────────────────────────────────

test('auditor: disabled → no-op', () => {
  const a = createAuditor({ config: { disabled: true } });
  a.event('anything', { ip: '1.2.3.4' }); // must not throw
  a.close();
});

test('auditor: writes JSONL line per event with canonical fields', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qv-audit-'));
  const path = join(dir, 'audit.log');
  const a = createAuditor({
    config: { disabled: false, stdout: false, fileOn: true, path },
    now: () => new Date('2026-04-21T10:00:00Z'),
  });
  a.event('http.request', {
    requestId: 'r1', ip: '127.0.0.1', method: 'GET', path: '/v3/health', status: 200, ms: 3,
  });
  a.event('auth.deny', {
    requestId: 'r2', ip: '10.0.0.5', reason: 'bad_token', level: 'warn',
  });
  a.close();

  const lines = readFileSync(path, 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
  const e1 = JSON.parse(lines[0]);
  assert.equal(e1.event, 'http.request');
  assert.equal(e1.status, 200);
  assert.equal(e1.requestId, 'r1');
  assert.equal(e1.level, 'info');
  assert.equal(e1.ts, '2026-04-21T10:00:00.000Z');
  const e2 = JSON.parse(lines[1]);
  assert.equal(e2.event, 'auth.deny');
  assert.equal(e2.level, 'warn');
  assert.equal(e2.reason, 'bad_token');

  rmSync(dir, { recursive: true, force: true });
});

test('auditor: blocks known-sensitive keys', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qv-audit-'));
  const path = join(dir, 'audit.log');
  const a = createAuditor({
    config: { disabled: false, stdout: false, fileOn: true, path },
  });
  a.event('test', {
    requestId: 'r1',
    token: 'SECRET-TOKEN-DO-NOT-LOG',
    authorization: 'Bearer xyz',
    masterKey: Buffer.from('deadbeef', 'hex'),
    private_key: 'pk',
    password: 'pw',
    keyId: 'kid-123',
  });
  a.close();
  const txt = readFileSync(path, 'utf8');
  assert.ok(!txt.includes('SECRET-TOKEN-DO-NOT-LOG'));
  assert.ok(!txt.includes('Bearer'));
  assert.ok(!txt.includes('deadbeef'));
  assert.ok(!txt.includes('"password"'));
  assert.ok(txt.includes('"keyId":"kid-123"'));
  rmSync(dir, { recursive: true, force: true });
});

test('auditor: survives unserializable fields', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qv-audit-'));
  const path = join(dir, 'audit.log');
  const a = createAuditor({
    config: { disabled: false, stdout: false, fileOn: true, path },
  });
  const circ = {};
  circ.self = circ;
  a.event('weird', { requestId: 'r1', circ });
  a.close();
  const line = readFileSync(path, 'utf8').trim();
  const parsed = JSON.parse(line);
  assert.equal(parsed.event, 'weird');
  assert.equal(parsed.level, 'error');
  assert.equal(parsed.reason, 'unserializable');
  rmSync(dir, { recursive: true, force: true });
});

test('auditor: file-open failure falls back gracefully (no throw)', () => {
  // Path inside a file-as-directory is invalid on most OSes.
  const a = createAuditor({
    config: { disabled: false, stdout: false, fileOn: true, path: '\0/invalid/\0path' },
  });
  a.event('x', { requestId: 'r' }); // must not throw
  a.close();
});

// ─── Rotation (limitation #6b) ──────────────────────────────────────────────

test('loadAuditConfig: rotation defaults', () => {
  const c = loadAuditConfig({}, '/d');
  assert.equal(c.rotateBytes, 64 * 1024 * 1024);
  assert.equal(c.rotateKeep, 5);
});

test('loadAuditConfig: rotation env overrides', () => {
  const c = loadAuditConfig({ QV_AUDIT_ROTATE_BYTES: '1024', QV_AUDIT_ROTATE_KEEP: '3' }, '/d');
  assert.equal(c.rotateBytes, 1024);
  assert.equal(c.rotateKeep, 3);
});

test('auditor: rotates when file exceeds rotateBytes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qv-rot-'));
  const path = join(dir, 'audit.log');
  const a = createAuditor({
    config: { disabled: false, stdout: false, fileOn: true, path,
              rotateBytes: 200, rotateKeep: 3 },
  });
  // Each event serialises to ~80 bytes; 5 events should trigger at least
  // one rotation.
  for (let i = 0; i < 10; i++) {
    a.event('x', { requestId: 'r', seq: i, pad: 'AAAAAAAAAAAAAAAAAAAAAAAA' });
  }
  a.close();
  // audit.log.1 must exist as a result of rotation.
  // existsSync imported below via dynamic import fallback; use sync check via readFileSync try/catch.
  assert.ok(existsSync(`${path}.1`), 'audit.log.1 should exist after rotation');
  rmSync(dir, { recursive: true, force: true });
});

test('auditor: rotation keeps at most rotateKeep archives', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qv-rot2-'));
  const path = join(dir, 'audit.log');
  const a = createAuditor({
    config: { disabled: false, stdout: false, fileOn: true, path,
              rotateBytes: 150, rotateKeep: 2 },
  });
  for (let i = 0; i < 40; i++) {
    a.event('x', { requestId: 'r', seq: i, pad: 'B'.repeat(40) });
  }
  a.close();
  assert.ok(existsSync(`${path}`),   'active log exists');
  assert.ok(existsSync(`${path}.1`), 'rotated .1 exists');
  assert.ok(existsSync(`${path}.2`), 'rotated .2 exists');
  // Retention of 2 means .3 must never exist.
  assert.ok(!existsSync(`${path}.3`), 'no .3 beyond rotateKeep');
  rmSync(dir, { recursive: true, force: true });
});

test('auditor: rotation disabled when rotateBytes=0', () => {
  // existsSync imported below via dynamic import fallback; use sync check via readFileSync try/catch.
  const dir = mkdtempSync(join(tmpdir(), 'qv-rot3-'));
  const path = join(dir, 'audit.log');
  const a = createAuditor({
    config: { disabled: false, stdout: false, fileOn: true, path,
              rotateBytes: 0, rotateKeep: 5 },
  });
  for (let i = 0; i < 100; i++) a.event('x', { requestId: 'r', seq: i, pad: 'C'.repeat(60) });
  a.close();
  assert.ok(!existsSync(`${path}.1`), 'no rotation should have happened');
  rmSync(dir, { recursive: true, force: true });
});
