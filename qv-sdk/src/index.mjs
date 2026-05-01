/**
 * Sigvault v3.0 — Node.js / WASM-ready SDK
 *
 * Runs on Node.js, Deno, Bun, Cloudflare Workers, and any browser that
 * supports WebCrypto + WebAssembly. Never blocked by OS AppControl because
 * it executes inside the already-trusted JavaScript runtime.
 *
 * Cryptographic primitives:
 *  - ML-DSA-87 (Dilithium-5, NIST FIPS 204)  ← @noble/post-quantum
 *  - XChaCha20-Poly1305                        ← @noble/ciphers
 *  - SHA3-256                                  ← @noble/hashes
 *  - CSPRNG                                    ← WebCrypto getRandomValues
 */

import { ml_dsa87 }        from '@noble/post-quantum/ml-dsa.js';
import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { sha3_256 }          from '@noble/hashes/sha3.js';
import { randomBytes }       from '@noble/hashes/utils.js';
import { deflateRawSync, inflateRawSync } from 'node:zlib';

// ─── Payload compression markers (inside the encrypted blob) ────────────────
// Backward compat: legacy tokens start with 0x8N (MessagePack fixmap for N
// claims, N<=15). So we detect on decrypt — if byte 0 is 0x00 or 0x01 it's
// a v4.1 marker, otherwise it's legacy raw MessagePack.
const PAYLOAD_RAW     = 0x00;   // plaintext = [0x00] + msgpack
const PAYLOAD_DEFLATE = 0x01;   // plaintext = [0x01] + deflate-raw(msgpack)

// ─── Constants ───────────────────────────────────────────────────────────────

export const MAGIC        = 0x51564C54;     // "QVLT"
export const VERSION      = 0x0300;         // v3.0
export const SUITE_IDS    = {
  Dilithium5: 0x05,            // ML-DSA-87  — default, PQ-256
  Dilithium3: 0x02,             // ML-DSA-65  — reserved (PQ-192, smaller)
  Dilithium2: 0x03,             // ML-DSA-44  — reserved (PQ-128, smallest ML-DSA)
  Falcon512:  0x10,             // Falcon-512  — reserved (PQ-128, ~666B sig)
  Falcon1024: 0x11,             // Falcon-1024 — reserved (PQ-256, ~1280B sig)
  Dual:       0x09, Triple: 0xFF,
};
export const TOKEN_TYPES  = { Access: 0x01, Refresh: 0x02, Service: 0x03 };
export const SIG_LEN      = 4627;           // ML-DSA-87 signature bytes
export const VK_LEN       = 2592;           // verifying key bytes
export const SK_SEED_LEN  = 32;             // signing key seed bytes

// ─── Key management ──────────────────────────────────────────────────────────

/**
 * Generate a fresh ML-DSA-87 keypair.
 * @returns {{ signingKey: Uint8Array, verifyingKey: Uint8Array, encryptKey: Uint8Array }}
 *   signingKey  — 32-byte seed (store securely; reconstruct full key on demand)
 *   verifyingKey— 2592-byte public key
 *   encryptKey  — 32-byte XChaCha20 symmetric key
 */
export function generateKeypair() {
  const kp = ml_dsa87.keygen();        // generates from CSPRNG internally
  return {
    signingKey:   kp.secretKey,        // 4896B — ML-DSA-87 expanded secret key
    verifyingKey: kp.publicKey,        // 2592B
    encryptKey:   randomBytes(32),     // 32B XChaCha20 key
  };
}

// ─── Entropy certification (KOLMOGOROV) ──────────────────────────────────────

function certifyEntropy(data) {
  if (data.length < 8) return;
  const total  = data.length - 3;
  const seen   = new Set();
  for (let i = 0; i < total; i++) {
    const key = (data[i] << 24) | (data[i+1] << 16) | (data[i+2] << 8) | data[i+3];
    seen.add(key >>> 0);
  }
  const ratio = seen.size / total;
  if (ratio < 0.85) {
    throw new Error(`KOLMOGOROV: entropy too low (ratio ${ratio.toFixed(3)})`);
  }
}

// ─── Mutation chain (HYDRA ratchet) ──────────────────────────────────────────

export class MutationChain {
  #state;
  #counter;

  constructor(seed = randomBytes(32)) {
    this.#state   = seed instanceof Uint8Array ? seed : new Uint8Array(seed);
    this.#counter = 0n;
  }

