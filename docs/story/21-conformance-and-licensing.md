# Chapter 21 — Conformance, Trademark, and the Licence Boundary

## The story

Chapter 20 published the *contract*: the OpenAPI spec, the wire-format
document, the error-code registry, the Helm chart, the SBOM. Anyone
can integrate against those and never touch our source.

This chapter is about the *boundary* that keeps Sigvault viable while
the contract is open. Three artefacts:

1. The **conformance test vectors** — the binary "pass / fail" gate
   for any third-party SDK claiming Sigvault compatibility.
2. The **trademark** — what a forked or competing product can and
   cannot call itself.
3. The **source licence** — BUSL-1.1 with an additional-use grant.

Together they answer the question every founder gets asked: *"how do
you stay in business when you've open-sourced everything?"*

Answer: we open-sourced the **interop**, not the **identity**. Anyone
can integrate. Only the conforming, trademark-licensed deployments
can call themselves Sigvault.

## The conformance vectors

`qv-spec/test-vectors/vectors.json` contains 24 vectors today:

- 15 chain-advance vectors (5 seeds × 3 lengths) — they exercise the
  SHA3-256 ratchet exactly the way a token issuer would.
- 9 claims-validation vectors (one per `CLAIMS_*` error code).

Run them with the bundled harness:

```bash
node qv-spec/test-vectors/harness.mjs
# PASS chain.advance.001
# PASS chain.advance.002
# …
# harness: 24 pass, 0 fail, 0 skipped, 24 total (spec 1.0)
```

A SDK in any language is *Sigvault Verified* when it implements
`runners` for each `kind` and produces the same pass count against
the published `vectors.json` for the release it claims to support.

The harness is intentionally tiny so the Go / Rust / Python / Java /
.NET / Ruby ports are mechanical: parse JSON → switch on `kind` →
compare result to `expect`. Roughly 200 lines per language.

### What's not (yet) in the vectors

- **Token issue / verify round-trips.** That requires a deterministic
  ML-DSA-87 signing path, which means seeding `noble-post-quantum`'s
  CSPRNG. Phase 5 ships that in a follow-up PR alongside the Go SDK.
- **AEAD encryption fixtures.** Same reason — `XChaCha20-Poly1305` is
  deterministic given the nonce, but our reference SDK currently
  draws the nonce from `randomBytes(32)` inside `issueToken`. We'll
  expose a deterministic-nonce path for fixture generation.

The shipped 24 vectors cover the pieces a third-party SDK is most
likely to get wrong: the chain ratchet (off-by-one bugs in the
counter, byte-order mistakes in the SHA3 input) and claims
validation (every `CLAIMS_*` code).

## The trademark

We will register **"Sigvault"** + the logo as a trademark in the
software class. After registration:

- Anyone can fork the source. BUSL-1.1 permits that.
- A fork **cannot** call itself "Sigvault." It can call itself
  anything else — "Postern", "Phylakto", "Krcsvault" — and it can
  even claim *Sigvault-compatible* (the way "PostgreSQL-compatible"
  describes Aurora). It just can't be Sigvault.
- A conforming SDK gets a no-fee licence to display the **Sigvault
  Verified** badge once its conformance harness passes against the
  published vectors. That badge expires per release line; SDKs must
  re-test on each minor.

The trademark + the badge are the two levers that prevent a hyperscale
cloud from launching "QV-as-a-Service" the day after we cut v4.3.0.

## The source licence — BUSL-1.1

Active components ship under **Business Source Licence 1.1** with an
additional-use grant. Plain English:

- **You can:** read, audit, fork, modify, run on your own infrastructure,
  ship inside your own product, contribute back.
- **You cannot:** offer it as a hosted service in competition with us
  during the licence's active period.
- **After 4 years**, each release converts to **Apache-2.0**
  retroactively. The clock starts at the release date, not the
  modification date — so v4.3.0 becomes Apache-2.0 in April 2030.

