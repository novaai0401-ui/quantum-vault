/**
 * Verify-pool — bounded-queue worker pool for signature verification.
 *
 * Two operating modes:
 *
 *   1. Round-robin (default).  Single shared FIFO queue, N workers
 *      pull from it. Optimal when traffic is spread across many keys
 *      that visit all workers roughly equally.
 *
 *   2. Affinity.  `keyId` is hashed (murmur3_32) modulo `size` to pick
 *      a fixed worker per key. The per-worker queue means a hot key's
 *      verifying-key stays warm in that one worker's heap, eliminating
 *      ~30% of per-verify ML-DSA-87 setup cost on a sustained workload.
 *      Enabled with `{ affinity: true }`.
 *
 * Zero npm deps — node:worker_threads only.
 *
 * See `docs/design/verify-pool-worker-affinity.md` for the design
 * notes that informed this implementation, including the three
 * correctness traps (queue starvation, worker death, backpressure
 * semantics) that the affinity path navigates.
 */

import { Worker } from 'node:worker_threads';

const WORKER_URL_DEFAULT = new URL('./verify-worker.mjs', import.meta.url);

// ─── Murmur3_32 — non-cryptographic hash for keyId → worker index ──────────
// 32-bit murmurhash3, fixed seed 0. Stable across restarts on the same
// `size`. Public-domain algorithm, ~30 LOC. Avoids pulling a hashing
// dependency or paying SHA3 cost on a hot path.
const MUR3_C1 = 0xcc9e2d51;
const MUR3_C2 = 0x1b873593;

function rotl32(x, r) { return ((x << r) | (x >>> (32 - r))) >>> 0; }
function imul32(a, b) {
  const aHi = (a >>> 16) & 0xffff, aLo = a & 0xffff;
  const bHi = (b >>> 16) & 0xffff, bLo = b & 0xffff;
  return ((aLo * bLo) + (((aHi * bLo + aLo * bHi) << 16) >>> 0)) >>> 0;
}
export function murmur3_32(input, seed = 0) {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : Buffer.from(input);
  let h1 = seed >>> 0;
  const nBlocks = buf.length >>> 2;
  for (let i = 0; i < nBlocks; i++) {
    let k1 = buf.readUInt32LE(i << 2);
    k1 = imul32(k1, MUR3_C1);
    k1 = rotl32(k1, 15);
    k1 = imul32(k1, MUR3_C2);
    h1 ^= k1;
    h1 = rotl32(h1, 13);
    h1 = (imul32(h1, 5) + 0xe6546b64) >>> 0;
  }
  let k1 = 0;
  const tail = buf.length & 3;
  const tailStart = nBlocks << 2;
  if (tail === 3) k1 ^= buf[tailStart + 2] << 16;
  if (tail >= 2)  k1 ^= buf[tailStart + 1] << 8;
  if (tail >= 1) {
    k1 ^= buf[tailStart];
    k1 = imul32(k1, MUR3_C1);
    k1 = rotl32(k1, 15);
    k1 = imul32(k1, MUR3_C2);
    h1 ^= k1;
  }
  h1 ^= buf.length;
  h1 ^= h1 >>> 16;
  h1 = imul32(h1, 0x85ebca6b);
  h1 ^= h1 >>> 13;
  h1 = imul32(h1, 0xc2b2ae35);
  h1 ^= h1 >>> 16;
  return h1 >>> 0;
}

// ─── Pool ────────────────────────────────────────────────────────────────────

export class VerifyPool {
  /**
   * @param {number} size      worker count
   * @param {number} queueMax  global queue cap (round-robin) OR sum of per-worker caps (affinity)
   * @param {URL|string} workerUrl
   * @param {object} [opts]
   * @param {boolean} [opts.affinity=false]   keyId → worker hashed dispatch
   */
  constructor(size, queueMax = 1024, workerUrl = WORKER_URL_DEFAULT, opts = {}) {
    this.size      = size;
    this.queueMax  = queueMax;
    this.workerUrl = workerUrl;
    this.affinity  = !!opts.affinity;
    this.workers   = [];

    // Round-robin state
    this.idle      = [];
    this.queue     = [];

    // Affinity state
    this.queues    = [];                      // per-worker FIFO
    this.busy      = [];                      // per-worker boolean
    this.perQueueMax = Math.max(1, Math.ceil(queueMax / Math.max(1, size)));

    this.nextJobId = 1;
    this.pending   = new Map();               // jobId → { resolve, workerIdx }
    this.rejects   = 0;
    this.affinityRejects = new Array(size).fill(0);
  }

  /** Total queued jobs across all paths (for the existing Prometheus gauge). */
  get queueDepth() {
    if (!this.affinity) return this.queue.length;
    let n = 0;
    for (const q of this.queues) n += q.length;
    return n;
  }

