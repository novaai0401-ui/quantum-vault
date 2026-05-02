# Sigvault Roadmap

This document is the **product-owner view** of what's shipped, what's
broken, and what's coming next. It is kept in sync with open GitHub
milestones and issues.

Last updated: **2026-04-20** (v4.2.0 shipped).

---

## Where we are: v4.2.0

Shipped across 5 registries:

- **npm** — `@sigvault/sdk`, `@sigvault/wasm`
- **PyPI** — `sigvault` (REST client)
- **crates.io** — `qv-core` (ML-DSA-87 + Falcon-512/1024)
- **GHCR** — `ghcr.io/007krcs/qv-server:4.2.0` (multi-arch)
- **GitHub Releases** — prebuilt `libqv.{so,dylib,dll}` for 5 platforms

See [`CHANGELOG.md`](./CHANGELOG.md) for the full list of v4.2 changes.

---

## Known limitations in v4.2.0

Grouped by domain, ordered by blocker severity.

### Cryptographic / protocol

| ID | Limitation | Impact |
|----|------------|--------|
| **C-1** | MutationChain is single-writer. | Horizontal scaling breaks replay protection. |
| **C-2** | No `kid` (key id) in the token header. | Verifiers must scan every key on rotation. |
| **C-3** | `encryptKey` is shared across issuer + all verifiers. | Compromise of one verifier exposes every claim ever issued. |
| **C-4** | Master key sits in an env var or plaintext file. | No KMS / HSM / OS-keyring integration. |
| **C-5** | Revocation is in-memory only. | Restart loses revocations. |
| **C-6** | No third-party cryptographic audit. | Enterprise adoption blocker. |
| **C-7** | Falcon FP sampler side-channel posture is inherited from PQClean, not independently measured. | Known weakness category. |
| **C-8** | `SuiteId::Dual` / `Triple` reserved but not implemented. | No hybrid defense-in-depth path. |

### Operational / server

| ID | Limitation | Impact |
|----|------------|--------|
| **O-1** | JSON file keystore; no fsync discipline documented. | Data loss risk on crash. |
| **O-2** | No metrics (Prometheus / OpenTelemetry). | Operators blind. |
| **O-3** | No audit log. | Fails every compliance regime. |
| **O-4** | No rate-limiting / request-size caps. | Trivial DoS vectors. |
| **O-5** | No readiness vs liveness split. | K8s routes traffic to cold pods. |
| **O-6** | No graceful-shutdown in-flight drain. | Rolling deploys drop requests. |
| **O-7** | No HA / clustering. | Vertical scale only. |

### Integration / ecosystem

| ID | Limitation | Impact |
|----|------------|--------|
| **I-1** | No OIDC / OAuth2 compatibility layer. | Can't drop into Okta/Auth0/Entra stacks. |
| **I-2** | No `/.well-known/jwks.json`-equivalent. | nginx auth-request, Envoy JWT filter can't consume. |
| **I-3** | Claims are CBOR; tooling is JSON. | Debugging friction. |
| **I-4** | PyPI package is REST-only (no native bindings). | Python backends must run qv-server alongside. |
| **I-5** | No framework middlewares (Express / Fastify / axum / FastAPI / Django / ASP.NET / Spring). | Every adopter writes boilerplate. |
| **I-6** | No Helm chart, no Terraform module. | DevOps adoption friction. |
| **I-7** | No signed artifacts / SLSA provenance. | Supply chain unverifiable. |
| **I-8** | No SBOM (CycloneDX / SPDX). | Fails procurement reviews. |

### Developer experience

| ID | Limitation | Impact |
|----|------------|--------|
| **D-1** | Docs site has no search. | Findability suffers. |
| **D-2** | No version selector in docs. | Old-version users get new-version info. |
| **D-3** | No API playground beyond the single live demo. | Evaluation friction. |
| **D-5** | No published benchmark suite. | Can't quantify trade-offs. |
| **D-6** | No "Migrating from JWT" cookbook. | Adoption friction. |
| **D-7** | No changelog until now. | Users don't know what moved. |

### Governance

| ID | Limitation | Impact |
|----|------------|--------|
| **G-1** | No SECURITY.md (addressed in v4.2.1). | Disclosure has no clear path. |
| **G-2** | No CODEOWNERS (addressed in v4.2.1). | Bus factor = 1. |
| **G-3** | No release-cadence or LTS commitment. | Enterprises can't plan. |
| **G-4** | No community forum (Discussions / Discord). | Q&A has nowhere to live. |

---

## Milestones

### v4.3 — "Production-ready server" *(~6 weeks)*

Theme: **you can actually deploy qv-server to a K8s cluster.**