The companion `LICENSE-ADDITIONAL-USE-GRANT.md` (shipping with v4.3.0)
spells out the grant: production use is unrestricted *unless* you are
operating Sigvault as a Service (SVaaS) for third parties. Internal
production by your own organisation is always permitted — there is no
seat or revenue threshold.

This is not a novel position. HashiCorp Vault, Sentry, MongoDB,
Elastic, CockroachDB, Couchbase, Redis Labs, and Confluent all
arrived at variations of the same answer between 2019 and 2024.
Operators have built workflows around it; auditors recognise it.

### Why not pure Apache-2.0?

We would, if hyperscalers had not made the original-author bargain
unsustainable in adjacent markets. The BUSL is what they earned.

### Why not AGPL-3.0?

AGPL is fine for libraries inside applications that *also* go
copyleft. It is hostile to the customers we want — security teams in
finance, infrastructure teams in regulated industries, anyone whose
internal compliance review has a hard "no copyleft" rule. BUSL trades
some adoption friction for *less* adoption friction in the markets
where we actually want users.

### Why not "available" with no commercial restriction?

Because "no commercial restriction" is exactly the door through which
QV-as-a-Service walks. We've watched that movie.

## Adjacent licences in the repo

| Component | Licence |
|-----------|---------|
| `qv-server`, `qv-core` | BUSL-1.1 with additional-use grant (from v4.3.0) |
| `qv-sdk` (npm package) | Apache-2.0 |
| `qv-sdk/{go,java,php,csharp,ruby,python}/` adapter clients | Apache-2.0 |
| `qv-spec/` (OpenAPI, wire format, error registry, vectors) | CC BY 4.0 |
| `qv-ops/helm/`, `qv-ops/scripts/` | Apache-2.0 |
| `docs/story/` | CC BY 4.0 |

The asymmetry is deliberate: SDKs and integration artefacts must be
maximally permissive (clients should never have to call legal to
adopt), specifications must be maximally citeable (so other
implementations exist), and only the *server* — the operationally
load-bearing component — sits under BUSL.

## The composite picture

```
            ┌──────────────────────────────────────────┐
            │   qv-spec/   (CC BY 4.0)                 │
            │   ─────────────────────                  │
            │   OpenAPI + wire format + error codes    │
            │   + test vectors                         │
            └────────────┬─────────────────────────────┘
                         │
            ┌────────────┴─────────────────────────────┐
            │                                          │
            ▼                                          ▼
   ┌──────────────────────┐             ┌──────────────────────┐
   │  Any-language SDK    │             │  Any-language SDK    │
   │  (Apache-2.0)        │             │  (Apache-2.0)        │
   │   ┄ pass conformance │             │   ┄ pass conformance │
   │     vectors → badge  │             │     vectors → badge  │
   └─────────┬────────────┘             └─────────┬────────────┘
             │                                    │
             ▼                                    ▼
   ┌──────────────────────────────────────────────────────────┐
   │   qv-server  (BUSL-1.1 + additional use grant)           │
   │   ────────────────────────────────────────────           │
   │   The token issuer / verifier. The licence boundary.     │
   │   Operationally drop-in. Forkable. Brand-protected.      │
   └──────────────────────────────────────────────────────────┘
```

## What an operator gets

If you adopt Sigvault you get, in writing:

1. **An open contract**: build clients, write SDKs, run audits, fork
   if you want — under permissive terms.
2. **A protected brand**: "Sigvault" in your runbook means the same
   thing in 2026 and 2030.
3. **A clear runway**: BUSL converts to Apache-2.0 four years from
   release. There is no rug-pull mechanism.
4. **A conformance gate**: any SDK / verifier you depend on that
   claims Sigvault compatibility has run the same vector battery you
   can run yourself.

## What we get

A sustainable enough position that we can keep the spec free, the
SDKs free, the docs free, and the server source readable.

That's the deal. The next chapter (22) lays out the v4.4 roadmap —
the multi-writer ChainStore, the Operator (CRD), the OTLP bridge,
the Go SDK, and the kid-in-header wire-format change. None of it
disturbs anything in this chapter.
