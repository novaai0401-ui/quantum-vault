# Chapter 1 — The Post-Quantum Countdown

## The story

On October 27, 2024, NIST ratified three post-quantum cryptographic
standards: FIPS 203 (ML-KEM, formerly Kyber), FIPS 204 (ML-DSA,
formerly Dilithium), and FIPS 205 (SLH-DSA, formerly SPHINCS+). A
fourth — Falcon, now being standardised as FIPS 206 — followed close
behind. Three days later the U.S. government's Commercial National
Security Algorithm Suite 2.0 mandated these algorithms for new
classified systems by 2027 and full migration by 2033.

None of that is speculative. What *is* speculative is the timeline of
cryptographically-relevant quantum computers. Estimates from serious
cryptographers range from "never" to "before 2040". The National
Security Agency, the U.S. Department of Defense, the European Union,
the People's Republic of China, and the G7 Cybersecurity Working Group
have all converged on the same operating posture: assume it *will*
happen, and migrate *now*.

Why now, if the machines might be decades away?

Because the attack starts today. It's called **Harvest Now, Decrypt
Later** (HNDL). An adversary records encrypted traffic, session
tokens, VPN handshakes, anything they can touch, and stores it.
When a capable quantum computer comes online — yours, theirs, or
someone's — the stored data is decrypted retroactively. Every token
you issue today that will still be meaningful in 2035 is already
compromised. You just don't know it yet.

**This is why Sigvault exists.**

## What breaks

