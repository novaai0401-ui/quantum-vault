# The Sigvault Storybook

> *How we built a post-quantum token server that refuses to trust npm,
> the operating system, or even its own future selves — and why every
> decision is the way it is.*

This is not reference documentation. Reference documentation answers
*what*. This document answers **why**, **how**, and **compared to what**.
It is organised as a set of chapters you can read in order (like a
novel) or jump into individually (like an encyclopaedia).

If you only have five minutes, read Chapter 1.
If you are adopting Sigvault for a regulated workload, read
Chapters 1–4 and Chapter 14.
If you are auditing the code, read all of them.

---

## Part I — The world we were born into

1. [**The Post-Quantum Countdown**](./01-the-problem.md) — Why JWT, PASETO,
   and every RSA/ECDSA token scheme on the market is on a deadline,
   what "Harvest Now, Decrypt Later" means for tokens that live even
   ten seconds, and why a sovereign implementation matters.
2. [**The Zero-Dependency Oath**](./02-zero-deps.md) — The npm supply
   chain and what it takes to survive without it. Why every line of
   `qv-server` is Node.js stdlib only, and how we still ship a 200-test
   suite.
3. [**Threat Model**](./03-threat-model.md) — Who we defend against, what
   we explicitly don't protect against, and the sharp edges we leave
   visible on purpose.

## Part II — The cryptographic engine

4. [**The Key Triplet**](./04-key-triplet.md) — Why every Sigvault
   identity has *three* keys (sign, encrypt, tag), how they compose
   into a sealed envelope, and why this is stronger than JWT's signed
   blob or PASETO's v4.local.
5. [**Token Suites: ML-DSA-87, Falcon-512, Falcon-1024**](./05-suites.md)
   — Size vs speed trade-offs, why we support all three, how the suite
   byte travels on the wire, and when to pick which.
6. [**The MutationChain**](./06-mutation-chain.md) — A tamper-evident
   per-key counter that makes replay impossible even if the signing
   key leaks for a window. Single-writer by design, and the
   consequences for scale.
7. [**Sealing Keys at Rest**](./07-sealing.md) — AES-256-GCM envelope
   with per-key UUID as AAD. Why this isn't just "AES over the keystore"
   and how it survives a read-only filesystem compromise.

## Part III — The server

8. [**Request Lifecycle**](./08-request-lifecycle.md) — A single HTTP
   request, traced end-to-end through thirteen middlewares. This is
   the chapter to read if you want to understand the architecture
   in one sitting.
9. [**Authentication, CIDR, Rate Limiting**](./09-auth-cidr-rate.md) —
   The three concentric rings around every mutating endpoint, why
   defence in depth is not optional, and how we avoid the pitfalls
   that made JWT allowlists notorious.
10. [**Observability: Metrics, Audit, Traces**](./10-observability.md) —
    Prometheus at `/v3/metrics`, JSONL structured audit with automatic
    rotation, W3C traceparent propagation — and the single rule that
    keeps them all correct: no secret ever touches any of them.
11. [**Verify Pool + Backpressure**](./11-verify-pool.md) — Why
    signature verification needs its own thread pool, how the bounded
    queue prevents unbounded latency growth, and what `503 POOL_OVERLOADED`
    really means.
12. [**Graceful Shutdown + Health**](./12-lifecycle.md) — Liveness vs
    readiness, what draining looks like from the load-balancer's
    perspective, and the hard-timeout that keeps Kubernetes happy.

## Part IV — The periphery

13. [**Claims Validation**](./13-claims.md) — Two caps (bytes + shape),
    why a 16 KiB blob is still a DoS vector, and how we kill it before
    the signer even sees it.
14. [**Competitive Landscape**](./14-competition.md) — Feature-by-feature
    comparison against Auth0, Okta, HashiCorp Vault, Keycloak, AWS KMS,
    the raw JWT ecosystem, and PASETO. What Sigvault uniquely
    offers and where the seams still show.
15. [**The Limitations We Ship With**](./15-limitations.md) — Every
    known limitation, honestly named, with the planned fix, the workaround,
    and why it hasn't landed yet.

## Part V — The practitioner's handbook

16. [**Operations Cookbook**](./16-operations.md) — Recipes for TLS
    termination, horizontal scaling, metrics scraping, log aggregation,
    disaster recovery, key rotation, and the eight env vars you must
    set before a production deploy.
17. [**Testing Philosophy**](./17-testing.md) — Why we write unit +
    integration + property tests, what we specifically don't test, and
    how to add a new test without breaking the pure-stdlib invariant.
18. [**Secret Manager Integration**](./18-secret-managers.md) — The
    pluggable `MasterKeyProvider`: env, file, and exec backends. Recipes
    for AWS KMS, HashiCorp Vault, Azure Key Vault, GCP KMS, 1Password,
    and sops. Why `exec` is the universal escape hatch instead of a
    plugin API.
19. [**The Single-Writer Lock**](./19-single-writer-lock.md) — Why two
    qv-servers against one DATA_DIR is silent corruption, the
    fence-token lease that makes it loud, and the cost / benefit of a
    file-based lock vs a real coordinator (Postgres / etcd / S3).
20. [**The Public Contract and the Container**](./20-spec-and-packaging.md)
    — OpenAPI 3.1, the wire-format spec, the error-code registry, the
    reproducible Dockerfile, the Helm chart, and the SBOM that proves
    zero deps. The artefacts that let any language and any cluster
    integrate qv-server without reading qv-server source.

---

### How to read this book

Every chapter follows the same structure:

1. **The story.** What problem does this chapter solve, and why does it
   matter beyond the technical merits?
2. **The design.** What did we build and what were the alternatives?
3. **The code.** Pointers to the files and functions that implement it.
4. **The evidence.** What tests prove it works, and what metrics surface
   it in production.
5. **The comparison.** How does this compare to JWT/PASETO/Vault/etc.?

If a chapter deviates from that structure, it's because the topic is
either foundational (and can't be compared) or too new to have rivals.

### Writing conventions

- **"We"** refers to the maintainers. **"You"** is the reader, assumed
  to be an engineer shipping authentication in production.
- **Code snippets** are always drawn from the actual repo. Line numbers
  shift as the codebase evolves, so we refer to functions by name.
- **File paths** are relative to the repo root, e.g. `qv-server/auth.mjs`.
- **Env vars** are always `MONO_CAPS`. Their defaults are the boring
  obviously-correct choice; the overrides exist for edge cases, not
  as a configuration treadmill.
- **Where we disagree with an industry-standard practice**, we say so
  explicitly and defend the position.

Turn the page when you're ready.
