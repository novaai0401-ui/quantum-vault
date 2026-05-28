// SPDX-License-Identifier: Apache-2.0
//
// Hand-written TypeScript declarations for @sigvault/sdk.
//
// We deliberately don't auto-generate these because the runtime is .mjs
// and we want the type surface to be the deliberate, audited public API
// — not whatever shape the implementation happens to expose today.
// Internal-only helpers in index.mjs are intentionally NOT declared here.

// ─── Constants ──────────────────────────────────────────────────────────

/** Magic header bytes — `0x51564C54` ('QVLT'). */
export const MAGIC: 0x51564C54;

/** Wire-format version (v3.x). */
export const VERSION: number;

/** Suite registry — values match `suite` byte at token offset 6. */
export const SUITE_IDS: {
  /** ML-DSA-87 (FIPS 204) — NIST PQ level 5. Default. */
  readonly Dilithium5: 0x05;
  /** Reserved — ML-DSA-65, PQ level 3. */
  readonly Dilithium3: 0x02;
  /** Reserved — ML-DSA-44, PQ level 2. */
  readonly Dilithium2: 0x03;
  /** Reserved — Falcon-512. SDK does NOT sign Falcon (yet). See README. */
  readonly Falcon512:  0x10;
  /** Reserved — Falcon-1024. SDK does NOT sign Falcon (yet). See README. */
  readonly Falcon1024: 0x11;
  readonly Dual:       0x09;
  readonly Triple:     0xFF;
};

/** Token-type registry — values match `tokenType` byte at offset 7. */
export const TOKEN_TYPES: {
  readonly Access:  0x01;
  readonly Refresh: 0x02;
  readonly Service: 0x03;
};

/** ML-DSA-87 signature length in bytes. */
export const SIG_LEN:     4627;
/** ML-DSA-87 verifying-key length in bytes. */
export const VK_LEN:      2592;
/** ML-DSA-87 signing-key seed length in bytes. */
export const SK_SEED_LEN: 32;

// ─── Types ──────────────────────────────────────────────────────────────

/** A bag of arbitrary JSON-serialisable claim values keyed by string. */
export type Claims = Record<string, unknown>;

/**
 * Per-key cryptographic chain that prevents token replay.
 *
 *  - `advance()` ratchets the chain forward by one step and returns the new
 *    state hash. Called by `issueToken`.
 *  - `checkTokenCounter(ctr)` throws `REPLAY` if `ctr <= this.counter`.
 *  - `fromState(state, counter)` reconstructs a chain at a known position,
 *    for instance after the server restarts.
 *
 * For SERVERLESS deployments — where the in-memory chain disappears between
 * invocations — use {@link ChainStore} + {@link issueTokenWithStore} +
 * {@link verifyTokenWithStore} instead of touching MutationChain directly.
 * Those wrappers reserve the counter from an external store (Redis,
 * Postgres, DynamoDB, Cloudflare Durable Object) atomically; see the
 * README "Serverless cookbook" for ready-made recipes.
 *
 * Hash function: SHA3-256(prev_state || prev_counter as big-endian u64).
 * Single-writer by design; for horizontal scaling use the server-side
 * Postgres ChainStore (see qv-server/chain-store-postgres.mjs).
 */
export class MutationChain {
  /**
   * @param seed 32-byte chain seed. Defaults to fresh CSPRNG; in
   *             production you almost always want to derive this from
   *             the encrypt key (`encryptKey.slice(0, 32)`) so reload
   *             across restarts is deterministic.
   */
  constructor(seed?: Uint8Array | ArrayBuffer);

  /** Reconstruct a chain at counter `counter` from a known `state`. */
  static fromState(state: Uint8Array | ArrayBuffer, counter: bigint | number): MutationChain;

  /** Advance the chain by one step. Returns the new 32-byte state. */
  advance(): Uint8Array;

  /** Throws `Error('REPLAY: ...')` if `tokenCtr` is not strictly greater than current. */
  checkTokenCounter(tokenCtr: bigint | number): void;

  /** Current counter (number of `advance()` calls so far). */
  readonly counter: bigint;

  /** Current 32-byte chain state. */
  readonly state: Uint8Array;
}

/** Result of `generateKeypair`. */
export interface Keypair {
  /** ML-DSA-87 secret key bytes (full key, ~4896 B). */
  signingKey:   Uint8Array;
  /** ML-DSA-87 verifying key bytes (2592 B). */
  verifyingKey: Uint8Array;
  /** XChaCha20-Poly1305 symmetric key bytes (32 B). */
  encryptKey:   Uint8Array;
}

