import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { writeFileDurable, cleanupStaleTmp } from '../durable.mjs';

function tdir() { return mkdtempSync(join(tmpdir(), 'qv-durable-')); }

test('writeFileDurable writes bytes and no tmp remains', () => {
  const d = tdir();
  const p = join(d, 'x.json');
  writeFileDurable(p, '{"a":1}');
  assert.equal(readFileSync(p, 'utf8'), '{"a":1}');
  assert.ok(!existsSync(`${p}.tmp`), 'tmp sibling must be cleaned up by rename');
  rmSync(d, { recursive: true, force: true });
});

test('writeFileDurable overwrites atomically', () => {
  const d = tdir();
  const p = join(d, 'x.json');
  writeFileDurable(p, 'v1');
  writeFileDurable(p, 'v2');
  assert.equal(readFileSync(p, 'utf8'), 'v2');
  rmSync(d, { recursive: true, force: true });
});

test('writeFileDurable accepts Uint8Array', () => {
  const d = tdir();
  const p = join(d, 'x.bin');
  const buf = new Uint8Array([1, 2, 3, 4]);
  writeFileDurable(p, buf);
  const got = readFileSync(p);
  assert.deepEqual([...got], [1, 2, 3, 4]);
  rmSync(d, { recursive: true, force: true });
});

test('writeFileDurable honours mode on POSIX', () => {
  if (process.platform === 'win32') return; // chmod semantics differ
  const d = tdir();
  const p = join(d, 'x.json');
  writeFileDurable(p, 'secret', { mode: 0o600 });
  const mode = statSync(p).mode & 0o777;
  assert.equal(mode, 0o600, `expected 0600, got 0${mode.toString(8)}`);
  rmSync(d, { recursive: true, force: true });
});

test('cleanupStaleTmp removes an orphan tmp file', () => {
  const d = tdir();
  const p = join(d, 'x.json');
  writeFileSync(`${p}.tmp`, 'orphan');
  assert.ok(existsSync(`${p}.tmp`));
  cleanupStaleTmp(p);
  assert.ok(!existsSync(`${p}.tmp`));
  rmSync(d, { recursive: true, force: true });
});

test('cleanupStaleTmp is a no-op when no tmp exists', () => {
  const d = tdir();
  const p = join(d, 'nope.json');
  cleanupStaleTmp(p); // must not throw
  assert.equal(readdirSync(d).length, 0);
  rmSync(d, { recursive: true, force: true });
});

test('simulated crash between tmp-write and rename leaves original intact', () => {
  // We can't actually crash the process, but we can verify the invariant:
  // if a .tmp is orphaned, the real file (if any) is untouched.
  const d = tdir();
  const p = join(d, 'x.json');
  writeFileDurable(p, 'good');
  writeFileSync(`${p}.tmp`, 'half-written-garbage'); // simulate crash
  assert.equal(readFileSync(p, 'utf8'), 'good');
  // Next legit write cleans up tmp and succeeds.
  writeFileDurable(p, 'better');
  assert.equal(readFileSync(p, 'utf8'), 'better');
  assert.ok(!existsSync(`${p}.tmp`));
  rmSync(d, { recursive: true, force: true });
});
