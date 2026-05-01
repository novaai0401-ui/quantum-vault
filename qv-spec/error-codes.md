# Sigvault Error Code Registry

Every `4xx`/`5xx` response from qv-server carries a JSON envelope:

```json
{ "error": { "code": "STABLE_CODE", "message": "human-readable detail" } }
```

Clients branch on `code`, **never** on `message`. The list below is
the contract.

## Authentication & authorisation

| Code | HTTP | Meaning |
|------|-----:|---------|
| `BEARER_MISSING`     | 401 | `Authorization` header absent. |
| `BEARER_INVALID`     | 401 | Token did not match `QV_ADMIN_TOKEN_SHA256`. |
| `CIDR_DENIED`        | 403 | Caller IP not in admin/metrics CIDR allowlist. |
| `ANON_DISABLED`      | 401 | `QV_ALLOW_ANON=false` and no bearer presented. |

## Rate limiting

| Code | HTTP | Meaning |
|------|-----:|---------|
| `RATE_LIMITED_PUBLIC`  | 429 | Public-bucket exhausted. |
| `RATE_LIMITED_VERIFY`  | 429 | Verify-bucket exhausted. |
| `RATE_LIMITED_ADMIN`   | 429 | Admin-bucket exhausted. |
| `RATE_LIMITED_AUTHFAIL`| 429 | Failed-auth bucket — operator must investigate. |

## Body / claims validation

| Code | HTTP | Meaning |
|------|-----:|---------|
| `BODY_TOO_LARGE`         | 413 | Request body exceeded `QV_MAX_BODY_BYTES`. |
| `CLAIMS_NOT_OBJECT`      | 400 | Root of `claims` not a JSON object. |
| `CLAIMS_TOO_DEEP`        | 400 | Nesting exceeded `QV_CLAIMS_MAX_DEPTH`. |
| `CLAIMS_TOO_MANY_KEYS`   | 400 | Object key count exceeded `QV_CLAIMS_MAX_KEYS`. |
| `CLAIMS_ARRAY_TOO_LARGE` | 400 | Array length exceeded `QV_CLAIMS_MAX_ARRAY`. |
| `CLAIMS_STRING_TOO_LONG` | 400 | String length exceeded `QV_CLAIMS_MAX_STRING`. |
| `CLAIMS_KEY_TOO_LONG`    | 400 | Key length exceeded `QV_CLAIMS_MAX_STRING`. |
| `CLAIMS_BAD_NUMBER`      | 400 | NaN or Infinity in claims. |
| `CLAIMS_BAD_TYPE`        | 400 | Function/Symbol/etc. in claims. |
| `CLAIMS_TOO_MANY_NODES`  | 400 | Total tree nodes exceeded `QV_CLAIMS_MAX_NODES`. |
| `INVALID_JSON`           | 400 | Body is not valid JSON. |
| `INVALID_SUITE`          | 400 | `suite` not in `/v3/spec.suites`. |

## Keys

| Code | HTTP | Meaning |
|------|-----:|---------|
| `KEY_NOT_FOUND`     | 404 | `keyId` is unknown. |
| `KEY_REVOKED`       | 410 | `keyId` was revoked. |
| `ALREADY_REVOKED`   | 409 | Revoke called on an already-revoked key. |

## Tokens

| Code | HTTP | Meaning |
|------|-----:|---------|
| `INVALID_TOKEN`           | 422 | Cryptographic verification failed (sig / AEAD / magic / version). |
| `MUTATION_CTR_STALE`      | 422 | Token counter ≤ chain counter — replay or read-replica lag. |
| `KOLMOGOROV_FAIL`         | 422 | Nonce entropy floor (0.85) not met. |
| `TOKEN_EXPIRED`           | 410 | `issuedAt + ttl < now`. |

## Server-side / capacity

| Code | HTTP | Meaning |
|------|-----:|---------|
| `POOL_OVERLOADED` | 503 | Verify-pool queue full. Retry with backoff. |
| `POOL_SHUTDOWN`   | 503 | Server is draining. |

## Boot-time errors (logged to stderr, not HTTP)

These never reach a client — they cause the server to refuse to
start. Listed here so operators can diagnose:

| Code | Meaning |
|------|---------|
| `MK_ENV_MISSING`            | `QV_MASTER_KEY_HEX` required by provider but unset. |
| `MK_FILE_MISSING`           | Master file required by provider but unset and `allowGenerate=false`. |
| `WRITER_LOCK_HELD`          | Another live qv-server owns this DATA_DIR. |
| `WRITER_LOCK_STALE`         | Stale lease present and `allowSteal=false`. |
| `WRITER_LOCK_LOST`          | Lease was stolen during a long pause; aborting to avoid double-write. |
| `CHAIN_LOG_TAMPERED`        | Chain log stateHash mismatched the SHA3 ratchet — tamper, corruption, or seed mismatch. |
| `CHAIN_LOG_NON_MONOTONIC`   | Chain log counter skipped a step. |
| `CHAIN_LOG_CORRUPT`         | Chain log file is not a multiple of 40 bytes (truncated). |

## Stability guarantee

Codes never change spelling. New codes may be added; old ones may be
deprecated (announced in CHANGELOG, kept emitting for ≥1 minor
release, then removed). Branch on these — not on HTTP status, not on
prose, not on stack-trace shape.
