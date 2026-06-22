#!/usr/bin/env node
// bench.mjs — end-to-end throughput + latency benchmark for Sigvault.
//
// Usage:
//   node qv-server/bench.mjs                     # 5000 ops, default
//   QV_BENCH_OPS=20000 QV_BENCH_CONC=8 node qv-server/bench.mjs
//
// What it measures:
//   - Issue throughput  (POST /v3/token/issue)
//   - Verify throughput (POST /v3/token/verify)
//   - Latency p50 / p95 / p99 / max for each
//   - Bytes-on-the-wire for the token
//
// Spins up a fresh qv-server in a temp DATA_DIR with rate-limiting
// disabled, then drives `ops` requests at `conc` concurrency.
// Tears down cleanly on exit.
//
// Zero npm deps. Node stdlib only.

import { spawn }                from 'node:child_process';
import { mkdtempSync, rmSync }  from 'node:fs';
import { tmpdir }               from 'node:os';
import { join, dirname }        from 'node:path';
import { fileURLToPath }        from 'node:url';
import { createHash, randomBytes } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER    = join(__dirname, 'server-sovereign.mjs');

const OPS  = Number(process.env.QV_BENCH_OPS  || 5000);
const CONC = Number(process.env.QV_BENCH_CONC || 8);
const PORT = 30000 + Math.floor(Math.random() * 30000);

function pct(arr, p) {
  const i = Math.min(arr.length - 1, Math.floor(arr.length * p));
  return arr[i];
}

async function waitFor(url, ms = 8000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try { const r = await fetch(url); if (r.ok) return; } catch {}
    await new Promise(r => setTimeout(r, 80));
  }
  throw new Error(`server at ${url} not ready in ${ms}ms`);
}

async function timed(fn) {
  const t0 = process.hrtime.bigint();
  const r  = await fn();
  const ns = Number(process.hrtime.bigint() - t0);
  return { ms: ns / 1e6, r };
}

async function driver(taskFn, n, conc) {
  const samples = new Array(n);
  let done = 0, ok = 0, err = 0;
  async function worker() {
    while (true) {
      const i = done++;
      if (i >= n) return;
      try {
        const t0 = process.hrtime.bigint();
        await taskFn(i);
        samples[i] = Number(process.hrtime.bigint() - t0) / 1e6;
        ok++;
      } catch (e) {
        samples[i] = -1;
        err++;
      }
    }
  }
  const t0 = process.hrtime.bigint();
  await Promise.all(Array.from({ length: conc }, worker));
  const totalMs = Number(process.hrtime.bigint() - t0) / 1e6;
  const okSamples = samples.filter(s => s > 0).sort((a, b) => a - b);
  if (okSamples.length === 0) {
    return { ok, err, totalMs, rps: '0', p50: 'n/a', p95: 'n/a', p99: 'n/a', max: 'n/a' };
  }
  return {
    ok, err, totalMs,
    rps:  (ok / (totalMs / 1000)).toFixed(0),
    p50:  pct(okSamples, 0.50).toFixed(2),
    p95:  pct(okSamples, 0.95).toFixed(2),
    p99:  pct(okSamples, 0.99).toFixed(2),
    max:  okSamples[okSamples.length - 1].toFixed(2),
  };
}

function fmt(label, r) {
  return `${label.padEnd(8)}  rps=${String(r.rps).padStart(6)}  `
    + `p50=${r.p50}ms  p95=${r.p95}ms  p99=${r.p99}ms  max=${r.max}ms  `
    + `(ok=${r.ok}/${r.ok + r.err}, total=${r.totalMs.toFixed(0)}ms)`;
}

async function main() {
  const dir   = mkdtempSync(join(tmpdir(), 'qv-bench-'));
  const token = 'b'.repeat(64);
  const sha256 = createHash('sha256').update(token).digest('hex');
  const env = {
    ...process.env,
    QV_HOST: '127.0.0.1', QV_PORT: String(PORT),
    QV_DATA_DIR: dir,
    QV_ADMIN_TOKEN_SHA256: sha256,
    QV_MASTER_KEY_HEX: '33'.repeat(32),
    QV_RATE_LIMIT_DISABLED: 'true',
    QV_AUDIT_ENABLED: 'false',
    QV_AUDIT_STDOUT: 'false',
  };
  const child = spawn(process.execPath, [SERVER], { env, stdio: 'pipe' });
  child.stderr.on('data', () => {});
  child.stdout.on('data', () => {});
  const base = `http://127.0.0.1:${PORT}`;

  try {
    await waitFor(`${base}/v3/ready`);

    // Provision a key.
    const kg = await fetch(`${base}/v3/keygen`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'bench' }),
    });
    if (!kg.ok) throw new Error(`keygen ${kg.status}`);
    const { keyId } = await kg.json();

    console.log(`Sigvault bench — ${OPS} ops × ${CONC} concurrency`);
    console.log(`Server: ${base}  keyId=${keyId.slice(0, 8)}…`);
    console.log('');

    // ── Issue ────────────────────────────────────────────────────────
    let firstToken;
    let firstSize;
    const issueResult = await driver(async (i) => {
      const r = await fetch(`${base}/v3/token/issue`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyId, claims: { sub: `u-${i}`, role: 'svc' }, ttl: 3600 }),
      });
      if (!r.ok) throw new Error(`issue ${r.status}`);
      const b = await r.json();
      if (!firstToken) {
        firstToken = b.tokenHex;
        firstSize  = (b.tokenHex.length / 2);
      }
    }, OPS, CONC);
    console.log(fmt('issue', issueResult));
    console.log(`         token bytes on the wire: ${firstSize}`);

    // ── Verify (each call drives one fresh, never-seen token) ───────
    // The chain advances on every successful verify, so a benchmark that
    // re-uses tokens hits MUTATION_CTR_STALE after the first pass. We
    // pre-issue OPS fresh tokens (sequentially — that's the chain
    // bottleneck), then verify them in parallel.
    process.stdout.write('         pre-issuing fresh tokens for verify... ');
    const pool = new Array(OPS);
    const issueT0 = process.hrtime.bigint();
    for (let i = 0; i < OPS; i++) {
      const r = await fetch(`${base}/v3/token/issue`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyId, claims: { i }, ttl: 3600 }),
      });
      pool[i] = (await r.json()).tokenHex;
    }
    const issueDt = Number(process.hrtime.bigint() - issueT0) / 1e6;
    console.log(`done in ${issueDt.toFixed(0)}ms`);

    // Verify each token once. The chain's verifier-side counter only
    // accepts strictly-increasing counters from one writer-side advance,
    // so we MUST verify in issue-order; concurrent verify of out-of-order
    // tokens will produce STALE rejections that don't reflect real perf.
    const verifyResult = await driver(async (i) => {
      const r = await fetch(`${base}/v3/token/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyId, token: pool[i] }),
      });
      if (!r.ok) throw new Error(`verify ${r.status}`);
    }, OPS, /* concurrency */ 1);
    console.log(fmt('verify', verifyResult));

    // ── Identify ─────────────────────────────────────────────────────
    const vk = await fetch(`${base}/v3/keys/${keyId}`).then(r => r.json());
    const idResult = await driver(async () => {
      const r = await fetch(`${base}/v3/keys/identify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vkB64u: vk.verifyingKeyB64 }),
      });
      if (!r.ok) throw new Error(`identify ${r.status}`);
    }, Math.min(OPS, 2000), CONC);
    console.log(fmt('identify', idResult));

  } finally {
    child.kill('SIGKILL');
    await new Promise(r => child.once('exit', r));
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch(e => { console.error(e); process.exit(1); });
