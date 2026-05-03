/**
 * W3C Trace Context propagation (limitation #8).
 *
 * Implements the inbound-only subset of https://www.w3.org/TR/trace-context/
 * that a stateless REST server needs:
 *   - Parse `traceparent` header, validate strictly. Version 00 only.
 *   - Parse `tracestate` header, validate length/shape, keep as opaque.
 *   - When the caller sends no traceparent, mint a fresh trace + span id.
 *   - Produce a CHILD span-id so our logs can be stitched into the caller's
 *     distributed trace without us running a full tracer.
 *   - Expose traceId / spanId / parentSpanId / sampled / tracestate on req.
 *
 * Zero npm deps — node:crypto only.
 */

import { randomBytes } from 'node:crypto';

// traceparent = version "-" trace-id "-" parent-id "-" trace-flags
// version:      2 hex (must be "00" for v1 of the spec)
// trace-id:     32 hex, all-zero is invalid
// parent-id:    16 hex, all-zero is invalid
// trace-flags:  2 hex (only low bit "sampled" is meaningful today)
const TP_RE = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

const ZERO_TRACE = '0'.repeat(32);
const ZERO_SPAN  = '0'.repeat(16);

function newTraceId() { return randomBytes(16).toString('hex'); }
function newSpanId()  { return randomBytes(8).toString('hex'); }

export function parseTraceparent(raw) {
  if (typeof raw !== 'string') return null;
  const m = TP_RE.exec(raw.trim());
  if (!m) return null;
  const [, version, traceId, parentSpanId, flags] = m;
  if (version !== '00') return null;
  if (traceId === ZERO_TRACE || parentSpanId === ZERO_SPAN) return null;
  const sampled = (parseInt(flags, 16) & 0x01) === 0x01;
  return { traceId, parentSpanId, sampled };
}

// tracestate is an opaque key-value list the caller owns. We only guard
// against absurd sizes / non-printable bytes; we don't manipulate values.
const TS_MAX_LEN = 512;
export function sanitizeTracestate(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length > TS_MAX_LEN) return null;
  if (/[^\x20-\x7e]/.test(trimmed)) return null;
  return trimmed;
}

/**
 * Derive or mint trace context for a request.
 * Returns { traceId, parentSpanId, spanId, sampled, tracestate, inherited }.
 *   - `inherited` = true if a valid traceparent was received.
 *   - `spanId` is always freshly minted (this request's own span).
 */
export function deriveTraceContext(req) {
  const tpRaw = req?.headers?.traceparent;
  const tsRaw = req?.headers?.tracestate;
  const parsed = parseTraceparent(tpRaw);
  if (parsed) {
    return {
      traceId:      parsed.traceId,
      parentSpanId: parsed.parentSpanId,
      spanId:       newSpanId(),
      sampled:      parsed.sampled,
      tracestate:   sanitizeTracestate(tsRaw),
      inherited:    true,
    };
  }
  return {
    traceId:      newTraceId(),
    parentSpanId: null,
    spanId:       newSpanId(),
    sampled:      false,
    tracestate:   null,
    inherited:    false,
  };
}

export function formatTraceparent(ctx) {
  const flags = ctx.sampled ? '01' : '00';
  return `00-${ctx.traceId}-${ctx.spanId}-${flags}`;
}

/**
 * Attach trace context to the request and echo our own traceparent on the
 * response so a downstream hop (or the client's tracer) can continue.
 */
export function applyTrace(req, res) {
  const ctx = deriveTraceContext(req);
  if (req) req.trace = ctx;
  try { res.setHeader('traceparent', formatTraceparent(ctx)); } catch {}
  if (ctx.tracestate) {
    try { res.setHeader('tracestate', ctx.tracestate); } catch {}
  }
  return ctx;
}
