#!/usr/bin/env node
// qv-audit.mjs — forensic CLI for Sigvault JSONL audit logs.
//
// Why this exists
// ----------------
// Every Sigvault server emits a JSONL audit stream
// (qv-server/audit.mjs). On incident response operators need to:
//   - find every event for one requestId / traceId / keyId
//   - find auth denials / rate-limit denials / failed verifies
//   - know the p50 / p95 / p99 of /v3/token/issue last hour
//   - export a clean grep-friendly form for their own pipelines
//
// The standard answer is "use jq + grep" — but the audit log is too
// security-relevant for ad-hoc shell pipelines. Operators routinely
// type the wrong jq filter and miss events. This tool makes the right
// queries first-class.
//
// Zero deps. Reads stdin OR a path. Streams line-by-line so a
// gigabyte audit log uses constant memory.
//
// Usage
// -----
//   qv-audit --file /var/lib/sigvault/audit.log --event auth.deny
//   qv-audit --file ... --since 2026-04-01T00:00:00Z --until 2026-04-02T00:00:00Z
//   qv-audit --file ... --request-id <uuid>
//   qv-audit --file ... --trace-id <hex32>
//   qv-audit --file ... --key-id <uuid>
//   qv-audit --file ... --status 5xx
//   qv-audit --file ... --summary           # counts + p50/p95/p99
//   qv-audit --file ... --top events 10
//   qv-audit --file ... --format human|json|tsv
//   cat audit.log | qv-audit --event token.issue --format json
//
// Exit codes:
//   0 — query ran (events may or may not have matched)
//   1 — input or filter parse error
//   2 — missing required arg

import { createReadStream, existsSync, statSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { stdin } from 'node:process';

// ─── argv ────────────────────────────────────────────────────────────────────

function arg(name, fallback) {
  const flag = `--${name}=`;
  const a = process.argv.find(x => x.startsWith(flag));
  if (a) return a.slice(flag.length);
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < process.argv.length && !process.argv[i + 1].startsWith('--')) {
    return process.argv[i + 1];
  }
  if (i >= 0) return true;
  return fallback;
}

function help(exitCode = 0) {
  process.stdout.write(
`qv-audit — Sigvault audit-log forensic CLI

Sources (one of):
  --file PATH               Read from a file
  (otherwise reads stdin)

Filters (combine freely; AND semantics):
  --event NAME              e.g. auth.deny, token.issue, ratelimit.deny
  --since ISO8601           events with ts >= this
  --until ISO8601           events with ts <  this
  --request-id ID
  --trace-id HEX32
  --key-id ID
  --status CODE             "200", "4xx", "5xx", or "401"
  --ip IP                   exact IP match
  --reason CODE             e.g. cidr_denied, per_key_rate, bad_token
  --grep TEXT               substring match anywhere in line

Modes:
  --summary                 print counts + latency percentiles
  --top FIELD N             top-N values of FIELD (event, ip, keyId, reason)
  --format human|json|tsv   default: human

Examples:
  qv-audit --file audit.log --event auth.deny --since 2026-05-01T00:00:00Z
  qv-audit --file audit.log --request-id 27c3...
  qv-audit --file audit.log --summary
  qv-audit --file audit.log --top events 10
  cat audit.log | qv-audit --event token.issue --format json
`);
  process.exit(exitCode);
}

if (arg('help') === true || arg('h') === true) help(0);

const file       = arg('file');
const eventName  = arg('event');
const since      = arg('since');
const until      = arg('until');
const requestId  = arg('request-id');
const traceId    = arg('trace-id');
const keyId      = arg('key-id');
const statusFlt  = arg('status');
const ipFlt      = arg('ip');
const reasonFlt  = arg('reason');
const grepStr    = arg('grep');
const summary    = arg('summary') === true;
const topFlag    = arg('top');                 // either string fieldName, or `--top events 10`
const topN       = arg('top-n', 10);
const format     = arg('format', 'human');

// `--top events 10` form: argv has `--top events 10`. Detect.
let topField = null, topLimit = 10;
if (typeof topFlag === 'string' && topFlag !== 'true') {
  topField = topFlag;
  // Look for the next non-flag token after --top → numeric limit.
  const i = process.argv.indexOf('--top');
  if (i >= 0 && i + 2 < process.argv.length && /^\d+$/.test(process.argv[i + 2])) {
    topLimit = Number(process.argv[i + 2]);
  } else if (typeof topN !== 'boolean' && /^\d+$/.test(String(topN))) {
    topLimit = Number(topN);
  }
}

