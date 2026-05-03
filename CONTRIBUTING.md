# Contributing to Sigvault

Sigvault ships cryptographic infrastructure that other people's
production systems depend on. Contributions are welcome, and the bar
is correspondingly high.

## The non-negotiables

These rules exist because of real, specific incidents in the broader
ecosystem (XZ-utils backdoor 2024, npm `event-stream` 2018, axios
prototype-pollution 2023, leftpad 2016). They are not negotiable.

### 1. Zero npm dependencies in `qv-server`

`qv-server/package.json` declares `"dependencies": {}`. The SBOM test
(`qv-server/test/sbom.test.mjs`) asserts that the dependency graph
stays empty. **A PR that adds a runtime npm dependency to qv-server
will not merge.** If you genuinely need a new primitive, the answer is
to write it from `node:` stdlib, not to import it.

### 2. Zero npm dependencies in `qv-sdk`

The SDK's only allowed runtime imports are:
- `@noble/post-quantum` (ML-DSA, audited by Cure53 + Trail of Bits)
- `@noble/ciphers` (XChaCha20-Poly1305, same authors, same audits)
- `@noble/hashes` (SHA3, same authors, same audits)

**No other imports. No transitive expansion of these.** The Noble
suite is the most conservatively-vendored crypto library on npm —
zero deps, single author surface, regular audits. We reverify the lockfile
on each release.

### 3. Zero new dependencies in any language adapter

Python (`qv-python/`) uses `urllib` from stdlib. Go uses `net/http`.
Java uses `java.net.http.HttpClient` (JDK 11+). PHP uses `curl_*`
built-ins. C# uses `System.Net.Http.HttpClient` (BCL). Ruby uses
`net/http`. **None of these may pull in a third-party HTTP library or
JSON parser.** If a language's stdlib genuinely cannot do the job,
file an issue and we'll discuss; the answer is usually to write the
needed code in 30 lines rather than pull in a library.

### 4. The wire format is frozen at v3.0

Magic `0x51564C54`, version `0x0300`, and the byte layout in
`qv-spec/wire-format.md` are immutable for the v4.x line. Adding
fields requires a wire-format major bump, which is a v5.0 conversation,
not a PR conversation.

### 5. Tests fail closed

If a security feature can be silently disabled by an environment
variable, that variable must default to **on**. We will not merge a
feature whose default state silently weakens the security model.

### 6. No secrets in logs, tests, error messages, or audit events

The audit log explicitly maintains a sensitive-key blocklist
(`qv-server/audit.mjs:SENSITIVE_KEYS`). Tests that print bearer
tokens, signing keys, or master-key bytes will be rejected.

## Workflow

### Filing an issue

1. **Security issues** → see [SECURITY.md](./SECURITY.md). Do **not**
   open a public issue.
2. **Bug** → include: version (`git rev-parse HEAD`), platform, the
   exact steps to reproduce, and what you expected vs got.
3. **Feature request** → describe the *operator* problem first, the
   *implementation* second.
4. **Documentation** → just open a PR.

### Filing a PR

1. Fork, branch off `main`, named `feat/<area>-<summary>` or
   `fix/<area>-<summary>`.
2. **One concern per PR.** Refactors in their own PRs.
3. Run `cd qv-server && npm test` locally. All tests must pass.
4. If you added a new module, add tests for it. The repo norm is
   ~5–15 unit tests per module + 1–4 integration tests per
   feature.
5. If you changed wire format, error codes, or HTTP shapes, update
   `qv-spec/` in the same PR. Spec drift fails CI.
6. Sign your commits (`git commit -S`). We do not require a CLA but
   we do require DCO-style attribution (`git commit -s`).
7. PR title is conventional-commits: `feat(server): …`,
   `fix(sdk): …`, `docs: …`, `chore(brand): …`.

### Review SLAs

- Trivial PRs (typo, doc fix): 48 hours.
- Feature PRs: best-effort within a week. Big features may need a
  design discussion in an issue first.
- Security PRs: same-day triage.

## Coding style

### JavaScript / TypeScript

- **Modules**: ESM only. No CommonJS.
- **Imports**: prefix `node:` for stdlib (`node:fs`, `node:crypto`).
- **Async**: top-level `await` in scripts is fine; in modules prefer
  factory functions.
- **No `console.log` in production code paths.** The audit log is the
  only sanctioned channel for runtime events.
- **Fail-closed**: throw on invalid input; never silently coerce.
- **One file per module**, with the public surface at the top and
  helpers below. Use `// SPDX-License-Identifier:` at the top.

### Rust

- `cargo fmt` + `cargo clippy --all-targets --all-features -- -D warnings`
- No `unsafe` outside `qv-ffi/` and `qv-wasm/` boundary glue.
- `#[deny(warnings)]` at crate roots.
- `proptest` for anything taking adversarial input.

### Python (`qv-python/`)

- `python -m py_compile` must succeed on 3.10+.
- Stdlib only. `urllib.request`, `json`, `dataclasses`, `typing`.
- No `requests`, no `httpx`, no `pydantic`.

### Other language adapters

Match the host language's idiomatic style. Stdlib only.

## DCO sign-off

Every commit must carry `Signed-off-by:` (use `git commit -s`). By
signing you confirm:

> The contribution was created in whole or in part by you and you
> have the right to submit it under the open source licence indicated
> in the file; or it is based upon previous work that, to the best of
> your knowledge, is covered under an appropriate open source licence
> and you have the right under that licence to submit that work.

DCO is preferred over a CLA because it requires no separate signature
ceremony and produces a permanent, machine-verifiable trail in `git log`.

## Licensing

By contributing you agree your contribution is licensed under the
licence governing the file you are modifying. See [LICENSING.md](./LICENSING.md):

- `qv-server/`, `qv-core/`, `qv-cli/`, `qv-ffi/`, `qv-wasm/` → AGPL-3.0-only
- `qv-sdk/`, `qv-python/`, `qv-ops/` → Apache-2.0
- `qv-spec/`, `docs/` → CC BY 4.0

## Code of Conduct

See [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md). One sentence: behave.

## Attribution

Significant contributors are listed in `AUTHORS.md` (added v4.3.0).
The git history is the authoritative record.
