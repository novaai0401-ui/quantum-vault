/**
 * Unit tests for qv-server/metrics.mjs
 * Run: node --test qv-server/test/metrics.test.mjs
 */

import { test } from 'node:test';
import assert   from 'node:assert/strict';
import { createMetrics, loadMetricsConfig, HTTP_BUCKETS } from '../metrics.mjs';

test('counter: increments and renders TYPE line', () => {
  const m = createMetrics();
  const c = m.counter('qv_test_total', { help: 'test counter' });
  c.inc({ kind: 'a' });
  c.inc({ kind: 'a' });
  c.inc({ kind: 'b' }, 5);
  const out = m.render();
  assert.match(out, /# HELP qv_test_total test counter/);
  assert.match(out, /# TYPE qv_test_total counter/);
  assert.match(out, /qv_test_total\{kind="a"\} 2/);
  assert.match(out, /qv_test_total\{kind="b"\} 5/);
});

test('counter: no labels renders with no braces', () => {
  const m = createMetrics();
  m.counter('qv_bare_total').inc();
  const out = m.render();
  assert.match(out, /qv_bare_total 1/);
});

test('gauge: set / inc / dec', () => {
  const m = createMetrics();
  const g = m.gauge('qv_thing', { help: 'a thing' });
  g.set(5);
  g.inc();
  g.dec({}, 2);
  const out = m.render();
  assert.match(out, /qv_thing 4/);
});

test('histogram: observes and emits le buckets + sum/count', () => {
  const m = createMetrics({ buckets: [0.1, 0.5, 1] });
  const h = m.histogram('qv_lat', { help: 'latency' });
  h.observe({ path: '/x' }, 0.05);
  h.observe({ path: '/x' }, 0.4);
  h.observe({ path: '/x' }, 2.0);
  const out = m.render();
  assert.match(out, /qv_lat_bucket\{le="0.1",path="\/x"\} 1/);
  assert.match(out, /qv_lat_bucket\{le="0.5",path="\/x"\} 2/);
  assert.match(out, /qv_lat_bucket\{le="1",path="\/x"\} 2/);
  assert.match(out, /qv_lat_bucket\{le="\+Inf",path="\/x"\} 3/);
  assert.match(out, /qv_lat_sum\{path="\/x"\} 2\.45/);
  assert.match(out, /qv_lat_count\{path="\/x"\} 3/);
});

test('label escaping: backslash, quote, newline', () => {
  const m = createMetrics();
  m.counter('qv_esc').inc({ k: 'a"b\\c\nd' });
  const out = m.render();
  assert.match(out, /qv_esc\{k="a\\"b\\\\c\\nd"\} 1/);
});

test('label cardinality: truncates 128+ char label values', () => {
  const m = createMetrics();
  const long = 'x'.repeat(500);
  m.counter('qv_big').inc({ k: long });
  const out = m.render();
  // 128 x's max in the rendered output.
  const match = out.match(/qv_big\{k="(x+)"\}/);
  assert.ok(match);
  assert.ok(match[1].length <= 128);
});

test('HTTP_BUCKETS: tuned for verify latency', () => {
  assert.ok(HTTP_BUCKETS.includes(0.001));
  assert.ok(HTTP_BUCKETS.includes(0.05));
  assert.ok(HTTP_BUCKETS.includes(1));
});

test('loadMetricsConfig: defaults enabled, private', () => {
  assert.deepEqual(loadMetricsConfig({}), { enabled: true, public: false });
});

test('loadMetricsConfig: env overrides', () => {
  assert.deepEqual(
    loadMetricsConfig({ QV_METRICS_DISABLED: 'true', QV_METRICS_PUBLIC: 'true' }),
    { enabled: false, public: true },
  );
});
