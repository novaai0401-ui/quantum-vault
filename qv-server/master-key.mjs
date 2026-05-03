// master-key.mjs — pluggable MasterKeyProvider.
//
// One responsibility: produce a 32-byte master key on boot. Three backends:
//
//   1. `env`  — read from QV_MASTER_KEY_HEX (existing behaviour).
//   2. `file` — read from $QV_DATA_DIR/master.key, generate-on-miss.
//   3. `exec` — run an operator-supplied command; first 64 hex chars of
//              stdout are the key. Universal escape hatch for AWS KMS,
//              HashiCorp Vault, Azure Key Vault, GCP KMS, 1Password,
//              age, sops, sentinel, doppler — anything that can write to
//              stdout in a wrapper script.
//
// Resolution order (highest-priority wins):
//   QV_MASTER_KEY_PROVIDER overrides → otherwise auto:
//     env  > exec > file
//
// The exec backend is intentionally simple: it shells the command, captures
// stdout, validates the hex, zeroes the buffer if invalid. Operators are
// expected to control the command's exposure (file mode, secrets-manager
// integration, etc.) — qv-server does not bake any one provider in.
//
// Zero npm deps — Node stdlib only.

import { spawnSync, execSync }              from 'node:child_process';
import { existsSync, readFileSync, chmodSync } from 'node:fs';
import { randomBytes }                       from 'node:crypto';

import { writeFileDurable, cleanupStaleTmp } from './durable.mjs';

const KEY_BYTES = 32;
const HEX_RE    = /[0-9a-fA-F]{64}/;

/* ─── Hex helpers ─────────────────────────────────────────────────────── */

function decodeHex(hex, who) {
  const trimmed = String(hex).trim();
  if (trimmed.length < 64) {
    throw new Error(`${who}: expected ≥64 hex chars, got ${trimmed.length}`);
  }
  // Allow callers to wrap output (e.g. "key=abc..."). Find first 64-hex run.
  const m = trimmed.match(HEX_RE);
  if (!m) throw new Error(`${who}: no 64-char hex run in output`);
  const buf = Buffer.from(m[0], 'hex');
  if (buf.length !== KEY_BYTES) {
    throw new Error(`${who}: hex decoded to ${buf.length} bytes, expected ${KEY_BYTES}`);
  }
  return buf;
}

/* ─── Backend: env ────────────────────────────────────────────────────── */

function envProvider(env) {
  const raw = env.QV_MASTER_KEY_HEX;
  if (!raw) {
    const err = new Error('env: QV_MASTER_KEY_HEX not set');
    err.code = 'MK_ENV_MISSING';
    throw err;
  }
  return { key: decodeHex(raw, 'env'), source: 'env' };
}

/* ─── Backend: file ───────────────────────────────────────────────────── */

function fileProvider({ path, allowGenerate = true }) {
  cleanupStaleTmp(path);
  if (existsSync(path)) {
    const buf = readFileSync(path);
    if (buf.length !== KEY_BYTES) {
      throw new Error(`file: ${path} is ${buf.length} bytes, expected ${KEY_BYTES}`);
    }
    return { key: Buffer.from(buf), source: 'file', path };
  }
  if (!allowGenerate) {
    const err = new Error(`file: ${path} missing and generate-on-miss disabled`);
    err.code = 'MK_FILE_MISSING';
    throw err;
  }
  const mk = randomBytes(KEY_BYTES);
  writeFileDurable(path, mk, { mode: 0o600 });
  try { chmodSync(path, 0o600); } catch {}
  return { key: mk, source: 'file', path, generated: true };
}

/* ─── Backend: exec ───────────────────────────────────────────────────── */

function execProvider({ command, timeoutMs = 30_000 }) {
  if (!command || typeof command !== 'string') {
    throw new Error('exec: QV_MASTER_KEY_EXEC must be a non-empty command');
  }
  // We deliberately use a single command-string + shell:true so operators
  // can compose pipes (e.g. `aws kms decrypt ... | jq -r .Plaintext | base64 -d | xxd -p`).
  // Operator owns the safety of the string they wrote.
  const r = spawnSync(command, {
    shell: true,
    timeout: timeoutMs,
    stdio: ['ignore', 'pipe', 'pipe'],
    // Limit stdout — the key is 64 hex chars, anything beyond a kilobyte is
    // suspicious. Prevents a runaway provider from filling memory.
    maxBuffer: 64 * 1024,
    env: process.env,
  });
  if (r.error) {
    throw new Error(`exec: failed to run provider: ${r.error.message}`);
  }
  if (r.status !== 0) {
    const stderr = (r.stderr || Buffer.alloc(0)).toString('utf8').trim();
    throw new Error(`exec: provider exited ${r.status}${stderr ? `: ${stderr}` : ''}`);
  }
  const stdout = (r.stdout || Buffer.alloc(0)).toString('utf8');
  const key    = decodeHex(stdout, 'exec');
  return { key, source: 'exec', command };
}

/* ─── Resolver ────────────────────────────────────────────────────────── */

/**
 * @param {object} opts
 * @param {string} opts.filePath               — path to master.key
 * @param {NodeJS.ProcessEnv} [opts.env]       — env source (defaults to process.env)
 * @param {boolean} [opts.allowGenerate=true]  — generate-on-miss for file backend
 * @returns {{ key: Buffer, source: 'env'|'file'|'exec', path?: string,
 *             command?: string, generated?: boolean }}
 */
export function loadMasterKey(opts) {
  if (!opts || !opts.filePath) {
    throw new Error('loadMasterKey: filePath is required');
  }
  const env       = opts.env ?? process.env;
  const explicit  = (env.QV_MASTER_KEY_PROVIDER || '').trim().toLowerCase();
  const allowGen  = opts.allowGenerate ?? true;

  // Explicit selection — fail loud if the chosen backend can't deliver.
  if (explicit === 'env')  return envProvider(env);
  if (explicit === 'file') return fileProvider({ path: opts.filePath, allowGenerate: allowGen });
  if (explicit === 'exec') return execProvider({ command: env.QV_MASTER_KEY_EXEC });
  if (explicit && explicit !== 'auto') {
    throw new Error(`QV_MASTER_KEY_PROVIDER unknown: '${explicit}' (env|file|exec|auto)`);
  }

  // Auto: env > exec > file. First wins.
  if (env.QV_MASTER_KEY_HEX)  return envProvider(env);
  if (env.QV_MASTER_KEY_EXEC) return execProvider({ command: env.QV_MASTER_KEY_EXEC });
  return fileProvider({ path: opts.filePath, allowGenerate: allowGen });
}

/* ─── Test helpers (exported for unit tests, not for production) ──────── */

export const __testing__ = { decodeHex, envProvider, fileProvider, execProvider };
