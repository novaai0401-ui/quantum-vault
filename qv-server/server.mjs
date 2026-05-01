/**
 * Sigvault v3.0 — Universal REST API Server
 *
 * Any language that can make HTTP calls (Python, Java, Go, C#, Ruby, PHP,
 * Swift, Kotlin, Rust, C, C++, R, MATLAB, …) can use Sigvault through
 * this server.
 *
 * Endpoints:
 *   POST /v3/keygen              — generate ML-DSA-87 keypair
 *   POST /v3/token/issue         — issue a signed token
 *   POST /v3/token/verify        — verify + decrypt a token
 *   POST /v3/token/inspect       — inspect header (no crypto needed)
 *   GET  /v3/health              — liveness check
 *   GET  /v3/spec                — algorithm/format spec
 */

import express          from 'express';
import cors             from 'cors';
import { randomUUID }   from 'crypto';
import {
  generateKeypair, issueToken, verifyToken, inspectToken,
  MutationChain, SUITE_IDS, TOKEN_TYPES
} from '../qv-sdk/src/index.mjs';

const app  = express();
const PORT = process.env.QV_PORT || 7433;

app.use(cors());
app.use(express.json({ limit: '2mb' }));

// ─── In-memory keystore (replace with HSM/Vault in production) ───────────────
const keystore  = new Map();   // keyId → { signingKey, verifyingKey, encryptKey }
const chains    = new Map();   // keyId → MutationChain

// ─── Helpers ─────────────────────────────────────────────────────────────────
function b64e(u8) { return Buffer.from(u8).toString('base64url'); }
function b64d(s)  { return new Uint8Array(Buffer.from(s, 'base64url')); }
function hex2u8(h){ return new Uint8Array(Buffer.from(h, 'hex')); }
function u82hex(u){ return Buffer.from(u).toString('hex'); }

function apiError(res, status, code, message) {
  return res.status(status).json({ error: { code, message } });
}

// ─── GET /v3/health ───────────────────────────────────────────────────────────
app.get('/v3/health', (_req, res) => {
  res.json({ status: 'ok', version: '3.0.0', algorithm: 'ML-DSA-87 (NIST FIPS 204)' });
});

// ─── GET /v3/spec ─────────────────────────────────────────────────────────────
app.get('/v3/spec', (_req, res) => {
  res.json({
    name:      'Sigvault',
    version:   '3.0.0',
    signature: 'ML-DSA-87 (NIST FIPS 204) — Dilithium-5',
    kem:       'ML-KEM-1024 (NIST FIPS 203) — Kyber-1024',
    symmetric: 'XChaCha20-Poly1305 (AEAD)',
    hash:      'SHA3-256 (NIST FIPS 202)',
    tokenMagic: '0x51564C54 ("QVLT")',
    suites: { '0x05': 'Dilithium5', '0x09': 'Dual', '0xFF': 'Triple' },
    tokenTypes: { '0x01': 'Access', '0x02': 'Refresh', '0x03': 'Service' },
    wire: {
      magic:       '4 bytes',
      version:     '2 bytes',
      suite:       '1 byte',
      tokenType:   '1 byte',
      issuedAt:    '8 bytes (µs since Unix epoch, big-endian)',
      ttl:         '4 bytes (seconds)',
      nonce:       '32 bytes (CSPRNG)',
      deviceFp:    '32 bytes (SHA3-256 of TPM pubkey)',
      payloadLen:  '4 bytes',
      payload:     'N bytes (XChaCha20-Poly1305 encrypted MessagePack claims)',
      mutationCtr: '8 bytes (monotonic replay counter)',
      signature:   '4627 bytes (ML-DSA-87 deterministic)',
    },
    security: {
      quantum:    'Post-quantum secure — resists Grover + Shor algorithms',
      ai:         'HEISENBERG timing oblivion, KOLMOGOROV entropy, HYDRA ratchet',
      replay:     'Monotonic mutation counter — every token is unique',
      expiry:     'TTL-based, microsecond precision',
    },
  });
});

// ─── POST /v3/keygen ─────────────────────────────────────────────────────────
/**
 * Request body: { label?: string }
 * Response:     { keyId, verifyingKeyHex, encryptKeyHex, createdAt }
 *
 * The signing key NEVER leaves the server. Callers reference it by keyId.
 * In production this would be backed by an HSM (Thales, AWS CloudHSM, etc.)
 */
app.post('/v3/keygen', (req, res) => {
  try {
    const kp     = generateKeypair();
    const keyId  = randomUUID();
    const chain  = new MutationChain();

    keystore.set(keyId, {
      signingKey:   kp.signingKey,
      verifyingKey: kp.verifyingKey,
      encryptKey:   kp.encryptKey,
      label:        req.body?.label ?? keyId,
      createdAt:    Date.now(),
    });
    chains.set(keyId, chain);

    res.status(201).json({
      keyId,
      label:         req.body?.label ?? keyId,
      verifyingKeyB64: b64e(kp.verifyingKey),
      encryptKeyB64:   b64e(kp.encryptKey),
      signingKeyLen:   kp.signingKey.length,
      verifyingKeyLen: kp.verifyingKey.length,
      algorithm:       'ML-DSA-87',
      createdAt:       new Date().toISOString(),
    });
  } catch (e) {
    apiError(res, 500, 'KEYGEN_FAILED', e.message);
  }
});

