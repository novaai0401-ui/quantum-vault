// falcon-bridge.mjs — child-process bridge from qv-server (Node) to
// qv-cli (Rust) for Falcon-512 / Falcon-1024 sign + verify.
//
// Why this exists
// ----------------
// qv-server has a zero-npm-dependency oath. There is no audited
// pure-JS Falcon implementation that respects that oath, and qv-wasm
// can't compile PQClean's C without a wasm32-wasip1 toolchain. The
// pragmatic v4.3 path is to delegate the cryptographic primitive to
// qv-cli (which links qv-core's PQClean Falcon directly) via a child
// process per call.
//
// Trade-off: each call pays ~50–100 ms of process spawn + Falcon
// keygen/sign cost. Acceptable for ad-hoc operator signing, infeasible
// for a verify hot path. The HTTP surface that wraps this (see
// server-sovereign.mjs) is therefore admin-only for sign and
// rate-limited for verify.
//
// Discovery: the qv-cli binary is found by walking, in order:
//   1. process.env.QV_CLI_BIN  (operator override)
//   2. ./target/release/qv     (workspace builds)
//   3. ./target/debug/qv       (dev)
//   4. PATH lookup for `qv`   (installed)
//
// Operators in production should set QV_CLI_BIN to the absolute path
// of a signed qv-cli build that lives next to qv-server.
//
// Zero deps. Node stdlib only.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BYTES  = 16 * 1024 * 1024;   // 16 MiB cap on stdout/stderr

const BIN_EXTS = process.platform === 'win32' ? ['.exe', ''] : [''];

/**
 * Resolve the qv-cli binary path. Caches the result for the process
 * lifetime so a startup probe is enough.
 */
let cachedBin = null;
let cachedProbe = null;

function findQvCli() {
  if (cachedBin) return cachedBin;
  const candidates = [];
  if (process.env.QV_CLI_BIN) candidates.push(process.env.QV_CLI_BIN);
  for (const ext of BIN_EXTS) {
    candidates.push(join(REPO, 'target', 'release', 'qv' + ext));
    candidates.push(join(REPO, 'target', 'debug',   'qv' + ext));
  }
  for (const c of candidates) {
    if (existsSync(c)) { cachedBin = c; return c; }
  }
  // PATH lookup. On win32 spawnSync respects PATHEXT.
  for (const ext of BIN_EXTS) {
    try {
      const r = spawnSync('qv' + ext, ['--version'], { stdio: 'ignore' });
      if (r.status === 0) { cachedBin = 'qv' + ext; return cachedBin; }
    } catch {}
  }
  return null;
}

/**
 * Probe qv-cli at startup. Returns:
 *   { available: true, path, falconBuilt: true|false, version }
 *   { available: false, reason }
 *
 * `falconBuilt` reports whether the CLI was built with the `falcon`
 * feature flag (default on v4.3+). If false the bridge surfaces a
 * structured error instead of spawning a process that would fail.
 */
export function probeFalconCli() {
  if (cachedProbe) return cachedProbe;
  const bin = findQvCli();
  if (!bin) {
    cachedProbe = { available: false,
      reason: 'qv-cli binary not found — set QV_CLI_BIN or build qv-cli' };
    return cachedProbe;
  }
  // Try `qv falcon-keygen --help` to detect the feature flag.
  const r = spawnSync(bin, ['falcon-keygen', '--help'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 5000,
  });
  const out = (r.stdout || '').toString() + (r.stderr || '').toString();
  const falconBuilt = r.status === 0 || out.includes('falcon');
  if (!falconBuilt) {
    cachedProbe = { available: false, path: bin,
      reason: 'qv-cli was built without the `falcon` feature — '
            + 'rebuild with `cargo build -p qv-cli` (default features) '
            + 'or `cargo build -p qv-cli --features falcon`' };
    return cachedProbe;
  }
  cachedProbe = { available: true, path: bin, falconBuilt: true };
  return cachedProbe;
}

// ─── Bridge implementation ────────────────────────────────────────────────────

function ensureProbe() {
  const p = probeFalconCli();
  if (!p.available) {
    const e = new Error(`FALCON_BRIDGE_UNAVAILABLE: ${p.reason}`);
    e.code = 'FALCON_BRIDGE_UNAVAILABLE';
    throw e;
  }
  return p;
}

function tdir() { return mkdtempSync(join(tmpdir(), 'qv-falcon-')); }

/**
 * Run qv-cli with the given args and stdin payload, returning
 * { code, stdout, stderr }. Enforces a hard timeout + output caps so a
 * runaway child can't DOS the server.
 */
