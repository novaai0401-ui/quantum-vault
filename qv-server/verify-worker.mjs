/**
 * QuantumVault v4.1 — batch verify worker
 * =========================================
 * One of N worker threads spawned by server-sovereign.mjs.
 *
 * Message protocol (from main):
 *   { jobId, tokenBytes, verifyingKey, encryptKey, chainStateSeed, chainCtr }
 * Reply:
 *   { jobId, ok: true,  claims, mutationCtr }
 *   { jobId, ok: false, error: string }
 *
 * All key material is transferred as ArrayBuffer (structured-clone zero-copy
 * where possible). The worker holds no global state — each job is independent.
 */
import { parentPort } from 'node:worker_threads';
import { verifyToken, MutationChain } from '../qv-sdk/src/index.mjs';

parentPort.on('message', (msg) => {
  const { jobId, tokenBytes, verifyingKey, encryptKey, chainSeed, chainCtr } = msg;
  try {
    const vchain = MutationChain.fromState(new Uint8Array(chainSeed), BigInt(chainCtr));
    const out = verifyToken({
      token:        new Uint8Array(tokenBytes),
      verifyingKey: new Uint8Array(verifyingKey),
      encryptKey:   new Uint8Array(encryptKey),
      chain:        vchain,
    });
    parentPort.postMessage({
      jobId, ok: true,
      claims: out.claims,
      mutationCtr: Number(out.mutationCtr),
    });
  } catch (e) {
    parentPort.postMessage({ jobId, ok: false, error: e.message || String(e) });
  }
});

parentPort.postMessage({ ready: true });
