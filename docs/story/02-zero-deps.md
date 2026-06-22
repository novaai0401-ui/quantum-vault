# Chapter 2 — The Zero-Dependency Oath

## The story

In March 2024, the XZ Utils backdoor came within days of shipping to
every Linux server on Earth. A single malicious maintainer, cultivated
over two years, had pushed code that compromised OpenSSH. The attack
was caught by a Microsoft engineer who noticed a 500-millisecond slow-down
in a benchmark. Half a second saved the internet.

In 2022, the `colors` and `faker` npm packages — with a combined
~23 million weekly downloads — were sabotaged by their own maintainer
as a protest. Countless CI pipelines broke overnight.

In 2021, `ua-parser-js` was hijacked via stolen npm credentials. The
malicious version shipped crypto-miners and credential stealers
to every service that auto-upgraded, which is *most of them*.

Node.js has approximately **3 million** published packages on npm.
The average real-world web service transitively depends on between
**500 and 5000** of them. Each is a separate trust root. Each is a
separate attacker.

**This is why `qv-server/package.json` has an empty `dependencies`
object.**

```json
"dependencies": {}
```

## What the oath means

We will not add an npm dependency to `qv-server`, ever.

Not to parse JSON. Node has `JSON.parse`.
Not for an HTTP framework. Node has `node:http`.
Not for rate limiting. `Map` + `Date.now()` is enough.
Not for the Prometheus exposition format. It's ~100 lines of string
concatenation.
Not for a logger. `process.stdout.write` plus `JSON.stringify` is a
logger.
Not for a test framework. `node:test` ships with Node 18+.
Not for UUID generation. `node:crypto.randomUUID()`.
Not for hashing. `node:crypto.createHash`.
Not for AES. `node:crypto.createCipheriv('aes-256-gcm', …)`.
Not for worker threads. `node:worker_threads`.
Not for file I/O. `node:fs`.

The cryptographic primitives we *cannot* get from the Node standard
library — ML-DSA-87, Falcon-512/1024, XChaCha20-Poly1305 — live in
`qv-sdk`, which is also dependency-free. Its `package.json` is:

```json
"dependencies": {},
"devDependencies": {}
```

The deeper primitives live in `qv-core` (Rust, published to crates.io),
vendored into `./vendor/` so `cargo build` works offline. Even here,
we vendor PQClean's Falcon reference implementation rather than pull
it from a registry.

## Why "zero" not "few"

"Few" is a spectrum. "Zero" is a binary property of the build. The
instant we add one dependency, the next pull request to add another
is a conversation, not a rejection. Two become three, three become
thirty, and you're back at the 500-dependency baseline with no clear
reason why this one was necessary.

"Zero" is easy to enforce in CI: `grep -c '"' qv-server/package.json`
is roughly constant. We can (and do) assert it:

```bash
test "$(jq '.dependencies | length' qv-server/package.json)" -eq 0
```

## The cost

The oath is not free.

1. **We write more code.** The rate limiter in `ratelimit.mjs` is ~180
   lines; an npm `rate-limiter-flexible` equivalent is a one-line
   import. But those 180 lines are our lines — we can debug them, we
   know their memory semantics, and they will still work on Node 30.

2. **We write more tests.** We have 195 server tests. A comparable
   Express + `express-rate-limit` + `pino` + `helmet` + `cors` stack
   might have fewer, because most behaviour lives in the dependencies,
   which have their own tests. We've shifted the test surface inward,
   not reduced it.

3. **We move more slowly on new features.** W3C Trace Context took an
   afternoon rather than an `npm install opentelemetry/api`. The
   trade-off is that our `trace.mjs` is 95 lines, does exactly what we
   need, and doesn't pull in 44 transitive packages.

## The reward

The first time a npm package is compromised and half of the ecosystem
is scrambling to patch, `qv-server` simply keeps running.

The first time an auditor asks for a Software Bill of Materials, ours
fits on an index card:

```
qv-server:
  - node.js (the runtime)
  - qv-sdk (our own code)
```

The first time we need to ship the server on an air-gapped appliance
with no internet connectivity, there is no `npm install` step. The
repo is the artefact.

## How we still ship reliably

The oath forces us to lean hard on **Node's standard library** and on
**our own tested primitives**. In practice this means:

| Need | Stdlib tool | Our tested primitive |
|------|-------------|----------------------|
| HTTP server | `node:http` | — |
| HTTPS | (delegated to a reverse proxy) | — |
| JSON | `JSON.parse` | `ratelimit.mjs` → `readJsonBounded` |
| Crypto primitives | `node:crypto` | `qv-sdk` |
| Worker threads | `node:worker_threads` | `verify-pool.mjs` |
| File I/O | `node:fs` | `audit.mjs` (append + rotate) |
| Timers | `setInterval`/`setTimeout` | limiter sweep |
| Path | `node:path` | — |
| Process signals | `process.on('SIGTERM')` | `shutdown.mjs` |
| UUID | `crypto.randomUUID` | — |
| Random | `crypto.randomBytes` | — |
| Constant-time compare | `crypto.timingSafeEqual` | `auth.mjs` |
| CBOR | — | `qv-sdk` (bundled) |
| AEAD (XChaCha20-Poly1305) | — | `qv-sdk` (bundled) |
| ML-DSA / Falcon | — | `qv-sdk` (bundled) |

Everything above the horizontal line is Node. Everything below is our
own code, shipped as `qv-sdk` under our own release pipeline.

## The design

The zero-dep principle constrains architecture in ways that are
actually *improvements*:

- **No framework lock-in.** `server-sovereign.mjs` is a single file that
  imports only Node modules and our own. You can read the whole
  request pipeline top-to-bottom.
- **No magic.** There is no middleware registration table, no plugin
  system, no dependency-injection container. Functions call functions.
- **No upgrade treadmill.** Express 5 breaks some Express 4 code.
  Fastify 4 breaks some Fastify 3 code. Node 18 → 20 → 22 breaks
  essentially nothing in the standard library.

## The code

- `qv-server/package.json` — the empty `dependencies` that binds us.
- Every file in `qv-server/` — together, a fully functional production
  HTTP server.

## The evidence

- CI has a job that runs `npm ci` in `qv-server/`. It should add
  no packages to `node_modules/` beyond what Node ships.
- `npm test` runs on a machine with `offline` mode in npm with no
  cache and still passes.
- The Docker image (`ghcr.io/novaai0401-ui/qv-server`) contains **zero** npm
  packages.

## The comparison

| Product | Declared npm deps | Transitive deps (approx) | Zero-dep option |
|---------|-------------------|--------------------------|-----------------|
| Auth0 Node SDK | ~12 | ~350 | No |
| Express + helmet + cors + express-rate-limit | 4 | ~120 | No |
| Fastify + @fastify/helmet + @fastify/rate-limit | 3 | ~60 | No |
| Keycloak Node adapter | ~8 | ~220 | No |
| **Sigvault qv-server** | **0** | **0** | **Yes (default)** |

Dependency counts are approximate and vary by version; the orders of
magnitude are the point.

Next: Chapter 3, [Threat Model](./03-threat-model.md).
