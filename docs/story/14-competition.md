# Chapter 14 — Competitive Landscape

## The story

"Why not just use Auth0?" is the reasonable first question. We answer
it here, product by product. We don't claim Sigvault is better
at everything — it isn't. We claim it is **uniquely positioned** on
four dimensions that matter for the next decade of identity:

1. Post-quantum ready **today**
2. Zero npm dependencies
3. Sovereign data-plane (you own the keys, you own the state)
4. Replay-proof tokens structurally, not by bolt-on cache

## Auth0 (Okta CIC)

**Strengths.** Mature SaaS, excellent social-login UX, enterprise
SSO, MFA, adaptive MFA, bot detection. The best-in-class choice for
consumer identity today.

**Weaknesses.**
- Proprietary infrastructure — your keys live on their servers.
- No post-quantum roadmap publicly committed.
- Pricing scales per-MAU (monthly active user), not per-load.
- Audit logs are theirs, not yours.
- Customisation is confined to Rules / Actions in a JS sandbox.

**When QV wins.** When you need to *own* the issuer, when post-quantum
is a contractual obligation, when MAU pricing is prohibitive
(e.g., machine-to-machine auth for a fleet of devices).

**When Auth0 wins.** Consumer-facing apps with human authentication,
social logins, passwordless flows. QV does not do any of that — it
is an issuer, not an IdP.

## Okta (Workforce Identity)

Same strengths/weaknesses as Auth0 (same company since 2021) with
more enterprise features: SCIM provisioning, advanced session
management, HR-system integration.

**When QV wins.** Machine identity, service-to-service, API gateways.
**When Okta wins.** Corporate SSO, workforce lifecycle management.

## HashiCorp Vault

**Strengths.** Secret management platform. Excellent plugin model,
transit secrets engine, strong community, rich policy language,
native replication (Enterprise).

**Weaknesses.**
- Not a token issuer — Vault's tokens are opaque, server-side lookups.
- PKI plugin exists but still pre-quantum.
- Operational complexity: sealing, unsealing, Raft coordination.
- Per-request latency higher than a local cryptographic verify.

**When QV wins.** You need **stateless token verification** at the
edge (every gateway verifies without calling home) with
**post-quantum signatures**. This is exactly what JWT promised but
QV actually delivers.

**When Vault wins.** Centralised secret storage, database credential
rotation, PKI issuance for internal TLS, envelope encryption as a
service.

**Can they coexist?** Absolutely. Run QV for token issue/verify;
run Vault for the rest. `QV_MASTER_KEY_HEX` can be sourced from
Vault's transit engine via an env-injection tool.

## Keycloak

**Strengths.** Open-source IdP, excellent OIDC/SAML support, realm
model, extensive admin UI, federates with LDAP/AD.

**Weaknesses.**
- Heavy (JVM, Quarkus, H2/PostgreSQL).
- Pre-quantum signing (RS256, ES256).
- Large attack surface — every OIDC/SAML feature is code.
- Scaling requires coordinated cache (Infinispan).

**When QV wins.** Machine-to-machine, where SAML/OIDC is overkill
and post-quantum matters.
**When Keycloak wins.** You need a full OIDC IdP with an admin UI
and enterprise federation.

## AWS IAM / Cognito

**Strengths.** AWS integration, scale, regional failover, SigV4 for
service calls.

**Weaknesses.**
- AWS-specific.
- Cognito is infamous for cold-start latency and operational surprises.
- SigV4 is pre-quantum.

**When QV wins.** Multi-cloud or on-prem; sovereignty requirements.

## Raw JWT (any library)

**Strengths.** Ubiquitous, standardised, every language has a library.

**Weaknesses.** All of Chapter 1. No post-quantum. No replay
protection. No claims confidentiality. The "secrets in base64" UX
invites mistakes.

**When QV wins.** Always, if you care about the next decade.
**When raw JWT wins.** You need interop with a caller that only
speaks JWT and you can't influence their stack. In that case, issue
both: a QV token for your own infrastructure and a JWT for the
legacy peer.

## PASETO / Branca / Macaroons

**Strengths.** Modern token formats that fix specific JWT mistakes
(algorithm confusion, JWK complexity, opaque claim binding).

**Weaknesses.**
- Ed25519-based: pre-quantum.
- Ecosystems are smaller.
- No server-side state binding (no MutationChain analogue).

**When QV wins.** Post-quantum requirement, replay-proof requirement.
**When PASETO wins.** You've already standardised on it internally
and don't have a PQ mandate.

## AWS KMS

**Strengths.** HSM-backed, FIPS-validated, tight IAM integration.

**Weaknesses.** You're signing per-API-call, costs and latency add
up. No token format — KMS signs bytes, you build the envelope.

**Can they coexist?** KMS can hold the master key; QV draws from
KMS envelope-unwrap on boot to decrypt `master.key`. Roadmap: v4.4.

## The feature matrix

| Feature | Auth0 | Vault | Keycloak | JWT | PASETO | **Sigvault** |
|---------|-------|-------|----------|-----|--------|------------------|
| Post-quantum signatures | No | No | No | No | No | **Yes (ML-DSA / Falcon)** |
| Claims AEAD-encrypted | No | N/A | No | No | Only v*.local | **Yes** |
| Replay-proof structurally | No | N/A | No | No | No | **Yes (MutationChain)** |
| Zero npm deps | N/A | N/A | No | No | No | **Yes** |
| Sovereign (you own keys) | No | Yes | Yes | Yes | Yes | **Yes** |
| Stateless verify | No | No | Partial | Yes | Yes | **Yes** |
| Rate limit built-in | Yes | Yes | Partial | No | No | **Yes (4 buckets)** |
| CIDR allowlist (OSS) | No | Enterprise | No | N/A | N/A | **Yes** |
| Prometheus metrics | Dashboards | Yes | Via JMX | N/A | N/A | **Yes (built-in)** |
| W3C traceparent out-of-box | No | Partial | Partial | No | No | **Yes** |
| JSONL audit + rotation | Proprietary | Yes | DB | N/A | N/A | **Yes** |
| FIPS-approved primitives | Partial | Yes | Yes | RS256 | No | **FIPS 204/206 + AES-256** |
| Size | SaaS | ~100 MB | ~400 MB | lib | lib | **~180 KB source** |

## Pricing comparison (rough)

- **Auth0/Okta**: $23–$240/mo per 1 000 MAU; enterprise is 5–7 figures.
- **Keycloak**: Free (self-host). TCO: ~1–2 FTE for operational
  maintenance.
- **Vault**: Free (OSS) / $12/hour (HCP) / 6-figure enterprise.
- **Sigvault**: Free (OSS). TCO: significantly lower because
  single-binary, zero-dep. Roadmap includes managed-SaaS tier (v5).

## When to pick Sigvault specifically

- **You sign machine-to-machine tokens** at scale (IoT fleets, service
  meshes, API gateways).
- **You have a post-quantum mandate** in contract or compliance.
- **You want to own your key material** (data residency, sovereignty
  requirements, FedRAMP High, Criteria Common).
- **You need replay-proof tokens** without adding a replay cache.
- **You're OK with "this is an issuer, not an IdP"** — QV does not
  do social login, passkeys, or enrollment flows. It issues and
  verifies tokens against existing identity.

## When to pick something else

- **Consumer-facing login flows** — Auth0 / Okta / Clerk.
- **Full IdP with SSO federation** — Keycloak / Auth0 / Azure AD.
- **General-purpose secret vault** — HashiCorp Vault.
- **On-chain identity** — a different design space entirely.

Next: Chapter 15, [Known Limitations](./15-limitations.md).
