# @quantumvault/sdk

Post-quantum (ML-DSA-87) cryptographic tokens for JavaScript. Runs in Node 18+,
Deno, Bun, Cloudflare Workers, and modern browsers. Zero native dependencies —
built on [@noble/post-quantum](https://github.com/paulmillr/noble-post-quantum),
[@noble/ciphers](https://github.com/paulmillr/noble-ciphers), and
[@noble/hashes](https://github.com/paulmillr/noble-hashes).

```bash
npm install @quantumvault/sdk
```

## Quickstart

```js
import {
  generateKeypair, MutationChain,
  issueToken, verifyToken, inspectToken,
} from '@quantumvault/sdk';

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

| | JWT (RS256 / ES256) | QuantumVault (ML-DSA-87) |
|---|---|---|
| Quantum-safe | ❌ | ✅ NIST FIPS 204 |
| Payload encrypted | ❌ base64 only | ✅ XChaCha20-Poly1305 |
| Replay protection | Timestamps only | HYDRA mutation chain (stateful) |
| Signature size | 256 B | 4 627 B (ML-DSA-87) / 666 B (Falcon-512) |
| Deps | varies | Pure JS — `@noble/*` only |

## What ships in the SDK

- `generateKeypair()` / `MutationChain`
- `issueToken({ ... })` / `verifyToken({ ... })` / `inspectToken(...)`
- Wire-format compatible with the Rust `qv-core` and REST server.

## Server-side verification

Pair this SDK with the zero-dependency REST server for a stateful backend:

```bash
docker run -p 7433:7433 ghcr.io/007krcs/qv-server:4.2
```

…or run `cargo add qv-core --features falcon` if your backend is Rust.

## License

Apache-2.0. See [LICENSE](../LICENSE).
