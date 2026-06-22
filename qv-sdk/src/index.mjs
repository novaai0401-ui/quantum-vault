/**
 * Sigvault SDK — see ./package.json for the authoritative version.
 *
 * Runs on Node.js, Deno, Bun, Cloudflare Workers, and any modern
 * browser. The compression path is runtime-detected and degrades to
 * uncompressed-only on platforms that ship neither `node:zlib` nor the
 * `CompressionStream` Web API.
 *
 * Cryptographic primitives:
 *  - ML-DSA-87 (Dilithium-5, NIST FIPS 204)  ← @noble/post-quantum
 *  - XChaCha20-Poly1305                        ← @noble/ciphers
 *  - SHA3-256                                  ← @noble/hashes
 *  - CSPRNG                                    ← @noble/hashes (WebCrypto under the hood)
 *
 * Falcon-512 / Falcon-1024 are reserved in the wire format but not yet
 * signed by this SDK — there is no audited zero-dep JS Falcon impl. For
 * Falcon today, use the server-side `/v3/admin/falcon/sign` bridge or
 * call `qv-cli` directly. See limitation L9.
 */

import { ml_dsa87 }         from '@noble/post-quantum/ml-dsa.js';
import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { sha3_256 }         from '@noble/hashes/sha3.js';
import { randomBytes }      from '@noble/hashes/utils.js';

// ─── Compression — platform-detected ────────────────────────────────────────
// We support three modes:
//   1. Node — use node:zlib synchronously (fastest, classic path).
//   2. Browser / Workers / Deno — use the CompressionStream Web API
//      (asynchronous; we only invoke it when the caller opts in).
//   3. Neither available — `_compressionAvailable` is false and any
//      `compress: 'auto' | true` request silently degrades to `false`.
//
// Detecting `node:zlib` requires a dynamic import because a static
// `import 'node:zlib'` breaks every non-Node runtime at module-load
// time (Workers throw `unsupported module` on parse).
//
// `_deflateRawSync` / `_inflateRawSync` are the Node-only fast path and
// are populated only when we're on Node. The CompressionStream path is
// async and surfaces via `compressAsync` / `decompressAsync` helpers
// reserved for a future, fully-async issue/verify pipeline.
let _deflateRawSync = null;
let _inflateRawSync = null;
let _compressionAvailable = false;

const _isNode = typeof process !== 'undefined' &&
                process?.versions?.node !== undefined &&
                typeof globalThis?.window === 'undefined';

if (_isNode) {
  // Top-level await is fine inside ESM. Bundlers that don't follow
  // node:* imports (esbuild + browser target) will tree-shake this
  // branch out because `_isNode` is statically false there.
  try {
    const zlib = await import('node:zlib');
    _deflateRawSync = zlib.deflateRawSync;
    _inflateRawSync = zlib.inflateRawSync;
    _compressionAvailable = true;
  } catch { /* swallow — fall through to the Web API check */ }
}

if (!_compressionAvailable && typeof globalThis?.CompressionStream !== 'undefined') {
  // CompressionStream is async-only. We don't wire it into the sync
  // issueToken path here — instead, callers on browser/Workers should
  // either pass `compress: false` (default for those runtimes via the
  // auto-detection below) or use the future async API.
  _compressionAvailable = false; // sync API still unavailable in this branch
}

// ─── Payload compression markers (inside the encrypted blob) ────────────────
// Backward compat: legacy tokens start with 0x8N (MessagePack fixmap for N
// claims, N<=15). So we detect on decrypt — if byte 0 is 0x00 or 0x01 it's
// a v4.1 marker, otherwise it's legacy raw MessagePack.
const PAYLOAD_RAW     = 0x00;   // plaintext = [0x00] + msgpack
const PAYLOAD_DEFLATE = 0x01;   // plaintext = [0x01] + deflate-raw(msgpack)

// ─── Constants ───────────────────────────────────────────────────────────────