  static fromState(state, counter) {
    const mc = new MutationChain(state);
    mc.#counter = BigInt(counter);
    return mc;
  }

  advance() {
    const buf = new Uint8Array(40);
    buf.set(this.#state, 0);
    const view = new DataView(buf.buffer);
    view.setBigUint64(32, this.#counter, false);
    this.#state = sha3_256(buf);
    this.#counter++;
    return this.#state;
  }

  get counter() { return this.#counter; }
  get state()   { return this.#state; }

  checkTokenCounter(tokenCtr) {
    const tc = BigInt(tokenCtr);
    if (tc <= this.#counter) {
      throw new Error(`REPLAY: token counter ${tc} <= chain counter ${this.#counter}`);
    }
  }
}

// ─── Payload encryption (XChaCha20-Poly1305) ─────────────────────────────────

function encryptPayload(plaintext, encryptKey, tokenNonce) {
  const digest = sha3_256(tokenNonce);
  const nonce  = digest.slice(0, 12);      // 12-byte ChaCha nonce from SHA3 digest
  const cipher = chacha20poly1305(encryptKey, nonce);
  return cipher.encrypt(plaintext);
}

function decryptPayload(ciphertext, encryptKey, tokenNonce) {
  const digest = sha3_256(tokenNonce);
  const nonce  = digest.slice(0, 12);
  const cipher = chacha20poly1305(encryptKey, nonce);
  return cipher.decrypt(ciphertext);
}

// ─── Claims (minimal MessagePack subset) ─────────────────────────────────────

function encodeClaims(claims) {
  const entries = Object.entries(claims);
  if (entries.length > 15) throw new Error('too many claims (max 15)');
  const parts = [new Uint8Array([0x80 | entries.length])];
  for (const [k, v] of entries) {
    parts.push(encodeStr(k));
    parts.push(encodeStr(String(v)));
  }
  return concat(...parts);
}

function decodeClaims(data) {
  let pos = 0;
  if ((data[pos] & 0xF0) !== 0x80) throw new Error('expected fixmap');
  const n = data[pos++] & 0x0F;
  const claims = {};
  for (let i = 0; i < n; i++) {
    const [k, ka] = decodeStr(data, pos); pos += ka;
    const [v, va] = decodeStr(data, pos); pos += va;
    claims[k] = v;
  }
  return claims;
}

function encodeStr(s) {
  const b = new TextEncoder().encode(s);
  if (b.length <= 31) return concat(new Uint8Array([0xA0 | b.length]), b);
  if (b.length <= 255) return concat(new Uint8Array([0xd9, b.length]), b);
  throw new Error('claim too long');
}

function decodeStr(data, pos) {
  const b0 = data[pos];
  if ((b0 & 0xE0) === 0xA0) {
    const len = b0 & 0x1F;
    return [new TextDecoder().decode(data.slice(pos+1, pos+1+len)), 1+len];
  }
  if (b0 === 0xd9) {
    const len = data[pos+1];
    return [new TextDecoder().decode(data.slice(pos+2, pos+2+len)), 2+len];
  }
  throw new Error(`unexpected msgpack byte 0x${b0.toString(16)}`);
}

// ─── Token wire format ───────────────────────────────────────────────────────

function writeUint64BE(buf, offset, value) {
  const hi = Number(BigInt(value) >> 32n) >>> 0;
  const lo = Number(BigInt(value) & 0xFFFFFFFFn) >>> 0;
  const v  = new DataView(buf.buffer, buf.byteOffset);
  v.setUint32(offset, hi, false);
  v.setUint32(offset + 4, lo, false);
}

function readUint64BE(buf, offset) {
  const v  = new DataView(buf.buffer, buf.byteOffset);
  const hi = BigInt(v.getUint32(offset, false));
  const lo = BigInt(v.getUint32(offset + 4, false));
  return (hi << 32n) | lo;
}

function serializeToken(header, encPayload, signature) {
  const plLen = encPayload.length;
  const total = 88 + plLen + 8 + signature.length;
  const buf   = new Uint8Array(total);
  const dv    = new DataView(buf.buffer);

  dv.setUint32(0,  MAGIC,    false);
  dv.setUint16(4,  VERSION,  false);
  buf[6] = header.suite;
  buf[7] = header.tokenType;
  writeUint64BE(buf, 8,  header.issuedAt);
  dv.setUint32(16, header.ttl, false);
  buf.set(header.nonce,    20);
  buf.set(header.deviceFp, 52);
  dv.setUint32(84, plLen, false);
  buf.set(encPayload, 88);
  writeUint64BE(buf, 88 + plLen, header.mutationCtr);
  buf.set(signature, 96 + plLen);

  return buf;
}

function deserializeToken(data) {
  const dv = new DataView(data.buffer, data.byteOffset);

  if (dv.getUint32(0, false) !== MAGIC)   throw new Error('Invalid magic');
  const version = dv.getUint16(4, false);
  if (version !== VERSION)               throw new Error(`Unsupported version 0x${version.toString(16)}`);

  const suite       = data[6];
  const tokenType   = data[7];
  const issuedAt    = readUint64BE(data, 8);
  const ttl         = dv.getUint32(16, false);
  const nonce       = data.slice(20, 52);
  const deviceFp    = data.slice(52, 84);
  const plLen       = dv.getUint32(84, false);
  const encPayload  = data.slice(88, 88 + plLen);
  const mutationCtr = readUint64BE(data, 88 + plLen);
  const signature   = data.slice(96 + plLen);

  return { header: { suite, tokenType, issuedAt, ttl, nonce, deviceFp, mutationCtr }, encPayload, signature };
}

function signedBytes(header, encPayload) {
  // Reconstruct the bytes the signature covers (all bytes before the sig field).
  return serializeToken(header, encPayload, new Uint8Array(0)).slice(0, 96 + encPayload.length);
}

// ─── Issue ────────────────────────────────────────────────────────────────────

/**
 * Issue a new Sigvault token.
 *
 * @param {object} params
 * @param {Uint8Array} params.signingKeySeed   — 32-byte ML-DSA-87 seed
 * @param {Uint8Array} params.encryptKey       — 32-byte XChaCha20 key
 * @param {MutationChain} params.chain         — HYDRA mutation chain (mutated in place)
 * @param {object}       params.claims         — plain JS object of string claims
 * @param {number}       [params.ttl=3600]     — TTL in seconds
 * @param {number}       [params.suite]        — SUITE_IDS value
 * @param {number}       [params.tokenType]    — TOKEN_TYPES value
 * @param {Uint8Array}   [params.deviceFp]     — 32-byte device fingerprint
 * @returns {{ tokenBytes: Uint8Array, tokenHex: string }}
 */
export function issueToken({
  signingKeySeed, encryptKey, chain, claims,
  ttl = 3600,
  suite = SUITE_IDS.Dilithium5,
  tokenType = TOKEN_TYPES.Access,
  deviceFp = null,
}) {
  // 1. Timestamp in microseconds.
  const issuedAt = BigInt(Date.now()) * 1000n;

  // 2. CSPRNG nonce.
  const nonce = randomBytes(32);
  certifyEntropy(nonce);

  // 3. Device fingerprint.
  const fp = deviceFp ?? sha3_256(nonce);

  // 4. Advance mutation chain.
  chain.advance();
  const mutationCtr = chain.counter;

  // 5. Encode + optionally compress + encrypt claims.
  //    `compress` options: 'auto' (default, only if it shrinks), true, false.
  const rawClaims = encodeClaims(claims);
  let plaintext;
  const mode = arguments[0].compress ?? 'auto';
  if (mode === false) {
    plaintext = concat(new Uint8Array([PAYLOAD_RAW]), rawClaims);
  } else {
    const deflated = deflateRawSync(Buffer.from(rawClaims), { level: 9 });
    const useCompressed = (mode === true)
      || (mode === 'auto' && deflated.length + 1 < rawClaims.length + 1);
    plaintext = useCompressed
      ? concat(new Uint8Array([PAYLOAD_DEFLATE]), new Uint8Array(deflated))
      : concat(new Uint8Array([PAYLOAD_RAW]),     rawClaims);
  }
  const encPayload = encryptPayload(plaintext, encryptKey, nonce);

  // 6. Build header.
  const header = { suite, tokenType, issuedAt, ttl, nonce, deviceFp: fp, mutationCtr };

  // 7. Sign everything except the signature field.
  //    noble API: sign(msg, secretKey)
  const msgBuf = signedBytes(header, encPayload);
  const sig    = ml_dsa87.sign(msgBuf, signingKeySeed);

  // 8. Serialize.
  const tokenBytes = serializeToken(header, encPayload, sig);
  return { tokenBytes, tokenHex: toHex(tokenBytes) };
}

// ─── Verify ───────────────────────────────────────────────────────────────────

/**
 * Verify a Sigvault token through the 7-layer pipeline.
 *
 * @param {object} params
 * @param {Uint8Array|string} params.token    — raw bytes or hex string
 * @param {Uint8Array}  params.verifyingKey   — 2592-byte ML-DSA-87 public key
 * @param {Uint8Array}  params.encryptKey     — 32-byte XChaCha20 key
 * @param {MutationChain} params.chain        — chain to check replay against
 * @returns {{ claims, issuedAt, ttl, mutationCtr }}
 */
export function verifyToken({ token, verifyingKey, encryptKey, chain }) {
  const data = typeof token === 'string' ? fromHex(token) : token;
  const { header, encPayload, signature } = deserializeToken(data);

  // Layer 2 — entropy on nonce.
  certifyEntropy(header.nonce);

  // Layer 3 — temporal validity.
  const nowUs = BigInt(Date.now()) * 1000n;
  if (header.issuedAt > nowUs + 5_000_000n) throw new Error('TOKEN_NOT_YET_VALID');
  const expiryUs = header.issuedAt + BigInt(header.ttl) * 1_000_000n;
  if (nowUs > expiryUs) throw new Error(`TOKEN_EXPIRED (issued ${header.issuedAt}, ttl ${header.ttl}s)`);

  // Layer 4 — signature.
  //    noble API: verify(sig, msg, publicKey)
  const msgBuf = signedBytes(header, encPayload);
  const valid  = ml_dsa87.verify(signature, msgBuf, verifyingKey);
  if (!valid) throw new Error('SIGNATURE_INVALID');

  // Layer 5 — decrypt payload.
  const plaintext = decryptPayload(encPayload, encryptKey, header.nonce);

  // Layer 6 — replay detection.
  chain.checkTokenCounter(header.mutationCtr);

  // Layer 7 — decompress (if v4.1 marker) then decode claims.
  let payloadBytes;
  if (plaintext.length > 0 && (plaintext[0] === PAYLOAD_RAW || plaintext[0] === PAYLOAD_DEFLATE)) {
    const body = plaintext.slice(1);
    payloadBytes = plaintext[0] === PAYLOAD_DEFLATE
      ? new Uint8Array(inflateRawSync(Buffer.from(body)))
      : body;
  } else {
    // Legacy token without marker byte.
    payloadBytes = plaintext;
  }
  const claims = decodeClaims(payloadBytes);

  return { claims, issuedAt: header.issuedAt, ttl: header.ttl, mutationCtr: header.mutationCtr };
}

// ─── Inspect ─────────────────────────────────────────────────────────────────

export function inspectToken(tokenHexOrBytes) {
  const data = typeof tokenHexOrBytes === 'string' ? fromHex(tokenHexOrBytes) : tokenHexOrBytes;
  const { header, encPayload, signature } = deserializeToken(data);
  const suiteName = Object.entries(SUITE_IDS).find(([,v]) => v === header.suite)?.[0] ?? 'unknown';
  const typeName  = Object.entries(TOKEN_TYPES).find(([,v]) => v === header.tokenType)?.[0] ?? 'unknown';
  return {
    version:     `0x${VERSION.toString(16).padStart(4,'0')}`,
    suite:       `${suiteName} (0x${header.suite.toString(16).padStart(2,'0')})`,
    tokenType:   typeName,
    issuedAt:    header.issuedAt.toString(),
    ttl:         `${header.ttl}s`,
    nonce:       toHex(header.nonce),
    deviceFp:    toHex(header.deviceFp),
    mutationCtr: header.mutationCtr.toString(),
    payloadLen:  `${encPayload.length} bytes (encrypted)`,
    sigLen:      `${signature.length} bytes`,
    totalBytes:  data.length,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toHex(bytes) { return Buffer.from(bytes).toString('hex'); }
function fromHex(hex) { return new Uint8Array(Buffer.from(hex, 'hex')); }
function concat(...arrs) {
  const total = arrs.reduce((n, a) => n + a.length, 0);
  const out   = new Uint8Array(total);
  let   pos   = 0;
  for (const a of arrs) { out.set(a, pos); pos += a.length; }
  return out;
}
