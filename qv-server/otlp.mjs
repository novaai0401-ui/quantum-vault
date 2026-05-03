// otlp.mjs — OTLP/HTTP-JSON exporter for Sigvault.
//
// Closes limitation L7 ("no OTLP exporter") without violating the zero-dep
// oath. We POST batches of OTLP-shaped JSON to an operator-supplied
// collector endpoint (e.g. otel-collector, Tempo, Honeycomb, Datadog).
//
// Why HTTP/JSON not gRPC: gRPC needs a protobuf compiler / runtime, which
// would either pull a dep or hand-write a generator we'd have to maintain.
// OTLP/HTTP/JSON is on-spec, well-supported, and zero-dep — every modern
// collector accepts it on the same port as protobuf with a content-type
// switch.
//
// Toggle:
//   QV_OTLP_ENDPOINT=https://collector.example/v1/traces   (off when unset)
//   QV_OTLP_TOKEN=<bearer>                                  (optional)
//   QV_OTLP_BATCH_MAX=128                                   (default)
//   QV_OTLP_FLUSH_MS=5000                                   (default)
//
// Resource attributes are minimal — we identify ourselves but never leak
// operator-specific data the audit log already filters.
//
// Zero deps. Node stdlib only.

import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { URL } from 'node:url';

const SERVICE_NAME    = 'sigvault-server';
const SERVICE_VERSION = '4.3.0';

export function loadOtlpConfig(env = process.env) {
  const endpoint = env.QV_OTLP_ENDPOINT?.trim();
  if (!endpoint) return { enabled: false };
  let url;
  try { url = new URL(endpoint); }
  catch { throw new Error(`QV_OTLP_ENDPOINT is not a valid URL: ${endpoint}`); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`QV_OTLP_ENDPOINT must be http:// or https://, got ${url.protocol}`);
  }
  return {
    enabled:    true,
    url,
    token:      env.QV_OTLP_TOKEN || null,
    batchMax:   Number(env.QV_OTLP_BATCH_MAX || 128),
    flushMs:    Number(env.QV_OTLP_FLUSH_MS  || 5000),
    timeoutMs:  Number(env.QV_OTLP_TIMEOUT_MS || 5000),
  };
}

/* ── conversion helpers ─────────────────────────────────────────────── */

const NS_PER_MS = 1_000_000n;

function nowNs() { return BigInt(Date.now()) * NS_PER_MS; }

function attrs(kv) {
  const out = [];
  for (const [k, v] of Object.entries(kv)) {
    if (v === null || v === undefined) continue;
    let value;
    if (typeof v === 'string')      value = { stringValue: v };
    else if (typeof v === 'boolean') value = { boolValue: v };
    else if (typeof v === 'number')  value = Number.isInteger(v)
      ? { intValue: String(v) } : { doubleValue: v };
    else if (typeof v === 'bigint')  value = { intValue: v.toString() };
    else                              value = { stringValue: JSON.stringify(v) };
    out.push({ key: k, value });
  }
  return out;
}

/**
 * Convert a Sigvault audit event into an OTLP span. Returns null if the
 * event is not span-shaped (no traceId or no spanId).
 */
export function auditToSpan(ev) {
  if (!ev || typeof ev !== 'object') return null;
  if (!ev.traceId || !ev.spanId) return null;
  // Time. Audit events have ISO8601 ts; convert to nanoseconds.
  const tsMs   = ev.ts ? Date.parse(ev.ts) : Date.now();
  const startNs = BigInt(tsMs) * NS_PER_MS;
  const durMs  = typeof ev.ms === 'number' ? Math.max(0, ev.ms) : 0;
  const endNs  = startNs + BigInt(Math.round(durMs * 1_000_000));
  const status = ev.status >= 500 ? 2 /* ERROR */
              : ev.status >= 400 ? 2 /* ERROR */
              : 1 /* OK */;
  const span = {
    traceId:           ev.traceId,
    spanId:            ev.spanId,
    parentSpanId:      ev.parentSpanId || undefined,
    name:              ev.template || ev.event || 'sigvault.request',
    kind:              2, // SERVER
    startTimeUnixNano: startNs.toString(),
    endTimeUnixNano:   endNs.toString(),
    attributes: attrs({
      'http.method':       ev.method,
      'http.route':        ev.template,
      'http.status_code':  ev.status,
      'http.target':       ev.path,
      'net.peer.ip':       ev.ip,
      'sigvault.event':    ev.event,
      'sigvault.request_id': ev.requestId,
      'sigvault.key_id':   ev.keyId,
      'sigvault.suite':    ev.suite,
      'sigvault.token_type': ev.tokenType,
    }),
    status: { code: status },
  };
  return span;
}

/**
 * Build the OTLP/JSON request body for an array of spans.
 */
export function buildPayload(spans) {
  return {
    resourceSpans: [{
      resource: {
        attributes: attrs({
          'service.name':    SERVICE_NAME,
          'service.version': SERVICE_VERSION,
        }),
      },
      scopeSpans: [{
        scope: { name: 'sigvault', version: SERVICE_VERSION },
        spans,
      }],
    }],
  };
}

/* ── exporter — buffers + periodic flush ─────────────────────────────── */

export function createOtlpExporter(cfg) {
  if (!cfg?.enabled) return { onAuditEvent: () => {}, flush: async () => {}, stop: () => {} };

  const buf = [];
  let timer = null;
  let stopping = false;

  function postJSON(payload) {
    return new Promise((resolve) => {
      const url = cfg.url;
      const reqFn = url.protocol === 'https:' ? httpsRequest : httpRequest;
      const data  = Buffer.from(JSON.stringify(payload));
      const headers = {
        'content-type':   'application/json',
        'content-length': data.length,
      };
      if (cfg.token) headers['authorization'] = `Bearer ${cfg.token}`;
      const r = reqFn({
        method:  'POST',
        hostname: url.hostname,
        port:     url.port || (url.protocol === 'https:' ? 443 : 80),
        path:     url.pathname + (url.search || ''),
        headers,
        timeout:  cfg.timeoutMs,
      }, (res) => {
        // Drain to free socket; we don't care about response body.
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      });
      r.on('error', () => resolve(0));        // never throw — best-effort
      r.on('timeout', () => { r.destroy(); resolve(0); });
      r.end(data);
    });
  }

  async function flush() {
    if (buf.length === 0) return;
    const batch = buf.splice(0, cfg.batchMax);
    const payload = buildPayload(batch);
    await postJSON(payload);
  }

  function schedule() {
    if (timer || stopping) return;
    timer = setTimeout(async () => {
      timer = null;
      try { await flush(); } catch {}
      if (!stopping && buf.length > 0) schedule();
    }, cfg.flushMs);
    if (timer.unref) timer.unref();
  }

  return {
    onAuditEvent(ev) {
      const span = auditToSpan(ev);
      if (!span) return;
      buf.push(span);
      if (buf.length >= cfg.batchMax) {
        // Fire-and-forget; the HTTP request is non-blocking.
        flush().catch(() => {});
      } else {
        schedule();
      }
    },
    async flush() { await flush(); },
    stop() {
      stopping = true;
      if (timer) { clearTimeout(timer); timer = null; }
    },
  };
}