/** Compression policy for the claims payload. */
export type CompressionMode = 'auto' | true | false;

/** Token-type alias accepted by the issuance helpers. */
export type TokenTypeName = 'access' | 'refresh' | 'service';

/** Parameters for `issueToken`. */
export interface IssueTokenParams {
  /**
   * 32-byte ML-DSA-87 signing-key seed. Canonical name. The alias
   * `signingKey` (used in older docs and some adapters) is also
   * accepted at runtime; either may be provided, not both.
   */
  signingKeySeed?: Uint8Array;
  /** Backward-compat alias for `signingKeySeed`. */
  signingKey?:     Uint8Array;
  /** 32-byte XChaCha20-Poly1305 key. */
  encryptKey:      Uint8Array;
  /** Per-key replay-protection chain (mutated in place). */
  chain:           MutationChain;
  /** Claims to seal into the token. */
  claims:          Claims;
  /** Time-to-live in seconds. Default 3600. */
  ttl?:            number;
  /** Suite byte. Default `SUITE_IDS.Dilithium5`. */
  suite?:          number;
  /** Token-type byte. Default `TOKEN_TYPES.Access`. */
  tokenType?:      number;
  /** Optional 32-byte device fingerprint. Defaults to SHA3-256(nonce). */
  deviceFp?:       Uint8Array;
  /**
   * `auto` (default): compress only if it shrinks the bytes.
   * `true`: always compress.
   * `false`: never compress.
   *
   * Compression requires either Node's `node:zlib` (Node) or the
   * `CompressionStream` Web API (browsers, Workers). On runtimes
   * with neither, this falls back to `false` automatically.
   */
  compress?:       CompressionMode;
}

/** Result of `issueToken`. */
export interface IssueTokenResult {
  /** Raw token bytes. */
  tokenBytes: Uint8Array;
  /** Hex-encoded token (the canonical transport form). */
  tokenHex:   string;
}

/** Parameters for `verifyToken`. */
export interface VerifyTokenParams {
  /** Token bytes or hex string. */
  token:        Uint8Array | string;
  /** 2592-byte ML-DSA-87 verifying key. */
  verifyingKey: Uint8Array;
  /** 32-byte XChaCha20-Poly1305 key. */
  encryptKey:   Uint8Array;
  /** Per-key chain to enforce replay protection against. */
  chain:        MutationChain;
}

/** Result of a successful `verifyToken`. */
export interface VerifyTokenResult {
  /** Decrypted claims object. */
  claims:       Claims;
  /** Issue timestamp in microseconds since the Unix epoch. */
  issuedAt:     bigint;
  /** TTL in seconds, as recorded in the token. */
  ttl:          number;
  /** Mutation counter the token was issued at. */
  mutationCtr:  bigint;
}

/** Result of `inspectToken`. */
export interface InspectResult {
  magic:       string;
  version:     string;
  suite:       string;
  tokenType:   string;
  issuedAt:    string;
  ttl:         number;
  mutationCtr: string;
  nonceB64:    string;
  deviceFpB64: string;
  payloadLen:  number;
  signatureLen: number;
}

// ─── Functions ──────────────────────────────────────────────────────────

/**
 * Generate a fresh ML-DSA-87 keypair plus a 32-byte XChaCha20 key.
 * Uses the platform CSPRNG (WebCrypto.getRandomValues / Node crypto).
 */
export function generateKeypair(): Keypair;

/**
 * Issue a new Sigvault token. The `chain` argument is mutated in place
 * (counter advanced by one). On a runtime without compression support
 * the `compress` option is downgraded to `false`.
 */
export function issueToken(params: IssueTokenParams): IssueTokenResult;

/** Parameters for `issueTokenAt` (stateless / serverless path). */
export interface IssueTokenAtParams extends Omit<IssueTokenParams, 'chain'> {
  /** 32-byte deterministic chain seed (typically derived from `encryptKey.slice(0, 32)`). */
  chainSeed: Uint8Array;
  /**
   * The post-advance counter value the issued token will carry. Caller
   * is responsible for atomically reserving this value in an external
   * store before calling — otherwise replay protection is illusory.
   */
  counter:   bigint | number;
}

/**
 * Stateless issue path for serverless environments (AWS Lambda,
 * Cloudflare Workers, Vercel Functions) where the chain counter is held
 * in an external store. Equivalent to `issueToken` with an explicit
 * `MutationChain.fromState(chainSeed, counter - 1)`, but the signature
 * makes the external-counter contract impossible to forget.
 *
 * See README — "Serverless mode" section.
 */
export function issueTokenAt(params: IssueTokenAtParams): IssueTokenResult;

