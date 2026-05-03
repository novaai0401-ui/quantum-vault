# Sigvault Conformance Test Vectors

This directory holds language-agnostic fixtures that any conforming
SDK MUST pass.

The format is JSON. All binary fields are base64url-encoded (no
padding) so the file round-trips through any tool. Each vector
captures one of the following families:

- **token.parse** — given bytes, deserialise the header and payload
  fields without verification.
- **token.verify-success** — given a token + verifyingKey + encryptKey
  + chain-state, verification succeeds and exposes the expected
  claims and counter.
- **token.verify-fail** — verification rejects with a specific stable
  error code (`INVALID_TOKEN`, `MUTATION_CTR_STALE`,
  `KOLMOGOROV_FAIL`, `TOKEN_EXPIRED`).
- **chain.advance** — given a seed and N successive advances, the
  state and counter at each step.
- **claims.validation** — given a JSON document and a config, expect
  one of the `CLAIMS_*` error codes (or success).

## File format

```jsonc
{
  "spec_version": "1.0",
  "produced_by":  "qv-server@4.3.0",
  "produced_at":  "2026-04-24T20:00:00Z",
  "vectors": [
    {
      "id":          "token.parse.access.dilithium5.001",
      "kind":        "token.parse",
      "description": "Plain access token, ML-DSA-87, 1 small claim",
      "input": {
        "tokenB64u": "..."
      },
      "expect": {
        "magic":       "QVLT",
        "version":     768,
        "suite":       5,
        "tokenType":   1,
        "issuedAtUs":  "1714060800000000",
        "ttlSec":      3600,
        "nonceB64u":   "...",
        "deviceFpB64u":"...",
        "encPayloadLen": 64,
        "mutationCtr": "1",
        "signatureLen": 4627
      }
    }
  ]
}
```

`id` is a stable, human-grokable name. New vectors get monotonically
increasing trailing numbers; old vectors are never deleted in a minor
release (only marked `deprecated: true`).

## Generating

```bash
node qv-spec/test-vectors/generate.mjs > qv-spec/test-vectors/vectors.json
```

Re-run after any qv-sdk change that affects byte layout. The generator
is deterministic — the same seeds produce the same vectors.

## Running against an SDK

A conformance harness for the JS SDK ships in
`qv-spec/test-vectors/harness.mjs`. Other languages port the same
shape (load JSON → call SDK → compare to `expect`). The harness's
exit code is the test-runner contract: `0` = all pass, non-zero =
N failures.

## Conformance levels

- **L1 — Parse**: the SDK can deserialise any well-formed token. ~30 vectors.
- **L2 — Verify**: full pipeline, including replay rejection. ~80 vectors.
- **L3 — Issue**: SDK round-trips through its own verifier and
  produces byte-identical tokens to the reference (modulo nonce
  randomness). Issue vectors fix the nonce explicitly.
- **L4 — Edge cases**: every error-code path. ~40 vectors.

A SDK is *QV Verified* when it passes L1+L2 against the public
vector file for the release it claims to support. L3 and L4 are
recommended but not required.
