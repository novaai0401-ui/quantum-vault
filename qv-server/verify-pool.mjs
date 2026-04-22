/**
 * Verify-pool — bounded-queue worker pool for signature verification.
 *
 * Extracted from server-sovereign.mjs (limitation #12) so it can be unit-tested
 * without booting the HTTP server.
 *
 * Semantics:
 *   - `size` worker threads, pre-spun at init().
 *   - Jobs dispatched to an idle worker immediately when available.
 *   - Otherwise queued FIFO up to `queueMax` entries.
 *   - When the queue is full, run() resolves immediately with
 *     { ok: false, error: 'POOL_OVERLOADED' } and increments `rejects`.
 *     Callers can surface a 503 / Retry-After to the client.
 *
 * Zero npm deps — node:worker_threads only.
 */

import { Worker } from 'node:worker_threads';

const WORKER_URL_DEFAULT = new URL('./verify-worker.mjs', import.meta.url);

export class VerifyPool {
  constructor(size, queueMax = 1024, workerUrl = WORKER_URL_DEFAULT) {
    this.size      = size;
    this.queueMax  = queueMax;
    this.workerUrl = workerUrl;
    this.workers   = [];
    this.idle      = [];
    this.queue     = [];
    this.nextJobId = 1;
    this.pending   = new Map();
    this.rejects   = 0;
  }

  get queueDepth() { return this.queue.length; }

  async init() {
    for (let i = 0; i < this.size; i++) {
      const w = new Worker(this.workerUrl);
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
        // Worker died mid-job — fail any pending job on it and let the pool
        // drop the worker. A more sophisticated implementation could respawn.
        for (const [jobId, p] of this.pending) {
          if (p.worker === w) {
            this.pending.delete(jobId);
            p.resolve({ ok: false, error: 'WORKER_ERROR', message: e.message });
          }
        }
      });
      this.workers.push(w);
      this.idle.push(w);
    }
  }

  _release(w) {
    const next = this.queue.shift();
    if (next) { this._dispatch(w, next); return; }
    this.idle.push(w);
  }

  _dispatch(w, { msg, resolve }) {
    const jobId = this.nextJobId++;
    this.pending.set(jobId, { resolve, worker: w });
    w.postMessage({ jobId, ...msg });
  }

  run(msg) {
    return new Promise((resolve) => {
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
    // Drain any queued jobs so callers don't hang forever.
    for (const q of this.queue) q.resolve({ ok: false, error: 'POOL_SHUTDOWN' });
    this.queue = [];
    for (const [, p] of this.pending) p.resolve({ ok: false, error: 'POOL_SHUTDOWN' });
    this.pending.clear();
  }
}
