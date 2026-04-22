# Chapter 7 — Sealing Keys at Rest

## The story

"We encrypt keys at rest" is a security claim almost every product
makes and almost no product implements as carefully as the marketing
implies. The usual implementation is:

1. A master key in an env var.
2. AES-CBC or AES-GCM of each private key with that master.
3. Write to disk.

That's fine as far as it goes, but it has an attack: **envelope
swapping**. An attacker with write access can copy `envelope(keyA)`
over `envelope(keyB)`. The decryption succeeds (the master is the same).
Now `keyA`'s material is returned whenever the server asks for `keyB`.
An attacker who had `keyA` briefly can use it as `keyB` forever.

The fix is AEAD with **associated data binding each envelope to its
identity**. QuantumVault's AAD is the UUID that names the key.

## The construction

From `server-sovereign.mjs`:

```javascript
function seal(plaintext, keyId) {
  const iv  = randomBytes(12);
  const enc = createCipheriv('aes-256-gcm', MASTER_KEY, iv);
  enc.setAAD(Buffer.from(keyId, 'utf8'));
  const ct  = Buffer.concat([enc.update(plaintext), enc.final()]);
  const tag = enc.getAuthTag();
  return Buffer.concat([iv, tag, ct]); // 12B || 16B || ciphertext
}

function unseal(buf, keyId) {
  const iv  = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct  = buf.subarray(28);
  const dec = createDecipheriv('aes-256-gcm', MASTER_KEY, iv);
  dec.setAAD(Buffer.from(keyId, 'utf8'));
  dec.setAuthTag(tag);
  return new Uint8Array(Buffer.concat([dec.update(ct), dec.final()]));
}
```

- **AES-256-GCM**: 256-bit key, 128-bit tag, 96-bit IV. FIPS-approved.
- **IV is random per envelope**: 96 bits of entropy makes collision
  infeasible even across billions of keys.
- **AAD is the UUID**: envelope swapping fails because the UUID
  doesn't match.
- **Tag is stored inline**: no separate integrity file.

On tampering, `dec.final()` throws, `unseal()` propagates the error,
and the handler returns 500. There is no silent corruption mode.

## The master key

Three ways to provision it:

1. **`master.key` file** (default). On first boot, qv-server generates
   32 random bytes and writes `<DATA_DIR>/master.key` with mode 0600.
   Every subsequent boot reads it.
2. **`QV_MASTER_KEY_HEX` env var** (recommended for production).
   64 hex chars. Never persisted, never logged. Allows master-key
   provisioning from a secrets manager (AWS Secrets Manager, Vault,
   Azure Key Vault, etc.) on container start.
3. **KMS/HSM integration** (future work, R-4.4.5). The master key
   never leaves the HSM; qv-server uses the HSM to unwrap individual
   envelopes. Roadmap target: v4.4.

Rotation is a three-step process (manual today, script later):

1. Generate a new master.
2. For every entry in `keystore.json`, `unseal(old_master)` then
   `seal(new_master)`.
3. Atomically replace both `master.key` and `keystore.json`.

Because the UUID AAD binds each envelope to its key ID, this rotation
is entirely per-entry and does not require chain state changes.

## Why not a KDF?

Some products derive per-key sub-keys from the master via HKDF. We
don't, because:

- The master is already 256 bits of uniform-random entropy.
- Deriving another 256-bit key adds a step without reducing risk —
  you still need the master to derive anything.
- AAD binding provides the "different keys for different purposes"
  property without HKDF.

We *do* use HKDF inside the token construction for deriving the
AEAD key per issue (so the same encryption key isn't literally
reused across tokens for the same identity); that's a property of
the wire format, not the at-rest layer.

## Performance

AES-256-GCM is accelerated on every modern CPU via AES-NI + PCLMUL.
On a 2024-era server: seal/unseal ~1 µs per key. Not on the hot
path anyway — the keystore is loaded into memory on boot and
unsealed once per key.

## The code

- `qv-server/server-sovereign.mjs` → `seal`, `unseal`,
  `loadOrCreateMasterKey`, `loadKeystore`, `saveKeystore`.

## The evidence

- The test suite includes a deliberate tampering test (mismatched
  AAD → unseal throws).
- Docker image E2E: start the container, kill it, restart, verify
  that issued tokens still verify (proves master persistence works).

## The comparison

| Product | At-rest encryption | Key binding to identity | Master in HSM |
|---------|--------------------|-------------------------|---------------|
| Keycloak | AES-CBC on DB column | No | Optional |
| Vault (Shamir) | AES-GCM | No AAD binding | Seals only, not keys |
| Auth0 | (closed) | (unknown) | Proprietary |
| AWS KMS | (platform) | Yes (KeyId in grant) | Yes |
| **QuantumVault** | **AES-256-GCM** | **Yes (UUID AAD)** | **Planned v4.4** |

Next: Chapter 8, [Request Lifecycle](./08-request-lifecycle.md).