| Req | Description | Fixes |
|-----|-------------|-------|
| **R-4.3.1** | Pluggable keystore: `file` (hardened), `sqlite`, `postgres`, `redis`. | O-1 |
| **R-4.3.2** | Pluggable MutationChain backend (`postgres` / `redis`), multi-replica safe. | **C-1**, O-7 |
| **R-4.3.3** | `kid` (key id) in token header; O(1) verifier lookup. | C-2 |
| **R-4.3.4** | Persistent revocation list. | C-5 |
| **R-4.3.5** | Prometheus metrics at `/metrics`. | O-2 |
| **R-4.3.6** | Structured JSONL audit log. | O-3 |
| **R-4.3.7** | `/v3/health/live` + `/v3/health/ready` split. | O-5 |
| **R-4.3.8** | Graceful SIGTERM shutdown with in-flight drain. | O-6 |
| **R-4.3.9** | Per-IP token-bucket rate limits + request-size caps. | O-4 |
| **R-4.3.10** | Helm chart published to `ghcr.io/007krcs/charts`. | I-6 |

**Success metric:** qv-server passes a 10-replica K8s deployment with a
chaos-engineering suite (pod kill, network partition) without
token-acceptance anomalies.

### v4.4 — "Enterprise integration" *(~6 weeks after v4.3)*

Theme: **drop into an existing IdP-centric stack.**

| Req | Description | Fixes |
|-----|-------------|-------|
| **R-4.4.1** | `/.well-known/jwks.json` discovery with `MLDSA87` / `FN512` / `FN1024` `alg` values. | I-2 |
| **R-4.4.2** | JWT-shaped compatibility mode (header.payload.signature, base64url). | I-1, I-3 |
| **R-4.4.3** | Framework middlewares: Express, Fastify, axum, tower, FastAPI, Django. | I-5 |
| **R-4.4.4** | OIDC bridge — accept IdP JWTs, re-issue as QV tokens. | I-1 |
| **R-4.4.5** | KMS/HSM master-key backends (AWS KMS, GCP, Azure KV, Vault Transit, PKCS#11). | C-4 |
| **R-4.4.6** | Sigstore / cosign artifact signatures + SLSA Level 3 provenance. | I-7 |
| **R-4.4.7** | CycloneDX SBOM attached to every release. | I-8 |

**Success metric:** one Fortune-500 pilot using AWS KMS + OIDC bridge + Fastify middleware.

### v4.5 — "Python native + multi-tenancy" *(~4 weeks after v4.4)*

| Req | Description | Fixes |
|-----|-------------|-------|
| **R-4.5.1** | Native Python wheels via cibuildwheel + libqv (`QVLocal` class). | I-4 |
| **R-4.5.2** | Multi-tenant organizations (`orgId` scoping). | (new) |
| **R-4.5.3** | Per-verifier encrypt keys via ML-KEM-1024 envelope encryption. | C-3 |
| **R-4.5.4** | Hybrid `Dual` suite implementation (ML-DSA-87 + Ed25519). | C-8 |

**Success metric:** `pip install sigvault` issues & verifies
offline at >10 k ops/sec on a laptop; per-verifier encryption
end-to-end.

### v5.0 — "Audited & compliant" *(Q3)*

| Req | Description | Fixes |
|-----|-------------|-------|
| **R-5.0.1** | Third-party cryptographic audit (Trail of Bits / NCC). | C-6, C-7 |
| **R-5.0.2** | FIPS 140-3 module submission (`qv-core-fips` variant). | (new) |
| **R-5.0.3** | CMVP listing. | (new) |
| **R-5.0.4** | RFC-style formal spec (wire format, MutationChain, replay window). | (new) |
| **R-5.0.5** | SemVer MAJOR-stability commitment + 18-month LTS per MAJOR. | G-3 |
| **R-5.0.6** | SECURITY.md with GPG + optional bug bounty. | G-1 |

**Success metric:** ship 1.0-stable wire format; published audit; at
least one regulated-industry customer.

---

## What gets cut first

If bandwidth halves: ship **only v4.3**. The single-writer
MutationChain (C-1) and the file keystore (O-1) are the two things
preventing any production deployment today. Everything else is
optimization.

---

## Out of scope (for now)

Items explicitly *not* on the roadmap so expectations don't drift:

- A browser-based key management UI — the REST API is the interface.
- Token-introspection proxies for legacy OAuth2 RS.
- BLS / threshold signatures.
- Cross-chain bridge / blockchain integrations.
- GUI desktop client.

If any of these matter to you, open a GitHub Discussion — we'll revisit
once v4.3 ships.
