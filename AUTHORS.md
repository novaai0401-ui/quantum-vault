# Authors

Sigvault is built and maintained by the people listed below, plus
everyone in the `git log` history of this repository.

## Maintainers

- **007krcs** — original author, project lead

## Contributors

Significant contributions appear here as they land. To propose a name
add it in a PR alongside your contribution; the git history is the
authoritative record.

(none yet — this file was added in v4.3.0)

## Acknowledgements

- **The Noble project** (paulmillr.com) — `@noble/post-quantum`,
  `@noble/ciphers`, and `@noble/hashes` are the only npm runtime
  dependencies of `qv-sdk`. Choosing them over alternatives was
  load-bearing for the zero-dep posture.
- **PQClean / pqcrypto-falcon** — Falcon implementation used in
  `qv-core`.
- **The Sigstore project** — cosign powers the keyless signing pipeline.
- **The CNCF / OpenTelemetry community** — the OTLP/JSON spec is what
  let us ship `otlp.mjs` zero-dep.

## Reporting

To request a correction or addition to this file, open a PR or file
an issue. Maintainers review monthly.
