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

### Serverless cookbook — `ChainStore`

In AWS Lambda / Cloudflare Workers / Vercel Functions the function instance
disappears between invocations. A `new MutationChain()` therefore starts at
counter=0 every cold start and **replay protection silently breaks**.

The SDK ships a `ChainStore` interface (since v4.3.8) so you don't have to
roll the atomicity yourself:

```ts
interface ChainStore {
  reserveNext(keyId: string): Promise<bigint>;  // issue side — atomic
  observe(keyId: string, counter: bigint): Promise<void>;  // verify side — throws REPLAY
}
```

Pair it with `issueTokenWithStore` and `verifyTokenWithStore`:

```js
import {
  issueTokenWithStore, verifyTokenWithStore, InMemoryChainStore,
} from '@sigvault/sdk';

const store = new InMemoryChainStore();   // dev only — see below for real ones

const { tokenHex, counter } = await issueTokenWithStore({
  store, keyId: 'svc-api',
  signingKey, encryptKey,
  claims: { sub: 'alice', role: 'admin' },
});

const verified = await verifyTokenWithStore({
  store, keyId: 'svc-api',
  token: tokenHex, verifyingKey, encryptKey,
});
```

The store guarantees:

1. **Atomic reserveNext** — concurrent callers never see the same counter.
2. **Durable before return** — a crash post-`reserveNext` cannot replay.
3. **Monotonic observe** — verifier high-water mark only goes up.

#### Redis (single-instance — global atomic counter)

```js
class RedisChainStore /* implements ChainStore */ {
  constructor(redis, prefix = 'sv') { this.r = redis; this.p = prefix; }
  async reserveNext(keyId) {
    const n = await this.r.incr(`${this.p}:i:${keyId}`);   // atomic
    return BigInt(n);
  }
  async observe(keyId, counter) {
    // Lua: only set if greater. Returns 1 on update, 0 on regression.
    const ok = await this.r.eval(`
      local cur = tonumber(redis.call('GET', KEYS[1]) or '0')
      if tonumber(ARGV[1]) > cur then
        redis.call('SET', KEYS[1], ARGV[1]); return 1
      end
      return 0
    `, 1, `${this.p}:v:${keyId}`, counter.toString());
    if (!ok) {
      const e = new Error(`REPLAY: counter ${counter} not above stored`);
      e.code = 'REPLAY'; throw e;
    }
  }
}
```

#### Postgres (SERIALIZABLE on a single counters table)

```sql
CREATE TABLE sigvault_chain (
  key_id  text   PRIMARY KEY,
  counter bigint NOT NULL DEFAULT 0
);
```

```js
class PostgresChainStore {
  constructor(pool) { this.pool = pool; }
  async reserveNext(keyId) {
    const { rows } = await this.pool.query(`
      INSERT INTO sigvault_chain (key_id, counter) VALUES ($1, 1)
      ON CONFLICT (key_id)
      DO UPDATE SET counter = sigvault_chain.counter + 1
      RETURNING counter
    `, [keyId]);
    return BigInt(rows[0].counter);
  }
  async observe(keyId, counter) {
    const { rowCount } = await this.pool.query(`
      INSERT INTO sigvault_chain (key_id, counter) VALUES ($1, $2)
      ON CONFLICT (key_id)
      DO UPDATE SET counter = $2 WHERE sigvault_chain.counter < $2
    `, [keyId, counter.toString()]);
    if (rowCount === 0) {
      const e = new Error('REPLAY'); e.code = 'REPLAY'; throw e;
    }
  }
}
```

#### DynamoDB (UpdateItem with ADD + ConditionExpression)

```js
class DynamoChainStore {
  constructor(ddb, table = 'sigvault_chain') { this.d = ddb; this.t = table; }
  async reserveNext(keyId) {
    const r = await this.d.update({
      TableName: this.t,
      Key: { keyId: { S: keyId } },
      UpdateExpression: 'ADD #c :one',
      ExpressionAttributeNames:  { '#c': 'counter' },
      ExpressionAttributeValues: { ':one': { N: '1' } },
      ReturnValues: 'UPDATED_NEW',
    });
    return BigInt(r.Attributes.counter.N);
  }
  async observe(keyId, counter) {
    try {
      await this.d.update({
        TableName: this.t,
        Key: { keyId: { S: keyId } },
        UpdateExpression: 'SET #c = :n',
        ConditionExpression: 'attribute_not_exists(#c) OR #c < :n',
        ExpressionAttributeNames:  { '#c': 'counter' },
        ExpressionAttributeValues: { ':n': { N: counter.toString() } },
      });
    } catch (e) {
      if (e.name === 'ConditionalCheckFailedException') {
        const re = new Error('REPLAY'); re.code = 'REPLAY'; throw re;
      }
      throw e;
    }
  }
}
```

#### Cloudflare Durable Object (single-instance per keyId — atomic by construction)

```js
export class ChainCounter {
  constructor(state) { this.state = state; }
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/reserve') {
      const cur = (await this.state.storage.get('c')) ?? 0n;
      const next = cur + 1n;
      await this.state.storage.put('c', next);
      return Response.json({ counter: next.toString() });
    }
    if (url.pathname === '/observe') {
      const { counter } = await req.json();
      const ctr = BigInt(counter);
      const cur = (await this.state.storage.get('c')) ?? 0n;
      if (ctr <= cur) return new Response('REPLAY', { status: 409 });
      await this.state.storage.put('c', ctr);
      return new Response('ok');
    }
  }
}

// On the worker side, wrap the DO as a ChainStore:
class DurableObjectChainStore {
  constructor(namespace) { this.ns = namespace; }
  async reserveNext(keyId) {
    const stub = this.ns.get(this.ns.idFromName(keyId));
    const { counter } = await (await stub.fetch('https://do/reserve')).json();
    return BigInt(counter);
  }
  async observe(keyId, counter) {
    const stub = this.ns.get(this.ns.idFromName(keyId));
    const r = await stub.fetch('https://do/observe', {
      method: 'POST', body: JSON.stringify({ counter: counter.toString() }),
    });
    if (r.status === 409) {
      const e = new Error('REPLAY'); e.code = 'REPLAY'; throw e;
    }
  }
}
```

All four implementations satisfy the `ChainStore` contract. Pick the one
that matches your existing infrastructure — Sigvault doesn't care which.

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
