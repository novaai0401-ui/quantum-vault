// qv-audit.mjs — forensic CLI tests. Drive the script with synthetic
// JSONL fed via stdin so we don't depend on a real audit log.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT    = resolve(__dirname, '..', 'qv-audit.mjs');

function run(stdinText, ...args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    input: stdinText,
    encoding: 'utf8',
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

const sample = [
  { ts: '2026-04-01T10:00:00.000Z', level: 'info', event: 'http.request', requestId: 'r1', traceId: 't1', ip: '10.0.0.1', method: 'POST', template: '/v3/token/issue', status: 200, ms: 4.2, keyId: 'k-aaaa' },
  { ts: '2026-04-01T10:00:01.000Z', level: 'warn', event: 'auth.deny', requestId: 'r2', ip: '10.0.0.2', reason: 'bad_token' },
  { ts: '2026-04-01T10:00:02.000Z', level: 'info', event: 'token.issue', requestId: 'r3', keyId: 'k-bbbb' },
  { ts: '2026-04-01T10:00:03.000Z', level: 'warn', event: 'ratelimit.deny', requestId: 'r4', ip: '10.0.0.1', reason: 'per_key_rate', keyId: 'k-aaaa' },
  { ts: '2026-04-01T10:00:04.000Z', level: 'info', event: 'http.request', requestId: 'r5', method: 'POST', template: '/v3/token/verify', status: 422, ms: 1.1 },
  { ts: '2026-04-01T10:00:05.000Z', level: 'info', event: 'http.request', requestId: 'r6', method: 'POST', template: '/v3/token/issue', status: 500, ms: 50.0 },
].map(o => JSON.stringify(o)).join('\n') + '\n';

test('--event filters by event name', () => {
  const r = run(sample, '--event', 'auth.deny', '--format', 'json');
  assert.equal(r.code, 0);
  const lines = r.out.trim().split('\n').filter(Boolean);
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).requestId, 'r2');
});

test('--key-id filter', () => {
  const r = run(sample, '--key-id', 'k-aaaa', '--format', 'json');
  const lines = r.out.trim().split('\n').filter(Boolean);
  assert.equal(lines.length, 2);
});

test('--status 5xx', () => {
  const r = run(sample, '--status', '5xx', '--format', 'json');
  const lines = r.out.trim().split('\n').filter(Boolean);
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).status, 500);
});

test('--status exact match', () => {
  const r = run(sample, '--status', '422', '--format', 'json');
  const lines = r.out.trim().split('\n').filter(Boolean);
  assert.equal(lines.length, 1);
});

test('--since and --until window', () => {
  const r = run(sample,
    '--since', '2026-04-01T10:00:02.000Z',
    '--until', '2026-04-01T10:00:04.000Z',
    '--format', 'json');
  const lines = r.out.trim().split('\n').filter(Boolean);
  assert.equal(lines.length, 2, `expected 2 lines, got ${lines.length}`);
});

test('--reason matches denials', () => {
  const r = run(sample, '--reason', 'per_key_rate', '--format', 'json');
  const lines = r.out.trim().split('\n').filter(Boolean);
  assert.equal(lines.length, 1);
});

test('--summary prints counts and percentiles', () => {
  const r = run(sample, '--summary');
  assert.equal(r.code, 0);
  assert.match(r.out, /total events: 6/);
  assert.match(r.out, /http\.request/);
  assert.match(r.out, /by status:/);
  assert.match(r.out, /latency over 3 samples/);
  assert.match(r.out, /p50 /);
});

test('--summary --format json', () => {
  const r = run(sample, '--summary', '--format', 'json');
  const obj = JSON.parse(r.out);
  assert.equal(obj.total, 6);
  assert.equal(obj.events['http.request'], 3);
  assert.equal(obj.latencyMs.n, 3);
  assert.ok(obj.latencyMs.p50 !== null);
});

test('--top events 3', () => {
  const r = run(sample, '--top', 'events', '3');
  assert.match(r.out, /top 3 events:/);
});

test('--grep substring match', () => {
  const r = run(sample, '--grep', 'k-bbbb', '--format', 'json');
  const lines = r.out.trim().split('\n').filter(Boolean);
  assert.equal(lines.length, 1);
});

test('non-JSON lines are silently skipped', () => {
  const noisy = '== banner ==\n' + sample + 'garbage line\n';
  const r = run(noisy, '--event', 'auth.deny', '--format', 'json');
  const lines = r.out.trim().split('\n').filter(Boolean);
  assert.equal(lines.length, 1);
});

test('zero-match prints hint to stderr in human mode', () => {
  const r = run(sample, '--event', 'never.happens');
  assert.equal(r.code, 0);
  assert.match(r.err, /no events matched/);
});

test('--help exits 0 with usage text', () => {
  const r = run('', '--help');
  assert.equal(r.code, 0);
  assert.match(r.out, /qv-audit/);
  assert.match(r.out, /Filters/);
});

test('TSV format produces tab-separated columns', () => {
  const r = run(sample, '--event', 'http.request', '--format', 'tsv');
  // Don't trim() — the audit script may emit a trailing TAB before \n
  // (because the last column, traceId, can be empty). trim() would
  // strip that tab and produce a column-count off-by-one.
  const lines = r.out.split('\n').filter(Boolean);
  assert.equal(lines.length, 3);
  for (const line of lines) {
    assert.equal(line.split('\t').length, 12,
      `expected 12 cols, got ${line.split('\t').length} for line: ${JSON.stringify(line)}`);
  }
});
