/**
 * Unit tests for qv-server/trace.mjs
 * Run: node --test qv-server/test/trace.test.mjs
 */
import { test } from 'node:test';
import assert   from 'node:assert/strict';
import {
  parseTraceparent, sanitizeTracestate, deriveTraceContext,
  formatTraceparent, applyTrace,
} from '../trace.mjs';

test('parseTraceparent: valid header', () => {
  const v = parseTraceparent('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01');
  assert.ok(v);
  assert.equal(v.traceId, '4bf92f3577b34da6a3ce929d0e0e4736');
  assert.equal(v.parentSpanId, '00f067aa0ba902b7');
  assert.equal(v.sampled, true);
});

test('parseTraceparent: rejects version != 00', () => {
  assert.equal(parseTraceparent('01-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'), null);
});

test('parseTraceparent: rejects all-zero trace or span id', () => {
  assert.equal(parseTraceparent('00-00000000000000000000000000000000-00f067aa0ba902b7-01'), null);
  assert.equal(parseTraceparent('00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01'), null);
});

test('parseTraceparent: rejects malformed', () => {
  assert.equal(parseTraceparent('not-a-traceparent'), null);
  assert.equal(parseTraceparent(''), null);
  assert.equal(parseTraceparent(undefined), null);
});

test('parseTraceparent: sampled flag low bit only', () => {
  assert.equal(parseTraceparent('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-00').sampled, false);
  assert.equal(parseTraceparent('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01').sampled, true);
  assert.equal(parseTraceparent('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-03').sampled, true);
});

test('sanitizeTracestate: passes printable ascii', () => {
  assert.equal(sanitizeTracestate('vendor=value,other=123'), 'vendor=value,other=123');
});

test('sanitizeTracestate: rejects overlong', () => {
  assert.equal(sanitizeTracestate('a'.repeat(600)), null);
});

test('sanitizeTracestate: rejects control chars', () => {
  assert.equal(sanitizeTracestate('vendor=val\x00ue'), null);
});

test('deriveTraceContext: inherits from traceparent', () => {
  const req = { headers: { traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01' } };
  const ctx = deriveTraceContext(req);
  assert.equal(ctx.traceId, '4bf92f3577b34da6a3ce929d0e0e4736');
  assert.equal(ctx.parentSpanId, '00f067aa0ba902b7');
  assert.notEqual(ctx.spanId, ctx.parentSpanId);
  assert.equal(ctx.spanId.length, 16);
  assert.equal(ctx.sampled, true);
  assert.equal(ctx.inherited, true);
});

test('deriveTraceContext: mints fresh when missing', () => {
  const ctx = deriveTraceContext({ headers: {} });
  assert.equal(ctx.traceId.length, 32);
  assert.equal(ctx.spanId.length, 16);
  assert.equal(ctx.parentSpanId, null);
  assert.equal(ctx.sampled, false);
  assert.equal(ctx.inherited, false);
});

test('formatTraceparent: round-trips', () => {
  const ctx = { traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), sampled: true };
  const s = formatTraceparent(ctx);
  assert.equal(s, `00-${ctx.traceId}-${ctx.spanId}-01`);
  const reparsed = parseTraceparent(s);
  assert.equal(reparsed.traceId, ctx.traceId);
});

test('applyTrace: attaches ctx and sets response header', () => {
  const headers = {};
  const res = { setHeader(k, v) { headers[k] = v; } };
  const req = { headers: { traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01' } };
  const ctx = applyTrace(req, res);
  assert.ok(req.trace);
  assert.equal(req.trace.traceId, ctx.traceId);
  assert.ok(headers.traceparent.startsWith('00-4bf92f3577b34da6a3ce929d0e0e4736-'));
});

test('applyTrace: echoes tracestate when present', () => {
  const headers = {};
  const res = { setHeader(k, v) { headers[k] = v; } };
  const req = { headers: {
    traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
    tracestate:  'vendor=value',
  } };
  applyTrace(req, res);
  assert.equal(headers.tracestate, 'vendor=value');
});
