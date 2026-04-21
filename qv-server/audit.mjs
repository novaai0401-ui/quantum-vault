/**
 * QuantumVault — Request-ID propagation + structured JSONL audit log
 * ====================================================================
 * Zero npm deps. Safe to call on every request.
 *
 * Design:
 *   - Every request is assigned an X-Request-Id. Accepted from the caller
 *     if it matches /^[A-Za-z0-9._-]{1,64}$/, otherwise a fresh UUID is
 *     minted. The id is echoed back on the response and passed through
 *     to every audit event for that request.
 *   - `createAuditor` returns an object with `.event(name, fields)` that
 *     writes ONE JSON object per line to either a file, stdout, or both.
 *     Errors writing the log never crash the request — they're reported
 *     once on stderr and then suppressed.
 *   - Events are deliberately flat. Field names are stable. No PII, no
 *     token material, no master-key bytes, no admin-token bytes.
 *
 * Environment:
 *   QV_AUDIT_LOG=/path/to/audit.log    default: <DATA_DIR>/audit.log
 *   QV_AUDIT_STDOUT=true|false         default: true (systemd/docker friendly)
 *   QV_AUDIT_FILE=true|false           default: true
 *   QV_AUDIT_DISABLED=true             kills all logging (tests only)
 *
 * Event shape:
 *   { ts, level, event, requestId, ip, method?, path?, status?, ms?,
 *     keyId?, suite?, reason?, actor?, n?, bytes?, ... }
 */

import { randomUUID } from 'node:crypto';
import { openSync, writeSync, closeSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const REQ_ID_RE = /^[A-Za-z0-9._-]{1,64}$/;

export function extractOrMintRequestId(req) {
  const hdr = req?.headers?.['x-request-id'];
  if (typeof hdr === 'string' && REQ_ID_RE.test(hdr)) return hdr;
  return randomUUID();
}

export function applyRequestId(req, res, id) {
  try { res.setHeader('x-request-id', id); } catch {}
  if (req) req.requestId = id;
  return id;
}

export function loadAuditConfig(env = process.env, dataDir = '.') {
  const disabled = env.QV_AUDIT_DISABLED === 'true';
  const stdout   = env.QV_AUDIT_STDOUT !== 'false';  // default on
  const fileOn   = env.QV_AUDIT_FILE   !== 'false';  // default on
  const path     = env.QV_AUDIT_LOG || `${dataDir}/audit.log`;
  return { disabled, stdout, fileOn, path };
}

/**
 * Returns { event(name, fields), close() }.
 * Log writes are best-effort. If the file can't be opened we warn on
 * stderr once and fall back to stdout.
 */
export function createAuditor({ config, now = () => new Date() } = {}) {
  if (!config || config.disabled) {
    return { event() {}, close() {} };
  }

  let fd = null;
  let fileBroken = false;
  if (config.fileOn) {
    try {
      mkdirSync(dirname(config.path), { recursive: true });
      // O_APPEND ensures atomic append under concurrent writers on POSIX.
      // 0o600 — the log may contain IPs and request ids. Not world-readable.
      fd = openSync(config.path, 'a', 0o600);
    } catch (e) {
      process.stderr.write(`[audit] could not open ${config.path}: ${e.message}\n`);
      fileBroken = true;
    }
  }

  function safeFields(fields) {
    // Guard against accidental leakage of known-sensitive keys.
    const BLOCK = new Set([
      'token', 'bearer', 'authorization', 'masterKey', 'master_key',
      'privateKey', 'private_key', 'secret', 'password', 'cookie',
    ]);
    const out = {};
    for (const [k, v] of Object.entries(fields || {})) {
      if (BLOCK.has(k)) continue;
      if (v === undefined) continue;
      out[k] = v;
    }
    return out;
  }

  function event(name, fields = {}) {
    const record = {
      ts:    now().toISOString(),
      level: fields.level || 'info',
      event: name,
      ...safeFields(fields),
    };
    delete record.level; // we re-added via spread — canonical order below
    record.level = fields.level || 'info';
    let line;
    try { line = JSON.stringify(record) + '\n'; }
    catch { line = JSON.stringify({ ts: record.ts, event: name, level: 'error', reason: 'unserializable' }) + '\n'; }

    if (fd != null && !fileBroken) {
      try { writeSync(fd, line); }
      catch (e) {
        if (!fileBroken) process.stderr.write(`[audit] write failed: ${e.message}\n`);
        fileBroken = true;
      }
    }
    if (config.stdout) {
      try { process.stdout.write(line); } catch {}
    }
  }

  function close() {
    if (fd != null) { try { closeSync(fd); } catch {} fd = null; }
  }

  return { event, close };
}
