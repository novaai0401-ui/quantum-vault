# QuantumVault Wire Format (v3.0)

This document is the **canonical specification** of the QuantumVault
token bytes. Any conforming SDK in any language MUST produce and
consume tokens matching this layout exactly.

The `qv-spec/test-vectors/` directory contains language-agnostic
`(input, expected_output)` pairs for cross-implementation conformance.

## Token bytes (big-endian)

```
offset (B)  size (B)  field
─────────── ────────  ──────────────────────────────────────────────────
   0           4      MAGIC          = 0x51 56 4C 54 ('QVLT')
   4           2      VERSION        = 0x0300
   6           1      suite          (see suite registry)
   7           1      tokenType      (see token-type registry)
   8           8      issuedAt       microseconds since Unix epoch
  16           4      ttl            seconds
  20          32      nonce          CSPRNG, KOLMOGOROV-certified
  52          32      deviceFp       SHA3-256 fingerprint or operator-supplied
  84           4      plLen          length of encPayload, big-endian
  88        plLen     encPayload     XChaCha20-Poly1305(claims)
  88+plLen     8      mutationCtr    big-endian u64 chain counter
  96+plLen   sigLen   signature      ML-DSA-87, Falcon-512, or Falcon-1024
```

`sigLen` is determined by `suite`:

| Suite byte | Name        | sigLen | NIST level |
|-----------:|-------------|-------:|-----------:|
| `0x05`     | Dilithium5 (ML-DSA-87, default) | 4627 | 5 |
| `0x02`     | Dilithium3 (ML-DSA-65) | 3293 | 3 |
| `0x03`     | Dilithium2 (ML-DSA-44) | 2420 | 2 |
| `0x10`     | Falcon-512  | ~666 | 1 |
| `0x11`     | Falcon-1024 | ~1280 | 5 |
| `0x09`     | Dual-sign   | reserved | — |
| `0xFF`     | Triple-sign | reserved | — |

Token-type registry:

| Byte | Name     |
|-----:|----------|
| 0x01 | Access   |
| 0x02 | Refresh  |
| 0x03 | Service  |

## What the signature covers

The signature spans every byte from offset 0 up to but excluding the
signature itself: the magic, version, suite/type, timestamps, nonce,
device fingerprint, encrypted payload length, encrypted payload, and
mutation counter.

Pseudocode:

```
signed_bytes = token[0 : 96 + plLen]
ok = ML_DSA_87.verify(verifyingKey, signed_bytes, signature)
```

This means: any single bit flipped anywhere in the header, the
ciphertext, or the mutation counter invalidates the signature.

## Encrypted payload

`encPayload` is the AEAD ciphertext of the claims, with the nonce
field as the AEAD nonce and an empty AAD.

```
encPayload = XChaCha20Poly1305(
    key:   encryptKey                  (32 bytes, per-key)
    nonce: token.nonce                 (32 bytes — the first 24 are
                                        the cipher nonce; the trailing
                                        8 are unused-by-spec but
                                        included in the signature)
    ad:    ""                          (no additional authenticated data)
    pt:    claim_blob
)
```

`claim_blob` is one of:

```
claim_blob[0] == 0x00  →  raw      (claim_blob[1..] = MessagePack(claims))
claim_blob[0] == 0x01  →  deflate  (claim_blob[1..] = deflate-raw(MessagePack(claims)))
```

A legacy v3.0 token has no marker byte (the encrypted blob is raw
MessagePack starting with `0x80..0x8F` for a small map). New SDKs
MUST emit the marker; verifiers MUST accept legacy form by sniffing
the first byte.

## Mutation chain advance

The chain advances per token issue:

```
state_n      = SHA3-256(state_{n-1} || ctr_{n-1}_be64)
ctr_n        = ctr_{n-1} + 1
```

`mutationCtr` in the token is `ctr_n`, i.e. the post-advance counter.
The chain seed (`state_0`) is the per-key 32-byte encryption key
truncated to 32 bytes (qv-server v4.3+ fixes this; pre-v4.3 used a
random per-create seed which broke linkage across restarts).

The chain is single-writer per key; a multi-writer coordinator is on
the v4.4 roadmap.

## Replay protection

Verifiers maintain `last_verified_ctr` per key and accept a token
only if `mutationCtr > last_verified_ctr`. Successful verification
advances the verifier's counter to the token's value. This makes
replays structurally impossible without server-side state, modulo the
verify-window for in-flight tokens issued within the same advance.

## What is OUT of scope of this document

- Token introspection / inspection JSON shape — see OpenAPI 3.1
  (`qv-spec/openapi.yaml`).
- HTTP envelope — see OpenAPI.
- Key generation, sealing, master-key handling — implementation
  details, not wire format.

## Conformance

A QuantumVault-conforming SDK MUST:

1. Produce a token whose bytes match this layout for any
   `(suite, tokenType, claims, encryptKey, signingKeySeed, chain)`
   tuple — verifiable against the test vectors.
2. Reject any token whose magic, version, suite byte, or signature
   fails to validate.
3. Reject any token whose `mutationCtr` is ≤ the verifier's stored
   counter for that key (replay).
4. Reject any token whose `nonce` fails the KOLMOGOROV entropy
   floor (≥0.85 unique-quad-window ratio).

A SHOULD-conforming SDK additionally:

5. Hex-encodes tokens for transport.
6. Compresses the payload with `deflate-raw` when it shrinks the
   bytes (mirroring the reference SDK's `compress: 'auto'`).

## Test vectors

See `qv-spec/test-vectors/README.md` for the JSON+binary fixtures
that any SDK can run against.
