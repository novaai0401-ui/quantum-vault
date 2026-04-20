# QuantumVault Signature Suite Adapters

A **suite adapter** plugs a post-quantum signature algorithm into QuantumVault's
wire format. All adapters implement the same narrow interface so the rest of
the stack (encryption, mutation chain, verification pipeline) is algorithm-
agnostic.

```js
export interface SuiteAdapter {
  readonly id:        number;   // SUITE_IDS value, e.g. 0x05 for Dilithium5
  readonly name:      string;   // human label for inspect/output
  readonly sigLen:    number;   // exact signature byte length (fixed per suite)
  readonly vkLen:     number;   // verifying key byte length
  readonly skSeedLen: number;   // signing key seed byte length (what we store)

  generateKeypair(): { signingKey: Uint8Array, verifyingKey: Uint8Array };
  sign(msg: Uint8Array, signingKey: Uint8Array):   Uint8Array;
  verify(sig: Uint8Array, msg: Uint8Array, vk: Uint8Array): boolean;
}
```

## Shipping suites

| Suite ID | Name         | Status    | Sig (B) | VK (B) | PQ bits | Best for |
|---------:|--------------|-----------|--------:|-------:|--------:|----------|
| `0x05`   | ML-DSA-87    | **shipped** | 4627 | 2592 | 192 | default, long-lived |
| `0x03`   | ML-DSA-44    | reserved  | 2420    | 1312   | 64  | service tokens |
| `0x02`   | ML-DSA-65    | reserved  | 3293    | 1952   | 128 | access tokens |
| `0x10`   | Falcon-512   | reserved  |  666    |  897   | 64  | **JWT-class size** |
| `0x11`   | Falcon-1024  | reserved  | 1280    | 1793   | 192 | size + security |

## Why Falcon is "reserved" not "shipped"

Falcon uses floating-point NTT arithmetic in its reference implementation,
which is a well-known constant-time hazard. A production-quality Falcon
adapter needs one of:

1. **Vendored Falcon-C from PQClean** compiled with a hardened FP lib
   (or the integer-only variant), linked via our `qv-ffi` crate. Adds a
   build-time C dep but no run-time npm/crates.io dep.
2. **Pure-Rust Falcon** (e.g. `falcon-rust` once it reaches 1.0 + audit).
   Cleaner sovereignty story, but today the pure-Rust options are
   experimental.

Path (1) is the plan for v4.1. Until then `SUITE_IDS.Falcon512` and
`SUITE_IDS.Falcon1024` are reserved — any token using them will fail with
`SUITE_NOT_IMPLEMENTED` at issue/verify time.

## Adapter registration

When a Falcon adapter lands:

```js
import { registerSuite } from '../index.mjs';
import { Falcon512Adapter } from './falcon512.mjs';

registerSuite(Falcon512Adapter);
```

Then `issueToken({ suite: SUITE_IDS.Falcon512, … })` starts producing
~700-byte tokens instead of ~4800-byte tokens — identical wire format
except the `suite` byte and the signature length.
