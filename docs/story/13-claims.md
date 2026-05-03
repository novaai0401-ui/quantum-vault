# Chapter 13 — Claims Validation

## The story

The most common JWT anti-pattern is **dumping arbitrary objects into
claims**. The token ends up carrying a full user profile, a
permissions tree, a tenant graph, a session history — and now you
have a 30 KB token, CPU-expensive to sign, CPU-expensive to parse,
and impossible to fit in a cookie.

Sigvault enforces two caps:

1. **Byte cap** (`QV_MAX_CLAIMS_BYTES`, default 16 KiB) — at
   ratelimit.mjs, before we touch JSON.parse.
2. **Structural cap** (`claims.mjs`, defaults depth≤8, keys≤64,
   array≤128, string≤4 096, nodes≤1 024) — before the signer.

The byte cap kills the pathological case of "9 MiB of repeated
whitespace". The structural cap kills the pathological case of
"16 KiB of 10 000 single-char keys".

## Why shape matters

A 16 KiB blob can still be shaped adversarially:

- **10 000 sibling keys** — the CBOR encoder allocates per key.
  16 KiB / 1.6 bytes per key ≈ 10 000 keys. Legitimate claims rarely
  have more than a few dozen.
- **5 000-deep nesting** — every level is a recursion. 16 KiB /
  ~3 bytes per level ≈ 5 000 levels. Legitimate claims rarely
  exceed 3 levels.
- **Numbers as strings** — `"123"` vs `123`. Fine, but an attacker
  might craft strings longer than intended. We cap.
- **NaN / Infinity** — JSON allows neither, but some relaxed parsers
  do. We reject.

Each of these costs measurable CPU in the CBOR encoder, the AEAD
primitive, and the signer. Against a well-paid attacker running a
single machine, a 16 KiB claims payload with 10 000 keys can push
`/v3/token/issue` latency from ~1 ms to hundreds of ms, amplifying
whatever legitimate rate-limit budget they have by three orders of
magnitude.

## The caps

| Env var | Default | Range | Purpose |
|---------|---------|-------|---------|
| `QV_CLAIMS_MAX_DEPTH` | 8 | 1–64 | Prevents pathological nesting |
| `QV_CLAIMS_MAX_KEYS` | 64 | 1–4 096 | Per-object key count |
| `QV_CLAIMS_MAX_ARRAY` | 128 | 1–65 536 | Per-array element count |
| `QV_CLAIMS_MAX_STRING` | 4 096 | 1–1 048 576 | Per-string chars |
| `QV_CLAIMS_MAX_NODES` | 1 024 | 1–1 048 576 | Total values in tree |

All values are integer-validated at startup. An invalid value
refuses to boot.

## The error vocabulary

Each violation gets a stable error code so clients can branch on it:

| Code | Meaning |
|------|---------|
| `CLAIMS_NOT_OBJECT` | Root is not a JSON object |
| `CLAIMS_TOO_DEEP` | Exceeded `maxDepth` |
| `CLAIMS_TOO_MANY_KEYS` | Object exceeded `maxKeys` |
| `CLAIMS_ARRAY_TOO_LARGE` | Array exceeded `maxArray` |
| `CLAIMS_STRING_TOO_LONG` | String exceeded `maxString` |
| `CLAIMS_KEY_TOO_LONG` | Object key exceeded `maxString` |
| `CLAIMS_BAD_NUMBER` | NaN or Infinity |
| `CLAIMS_BAD_TYPE` | Function / Symbol / etc. |
| `CLAIMS_TOO_MANY_NODES` | Tree exceeded `maxNodes` |

All return `400 Bad Request` with the standard error envelope:

```json
{"error": {"code": "CLAIMS_TOO_DEEP", "message": "claims exceed max depth (8)"}}
```

## Where it runs

Immediately after `readJson` in `/v3/token/issue`:

```javascript
try { validateClaims(claims, CLAIMS_CFG); }
catch (e) { return err(res, 400, e.code || 'INVALID_CLAIMS', e.message); }
```

If you want stricter-or-looser caps per route, thread your own
`CLAIMS_CFG` in. The function is pure — it's cheap to instantiate.

## Why separate from size cap

Size is enforced at the HTTP layer (413), before JSON parsing.
Structure is enforced after JSON parsing, before signing. They have
different failure modes and belong at different layers.

## The code

- `qv-server/claims.mjs` — `loadClaimsConfig` + `validateClaims`
- `qv-server/server-sovereign.mjs` → wired in `/v3/token/issue`

## The evidence

- `test/claims.test.mjs` — 13 unit tests covering every code path
- `test/integration.claims.test.mjs` — 3 E2E tests proving the
  server returns 400 + stable codes

## The comparison

| Product | Size cap | Shape cap | Stable error codes |
|---------|----------|-----------|--------------------|
| jsonwebtoken (npm) | No | No | No |
| Auth0 | Opaque | Opaque | Custom |
| Keycloak | Yes (token-claim-size limit) | No | No |
| **Sigvault** | **Yes (16 KiB)** | **Yes (9 caps)** | **Yes (9 codes)** |

Next: Chapter 14, [Competitive Landscape](./14-competition.md).
