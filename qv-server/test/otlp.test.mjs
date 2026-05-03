import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';

import { loadOtlpConfig, auditToSpan, buildPayload, createOtlpExporter } from '../otlp.mjs';

test('loadOtlpConfig: disabled when QV_OTLP_ENDPOINT unset', () => {
  const cfg = loadOtlpConfig({});
  assert.equal(cfg.enabled, false);
});

test('loadOtlpConfig: rejects non-http(s) endpoint', () => {
  assert.throws(() => loadOtlpConfig({ QV_OTLP_ENDPOINT: 'ftp://x/' }));
});

test('loadOtlpConfig: parses defaults', () => {
  const cfg = loadOtlpConfig({ QV_OTLP_ENDPOINT: 'http://collector:4318/v1/traces' });
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.batchMax, 128);
  assert.equal(cfg.flushMs, 5000);
});

test('auditToSpan: returns null on non-span audit event', () => {
  assert.equal(auditToSpan(null), null);
  assert.equal(auditToSpan({}), null);
  assert.equal(auditToSpan({ traceId: 'x' }), null);
});

test('auditToSpan: builds span from a request event', () => {
  const ev = {
    ts: '2026-04-30T12:00:00.000Z',
    event: 'http.request',
    requestId: 'req-1',
    traceId: 'a'.repeat(32),
    spanId:  'b'.repeat(16),
    parentSpanId: 'c'.repeat(16),
    method: 'POST', path: '/v3/token/issue', template: '/v3/token/issue',
    status: 200, ms: 12.34,
    ip: '127.0.0.1',
  };
  const span = auditToSpan(ev);
  assert.equal(span.traceId, ev.traceId);
  assert.equal(span.spanId,  ev.spanId);
  assert.equal(span.parentSpanId, ev.parentSpanId);
  assert.equal(span.name, '/v3/token/issue');
  assert.equal(span.kind, 2); // SERVER
  assert.equal(span.status.code, 1); // OK
  // Find the http.status_code attribute
  const code = span.attributes.find(a => a.key === 'http.status_code');
  assert.equal(code.value.intValue, '200');
});

test('auditToSpan: maps 5xx to ERROR status', () => {
  const span = auditToSpan({
    traceId: 'a'.repeat(32), spanId: 'b'.repeat(16),
    ts: '2026-04-30T12:00:00.000Z', event: 'http.request', status: 503, ms: 1,
  });
  assert.equal(span.status.code, 2); // ERROR
});

test('buildPayload: shapes a CycloneDX-free OTLP/JSON envelope', () => {
  const span = auditToSpan({
    traceId: 'a'.repeat(32), spanId: 'b'.repeat(16),
    ts: '2026-04-30T12:00:00.000Z', event: 'http.request', status: 200, ms: 1,
  });
  const p = buildPayload([span]);
  assert.equal(p.resourceSpans.length, 1);
  assert.equal(p.resourceSpans[0].scopeSpans[0].spans.length, 1);
  // Service identity is stamped
  const svc = p.resourceSpans[0].resource.attributes.find(a => a.key === 'service.name');
  assert.equal(svc.value.stringValue, 'sigvault-server');
});

test('createOtlpExporter: posts a batch to the configured endpoint', async () => {
  const captured = [];
  const srv = createServer((req, res) => {
    let chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try { captured.push(JSON.parse(Buffer.concat(chunks).toString())); } catch {}
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    });
  });
  srv.listen(0);
  await once(srv, 'listening');
  const port = srv.address().port;

  try {
    const cfg = loadOtlpConfig({
      QV_OTLP_ENDPOINT: `http://127.0.0.1:${port}/v1/traces`,
      QV_OTLP_BATCH_MAX: '2',
      QV_OTLP_FLUSH_MS: '50',
    });
    const exp = createOtlpExporter(cfg);
    for (let i = 0; i < 3; i++) {
      exp.onAuditEvent({
        traceId: 'a'.repeat(32), spanId: 'b'.repeat(16),
        ts: new Date().toISOString(), event: 'http.request', status: 200, ms: 1,
      });
    }
    await exp.flush();
    await new Promise(r => setTimeout(r, 200));
    await exp.flush();
    exp.stop();
  } finally {
    srv.close();
  }

  assert.ok(captured.length >= 1, `expected at least 1 batch, got ${captured.length}`);
  assert.ok(captured[0].resourceSpans, 'first batch is not OTLP-shaped');
});

test('createOtlpExporter: silent no-op when disabled', () => {
  const exp = createOtlpExporter({ enabled: false });
  exp.onAuditEvent({ anything: 'yes' });
  exp.stop(); // must not throw
});
