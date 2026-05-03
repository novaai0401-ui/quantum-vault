import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadMasterKey, __testing__ } from '../master-key.mjs';
const { decodeHex } = __testing__;

const HEX = 'ab'.repeat(32); // 64 hex chars
const BUF = Buffer.from(HEX, 'hex');

function tdir() { return mkdtempSync(join(tmpdir(), 'qv-mk-')); }

/* ── decodeHex ─────────────────────────────────────────────────────────── */

test('decodeHex accepts a clean 64-hex string', () => {
  const buf = decodeHex(HEX, 'unit');
  assert.equal(buf.length, 32);
  assert.deepEqual([...buf], [...BUF]);
});

test('decodeHex extracts the first 64-hex run from wrapped output', () => {
  const wrapped = `key=${HEX}\nfetched_at=2026-04-01\n`;
  const buf = decodeHex(wrapped, 'unit');
  assert.deepEqual([...buf], [...BUF]);
});

test('decodeHex rejects too-short input', () => {
  assert.throws(() => decodeHex('deadbeef', 'unit'), /≥64 hex chars/);
});

test('decodeHex rejects 64-char non-hex string', () => {
  assert.throws(() => decodeHex('z'.repeat(64), 'unit'), /no 64-char hex run/);
});

/* ── env backend ───────────────────────────────────────────────────────── */

test('env: explicit provider, key returned', () => {
  const r = loadMasterKey({ filePath: '/tmp/never', env: {
    QV_MASTER_KEY_PROVIDER: 'env',
    QV_MASTER_KEY_HEX: HEX,
  } });
  assert.equal(r.source, 'env');
  assert.deepEqual([...r.key], [...BUF]);
});

test('env: missing var raises MK_ENV_MISSING', () => {
  assert.throws(
    () => loadMasterKey({ filePath: '/tmp/never', env: { QV_MASTER_KEY_PROVIDER: 'env' } }),
    /MK_ENV_MISSING|not set/);
});

test('env: invalid hex rejected', () => {
  assert.throws(() => loadMasterKey({
    filePath: '/tmp/never',
    env: { QV_MASTER_KEY_PROVIDER: 'env', QV_MASTER_KEY_HEX: 'not-hex'.repeat(10) },
  }), /no 64-char hex run|hex decoded/);
});

/* ── file backend ──────────────────────────────────────────────────────── */

test('file: generate-on-miss writes 32 bytes with 0600', () => {
  const d = tdir();
  const p = join(d, 'master.key');
  const r = loadMasterKey({ filePath: p, env: { QV_MASTER_KEY_PROVIDER: 'file' } });
  assert.equal(r.source, 'file');
  assert.equal(r.generated, true);
  assert.equal(r.key.length, 32);
  assert.equal(readFileSync(p).length, 32);
  if (process.platform !== 'win32') {
    assert.equal(statSync(p).mode & 0o777, 0o600);
  }
  rmSync(d, { recursive: true, force: true });
});

test('file: existing key is read, not regenerated', () => {
  const d = tdir();
  const p = join(d, 'master.key');
  writeFileSync(p, BUF, { mode: 0o600 });
  const r = loadMasterKey({ filePath: p, env: { QV_MASTER_KEY_PROVIDER: 'file' } });
  assert.equal(r.source, 'file');
  assert.notEqual(r.generated, true);
  assert.deepEqual([...r.key], [...BUF]);
  rmSync(d, { recursive: true, force: true });
});

test('file: wrong-length file is rejected', () => {
  const d = tdir();
  const p = join(d, 'master.key');
  writeFileSync(p, Buffer.alloc(16));
  assert.throws(
    () => loadMasterKey({ filePath: p, env: { QV_MASTER_KEY_PROVIDER: 'file' } }),
    /16 bytes, expected 32/);
  rmSync(d, { recursive: true, force: true });
});

