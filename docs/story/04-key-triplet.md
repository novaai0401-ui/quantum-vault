# Chapter 4 — The Key Triplet

## The story

Almost every token format in production uses a **single key** for signing.
JWT has one private key per issuer (RSA or ECDSA). PASETO v4.public has
one Ed25519 key. Even OAuth opaque tokens often reduce to a single
server-side secret.

A single key is a single point of catastrophic failure. Crack it, leak
it, or steal it, and every past and future token signed by it is
forgeable *and* readable.

Sigvault uses **three** keys per identity:

1. **Signing seed** — produces the public/private pair for ML-DSA-87
   (or Falcon-512 / Falcon-1024). Used to sign the token body.
2. **Encryption key** — a 32-byte XChaCha20-Poly1305 key. Used to
   AEAD-encrypt the CBOR-encoded claims before the signature is
   computed over the ciphertext.
3. **Mutation tag key** — derived from the MutationChain seed.
   Drives the per-key replay-protection counter and chain state.

These three keys are generated together at `POST /v3/keygen`, sealed
together under AES-256-GCM at rest, and evicted together on
`DELETE /v3/keys/:id`. But cryptographically they are **independent**.
An adversary who breaks one does not obtain the others.

## Why three, not one

### The signing seed must be post-quantum

Because of the reasons in Chapter 1: Shor's algorithm breaks every
pre-quantum signature scheme. ML-DSA-87 is a lattice-based scheme —
its security reduces to the hardness of Module Learning With Errors,
which is not known to be efficiently solvable by quantum computers.

Public key sizes for ML-DSA-87 are ~2.6 KB. Signatures are ~4.6 KB.
That's larger than ECDSA but acceptable for a token. Falcon-512
signatures are only ~0.66 KB and ~6× faster to verify, which is why
we support it as an alternative.

### The encryption key must be separate

If claims were signed-but-unencrypted (as in vanilla JWT) then a
network observer learns everything you put in the claims — `sub`,
`roles`, `tenant_id`, anything. Even with TLS in place, TLS endpoints
often do logging, and service-to-service mesh proxies often break
the cipher to inspect it.

If claims were encrypted *with the same key used to sign* (as in
JWE's symmetric modes) then a single compromise gives the attacker
both forgery *and* reading. We want those to require independent
compromises.

So: AEAD with a separate 32-byte key. The ciphertext is what gets
signed. The signature proves "this ciphertext came from the issuer";
the AEAD tag proves "this ciphertext hasn't been tampered with and
the associated data (headers, suite byte, counter) is authentic".

### The mutation tag key must be separate

If replay protection was tied to the signing key, then an attacker
who leaked the signing key could forge tokens with arbitrary
counter values, which defeats the purpose. By keeping MutationChain
state independent and server-side only, we ensure that even a
signing-key compromise cannot produce a token that will verify,
because the counter is a property of *this server's history*, not of
the key.

## Generation

From `qv-server/server-sovereign.mjs`, the `/v3/keygen` handler is
(paraphrased):

```javascript
const { signingKey, verifyingKey, encryptKey } = generateKeypair(suiteId);
const keyId = randomUUID();
chains.set(keyId, new MutationChain(randomBytes(32), 0n));
keystore.set(keyId, seal(signingKey, encryptKey, keyId));
saveKeystore();
```

Three key materials, one UUID, one sealed envelope, one chain-state
file. The UUID is the public identifier — clients reference tokens
by `keyId`. The signing key and encryption key never leave the server.

## Storage

`<DATA_DIR>/keystore.json` is a JSON object mapping `keyId` → sealed
envelope (base64). The envelope is `AES-256-GCM(master_key, plaintext)`
where `plaintext` is the CBOR-encoded triplet `{signingKey, encryptKey,
verifyingKey, meta}`, and the AAD is the UUID as UTF-8 bytes.

Why AAD the UUID? Because it *binds* the ciphertext to its key ID. An
attacker who can reorder the keystore entries cannot swap envelopes —
the tag won't verify if the UUID AAD doesn't match.

`<DATA_DIR>/chains/<keyId>.chain` is an append-only log of
`(counter, state)` records, one per issued token. On startup, the
latest record is loaded into memory; on issue, a new record is
appended.

## Rotation

Three independent ways to rotate:

1. **Per-key rotation.** `POST /v3/keygen` mints a new key; callers
   switch to its `keyId`. Old tokens from the old key keep verifying
   until the old key is `DELETE`'d.

2. **Master-key rotation.** Replace `master.key` (via
   `QV_MASTER_KEY_HEX` env, or the file). Before replacing, re-seal
   every entry under the new master and atomically swap the keystore.
   Scripts for this ship in `qv-ops/rotate-master.mjs` (future work;
   manual today).

3. **Catastrophic reset.** Delete `master.key`. Every sealed key is
   now unreadable. All issued tokens become invalid. Bootstrap from
   scratch. This is the "fire break" — use if you suspect the master
   key is compromised.

## The code

- `qv-sdk/src/index.mjs` → `generateKeypair`, `issueToken`,
  `verifyToken`. These are the pure cryptographic functions.
- `qv-server/server-sovereign.mjs` → `seal`, `unseal`,
  `loadOrCreateMasterKey`. The server-side storage layer.
- `qv-core/src/lib.rs` → the Rust reference.

## The evidence

- `test/integration.auth.test.mjs` exercises keygen/issue/verify
  end-to-end.
- The sealed keystore is decipherable only with the matching
  `master.key`; a test deliberately mangles the AAD and asserts
  decryption fails.

## The comparison

| Property | JWT | JWE | PASETO v4.local | **Sigvault** |
|----------|-----|-----|-----------------|------------------|
| Keys per identity | 1 | 1 (symmetric) or 2 (hybrid) | 1 | **3 independent** |
| Sign/encrypt separation | N/A | No | No | **Yes** |
| Replay protection key distinct | No | No | No | **Yes** |
| Sealed at rest | Depends | Depends | Depends | **Always** |
| PQ-safe signing | No | No | No | **Yes** |

Next: Chapter 5, [Token Suites](./05-suites.md).
