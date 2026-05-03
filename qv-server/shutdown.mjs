/**
 * Sigvault — Graceful shutdown
 * ===================================
 * Zero npm deps. Wires SIGTERM/SIGINT into an orderly drain:
 *
 *   1. Stop accepting NEW connections (server.close()).
 *   2. Flip a "shutting down" flag so /v3/health returns 503 and
 *      load balancers stop routing.
 *   3. Wait for in-flight requests to finish (tracked via
 *      `beginRequest`/`endRequest`).
 *   4. Run teardown callbacks in order (close worker pool, save
 *      keystore, close audit file descriptor, …).
 *   5. Exit(0). If the whole dance takes longer than
 *      QV_SHUTDOWN_TIMEOUT_MS (default 30000), force exit(1).
 *
 * Usage:
 *   const sd = installShutdown({
 *     server,
 *     teardown: [async () => await verifyPool.shutdown(),
 *                () => audit.close()],
 *     timeoutMs: 30000,
 *   });
 *   // Wrap the dispatcher with sd.trackRequest so in-flight is tracked.
 */

const SIGNALS = ['SIGTERM', 'SIGINT'];

export function createShutdown({ server, teardown = [], timeoutMs = 30000, log = defaultLog, exit = process.exit } = {}) {
  let draining = false;
  let inFlight = 0;
  let shutdownPromise = null;

  function isDraining() { return draining; }

  function beginRequest() { inFlight += 1; }
  function endRequest()   { inFlight -= 1; if (inFlight < 0) inFlight = 0; }

  async function waitForDrain(deadline) {
    while (inFlight > 0 && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 50));
    }
  }

  function shutdown(signal = 'manual') {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
      draining = true;
      log(`shutdown: received ${signal}, draining (in-flight=${inFlight}, timeout=${timeoutMs}ms)`);
      const deadline = Date.now() + timeoutMs;

      // 1. Stop accepting new connections. close() resolves once all kept-alive
      //    connections are idle; existing in-flight continues.
      const closed = new Promise((resolve) => {
        if (!server || typeof server.close !== 'function') return resolve();
        server.close(() => resolve());
      });

      // 2. Wait for in-flight requests to finish.
      await waitForDrain(deadline);

      // 3. Server close may still be pending on keep-alive; race with deadline.
      await Promise.race([
        closed,
        new Promise(r => setTimeout(r, Math.max(0, deadline - Date.now()))),
      ]);

      // 4. Teardown callbacks (in order). Failures are logged, never thrown.
      for (const t of teardown) {
        try { await t(); }
        catch (e) { log(`shutdown: teardown failed: ${e.message}`, 'error'); }
      }

      log(`shutdown: complete (in-flight=${inFlight})`);
      exit(0);
    })();

    // Hard timeout: if we're still here after timeoutMs + 1s grace, force exit.
    const hardDeadline = setTimeout(() => {
      log(`shutdown: timed out after ${timeoutMs}ms, forcing exit(1)`, 'error');
      exit(1);
    }, timeoutMs + 1000);
    if (hardDeadline.unref) hardDeadline.unref();

    return shutdownPromise;
  }

  function install() {
    for (const sig of SIGNALS) {
      process.on(sig, () => { shutdown(sig).catch(() => exit(1)); });
    }
  }

  /**
   * Dispatcher wrapper: increments in-flight on request, decrements on response
   * finish/close. Call this around your route handler chain.
   */
  function trackRequest(handler) {
    return async (req, res) => {
      beginRequest();
      let done = false;
      const finish = () => { if (done) return; done = true; endRequest(); };
      res.on('finish', finish);
      res.on('close',  finish);
      try { await handler(req, res); }
      catch (e) { finish(); throw e; }
    };
  }

  return {
    install, shutdown, trackRequest, beginRequest, endRequest,
    isDraining,
    get inFlight() { return inFlight; },
    get draining() { return draining; },
  };
}

function defaultLog(msg, level = 'info') {
  const line = `[shutdown:${level}] ${msg}\n`;
  if (level === 'error') process.stderr.write(line);
  else                   process.stdout.write(line);
}
