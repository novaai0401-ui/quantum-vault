/**
 * Quick benchmark: POST /v3/token/batch-verify with N tokens.
 * Usage:  node bench-batch.mjs [host:port] [batchSize]
 */
const [hostArg, nArg] = process.argv.slice(2);
const HOST = hostArg || 'localhost:7434';
const N    = Number(nArg || 200);

async function post(path, body) {
  const r = await fetch(`http://${HOST}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json();
}

console.log(`Warming up against http://${HOST} ...`);
const { keyId } = await post('/v3/keygen', { label: 'bench' });
console.log(`  keyId = ${keyId}`);

const toks = [];
for (let i = 0; i < N; i++) {
  const r = await post('/v3/token/issue', {
    keyId, ttl: 3600, claims: { sub: `u${i}`, role: 'bench' },
  });
  if (!r.tokenHex) { console.error('issue failed:', r); process.exit(1); }
  toks.push(r.tokenHex);
}
console.log(`  issued ${N} tokens`);

const items = toks.map(t => ({ keyId, token: t }));
const t0 = performance.now();
const res = await post('/v3/token/batch-verify', { items });
const wallMs = performance.now() - t0;

console.log(`\n=== batch-verify N=${N} ===`);
console.log(`  server wall     : ${res.summary.durationMs} ms`);
console.log(`  server throughput: ${res.summary.throughput}/s`);
console.log(`  workers         : ${res.summary.workers}`);
console.log(`  client wall     : ${wallMs.toFixed(1)} ms`);
console.log(`  valid / total   : ${res.summary.valid} / ${res.summary.total}`);