test('file: allowGenerate=false + missing → MK_FILE_MISSING', () => {
  const d = tdir();
  const p = join(d, 'master.key');
  assert.throws(
    () => loadMasterKey({
      filePath: p,
      allowGenerate: false,
      env: { QV_MASTER_KEY_PROVIDER: 'file' },
    }),
    /MK_FILE_MISSING|missing/);
  assert.ok(!existsSync(p), 'must not have generated when forbidden');
  rmSync(d, { recursive: true, force: true });
});

/* ── exec backend ──────────────────────────────────────────────────────── */

test('exec: simple `printf` echoes the key', () => {
  // POSIX & Windows both have a way to print stdin; use node -e for portability.
  const cmd = `node -e "process.stdout.write('${HEX}')"`;
  const r = loadMasterKey({
    filePath: '/tmp/never',
    env: { QV_MASTER_KEY_PROVIDER: 'exec', QV_MASTER_KEY_EXEC: cmd },
  });
  assert.equal(r.source, 'exec');
  assert.deepEqual([...r.key], [...BUF]);
});

test('exec: provider exits non-zero → error includes stderr', () => {
  const cmd = `node -e "process.stderr.write('boom'); process.exit(7)"`;
  assert.throws(
    () => loadMasterKey({
      filePath: '/tmp/never',
      env: { QV_MASTER_KEY_PROVIDER: 'exec', QV_MASTER_KEY_EXEC: cmd },
    }),
    /exited 7.*boom/s);
});

test('exec: empty stdout rejected', () => {
  const cmd = `node -e "process.exit(0)"`;
  assert.throws(
    () => loadMasterKey({
      filePath: '/tmp/never',
      env: { QV_MASTER_KEY_PROVIDER: 'exec', QV_MASTER_KEY_EXEC: cmd },
    }),
    /≥64 hex chars/);
});

test('exec: missing QV_MASTER_KEY_EXEC rejected when explicitly selected', () => {
  assert.throws(
    () => loadMasterKey({
      filePath: '/tmp/never',
      env: { QV_MASTER_KEY_PROVIDER: 'exec' },
    }),
    /must be a non-empty command/);
});

test('exec: stdout with trailing whitespace + newlines accepted', () => {
  const cmd = `node -e "process.stdout.write('  ${HEX}  \\n')"`;
  const r = loadMasterKey({
    filePath: '/tmp/never',
    env: { QV_MASTER_KEY_PROVIDER: 'exec', QV_MASTER_KEY_EXEC: cmd },
  });
  assert.deepEqual([...r.key], [...BUF]);
});

/* ── resolver / auto-mode ─────────────────────────────────────────────── */

test('auto: env beats exec beats file', () => {
  const d = tdir();
  const p = join(d, 'master.key');
  // env present → env wins, even though exec + file would also work.
  const r = loadMasterKey({
    filePath: p,
    env: {
      QV_MASTER_KEY_HEX:  HEX,
      QV_MASTER_KEY_EXEC: `node -e "process.stdout.write('${'cd'.repeat(32)}')"`,
    },
  });
  assert.equal(r.source, 'env');
  assert.deepEqual([...r.key], [...BUF]);
  rmSync(d, { recursive: true, force: true });
});

test('auto: no env → exec runs', () => {
  const d = tdir();
  const cmd = `node -e "process.stdout.write('${HEX}')"`;
  const r = loadMasterKey({
    filePath: join(d, 'master.key'),
    env: { QV_MASTER_KEY_EXEC: cmd },
  });
  assert.equal(r.source, 'exec');
  rmSync(d, { recursive: true, force: true });
});

test('auto: no env or exec → file backend', () => {
  const d = tdir();
  const p = join(d, 'master.key');
  const r = loadMasterKey({ filePath: p, env: {} });
  assert.equal(r.source, 'file');
  rmSync(d, { recursive: true, force: true });
});

test('unknown QV_MASTER_KEY_PROVIDER value rejected', () => {
  assert.throws(
    () => loadMasterKey({ filePath: '/tmp/never', env: { QV_MASTER_KEY_PROVIDER: 'kms' } }),
    /unknown.*'kms'/);
});

test('filePath required', () => {
  assert.throws(() => loadMasterKey({ env: {} }), /filePath is required/);
});