function runChild(args, { stdin = null, timeoutMs = DEFAULT_TIMEOUT_MS, maxBytes = DEFAULT_MAX_BYTES } = {}) {
  const probe = ensureProbe();
  return new Promise((resolveP, rejectP) => {
    const child = spawn(probe.path, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let outLen = 0, errLen = 0;
    const outChunks = [], errChunks = [];
    let killed = false;

    const to = setTimeout(() => {
      killed = true;
      try { child.kill('SIGKILL'); } catch {}
      const e = new Error('FALCON_BRIDGE_TIMEOUT');
      e.code = 'FALCON_BRIDGE_TIMEOUT';
      rejectP(e);
    }, timeoutMs);
    if (to.unref) to.unref();

    child.stdout.on('data', (b) => {
      outLen += b.length;
      if (outLen > maxBytes) {
        killed = true;
        try { child.kill('SIGKILL'); } catch {}
        const e = new Error('FALCON_BRIDGE_OUTPUT_TOO_LARGE');
        e.code = 'FALCON_BRIDGE_OUTPUT_TOO_LARGE';
        rejectP(e);
        return;
      }
      outChunks.push(b);
    });
    child.stderr.on('data', (b) => {
      errLen += b.length;
      if (errLen <= maxBytes) errChunks.push(b);
    });
    child.on('error', (e) => {
      clearTimeout(to);
      rejectP(e);
    });
    child.on('close', (code) => {
      clearTimeout(to);
      if (killed) return;
      resolveP({
        code,
        stdout: Buffer.concat(outChunks),
        stderr: Buffer.concat(errChunks),
      });
    });

    if (stdin != null) {
      child.stdin.write(stdin);
    }
    child.stdin.end();
  });
}

/**
 * Sign `msg` (Buffer) under the given Falcon signing key (raw bytes).
 *
 * @param {object} opts
 * @param {Buffer} opts.signingKey   raw Falcon secret-key bytes
 * @param {Buffer} opts.message      bytes to sign
 * @param {512|1024} opts.n
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<Buffer>}        raw signature bytes
 */
export async function falconSign({ signingKey, message, n, timeoutMs }) {
  if (n !== 512 && n !== 1024) {
    const e = new Error(`FALCON_BAD_N: must be 512 or 1024, got ${n}`);
    e.code = 'FALCON_BAD_N'; throw e;
  }
  if (!Buffer.isBuffer(signingKey) || !Buffer.isBuffer(message)) {
    const e = new Error('FALCON_BAD_INPUT: signingKey and message must be Buffer');
    e.code = 'FALCON_BAD_INPUT'; throw e;
  }
  const dir = tdir();
  const skPath  = join(dir, 'sk.bin');
  const msgPath = join(dir, 'msg.bin');
  try {
    writeFileSync(skPath,  signingKey, { mode: 0o600 });
    writeFileSync(msgPath, message);
    const r = await runChild(
      ['falcon-sign', '--n', String(n), '--sk', skPath, '--msg', msgPath, '--format', 'hex'],
      { timeoutMs },
    );
    if (r.code !== 0) {
      const e = new Error(`FALCON_SIGN_FAILED: exit ${r.code} — ${r.stderr.toString().trim().slice(0, 500)}`);
      e.code = 'FALCON_SIGN_FAILED'; throw e;
    }
    const hex = r.stdout.toString('utf8').trim();
    if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) {
      const e = new Error('FALCON_SIGN_BAD_OUTPUT: expected hex on stdout');
      e.code = 'FALCON_SIGN_BAD_OUTPUT'; throw e;
    }
    return Buffer.from(hex, 'hex');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Verify `signature` against `message` under the given Falcon
 * verifying key. Resolves to true on VALID, false on INVALID. Other
 * errors throw with structured codes.
 */
export async function falconVerify({ verifyingKey, message, signature, n, timeoutMs }) {
  if (n !== 512 && n !== 1024) {
    const e = new Error(`FALCON_BAD_N: must be 512 or 1024, got ${n}`);
    e.code = 'FALCON_BAD_N'; throw e;
  }
  if (!Buffer.isBuffer(verifyingKey) || !Buffer.isBuffer(message) || !Buffer.isBuffer(signature)) {
    const e = new Error('FALCON_BAD_INPUT: verifyingKey, message, signature must be Buffer');
    e.code = 'FALCON_BAD_INPUT'; throw e;
  }
  const dir = tdir();
  const vkPath  = join(dir, 'vk.bin');
  const msgPath = join(dir, 'msg.bin');
  try {
    writeFileSync(vkPath,  verifyingKey);
    writeFileSync(msgPath, message);
    const r = await runChild(
      ['falcon-verify', '--n', String(n), '--vk', vkPath, '--msg', msgPath,
       '--sig', signature.toString('hex')],
      { timeoutMs },
    );
    // qv-cli returns 0 = VALID, 2 = INVALID, anything else = error.
    if (r.code === 0)  return true;
    if (r.code === 2)  return false;
    const e = new Error(`FALCON_VERIFY_FAILED: exit ${r.code} — ${r.stderr.toString().trim().slice(0, 500)}`);
    e.code = 'FALCON_VERIFY_FAILED'; throw e;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Exposed for tests.
export const __testing = { findQvCli, runChild };
