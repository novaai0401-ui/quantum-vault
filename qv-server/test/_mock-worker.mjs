/**
 * Mock verify-worker for unit-testing VerifyPool.
 * Echoes the job back after an optional configurable delay so tests can
 * control queueing behaviour.
 *
 * Protocol:
 *   First message from main: { jobId, kind:'ping' } → echo { ok:true, jobId, pong:true }
 *   Any other message: { jobId, delayMs? } → reply { ok:true, jobId } after delay
 */
import { parentPort } from 'node:worker_threads';

parentPort.postMessage({ ready: true });

parentPort.on('message', (msg) => {
  const { jobId, delayMs = 0, fail = false } = msg;
  const reply = fail
    ? { jobId, ok: false, error: 'MOCK_FAIL' }
    : { jobId, ok: true,  echoed: true };
  if (delayMs > 0) setTimeout(() => parentPort.postMessage(reply), delayMs);
  else parentPort.postMessage(reply);
});