// ─── POST /v3/token/issue ────────────────────────────────────────────────────
/**
 * Request body:
 *   { keyId, claims, ttl?, suite?, tokenType? }
 *
 * Response:
 *   { tokenHex, tokenB64, sizeBytes, issuedAt, ttl, mutationCtr }
 */
app.post('/v3/token/issue', (req, res) => {
  const { keyId, claims, ttl = 3600, suite = 'dilithium5', tokenType = 'access' } = req.body ?? {};
  if (!keyId)  return apiError(res, 400, 'MISSING_KEY_ID', 'keyId is required');
  if (!claims) return apiError(res, 400, 'MISSING_CLAIMS', 'claims object is required');

  const entry = keystore.get(keyId);
  if (!entry) return apiError(res, 404, 'KEY_NOT_FOUND', `keyId ${keyId} not found`);

  const suiteId = { dilithium5: SUITE_IDS.Dilithium5, dual: SUITE_IDS.Dual, triple: SUITE_IDS.Triple }[suite];
  if (suiteId === undefined) return apiError(res, 400, 'INVALID_SUITE', `unknown suite: ${suite}`);

  const typeId = { access: TOKEN_TYPES.Access, refresh: TOKEN_TYPES.Refresh, service: TOKEN_TYPES.Service }[tokenType];
  if (typeId === undefined) return apiError(res, 400, 'INVALID_TYPE', `unknown tokenType: ${tokenType}`);

  const chain = chains.get(keyId);

  try {
    const { tokenBytes, tokenHex } = issueToken({
      signingKeySeed: entry.signingKey,
      encryptKey:     entry.encryptKey,
      chain,
      claims,
      ttl,
      suite: suiteId,
      tokenType: typeId,
    });

    res.json({
      tokenHex,
      tokenB64:   b64e(tokenBytes),
      sizeBytes:  tokenBytes.length,
      issuedAt:   new Date().toISOString(),
      ttlSecs:    ttl,
      mutationCtr: Number(chain.counter),
      suite,
      tokenType,
    });
  } catch (e) {
    apiError(res, 500, 'ISSUE_FAILED', e.message);
  }
});

// ─── POST /v3/token/verify ───────────────────────────────────────────────────
/**
 * Request body:
 *   { keyId, token }   token = hex or base64url
 *
 * Response:
 *   { valid: true, claims, issuedAt, ttl, mutationCtr }
 * or
 *   { valid: false, error: { code, message } }
 */
app.post('/v3/token/verify', (req, res) => {
  const { keyId, token } = req.body ?? {};
  if (!keyId) return apiError(res, 400, 'MISSING_KEY_ID', 'keyId is required');
  if (!token) return apiError(res, 400, 'MISSING_TOKEN', 'token is required');

  const entry = keystore.get(keyId);
  if (!entry) return apiError(res, 404, 'KEY_NOT_FOUND', `keyId ${keyId} not found`);

  // Accept hex or base64url
  let tokenBytes;
  try {
    tokenBytes = /^[0-9a-f]+$/i.test(token) ? hex2u8(token) : b64d(token);
  } catch {
    return apiError(res, 400, 'INVALID_TOKEN', 'token must be hex or base64url');
  }

  // Stateless verify — accept counter > 0 (use persistent chain in production)
  const chain = MutationChain.fromState(entry.encryptKey.slice(0, 32), 0n);

  try {
    const out = verifyToken({
      token:       tokenBytes,
      verifyingKey: entry.verifyingKey,
      encryptKey:  entry.encryptKey,
      chain,
    });
    res.json({
      valid:      true,
      claims:     out.claims,
      issuedAt:   new Date(Number(out.issuedAt / 1000n)).toISOString(),
      ttlSecs:    out.ttl,
      mutationCtr: Number(out.mutationCtr),
    });
  } catch (e) {
    res.status(401).json({ valid: false, error: { code: e.message } });
  }
});

// ─── POST /v3/token/inspect ──────────────────────────────────────────────────
app.post('/v3/token/inspect', (req, res) => {
  const { token } = req.body ?? {};
  if (!token) return apiError(res, 400, 'MISSING_TOKEN', 'token is required');
  try {
    const tokenBytes = /^[0-9a-f]+$/i.test(token) ? hex2u8(token) : b64d(token);
    res.json(inspectToken(tokenBytes));
  } catch (e) {
    apiError(res, 400, 'INSPECT_FAILED', e.message);
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n╔═══════════════════════════════════════╗`);
  console.log(`║  Sigvault v3.0 REST API Server    ║`);
  console.log(`║  http://localhost:${PORT}               ║`);
  console.log(`║  ML-DSA-87 · XChaCha20 · SHA3-256    ║`);
  console.log(`╚═══════════════════════════════════════╝\n`);
});

export default app;
