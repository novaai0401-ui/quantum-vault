# Chapter 6 — The MutationChain

## The story

JWT's greatest lie is implicit in its design: *a valid signature on
a valid payload is a valid token*. There is no relationship to server
state. A token issued at 09:00 is indistinguishable from the same
token replayed at 09:01, 11:00, or five years later.

The workarounds are legion:

- **`jti` + replay cache**: Put a unique ID in the token, store seen
  IDs. Works but adds a database dependency and a GC problem.
- **`nbf` / `exp` tight windows**: Short-lived tokens reduce the
  replay window. Doesn't eliminate it.
- **Mutual TLS with client binding**: Binds the token to a TLS
  session. Moves the problem, doesn't solve it.
- **DPoP / Proof-of-Possession**: Adds a second signature proving the
  caller holds a paired key. Adds complexity, still not replay-proof
  in every case.

QuantumVault's answer is structurally different: the *token itself*
carries a counter, and the server keeps the counter authoritative.

## What it is

A MutationChain is a pair `(state, counter)` maintained per key:

- `state` is a 32-byte SHA3-256 hash
- `counter` is a 64-bit unsigned integer

On every issue:

```
counter' = counter + 1
state'   = SHA3-256(state || encode(counter') || randomSalt)
```

The new `state'` and `counter'` replace the old pair. Each issued
token embeds `counter'` (not the state — the state never leaves the
server) in its wire format.

## What it does

On verify, the server looks up `(state, counter)` for `keyId`. If
the token's embedded counter is ≤ the server's counter, reject with
`MUTATION_CTR_STALE`. Otherwise, accept and advance the server's
counter to the token's counter.

This makes replay structurally impossible: the server state only
moves forward. Two copies of the same token cannot both be accepted
unless the server has forgotten its state (which it doesn't —
chains are persisted to `<DATA_DIR>/chains/<keyId>.chain`).

## Why this is better than `jti` + cache

- No separate store. The counter is part of the keystore.
- No GC. The counter is a small fixed-size value per key; no
  unbounded ID set.
- No race. The counter is advanced atomically on verify.
- No false positives. A `jti` cache with a TTL can expire before the
  token does; MutationChain has no such gap.
- Cryptographically authenticated. The counter is inside the AEAD's
  associated data (Chapter 5), so tampering is detectable.

## The single-writer limitation

The MutationChain update is *intentionally* a single-writer structure.
Two qv-server instances pointed at the same keystore would race to
advance the counter, producing false `MUTATION_CTR_STALE` rejections
on half of legitimate tokens.

This is the most visible scalability trade-off in v4.3. It is
explicitly called out in the roadmap; v4.4 will ship a lease-based
multi-writer coordinator. Until then, horizontal scale is:

1. **Vertical for issue.** One qv-server per master-key scope. Scale
   up, not out, for issuance. A single process at 1 000+ issue/sec is
   easy with Falcon-512.
2. **Horizontal for verify.** Verify does not mutate the chain —
   wait, it does. Verify advances the counter. So multiple verifiers
   against the same keystore still conflict.
3. **Replicate read-only keystores.** Issue on instance A, ship the
   append-only chain log to instance B. B can verify up to the point
   it has synced but will reject any token newer than its sync tail.
   This is the MVP deploy pattern today.

## When you don't want MutationChain

Some workflows (stateless APIs that only care about freshness, not
uniqueness) don't need counter-bumping on verify. Future work:
`/v3/token/verify?advance=false` to verify-without-advance. Not yet
shipped because the marginal value is small and the footgun (operator
disables advance globally and accidentally reintroduces replay) is
big.

## The code

- `qv-sdk/src/index.mjs` → `MutationChain` class.
- `qv-server/server-sovereign.mjs` → the `chains` Map, `loadChain()`,
  `appendChain()`.

## The evidence

- `qv-sdk/test/mutation-chain.test.mjs` — property tests the chain
  advance & serialisation.
- Re-issuing with a stale counter in a qv-server integration test
  deterministically fails verify.

## The comparison

| Feature | JWT `jti` | Vault token accessor | **MutationChain** |
|---------|-----------|----------------------|-------------------|
| Requires separate store | Yes | Yes | No (in-process Map) |
| Cache GC required | Yes | Yes | No |
| Reject on replay | If cache hit | If accessor revoked | Always |
| Overhead per verify | DB lookup | HTTP round-trip | In-memory lookup |
| Wire overhead per token | ~24B | 24B (accessor) | 8B (counter) |

Next: Chapter 7, [Sealing Keys at Rest](./07-sealing.md).
