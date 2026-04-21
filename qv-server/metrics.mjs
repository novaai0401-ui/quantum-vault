/**
 * QuantumVault — Prometheus metrics (text exposition format, v0.0.4)
 * =====================================================================
 * Zero npm deps. In-process aggregation, exposed at GET /v3/metrics.
 *
 * Exposition format spec: https://prometheus.io/docs/instrumenting/exposition_formats/
 *
 * Design:
 *   - All metrics are process-local. For multi-replica deployments, scrape
 *     each replica and aggregate in Prometheus (standard pattern).
 *   - Label cardinality is carefully bounded: path is the ROUTE TEMPLATE
 *     (e.g., "/v3/keys/:id"), not the raw URL, so path never blows up.
 *   - Histograms use fixed latency buckets tuned for the sub-ms → second
 *     range typical of verify workloads.
 *
 * Authentication:
 *   GET /v3/metrics requires the admin bearer by default. Set
 *   QV_METRICS_PUBLIC=true to expose anonymously (e.g., behind a mesh).
 *
 * Metrics exposed (initial set — more will land as phases progress):
 *   qv_http_requests_total{method,path,status}
 *   qv_http_request_duration_seconds_bucket{method,path,le=…}
 *   qv_http_request_duration_seconds_sum{method,path}
 *   qv_http_request_duration_seconds_count{method,path}
 *   qv_auth_denies_total{reason}
 *   qv_rate_limit_denies_total{category}
 *   qv_token_issue_total{suite,tokenType,result}
 *   qv_token_verify_total{result}
 *   qv_keys_total
 *   qv_revoked_total
 *   qv_inflight_requests
 *   qv_process_uptime_seconds
 */

// ─── Label sanitisation ─────────────────────────────────────────────────────
// Prometheus label values may contain any UTF-8, but we escape " \ \n for
// the text format. Also cap length so nothing pathological makes it out.
function escapeLabel(v) {
  const s = String(v ?? '').slice(0, 128);
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function labelKey(labels) {
  const keys = Object.keys(labels).sort();
  return keys.map(k => `${k}=${labels[k]}`).join('\x1f');
}

function formatLabels(labels) {
  const keys = Object.keys(labels).sort();
  if (keys.length === 0) return '';
  return '{' + keys.map(k => `${k}="${escapeLabel(labels[k])}"`).join(',') + '}';
}

// ─── Registry ───────────────────────────────────────────────────────────────

export const HTTP_BUCKETS = [
  0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
];

export function createMetrics({ buckets = HTTP_BUCKETS, now = () => Date.now() } = {}) {
  // counter: name → Map<labelKey, { labels, value }>
  const counters = new Map();
  const gauges   = new Map();
  const histograms = new Map();
  const counterHelp = new Map();
  const gaugeHelp   = new Map();
  const histHelp    = new Map();

  function _counterSlot(name, labels) {
    let m = counters.get(name);
    if (!m) counters.set(name, m = new Map());
    const k = labelKey(labels);
    let slot = m.get(k);
    if (!slot) m.set(k, slot = { labels, value: 0 });
    return slot;
  }
  function _gaugeSlot(name, labels) {
    let m = gauges.get(name);
    if (!m) gauges.set(name, m = new Map());
    const k = labelKey(labels);
    let slot = m.get(k);
    if (!slot) m.set(k, slot = { labels, value: 0 });
    return slot;
  }
  function _histSlot(name, labels) {
    let m = histograms.get(name);
    if (!m) histograms.set(name, m = new Map());
    const k = labelKey(labels);
    let slot = m.get(k);
    if (!slot) m.set(k, slot = {
      labels, sum: 0, count: 0,
      buckets: buckets.map(le => ({ le, count: 0 })),
    });
    return slot;
  }

  function counter(name, { help = '' } = {}) {
    counterHelp.set(name, help);
    return {
      inc(labels = {}, by = 1) {
        _counterSlot(name, labels).value += by;
      },
    };
  }
  function gauge(name, { help = '' } = {}) {
    gaugeHelp.set(name, help);
    return {
      set(labels, val) {
        if (typeof labels === 'number') { val = labels; labels = {}; }
        _gaugeSlot(name, labels).value = val;
      },
      inc(labels = {}, by = 1) { _gaugeSlot(name, labels).value += by; },
      dec(labels = {}, by = 1) { _gaugeSlot(name, labels).value -= by; },
    };
  }
  function histogram(name, { help = '' } = {}) {
    histHelp.set(name, help);
    return {
      observe(labels, value) {
        if (typeof labels === 'number') { value = labels; labels = {}; }
        const slot = _histSlot(name, labels);
        slot.sum += value;
        slot.count += 1;
        for (const b of slot.buckets) if (value <= b.le) b.count += 1;
      },
    };
  }

  function render() {
    const out = [];
    for (const [name, map] of counters.entries()) {
      const help = counterHelp.get(name);
      if (help) out.push(`# HELP ${name} ${help}`);
      out.push(`# TYPE ${name} counter`);
      for (const { labels, value } of map.values()) {
        out.push(`${name}${formatLabels(labels)} ${value}`);
      }
    }
    for (const [name, map] of gauges.entries()) {
      const help = gaugeHelp.get(name);
      if (help) out.push(`# HELP ${name} ${help}`);
      out.push(`# TYPE ${name} gauge`);
      for (const { labels, value } of map.values()) {
        out.push(`${name}${formatLabels(labels)} ${value}`);
      }
    }
    for (const [name, map] of histograms.entries()) {
      const help = histHelp.get(name);
      if (help) out.push(`# HELP ${name} ${help}`);
      out.push(`# TYPE ${name} histogram`);
      for (const { labels, buckets: bks, sum, count } of map.values()) {
        for (const b of bks) {
          out.push(`${name}_bucket${formatLabels({ ...labels, le: b.le })} ${b.count}`);
        }
        out.push(`${name}_bucket${formatLabels({ ...labels, le: '+Inf' })} ${count}`);
        out.push(`${name}_sum${formatLabels(labels)} ${sum}`);
        out.push(`${name}_count${formatLabels(labels)} ${count}`);
      }
    }
    return out.join('\n') + '\n';
  }

  return { counter, gauge, histogram, render };
}

export function loadMetricsConfig(env = process.env) {
  return {
    enabled: env.QV_METRICS_DISABLED !== 'true',
    public:  env.QV_METRICS_PUBLIC === 'true',
  };
}
