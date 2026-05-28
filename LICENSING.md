# Licence Map

Sigvault is a **multi-licence** project. Each component carries the licence
that fits its role. Read this document before integrating; it determines
what you can and cannot do.

| Component | Path | Licence | SPDX |
|-----------|------|---------|------|
| **Server (binary distribution)** | `qv-server/` + `ghcr.io/...:qv-server` | GNU AGPL-3.0-only | `AGPL-3.0-only` |
| Rust core | `qv-core/` | **Dual: Apache-2.0 OR AGPL-3.0-only** | `Apache-2.0 OR AGPL-3.0-only` |
| CLI | `qv-cli/` | **Dual: Apache-2.0 OR AGPL-3.0-only** | `Apache-2.0 OR AGPL-3.0-only` |
| FFI | `qv-ffi/` | **Dual: Apache-2.0 OR AGPL-3.0-only** | `Apache-2.0 OR AGPL-3.0-only` |
| WASM (Rust source) | `qv-wasm/` | **Dual: Apache-2.0 OR AGPL-3.0-only** | `Apache-2.0 OR AGPL-3.0-only` |
| **WASM (npm package)** | `@sigvault/wasm` | **Apache-2.0** | `Apache-2.0` |
| SDK (npm) | `qv-sdk/` → `@sigvault/sdk` | Apache-2.0 | `Apache-2.0` |
| SDK (Python) | `qv-python/` → `sigvault` (PyPI) | Apache-2.0 | `Apache-2.0` |
| SDK adapters (Go, Java, PHP, C#, Ruby) | `qv-sdk/{go,java,php,csharp,ruby}/` | Apache-2.0 | `Apache-2.0` |
| Specification | `qv-spec/` | CC BY 4.0 | `CC-BY-4.0` |
| Documentation | `docs/` | CC BY 4.0 | `CC-BY-4.0` |
| Helm chart, ops scripts | `qv-ops/` | Apache-2.0 | `Apache-2.0` |

The repository's root `LICENSE` file contains the AGPL-3.0 text that
governs the **server binary distribution**. The Rust crates (`qv-core`,
`qv-cli`, `qv-ffi`, `qv-wasm`) are **dual-licensed** under either
Apache-2.0 OR AGPL-3.0-only — consumers choose. Each permissively-
licensed subdirectory carries its own `LICENSE` file.

## Why dual-licensing the crates?

Same pattern used by `tokio`, `serde`, `rand`, and the rest of the
production Rust ecosystem. A consumer who links one of our crates into
their own application picks the licence that fits their distribution:

- A SaaS product, a closed-source desktop app, or a network-facing API
  layer chooses **Apache-2.0** — no source-disclosure obligation, no
  AGPL §13 trigger.
- A copyleft project, or one that already runs under AGPL, may choose
  **AGPL-3.0-only** to keep the licence chain consistent.

We choose AGPL ourselves for the **server binary distribution** because
that's the surface hyperscalers would otherwise free-ride on. Anyone
running our published `qv-server` binary or `ghcr.io/.../qv-server`
image is using the AGPL leg.

**Client crypto libraries** (`@sigvault/wasm`, `qv-ffi`, the SDKs) are
explicitly permissively-licensed because copyleft on a crypto library
breaks adoption — exactly the JWT-alternative positioning we want.

## Plain-English summary

### If you are an operator running Sigvault inside your organisation

Use it. Modify it. Read it. Audit it. There is **no restriction** on
internal use — there is no MAU cap, no revenue threshold, no "phone
home" telemetry, no commercial tier required.

### If you are an SDK author

Build against `qv-spec/` (CC BY 4.0) and the Apache-2.0 SDK packages.
Your client code does not become AGPL just because qv-server is AGPL —
you are calling it over a network protocol, not linking to it. The
spec is **explicitly** licensed for derivative works under CC BY 4.0.

### If you are a backend developer

Pull `@sigvault/sdk` (Apache-2.0) into your service. Your service's
licence is unchanged. You are a *user* of the protocol, not a
modification of the server.

### If you are integrating Sigvault inside a SaaS product

You are running an AGPL-licensed program and exposing its function over
a network (the AGPL trigger). Three options:

1. **Run it as an internal-only service** consumed by your own
   backends — no AGPL trigger, do whatever you want.
2. **Expose it to your end users** — the AGPL §13 obligation kicks in.
   You must offer your users the corresponding source of qv-server +
   any modifications you made. Most SaaS product teams find this
   acceptable because (a) they didn't modify qv-server and (b) the
   source is already public on GitHub.
3. **Negotiate a commercial licence** — see "Commercial licensing"
   below.

### If you are a hyperscaler considering "Sigvault-as-a-Service"

Read AGPL-3.0 §13 carefully. You will be required to release every
modification to qv-server, every line of your control plane that
links to it, and every user-facing service tier under the AGPL. Most
hyperscalers structurally cannot do that, which is the point.

If you want to offer Sigvault as a managed service without that
obligation, contact us for a commercial licence.

## Commercial licensing

A commercial licence (proprietary terms, support SLA, contributor
indemnity) is available for organisations that:

- Need to embed Sigvault in a closed-source product they distribute.
- Need to offer Sigvault-as-a-Service without AGPL §13 source-disclosure.
- Need formal indemnification, an SLA, or audited builds.

Contact: `commercial@sigvault.example` (placeholder until v4.3.0
launch — production address will be set in `SECURITY.md`).

We deliberately do **not** dual-licence the SDKs. Apache-2.0 is fine for
every SDK use case.

## Trademark

"Sigvault" and the Sigvault logo are unregistered trademarks of the
project owner pending registration. Forks may continue using the source
under AGPL but **may not call themselves Sigvault** or use the Sigvault
mark in their distribution.

## File-level SPDX headers

We are progressively adding SPDX-License-Identifier headers to every
source file. Server / core / CLI / FFI / WASM source files carry:

```
// SPDX-License-Identifier: AGPL-3.0-only
```

SDK and spec source files carry:

```
// SPDX-License-Identifier: Apache-2.0
// or
// SPDX-License-Identifier: CC-BY-4.0
```

If you discover a file missing its header, file an issue or open a PR.

## Why this licence mix?

| Goal | How the licence achieves it |
|------|----------------------------|
| Anyone can integrate | Spec under CC BY 4.0; SDKs under Apache-2.0 — zero friction |
| Server is auditable | Source on GitHub, AGPL guarantees recipients keep getting source |
| Forks must rebrand | Trademark-protected name, separate from the source licence |
| Hyperscalers can't free-ride | AGPL §13 forces source disclosure of any hosted modification |
| Operators have certainty | Standard SPDX licences, no custom drafting, no expiring grants |
| Compliance reviews are short | AGPL is in every legal team's database; no novel interpretation needed |

## Compared to the rejected alternatives

- **BUSL-1.1** (HashiCorp/Sentry/MongoDB model): rejected because it
  required a custom additional-grant document, a 4-year release-clock to
  manage per release, and is novel enough that compliance reviews ask
  questions. AGPL solves the same problem with off-the-shelf legal
  text.
- **Pure Apache-2.0 server**: rejected because hyperscalers
  structurally do free-ride on Apache services and we would have to
  fight that asymmetry alone.
- **Closed-source server, only spec + SDKs open**: rejected because
  auditability is a load-bearing claim of Sigvault. The whole point
  is operators can read every line.
- **Elastic Licence 2.0** / **Functional Source Licence** /
  **PolyForm Shield**: each solves the same problem with non-standard
  text. They work, but AGPL-3.0 already does the job and is universally
  understood.

## Frequently asked questions

**Q: I'm putting an `Authorization: Bearer <sigvault-token>` header in
my Go service's HTTP middleware. Is my Go service now AGPL?**

No. Calling a network protocol is not "linking" under AGPL. You are a
user of the qv-server program, not a derivative of its source. Your
service's licence is unaffected.

**Q: I forked qv-server and added two lines to fix a bug. Do I have to
release those two lines?**

If you operate that forked qv-server as a network service exposed to
third parties, yes — that is exactly the AGPL §13 trigger. If you only
run the fork inside your own org, no. Either way, please consider
upstreaming the fix.

**Q: The Helm chart is Apache-2.0 but it deploys an AGPL server. What
licence governs the deployment?**

The chart and the server keep their own licences. The chart's
Apache-2.0 means you can fork the chart, embed it in commercial
tooling, etc. The server inside the chart remains AGPL. They do not
infect each other.

**Q: Can I use Sigvault to issue tokens in a closed-source SaaS?**

Yes — see "If you are integrating Sigvault inside a SaaS product"
above.
