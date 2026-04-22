# Chapter 5 — Token Suites

## The story

NIST's post-quantum contest produced three signature standards:
ML-DSA (Dilithium), Falcon, and SLH-DSA (SPHINCS+). Each makes a
different trade-off. QuantumVault supports the first two and will
likely add SLH-DSA in v4.5 once there's demand.

## The suite byte

Every QuantumVault token carries a single byte near the start that
identifies the signature algorithm. The suite byte lets the wire
format evolve without bumping the protocol version.

| Suite | Byte | Key size | Pub size | Sig size | Sign speed | Verify speed |
|-------|------|----------|----------|----------|------------|--------------|
| ML-DSA-87 (Dilithium5) | `0x05` | 4 864 B | 2 592 B | 4 627 B | Baseline | Baseline |
| Falcon-512 | `0x10` | 1 281 B | 897 B | 666 B | Slower to sign | **6× faster** to verify |
| Falcon-1024 | `0x11` | 2 305 B | 1 793 B | 1 280 B | Slower | ~3× faster verify |

(Numbers from NIST reference benchmarks; signatures are worst-case.)

## Picking a suite

### ML-DSA-87 (default)

The safe default. Straightforward implementation, conservative
parameters, large ecosystem. Use this unless you have a specific
reason not to.

- **Larger tokens**: 4.6 KB signatures mean tokens are ~5 KB on the
  wire. Fine for machine-to-machine APIs, large for cookie-based auth.
- **Verifies fast enough**: ~250 µs on a modern x86 core.
- **Slightly slower sign**: ~350 µs, matters only under extreme issue rates.

### Falcon-512

The bandwidth-optimal choice. Signatures are **7× smaller** than
ML-DSA-87, verification is **6× faster**. Trade-off: signing is more
complex (requires constant-time Gaussian sampling) and implementations
are younger. The NIST reference impl is mature but historically has
had constant-time bugs in various non-reference ports. We ship the
PQClean reference.

- Use when tokens travel in HTTP headers or cookies.
- Use when you verify far more than you issue (10:1 or more).
- Use Falcon-1024 only if you need 192-bit classical security
  (most deployments don't).

### Not yet supported

- **SLH-DSA (SPHINCS+)** — hash-based signatures. Extremely conservative,
  no lattice assumptions, but signatures are ~8–49 KB depending on
  parameter set. Adding later.
- **ML-KEM (Kyber)** — key encapsulation, not signatures. Relevant
  only if we add a future transport-security mode.

## How the server dispatches

In `qv-server/server-sovereign.mjs`, the `/v3/token/issue` handler
maps a string name to a suite byte:

```javascript
const suiteId = { dilithium5: SUITE_IDS.Dilithium5 }[suite];
```

Today only `dilithium5` is wired into the HTTP surface; Falcon
dispatch lives in `qv-sdk/src/index.mjs` and is reachable via the
SDKs directly. Extending the server to expose `falcon512` / `falcon1024`
is a one-line change plus tests.

## The signing pipeline (high-level)

```
┌──────────────┐
│ claims (JSON)│
└──────┬───────┘
       ▼
┌──────────────┐
│ CBOR encode  │
└──────┬───────┘
       ▼
┌──────────────────────────┐
│ XChaCha20-Poly1305 AEAD  │  ← encryptKey (per-key)
│ (nonce = random 24B)     │  AAD = suite || type || mutationCtr
└──────┬───────────────────┘
       ▼
┌──────────────────────────┐
│ body = suiteByte ||      │
│        typeByte ||       │
│        mutationCtr ||    │
│        nonce ||          │
│        ciphertext ||     │
│        tag               │
└──────┬───────────────────┘
       ▼
┌──────────────────────────┐
│ ML-DSA-87 / Falcon sign  │  ← signingSeed
└──────┬───────────────────┘
       ▼
┌──────────────────────────┐
│ token = body || sig      │
└──────────────────────────┘
```

Verification runs in reverse: parse, check suite byte, verify signature,
decrypt AEAD, match MutationChain counter.

## The MutationChain contribution to the wire

The counter is big-endian 8 bytes near the start of the token. On
verification, the server looks up the current `counter` for `keyId`;
if the token's counter ≤ stored counter, reject with `MUTATION_CTR_STALE`.
Otherwise advance and accept.

This means **each issued token is numbered**. Any attempt to re-inject
an earlier-numbered token fails. Out-of-order delivery is OK — we
accept any counter strictly greater than what we've seen, we don't
require monotone sequencing from a single client — but a counter once
seen cannot be reused. That's the guarantee.

## The code

- `qv-sdk/src/index.mjs` — `SUITE_IDS`, `TOKEN_TYPES`, `issueToken`,
  `verifyToken`.
- `qv-core/src/lib.rs` — the Rust reference: `crate::suite::{*}`.
- `qv-server/server-sovereign.mjs` → `/v3/token/issue` & `/v3/token/verify`.

## The evidence

- `qv-core` has a property test that round-trips random claims through
  every supported suite and asserts byte-exact equality with the Rust
  reference.
- `qv-server/test/integration.auth.test.mjs` issues and verifies
  Dilithium5 tokens end-to-end.

## The comparison

| Property | RS256 JWT | EdDSA PASETO v4 | Dilithium5 (default) | Falcon-512 |
|----------|-----------|-----------------|----------------------|------------|
| Post-quantum safe | No | No | **Yes** | **Yes** |
| Signature size | ~0.25 KB | ~0.06 KB | ~4.6 KB | **~0.66 KB** |
| Verify speed | ~150 µs | ~40 µs | ~250 µs | **~40 µs** |
| Standardised | RFC 7515 | (draft) | FIPS 204 | FIPS 206 (soon) |
| Constant-time sign | Varies | Yes | Yes (ref impl) | Must be careful |

Next: Chapter 6, [The MutationChain](./06-mutation-chain.md).
