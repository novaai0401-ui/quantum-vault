# Security Policy

QuantumVault is cryptographic infrastructure. A security bug here can
compromise every token ever issued. We take reports seriously and we
won't waste your time.

## Reporting a vulnerability

**Please do _not_ open a public GitHub issue for security problems.**

Preferred channel: **[GitHub Security Advisories](https://github.com/007krcs/quantum-vault/security/advisories/new)**.
This keeps the discussion private, assigns a CVE if applicable, and
lets us coordinate a fix + release.

Alternative channel: email the maintainer at the address listed in the
GitHub profile for [`@007krcs`](https://github.com/007krcs). For
sensitive material, request the maintainer's PGP key in the first
message; we'll reply with the key fingerprint and you can then send
encrypted follow-ups.

### What to include

A good report contains, in order of value:

1. **Affected version(s)** — git SHA, release tag, or `npm ls` /
   `cargo tree` output.
2. **Reproduction** — minimal code or wire bytes that trigger the
   issue. A failing test is gold.
3. **Impact** — what an attacker can do (forge tokens, decrypt
   claims, replay past a MutationChain, DoS the server, exfiltrate
   keys, etc.).
4. **Your analysis** — if you know which primitive / which line / which
   RFC is violated, say so.
5. **Suggested fix** — optional but appreciated.

You do not need to produce a working exploit. A credible description
of the vulnerability is enough.

## Response timeline

| Stage | Target |
|-------|--------|
| Acknowledgement of receipt | **72 hours** |
| Initial triage + severity assessment | **7 days** |
| Fix in a private branch (critical/high) | **14 days** |
| Coordinated public disclosure + patched release | **30 days** from acknowledgement, or sooner if a fix is ready |

If a fix is not feasible in that window (e.g. a protocol-level issue
requiring a spec amendment), we will publish an advisory describing
mitigations while long-term work continues.

## Scope

### In scope
- `qv-core` (Rust library on crates.io)
- `qv-ffi` / `libqv` (C ABI + prebuilt binaries)
- `qv-wasm` / `@quantumvault/wasm`
- `qv-sdk` / `@quantumvault/sdk`
- `qv-server` / `ghcr.io/007krcs/qv-server`
- `quantumvault` (PyPI REST client)
- `qv-docs` (if a doc issue materially misleads users about security posture)
- The GitHub Actions release pipeline and published artifact signatures

### Out of scope
- Denial-of-service from bounded-resource requests (send 10 GB JSON →
  server slows down). These are operational tuning, not vulnerabilities.
- Issues in the consumer's application code that happen to use
  QuantumVault — we'll help diagnose but it's not our CVE.
- Vulnerabilities in third-party dependencies that do not affect
  QuantumVault's attack surface (file an upstream report and let us
  know).
- Social-engineering / physical attacks.
- Missing best-practice HTTP headers on qv-docs.

## Supported versions

| Version | Supported |
|---------|-----------|
| 4.2.x   | ✅ security fixes |
| < 4.2   | ❌ please upgrade |

Starting with **v5.0** each MAJOR will receive **18 months of security
support** as documented in [`ROADMAP.md`](./ROADMAP.md#v50--audited--compliant-q3).

## Disclosure hall of fame

We credit reporters in the advisory and in
[`CHANGELOG.md`](./CHANGELOG.md) unless you prefer to remain anonymous.

_This file is intentionally brief. If anything above is unclear,
ask — we'd rather answer than have you not report at all._