Every token format in common production use signs with one of:
- RSA (breaks under Shor's algorithm)
- ECDSA / EdDSA (breaks under Shor's algorithm)
- HMAC-SHA256 (doesn't break, but requires a shared secret — unsuitable
  for federated auth and creates blast-radius problems)

Every token format in common use *encrypts* (where it encrypts at all)
with one of:
- AES-GCM (survives — Grover's algorithm halves the key strength, so
  AES-128 becomes ~64-bit effective under quantum; AES-256 stays
  ≥128-bit). **AES-256 is quantum-safe.** AES-128 is not.
- ChaCha20-Poly1305 (same story — safe at 256-bit keys, which is the
  standard).

So the *encryption* side is mostly fine if you use AES-256 or
ChaCha20 with 256-bit keys. The **signing** side is catastrophically
broken.

And unlike TLS — where the harvester has to break a fresh session key
derived from an ephemeral ECDH exchange, which is hard — a JWT signed
with ES256 has its signing key exposed forever. Recover the key once,
forge every token that key has ever signed and every token it will
ever sign until the key is rotated. If your JWT issuer is still
signing in 2035 and a quantum computer arrives, every token you ever
issued under that key is forgeable.

## The three mistakes that made this worse than it needed to be

1. **Long-lived keys.** Most JWT deployments rotate their signing
   keys quarterly at best, annually at typical, never at worst. HNDL
   amplifies across every day that key was active.

2. **No binding to state.** A standard JWT is a pure function of
   `{header, payload, key}`. Given the key, any past or future payload
   can be forged. There is no server-side counter, no replay cache,
   no chain. PASETO improved the algorithm choice but kept the pure-function
   model.

3. **Opaque key provenance.** When an Auth0 or Okta customer asks
   "which keys have ever signed my tokens?", the honest answer is
   "we rotate JWKS, and we don't publish historical keys beyond the
   current set." An attacker who recorded tokens four years ago and
   cracks them in 2035 has no problem — the forged tokens will present
   keys the issuer has long since discarded.

## What Sigvault does instead

Sigvault pairs a post-quantum signature (ML-DSA-87 / Falcon-512 /
Falcon-1024) with three additional safeguards that each alone would
improve on JWT:

1. **AEAD over the claims.** XChaCha20-Poly1305 with a per-key
   encryption key. The payload isn't just authenticated — it's
   *confidential*. A harvested token reveals zero metadata about the
   subject, roles, or tenancy until the encryption key is recovered,
   and that key lives on the server, not in the token.

2. **MutationChain replay protection.** Every key maintains a
   per-key counter and a SHA3-256 chain-state. Every issued token
   embeds the current counter; every verify bumps the counter and
   rolls the state. A replayed token fails not because its signature
   is invalid — it is — but because its counter is stale. This means
   even an attacker who briefly compromises the signing key cannot
   forge tokens with counters they don't control, because the chain
   state is on the server and cannot be synthesised externally.

3. **Revocation as a first-class operation.** `DELETE /v3/keys/:id`
   poisons the key ID. Any future verify against it returns 410
   with a stable error code, not a vague 401. Most JWT stacks bolt
   on revocation via allow-lists or deny-lists that aren't
   consulted on the fast path.

These together mean that even if the ML-DSA-87 signing key leaked
tomorrow in full, an attacker would still need the encryption key
(separate, sealed under AES-256-GCM at rest) to read or forge token
contents, *and* they would need to predict the MutationChain state,
which is infeasible without live write access to the server.

## How to read the countdown

Think of it as three converging deadlines:

| Deadline | What fires | Impact if you don't act |
|----------|------------|-------------------------|
| 2027 | NSA CNSA 2.0 requires PQC for new national-security systems | Contracts require proof of PQC readiness |
| 2030 | Most compliance frameworks expected to add PQC requirements | Audits start failing for RSA/ECDSA-only stacks |
| 2033–2035 | Conservative estimate for CRQC (cryptographically-relevant quantum computer) | Every harvested token is decrypted |

If your tokens live longer than six months (many do — refresh tokens,
service credentials, machine-to-machine auth), you have already run
out of time to plan for 2035. You need to be shipping PQ-signed tokens
in 2026.

## The design

Sigvault's answer:

- A sovereign Node.js REST server with zero npm dependencies, because
  the last thing you want on the critical path of a cryptographic
  primitive is an uncountable set of transitive vendors.
- Post-quantum signing (ML-DSA-87 default, Falcon variants on request)
  with AES-256-GCM envelope encryption at rest and XChaCha20-Poly1305
  AEAD over the claims.
- MutationChain for counter-enforced replay protection.
- A Prometheus metrics surface, W3C Trace Context propagation, JSONL
  structured audit with rotation, CIDR allowlist, per-IP rate limits,
  structural claims validation, and a bounded worker pool.
- Client SDKs in JavaScript/TypeScript, Rust, Python, WebAssembly, and
  C FFI — because the wire format has to outlive any one language
  ecosystem.

## The code

- `qv-core/src/lib.rs` — the reference implementation of the wire
  format. If there's ever a disagreement between an SDK and the
  server, the Rust reference wins.
- `qv-sdk/src/index.mjs` — the JavaScript SDK used by `qv-server`.
- `qv-server/server-sovereign.mjs` — the HTTP surface.

## The evidence

- 195 tests in `qv-server/test/` — `npm test` runs them all in ~18s.
- Five registries ship the artefacts: npm (JavaScript + WASM),
  crates.io (Rust), PyPI, GHCR (Docker), GitHub Releases (native
  libraries).

## The comparison

| Question | JWT (RS256) | PASETO (v4.public) | Sigvault (ML-DSA-87) |
|----------|-------------|--------------------|--------------------------|
| Post-quantum secure signing? | No | No (Ed25519) | Yes |
| Payload confidentiality by default? | No | Only v*.local | Yes |
| Per-token replay protection? | Bolt-on | Bolt-on | Built in (MutationChain) |
| Revocation on fast path? | Bolt-on | Bolt-on | Yes (revoked set) |
| Key material sealed at rest? | Depends on deployment | Depends on deployment | Yes (AES-256-GCM envelope) |
| Zero-dep implementation available? | No | No | Yes |
| Standards body ratification? | RFC 7519 | draft | NIST FIPS 204/206 |

The other formats are fine — for *today*. Sigvault is what you
deploy if you intend the same infrastructure to still be authoritative
in 2035.

Next: Chapter 2, [The Zero-Dependency Oath](./02-zero-deps.md).