if (!['human', 'json', 'tsv'].includes(format)) {
  process.stderr.write(`unknown --format ${format}\n`); process.exit(1);
}

const sinceMs = since ? Date.parse(since) : null;
const untilMs = until ? Date.parse(until) : null;
if (since && Number.isNaN(sinceMs)) { process.stderr.write(`bad --since\n`); process.exit(1); }
if (until && Number.isNaN(untilMs)) { process.stderr.write(`bad --until\n`); process.exit(1); }

// ─── filter ──────────────────────────────────────────────────────────────────

function statusMatches(code, flt) {
  if (!flt) return true;
  const c = Number(code);
  if (Number.isNaN(c)) return false;
  if (/^\d+$/.test(flt))      return c === Number(flt);
  if (/^[1-5]xx$/i.test(flt)) return Math.floor(c / 100) === Number(flt[0]);
  return false;
}

function matchesFilters(rec, line) {
  if (eventName && rec.event !== eventName) return false;
  if (requestId && rec.requestId !== requestId) return false;
  if (traceId   && rec.traceId   !== traceId)   return false;
  if (keyId     && rec.keyId     !== keyId)     return false;
  if (ipFlt     && rec.ip        !== ipFlt)     return false;
  if (reasonFlt && rec.reason    !== reasonFlt) return false;
  if (!statusMatches(rec.status, statusFlt))    return false;
  if (sinceMs || untilMs) {
    const t = rec.ts ? Date.parse(rec.ts) : NaN;
    if (Number.isNaN(t)) return false;
    if (sinceMs && t < sinceMs) return false;
    if (untilMs && t >= untilMs) return false;
  }
  if (grepStr && !line.includes(grepStr)) return false;
  return true;
}

// ─── output formats ──────────────────────────────────────────────────────────

function fmtHuman(rec) {
  const t      = rec.ts || '';
  const lvl    = (rec.level || 'info').toUpperCase().padEnd(4);
  const evt    = (rec.event || '').padEnd(20);
  const status = rec.status ? ` ${rec.status}` : '';
  const ms     = rec.ms != null ? ` ${rec.ms.toFixed(2)}ms` : '';
  const meta   = [
    rec.method && `${rec.method} ${rec.template || rec.path || ''}`,
    rec.ip     && `ip=${rec.ip}`,
    rec.keyId  && `keyId=${rec.keyId.slice(0, 8)}…`,
    rec.reason && `reason=${rec.reason}`,
    rec.requestId && `req=${rec.requestId.slice(0, 8)}…`,
  ].filter(Boolean).join(' ');
  return `${t} ${lvl} ${evt}${status}${ms} ${meta}`;
}

function fmtTsv(rec) {
  return [
    rec.ts || '', rec.level || '', rec.event || '',
    rec.status || '', rec.ms ?? '', rec.method || '',
    rec.template || rec.path || '', rec.ip || '',
    rec.keyId || '', rec.reason || '', rec.requestId || '',
    rec.traceId || '',
  ].map(v => String(v).replace(/\t/g, ' ')).join('\t');
}

// ─── summary engine ──────────────────────────────────────────────────────────