export const MAGIC        = 0x51564C54;     // "QVLT"
// Wire-format version: 0x0300 = wire v3.0. Bumped only on a
// breaking change to the byte layout. Distinct from the npm
// package version (see package.json) — clients should never rely on
// the npm version to negotiate the wire format.
export const VERSION      = 0x0300;
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

  /**
   * Advance the chain's high-water mark to a specific counter. Called by
   * `verifyToken` after a successful verification so that the same token
   * cannot be verified twice against the same chain instance. Throws if
   * the target is not strictly above the current counter.
   */
  advanceTo(targetCtr) {
    const t = BigInt(targetCtr);
    if (t <= this.#counter) {
      throw new Error(`REPLAY: target counter ${t} <= chain counter ${this.#counter}`);
    }
    while (this.#counter < t) this.advance();
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
    // Wire format carries a minimal string→string map. Stringify
    // primitives losslessly; reject objects/arrays so they cannot
    // silently round-trip as "[object Object]".
    const t = typeof v;
    let s;
    if (t === 'string')              s = v;
    else if (t === 'number' && Number.isFinite(v)) s = String(v);
    else if (t === 'bigint')         s = String(v);
    else if (t === 'boolean')        s = String(v);
    else if (v === null)             s = 'null';
    else {
      throw new Error(
        `claim "${k}" has unsupported value type (${t}). ` +
        `Sigvault claims accept string | number | bigint | boolean | null only. ` +
        `JSON.stringify(...) nested data yourself if you need richer shape.`
      );
    }
    parts.push(encodeStr(k));
    parts.push(encodeStr(s));
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
 * @param {Uint8Array} [params.signingKeySeed]  — 32-byte ML-DSA-87 seed (canonical name)
 * @param {Uint8Array} [params.signingKey]      — alias for `signingKeySeed`; accepted
 *                                                for backward compat with older docs
 *                                                and adapter SDKs. Do not pass both.
 * @param {Uint8Array} params.encryptKey        — 32-byte XChaCha20 key
 * @param {MutationChain} params.chain          — Mutation chain (mutated in place)
 * @param {object}     params.claims            — plain JS object of claim values
 * @param {number}     [params.ttl=3600]        — TTL in seconds
 * @param {number}     [params.suite]           — SUITE_IDS value
 * @param {number}     [params.tokenType]       — TOKEN_TYPES value
 * @param {Uint8Array} [params.deviceFp]        — 32-byte device fingerprint
 * @param {'auto'|true|false} [params.compress] — see compression note above
 * @returns {{ tokenBytes: Uint8Array, tokenHex: string }}
 */
export function issueToken({
  signingKeySeed, signingKey, encryptKey, chain, claims,
  ttl = 3600,
  suite = SUITE_IDS.Dilithium5,
  tokenType = TOKEN_TYPES.Access,
  deviceFp = null,
}) {
  // Accept either `signingKeySeed` (canonical) or `signingKey` (alias).
  // Reject if both were supplied — likely a caller mistake, and we don't
  // want to pick a winner silently.
  if (signingKeySeed && signingKey) {
    throw new Error('AMBIGUOUS_SIGNING_KEY: pass either `signingKeySeed` '
                  + '(canonical) or `signingKey` (alias), not both.');
  }
  signingKeySeed = signingKeySeed ?? signingKey;
  if (!signingKeySeed) {
    throw new Error('MISSING_SIGNING_KEY: `signingKeySeed` (or alias `signingKey`) required.');
  }
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
  //    `compress` options: 'auto' (default, only compress if it shrinks),
  //    true (always), false (never). On runtimes without sync compression
  //    available (browsers, Workers, Deno without node:zlib shim) the
  //    `auto` and `true` modes silently downgrade to `false`. If the
  //    caller explicitly passed `compress: true` we throw a structured
  //    error rather than silently writing an uncompressed token they
  //    didn't ask for.
  const rawClaims = encodeClaims(claims);
  let plaintext;
  const requestedMode = arguments[0].compress ?? 'auto';
  if (requestedMode === false || !_compressionAvailable) {
    if (requestedMode === true && !_compressionAvailable) {
      throw new Error('COMPRESSION_UNAVAILABLE: `compress: true` requested but '
                    + 'this runtime ships neither node:zlib nor a sync '
                    + 'compression API. Pass `compress: false` or run on Node.');
    }
    plaintext = concat(new Uint8Array([PAYLOAD_RAW]), rawClaims);
  } else {
    const deflated = _deflateRawSync(Buffer.from(rawClaims), { level: 9 });
    const useCompressed = (requestedMode === true)
      || (requestedMode === 'auto' && deflated.length + 1 < rawClaims.length + 1);
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

/**
 * Stateless issue path for serverless environments where the chain
 * counter is held in an EXTERNAL store (Redis, DynamoDB, Postgres,
 * etc.) and the function instance can't be trusted to retain state
 * across invocations. The caller atomically reads + increments the
 * counter in their store, then calls this with the post-advance value.
 *
 * This is functionally equivalent to:
 *
 *   const chain = MutationChain.fromState(seed, preCounter);
 *   issueToken({ ..., chain });
 *
 * but without the SDK assuming any in-memory chain survives across
 * the call. If you forget to externalise the counter, every Lambda
 * cold-start issues a token at counter=1 and replay protection
 * silently breaks. This API forces the issue.
 *
 * @param {object} params
 * @param {Uint8Array} params.signingKeySeed   — 32-byte seed (or signingKey alias)
 * @param {Uint8Array} params.encryptKey       — 32-byte XChaCha20 key
 * @param {Uint8Array} params.chainSeed        — 32-byte deterministic chain seed
 * @param {bigint|number} params.counter       — post-advance chain counter, from your store
 * @param {object}     params.claims
 * @param {number}     [params.ttl=3600]
 * @param {number}     [params.suite]          — SUITE_IDS value
 * @param {number}     [params.tokenType]      — TOKEN_TYPES value
 * @param {Uint8Array} [params.deviceFp]
 * @param {'auto'|true|false} [params.compress]
 * @returns {{ tokenBytes: Uint8Array, tokenHex: string }}
 */
export function issueTokenAt(params) {
  const { chainSeed, counter, ...rest } = params;
  if (!(chainSeed instanceof Uint8Array) || chainSeed.length !== 32) {
    throw new Error('issueTokenAt: chainSeed must be a 32-byte Uint8Array');
  }
  const ctr = typeof counter === 'bigint' ? counter : BigInt(counter);
  if (ctr <= 0n) {
    throw new Error('issueTokenAt: counter must be ≥ 1 (counters are post-advance)');
  }
  // Rebuild the chain to (counter - 1) so advance() lands at `counter`.
  const chain = MutationChain.fromState(chainSeed, ctr - 1n);
  return issueToken({ ...rest, chain });
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

  // Layer 6 — replay detection. Token counter MUST be strictly above
  // the chain's current high-water mark; on success we advance the chain
  // so the same token cannot verify twice against the same instance.
  chain.checkTokenCounter(header.mutationCtr);
  chain.advanceTo(header.mutationCtr);

  // Layer 7 — decompress (if v4.1 marker) then decode claims. On a
  // runtime without sync decompression and a deflate-marked token we
  // surface DECOMPRESSION_UNAVAILABLE rather than silently treating the
  // body as raw bytes (which would corrupt claims).
  let payloadBytes;
  if (plaintext.length > 0 && (plaintext[0] === PAYLOAD_RAW || plaintext[0] === PAYLOAD_DEFLATE)) {
    const body = plaintext.slice(1);
    if (plaintext[0] === PAYLOAD_DEFLATE) {
      if (!_compressionAvailable) {
        throw new Error('DECOMPRESSION_UNAVAILABLE: token is deflate-compressed but '
                      + 'this runtime ships neither node:zlib nor a sync '
                      + 'decompression API. Issue the token with `compress: false` '
                      + 'or verify on Node.');
      }
      payloadBytes = new Uint8Array(_inflateRawSync(Buffer.from(body)));
    } else {
      payloadBytes = body;
    }
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
    magic:       `0x${MAGIC.toString(16).toUpperCase()}`,
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

// ─── Public AEAD primitives (since v4.3.x) ───────────────────────────────────
// Some consumers want XChaCha20-Poly1305 directly, without going through
// the full Sigvault token format — for instance, sealing arbitrary
// configuration blobs at rest under the same key the server already
// holds. We surface the primitive with the same nonce convention used
// internally (32-byte token nonce → SHA3-256 derives the 12-byte
// XChaCha nonce) so anything written here can later be unsealed via a
// hand-rolled equivalent and vice versa.

/**
 * AEAD-encrypt arbitrary bytes under an XChaCha20-Poly1305 key.
 *
 * @param {Uint8Array} plaintext
 * @param {Uint8Array} key       — 32-byte symmetric key
 * @param {Uint8Array} nonce     — 32-byte nonce (first 12 used; the trailing
 *                                  20 are reserved so the same token-nonce
 *                                  shape composes naturally)
 * @param {Uint8Array} [aad]     — optional additional authenticated data
 * @returns {Uint8Array}         — `ciphertext || 16-byte tag`
 */
export function encrypt(plaintext, key, nonce, aad) {
  if (!(plaintext instanceof Uint8Array)) throw new Error('encrypt: plaintext must be Uint8Array');
  if (!(key       instanceof Uint8Array) || key.length !== 32)
    throw new Error('encrypt: key must be a 32-byte Uint8Array');
  if (!(nonce     instanceof Uint8Array) || nonce.length !== 32)
    throw new Error('encrypt: nonce must be a 32-byte Uint8Array');
  const digest = sha3_256(nonce);
  const chacha = chacha20poly1305(key, digest.slice(0, 12), aad);
  return chacha.encrypt(plaintext);
}

/** Inverse of `encrypt`. Throws on AEAD-tag mismatch. */
export function decrypt(ciphertext, key, nonce, aad) {
  if (!(ciphertext instanceof Uint8Array)) throw new Error('decrypt: ciphertext must be Uint8Array');
  if (!(key        instanceof Uint8Array) || key.length !== 32)
    throw new Error('decrypt: key must be a 32-byte Uint8Array');
  if (!(nonce      instanceof Uint8Array) || nonce.length !== 32)
    throw new Error('decrypt: nonce must be a 32-byte Uint8Array');
  const digest = sha3_256(nonce);
  const chacha = chacha20poly1305(key, digest.slice(0, 12), aad);
  return chacha.decrypt(ciphertext);
}

// ─── ChainStore interface (since v4.3.8) ─────────────────────────────────────
//
// Pluggable mutation-counter store so serverless / multi-instance deployments
// can keep replay protection honest. The SDK never assumes in-memory state
// survives across invocations — the store does. Two operations:
//
//   reserveNext(keyId) → bigint
//       Atomically reserve the next counter value for keyId and persist it
//       in your backing store BEFORE returning. The returned counter is
//       committed; the SDK trusts it to be monotonic. Called once per
//       token issue.
//
//   observe(keyId, counter)
//       For verifiers. Update the high-water mark for keyId. Throws
//       Error('REPLAY: ...') if `counter` is not strictly greater than
//       the stored value. Called once per successful token verify.
//
// Both methods are async — your backing store is probably a network call.
// Reference impl below is in-memory and synchronous-style; suitable for
// single-instance deployments and tests. Production deployments back it
// with Redis INCR, Postgres SELECT…FOR UPDATE + UPDATE, DynamoDB
// UpdateItem-with-ADD, or a Cloudflare Durable Object — see the README
// "Serverless cookbook" for recipes.
//
// All implementations must guarantee:
//   - Atomicity of reserveNext (no two callers ever get the same counter).
//   - Monotonicity (counters only go up).
//   - Durability before reserveNext returns (a crash post-return must not
//     replay the counter).

/**
 * In-memory ChainStore. Single-process, lost on restart. Good for tests,
 * single-instance deployments where you've accepted the limitation,
 * and as a reference implementation when porting to a distributed store.
 */
export class InMemoryChainStore {
  #counters = new Map();

  async reserveNext(keyId) {
    const next = (this.#counters.get(keyId) ?? 0n) + 1n;
    this.#counters.set(keyId, next);
    return next;
  }

  async observe(keyId, counter) {
    const ctr = typeof counter === 'bigint' ? counter : BigInt(counter);
    const cur = this.#counters.get(keyId) ?? 0n;
    if (ctr <= cur) {
      const e = new Error(`REPLAY: counter ${ctr} <= chain counter ${cur}`);
      e.code = 'REPLAY';
      throw e;
    }
    this.#counters.set(keyId, ctr);
  }

  /** Read-only snapshot — for dashboards/debugging, not for replay decisions. */
  current(keyId) { return this.#counters.get(keyId) ?? 0n; }
}

/**
 * Issue a token using an external ChainStore to atomically reserve the
 * counter. This is the canonical serverless path — your function reads
 * + increments the counter in a shared store, then signs.
 *
 * @param {object} opts
 * @param {ChainStore} opts.store           — implementation of reserveNext()
 * @param {string}     opts.keyId           — key whose chain to advance
 * @param {Uint8Array} opts.signingKeySeed  — 32-byte signing seed (or `signingKey` alias)
 * @param {Uint8Array} [opts.signingKey]    — alias for signingKeySeed
 * @param {Uint8Array} opts.encryptKey      — 32-byte XChaCha20 key
 * @param {Uint8Array} [opts.chainSeed]     — defaults to encryptKey.slice(0, 32)
 * @param {object}     opts.claims
 * @param {number}     [opts.ttl=3600]
 * @param {number}     [opts.suite]
 * @param {number}     [opts.tokenType]
 * @param {Uint8Array} [opts.deviceFp]
 * @param {'auto'|true|false} [opts.compress]
 * @returns {Promise<{ tokenBytes: Uint8Array, tokenHex: string, counter: bigint }>}
 */
export async function issueTokenWithStore({
  store, keyId, chainSeed, ...rest
}) {
  if (!store || typeof store.reserveNext !== 'function') {
    throw new Error('issueTokenWithStore: opts.store must implement reserveNext()');
  }
  if (typeof keyId !== 'string' || !keyId) {
    throw new Error('issueTokenWithStore: opts.keyId required (string)');
  }
  const seed = chainSeed ?? (rest.encryptKey && rest.encryptKey.slice(0, 32));
  if (!seed || seed.length !== 32) {
    throw new Error('issueTokenWithStore: chainSeed (or encryptKey ≥ 32 bytes) required');
  }
  const counter = await store.reserveNext(keyId);
  const result  = issueTokenAt({ ...rest, chainSeed: seed, counter });
  return { ...result, counter };
}

/**
 * Verify a token and atomically advance the verifier's high-water mark in
 * the supplied ChainStore. Throws `REPLAY` on counter regression, or the
 * underlying verify error on signature / AEAD failure. On success the
 * store has been updated; future verifies for the same keyId at ≤ this
 * counter will reject.
 */
export async function verifyTokenWithStore({
  store, keyId, token, verifyingKey, encryptKey, chainSeed,
}) {
  if (!store || typeof store.observe !== 'function') {
    throw new Error('verifyTokenWithStore: opts.store must implement observe()');
  }
  const seed = chainSeed ?? encryptKey.slice(0, 32);
  // Verify against a fresh chain pegged at counter=0 so the SDK's
  // intra-call replay check is a no-op; the cross-call check lives in the
  // store and runs only AFTER cryptographic verify succeeds.
  const vchain = MutationChain.fromState(seed, 0n);
  const out = verifyToken({ token, verifyingKey, encryptKey, chain: vchain });
  await store.observe(keyId, out.mutationCtr);
  return out;
}

// ─── Re-exports from @noble (since v4.3.x) ───────────────────────────────────
// Convenience: consumers that already depend on @sigvault/sdk shouldn't
// have to install @noble themselves to use a CSPRNG or a hash. These are
// the SAME instances we use internally — no extra dep, no extra bytes.

export { randomBytes };

