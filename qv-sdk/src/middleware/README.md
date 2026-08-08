# Sigvault framework middlewares

Drop-in request authentication for Express-style and Fastify apps.
Zero dependencies — the middlewares import nothing but the SDK itself
and never import the framework (they follow each framework's plain
function contracts).

## Express / Connect / Polka

```js
import { sigvaultExpress } from '@sigvault/sdk/middleware/express';

// Remote mode — delegate verification to a running qv-server:
app.use('/api', sigvaultExpress({ serverUrl: 'http://localhost:7433' }));

// Local mode — verify in-process, no server round-trip:
app.use('/api', sigvaultExpress({ keyId, verifyingKey, encryptKey, store }));

app.get('/api/me', (req, res) => res.json(req.sigvault.claims));
```

## Fastify

```js
import { sigvaultFastify } from '@sigvault/sdk/middleware/fastify';

await app.register(sigvaultFastify, { serverUrl: 'http://localhost:7433' });
app.get('/me', (req) => req.sigvault.claims);
```

## Options

| Option | Default | Meaning |
|---|---|---|
| `serverUrl` | — | Remote mode: base URL of qv-server. Uses `/v3/token/verify-auto`, or `/v3/token/verify` when `keyId` is also set. |
| `keyId` | — | Local mode: key the tokens were issued under (also narrows remote mode). |
| `verifyingKey` | — | Local mode: ML-DSA-87 verifying key bytes. |
| `encryptKey` | — | Local mode: XChaCha20 claims key bytes. |
| `store` | `InMemoryChainStore` | Local mode: ChainStore for cross-call replay protection. The in-memory default protects a single process only — supply a durable store in multi-process deployments. |
| `header` | `authorization` | Header to read the token from. |
| `scheme` | `Bearer` | Expected prefix; pass `''` to use the raw header value. |
| `getToken` | — | Custom `(req) => token` extractor; overrides `header`/`scheme`. |
| `property` | `sigvault` | Request property the verify result is attached to. |

On success the request gains `req.sigvault = { valid, keyId, claims, ... }`.
On failure the request is answered `401` with `{ error: { code, message } }`
and your handler never runs.