  /** Per-worker queue depth. Useful for the worker-labelled Prometheus dimension. */
  perWorkerQueueDepth() {
    if (!this.affinity) {
      // Round-robin: synthesise a single bucket that contains the whole queue.
      const out = new Array(this.size).fill(0);
      out[0] = this.queue.length;
      return out;
    }
    return this.queues.map(q => q.length);
  }

  async init() {
    for (let i = 0; i < this.size; i++) {
      const w = await this._spawnWorker(i);
      this.workers.push(w);
      if (this.affinity) {
        this.queues.push([]);
        this.busy.push(false);
      } else {
        this.idle.push(w);
      }
    }
  }

  async _spawnWorker(idx) {
    const w = new Worker(this.workerUrl);
    w.__idx = idx;
    await new Promise((resolve, reject) => {
      w.once('message', (m) => m && m.ready ? resolve() : reject(new Error('worker not ready')));
      w.once('error', reject);
    });
    w.on('message', (m) => {
      if (m && m.ready) return;
      const p = this.pending.get(m.jobId);
      if (!p) return;
      this.pending.delete(m.jobId);
      p.resolve(m);
      this._release(w);
    });
    w.on('error', (e) => {
      // Fail every pending job that was on this worker.
      for (const [jobId, p] of this.pending) {
        if (p.workerIdx === w.__idx) {
          this.pending.delete(jobId);
          p.resolve({ ok: false, error: 'WORKER_ERROR', message: e.message });
        }
      }
      // In affinity mode also drain the dead worker's queue. A more
      // sophisticated impl would respawn and redispatch — that's a v4.4
      // refinement scoped in the design doc. Today: fail loud.
      if (this.affinity) {
        const q = this.queues[w.__idx] || [];
        for (const j of q) j.resolve({ ok: false, error: 'WORKER_ERROR', message: e.message });
        this.queues[w.__idx] = [];
        this.busy[w.__idx] = false;
      }
    });
    return w;
  }

  _release(w) {
    if (this.affinity) {
      // Drain THIS worker's queue, not the global one — per-key affinity.
      const q = this.queues[w.__idx];
      const next = q.shift();
      if (next) { this._dispatch(w, next); return; }
      this.busy[w.__idx] = false;
      return;
    }
    const next = this.queue.shift();
    if (next) { this._dispatch(w, next); return; }
    this.idle.push(w);
  }

  _dispatch(w, { msg, resolve }) {
    const jobId = this.nextJobId++;
    this.pending.set(jobId, { resolve, workerIdx: w.__idx });
    w.postMessage({ jobId, ...msg });
  }

  /**
   * Pick the worker index for a keyId. Returns null if affinity is off
   * (caller falls back to the idle pool).
   */
  workerForKey(keyId) {
    if (!this.affinity) return null;
    if (typeof keyId !== 'string' || keyId.length === 0) {
      // Without a keyId we can't hash — fall back to worker 0 to keep
      // forward progress, but operators who hit this path likely have a bug.
      return 0;
    }
    return murmur3_32(keyId) % this.size;
  }

  run(msg) {
    return new Promise((resolve) => {
      if (this.affinity) {
        const idx = this.workerForKey(msg && msg.keyId);
        const w = this.workers[idx];
        if (!w) {
          // Worker slot dead. Fail loud — the design doc lays out the
          // full respawn-and-redispatch path for v4.4.
          this.rejects += 1;
          this.affinityRejects[idx] += 1;
          return resolve({ ok: false, error: 'POOL_OVERLOADED', worker: idx, reason: 'worker_dead' });
        }
        if (!this.busy[idx]) {
          this.busy[idx] = true;
          return this._dispatch(w, { msg, resolve });
        }
        const q = this.queues[idx];
        if (q.length >= this.perQueueMax) {
          this.rejects += 1;
          this.affinityRejects[idx] += 1;
          return resolve({ ok: false, error: 'POOL_OVERLOADED', worker: idx });
        }
        q.push({ msg, resolve });
        return;
      }
      // Round-robin path (unchanged from v4.3).
      const w = this.idle.pop();
      if (w) return this._dispatch(w, { msg, resolve });
      if (this.queue.length >= this.queueMax) {
        this.rejects += 1;
        return resolve({ ok: false, error: 'POOL_OVERLOADED' });
      }
      this.queue.push({ msg, resolve });
    });
  }

  async shutdown() {
    await Promise.all(this.workers.map(w => w.terminate()));
    this.workers = [];
    this.idle    = [];

    // Drain anything still queued.
    if (this.affinity) {
      for (const q of this.queues) {
        for (const j of q) j.resolve({ ok: false, error: 'POOL_SHUTDOWN' });
      }
      this.queues = [];
      this.busy   = [];
    } else {
      for (const q of this.queue) q.resolve({ ok: false, error: 'POOL_SHUTDOWN' });
      this.queue = [];
    }

    for (const [, p] of this.pending) p.resolve({ ok: false, error: 'POOL_SHUTDOWN' });
    this.pending.clear();
  }
}
