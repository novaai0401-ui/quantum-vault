# @sigvault/sdk

Post-quantum (ML-DSA-87) cryptographic tokens for JavaScript. Runs in Node 18+,
Deno, Bun, Cloudflare Workers, and modern browsers. Zero native dependencies —
built on [@noble/post-quantum](https://github.com/paulmillr/noble-post-quantum),
[@noble/ciphers](https://github.com/paulmillr/noble-ciphers), and
[@noble/hashes](https://github.com/paulmillr/noble-hashes).

```bash
npm install @sigvault/sdk
```

## Quickstart

```js
import {
  generateKeypair, MutationChain,
  issueToken, verifyToken, inspectToken,
} from '@sigvault/sdk';

// 1. One-time setup: generate keys + a replay-protection chain.
const { signingKey, verifyingKey, encryptKey } = generateKeypair();
const chain = new MutationChain();

// 2. Issue a token.
const { tokenHex } = issueToken({
  signingKeySeed: signingKey,
  encryptKey,
  chain,
  claims: { sub: 'user-123', role: 'admin' },
  ttl: 3600,
});

// 3. Verify (recipient side).
const result = verifyToken({
  token: tokenHex,
  verifyingKey,
  encryptKey,
  chain: new MutationChain(chain.state),
});

console.log(result.claims); // { sub: 'user-123', role: 'admin' }
```

## Why not JWT?

| | JWT (RS256 / ES256) | Sigvault (ML-DSA-87) |
|---|---|---|
| Quantum-safe | ❌ | ✅ NIST FIPS 204 |
| Payload encrypted | ❌ base64 only | ✅ XChaCha20-Poly1305 |
| Replay protection | Timestamps only | HYDRA mutation chain (stateful) |
| Signature size | 256 B | 4 627 B (ML-DSA-87) / 666 B (Falcon-512) |
| Deps | varies | Pure JS — `@noble/*` only |

## What ships in the SDK

- `generateKeypair()` / `MutationChain`
- `issueToken({ ... })` / `verifyToken({ ... })` / `inspectToken(...)`
- `issueTokenAt({ chainSeed, counter, ... })` — stateless issue for serverless
- `encrypt(plaintext, key, nonce, aad?)` / `decrypt(...)` — XChaCha20-Poly1305 primitive
- `randomBytes(n)` — re-exported from `@noble/hashes` so you don't need to install it
- TypeScript declarations (`index.d.ts`) — TS consumers get full types out of the box
- Wire-format compatible with the Rust `qv-core` and the REST server

### Serverless mode

In AWS Lambda / Cloudflare Workers / Vercel Functions the function instance
disappears between invocations. A `new MutationChain()` therefore starts at
counter=0 every cold start and **replay protection silently breaks**.

Use `issueTokenAt` and hold the counter in an external atomic store:

```js
import { issueTokenAt } from '@sigvault/sdk';

// Pseudocode — replace with your atomic-increment store
const next = await redis.incr(`sigvault:ctr:${keyId}`);

const { tokenHex } = issueTokenAt({
  signingKeySeed: signingKey,
  encryptKey,
  chainSeed: encryptKey.slice(0, 32),  // the deterministic seed used server-side
  counter: BigInt(next),
  claims: { sub: 'alice' },
});
```

Verify side: hold `last_seen_ctr_per_keyId` in the same store and reject tokens
whose counter is `<=` the stored value.

### Falcon-512 / Falcon-1024 — current status

The SDK signs **ML-DSA-87 only** today. The wire format reserves suite bytes
`0x10` (Falcon-512) and `0x11` (Falcon-1024) but the SDK has no Falcon
implementation because there is no audited zero-dep JS Falcon yet — PQClean's
reference code is float-heavy NTT C that resists pure-JS porting, and
`@noble/post-quantum` does not include Falcon.

For Falcon today:

- Run the Sigvault server with `qv-cli` available; the server exposes
  `POST /v3/admin/falcon/sign` and `POST /v3/falcon/verify` over HTTP. The
  bridge spawns `qv-cli` (Rust + PQClean) per call.
- Or call `qv-core` directly from Rust.

Falcon in the JS SDK is tracked as limitation **L9**; it's a v4.4 candidate
once a viable Falcon path (WASM with C-toolchain build, or an audited JS impl)
emerges.

### Runtime compatibility

| Runtime          | Issue / verify | Compression           |
|------------------|----------------|-----------------------|
| Node 18+         | ✅              | `node:zlib` (sync)    |
| Bun              | ✅              | `node:zlib` (sync)    |
| Deno             | ✅              | Pass `compress: false`|
| Cloudflare Workers | ✅            | Pass `compress: false`|
| Modern browser   | ✅              | Pass `compress: false`|

The SDK auto-detects: on a runtime without sync compression, `compress: 'auto'`
silently downgrades to `false`. Pass `compress: true` to force compression
and you'll get `COMPRESSION_UNAVAILABLE` if the runtime can't honour it.

## Server-side verification

Pair this SDK with the zero-dependency REST server for a stateful backend:

```bash
docker run -p 7433:7433 ghcr.io/007krcs/qv-server:4.3
```

…or run `cargo add qv-core --features falcon` if your backend is Rust.

## License

Apache-2.0. See [LICENSE](../LICENSE).