class Summary {
  constructor() {
    this.total = 0;
    this.byEvent = new Map();
    this.byStatus = new Map();
    this.byReason = new Map();
    this.latencies = []; // ms numbers
    this.byTop = new Map(); // fieldName -> Map(value, count)
  }
  bump(map, k) { if (k == null) return; map.set(k, (map.get(k) || 0) + 1); }
  ingest(rec) {
    this.total++;
    this.bump(this.byEvent,  rec.event);
    this.bump(this.byStatus, rec.status);
    this.bump(this.byReason, rec.reason);
    if (typeof rec.ms === 'number' && rec.ms >= 0) this.latencies.push(rec.ms);
    if (topField) {
      let m = this.byTop.get(topField);
      if (!m) { m = new Map(); this.byTop.set(topField, m); }
      this.bump(m, rec[topField]);
    }
  }
  pct(arr, p) {
    if (arr.length === 0) return null;
    arr.sort((a, b) => a - b);
    return arr[Math.min(arr.length - 1, Math.floor(arr.length * p))];
  }
  print() {
    if (format === 'json') {
      process.stdout.write(JSON.stringify({
        total: this.total,
        events: Object.fromEntries(this.byEvent),
        status: Object.fromEntries(this.byStatus),
        reasons: Object.fromEntries(this.byReason),
        latencyMs: {
          p50: this.pct(this.latencies, 0.50),
          p95: this.pct(this.latencies, 0.95),
          p99: this.pct(this.latencies, 0.99),
          max: this.latencies.length ? this.latencies[this.latencies.length - 1] : null,
          n:   this.latencies.length,
        },
      }, null, 2) + '\n');
      return;
    }
    process.stdout.write(`total events: ${this.total}\n`);
    process.stdout.write(`\nby event:\n`);
    for (const [k, v] of [...this.byEvent].sort((a, b) => b[1] - a[1])) {
      process.stdout.write(`  ${String(v).padStart(8)} ${k}\n`);
    }
    if (this.byStatus.size) {
      process.stdout.write(`\nby status:\n`);
      for (const [k, v] of [...this.byStatus].sort((a, b) => Number(a[0]) - Number(b[0]))) {
        process.stdout.write(`  ${String(v).padStart(8)} ${k}\n`);
      }
    }
    if (this.byReason.size) {
      process.stdout.write(`\nby reason (denials):\n`);
      for (const [k, v] of [...this.byReason].sort((a, b) => b[1] - a[1])) {
        process.stdout.write(`  ${String(v).padStart(8)} ${k}\n`);
      }
    }
    if (this.latencies.length) {
      process.stdout.write(`\nlatency over ${this.latencies.length} samples:\n`);
      process.stdout.write(`  p50 ${this.pct(this.latencies, 0.50).toFixed(2)} ms\n`);
      process.stdout.write(`  p95 ${this.pct(this.latencies, 0.95).toFixed(2)} ms\n`);
      process.stdout.write(`  p99 ${this.pct(this.latencies, 0.99).toFixed(2)} ms\n`);
      process.stdout.write(`  max ${this.latencies[this.latencies.length - 1].toFixed(2)} ms\n`);
    }
    if (topField) {
      const m = this.byTop.get(topField);
      if (!m) return;
      process.stdout.write(`\ntop ${topLimit} ${topField}:\n`);
      const sorted = [...m].sort((a, b) => b[1] - a[1]).slice(0, topLimit);
      for (const [k, v] of sorted) {
        process.stdout.write(`  ${String(v).padStart(8)} ${k ?? '<null>'}\n`);
      }
    }
  }
}

// ─── input stream ────────────────────────────────────────────────────────────

function inputStream() {
  if (file) {
    if (!existsSync(file)) {
      process.stderr.write(`no such file: ${file}\n`); process.exit(2);
    }
    if (!statSync(file).isFile()) {
      process.stderr.write(`not a file: ${file}\n`); process.exit(2);
    }
    return createReadStream(file, 'utf8');
  }
  // stdin
  return stdin;
}

// ─── run ─────────────────────────────────────────────────────────────────────

async function main() {
  const summarise = summary || topField;
  const sum = summarise ? new Summary() : null;
  const rl  = createInterface({ input: inputStream(), crlfDelay: Infinity });
  let matched = 0;

  for await (const line of rl) {
    if (!line.trim()) continue;
    let rec;
    try { rec = JSON.parse(line); }
    catch { continue; } // skip non-JSON lines (operator-pasted output, banner, etc.)
    if (!matchesFilters(rec, line)) continue;
    matched++;
    if (summarise) {
      sum.ingest(rec);
    } else if (format === 'json') {
      process.stdout.write(line + '\n');
    } else if (format === 'tsv') {
      process.stdout.write(fmtTsv(rec) + '\n');
    } else {
      process.stdout.write(fmtHuman(rec) + '\n');
    }
  }

  if (summarise) sum.print();
  // Hint when zero events match — operators routinely paste the wrong filter.
  if (!summarise && matched === 0 && format === 'human') {
    process.stderr.write(`(no events matched the filter)\n`);
  }
}

main().catch(e => { process.stderr.write(`qv-audit: ${e.message}\n`); process.exit(1); });