/**
 * Verify a Sigvault token end-to-end:
 *
 *   1. Wire-format magic + version
 *   2. KOLMOGOROV nonce-entropy floor
 *   3. ML-DSA-87 signature
 *   4. XChaCha20-Poly1305 AEAD on the claims payload
 *   5. MutationChain replay check (token counter > chain counter)
 *
 * Throws on any failure. The chain's counter advances on success.
 */
export function verifyToken(params: VerifyTokenParams): VerifyTokenResult;

/**
 * Decode a token's public header WITHOUT verifying the signature.
 * Useful for debugging and operator tools. Do NOT trust the result.
 */
export function inspectToken(token: Uint8Array | string): InspectResult;

// ─── AEAD primitives (since v4.3.x) ─────────────────────────────────────

/**
 * Encrypt arbitrary bytes with XChaCha20-Poly1305. The nonce must be
 * 32 bytes; the first 24 are the XChaCha nonce, the trailing 8 are
 * reserved (so the same nonce shape used inside a Sigvault token can
 * be reused here). The output is `ciphertext || 16-byte-tag`.
 */
export function encrypt(
  plaintext: Uint8Array,
  key:       Uint8Array,
  nonce:     Uint8Array,
  aad?:      Uint8Array,
): Uint8Array;

/**
 * Inverse of `encrypt`. Throws on AEAD-tag mismatch (tampering, wrong
 * key, wrong nonce, wrong AAD).
 */
export function decrypt(
  ciphertext: Uint8Array,
  key:        Uint8Array,
  nonce:      Uint8Array,
  aad?:       Uint8Array,
): Uint8Array;

// ─── ChainStore (since v4.3.8) ──────────────────────────────────────────

/**
 * Pluggable mutation-counter store for serverless / multi-instance
 * deployments. Implementations back this with Redis INCR, Postgres
 * SELECT…FOR UPDATE, DynamoDB UpdateItem, Cloudflare Durable Objects,
 * etc. See README "Serverless cookbook" for ready-made recipes.
 */
export interface ChainStore {
  /**
   * Atomically reserve the next counter for `keyId`. The store MUST
   * commit the new value to durable storage before this resolves.
   * Subsequent callers (concurrent or sequential) must never receive
   * the same value.
   */
  reserveNext(keyId: string): Promise<bigint>;

  /**
   * Update the verifier-side high-water mark for `keyId` to `counter`.
   * Throws `Error('REPLAY: ...')` if `counter` is not strictly greater
   * than the stored value. Called once per successful token verify.
   */
  observe(keyId: string, counter: bigint | number): Promise<void>;
}

/**
 * Reference single-process in-memory ChainStore. Counters are lost on
 * restart — use this for tests, local dev, and as a template when you
 * implement a production backing store.
 */
export class InMemoryChainStore implements ChainStore {
  reserveNext(keyId: string): Promise<bigint>;
  observe(keyId: string, counter: bigint | number): Promise<void>;
  /** Read-only snapshot of the current high-water mark. */
  current(keyId: string): bigint;
}

/** Parameters for `issueTokenWithStore`. */
export interface IssueTokenWithStoreParams extends Omit<IssueTokenAtParams, 'counter'> {
  store: ChainStore;
  keyId: string;
}

/** Result of `issueTokenWithStore` — includes the counter that was reserved. */
export interface IssueTokenWithStoreResult extends IssueTokenResult {
  counter: bigint;
}

/**
 * Canonical serverless issuance path. Reserves the next counter from
 * the supplied ChainStore (atomic, durable) and then signs against it.
 */
export function issueTokenWithStore(
  params: IssueTokenWithStoreParams,
): Promise<IssueTokenWithStoreResult>;

/** Parameters for `verifyTokenWithStore`. */
export interface VerifyTokenWithStoreParams {
  store:        ChainStore;
  keyId:        string;
  token:        Uint8Array | string;
  verifyingKey: Uint8Array;
  encryptKey:   Uint8Array;
  /** Defaults to encryptKey.slice(0, 32). */
  chainSeed?:   Uint8Array;
}

/**
 * Canonical serverless verification path. Verifies the token, then
 * atomically advances the verifier high-water mark in the ChainStore.
 * Throws `REPLAY` if the token's counter is not strictly above the
 * stored value, AFTER cryptographic verification succeeds.
 */
export function verifyTokenWithStore(
  params: VerifyTokenWithStoreParams,
): Promise<VerifyTokenResult>;

// ─── Re-exports from @noble (since v4.3.x) ──────────────────────────────

/** Cryptographically secure random bytes. Re-export from @noble/hashes. */
export function randomBytes(n: number): Uint8Array;
