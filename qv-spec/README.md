# qv-spec — the public contract

This directory is the **interop contract** for QuantumVault. It is
intentionally small, intentionally precise, and intentionally
licensed for maximum reuse (CC BY 4.0 from v4.3.0).

## Contents

| File | What it is |
|------|------------|
| [`openapi.yaml`](./openapi.yaml) | OpenAPI 3.1 spec for the `/v3/*` HTTP surface. Every status code, every error envelope, every authentication mode. |
| [`wire-format.md`](./wire-format.md) | The byte-level layout of a QuantumVault token. Read this if you're writing an SDK in any language. |
| [`error-codes.md`](./error-codes.md) | Canonical list of stable error-code strings. Clients should branch on these, never on prose messages. |
| `test-vectors/` *(coming v4.3.0)* | Cross-language `(input, expected output)` fixtures. Pass them all, get the "QV Verified" badge. |

## Audience

- **Backend developers** integrating qv-server: read OpenAPI.
- **SDK authors** implementing token issue/verify in another
  language: read `wire-format.md` + run the test vectors.
- **Auditors**: read everything; cross-reference with `qv-server/`
  source.

## What you get out of conforming

1. Any QuantumVault-issued token your SDK produces will verify
   against any conforming verifier (server or other SDK).
2. Forward compatibility: new suites are additive (new bytes in the
   suite registry); old SDKs gracefully refuse to verify what they
   don't recognise.
3. Operator portability: caller code does not change when an
   operator switches from `qv-server` to a different conforming
   implementation.

## What you do NOT need

- The `qv-server` source code.
- Any non-test dependency.
- Permission. The OpenAPI and wire-format docs are public.

## Versioning

The wire-format version field (`0x0300`) bumps only on incompatible
changes. The OpenAPI doc's `info.version` tracks the qv-server
release line. Conformance test-vectors are pinned per release.

A v4 SDK reading a v3 token MUST verify it. A v3 SDK reading a v4
token SHOULD reject with a clear "version unsupported" error rather
than mis-parse.
