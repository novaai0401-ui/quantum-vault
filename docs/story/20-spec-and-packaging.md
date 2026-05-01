# Chapter 20 — The Public Contract and the Container

## The story

Up to now, "use QuantumVault" meant "read the qv-server source." That
is fine for the founder and the first ten adopters. It is not fine
for an SDK author in Go, an enterprise security team in finance, or
a regulator who needs to audit what you ship without trusting your
prose.

This chapter is about the artefacts that make QuantumVault
*portable*: the OpenAPI spec, the wire-format document, the error
code registry, the reproducible Dockerfile, the Helm chart, and the
SBOM that proves the zero-dependency claim.

You cannot copy our architecture from the spec alone. You can build
against it, write a conforming SDK in any language, and run a
hardened production deploy in any cluster. That is the deal.

## The four artefacts

### 1. `qv-spec/openapi.yaml`

OpenAPI 3.1, lossless. Every endpoint, every status code, every error
envelope. Authentication modes are tagged with `securitySchemes` so
clients (and codegen tooling like `oapi-codegen`,
`openapi-typescript`, `openapi-generator`) can render typed clients
in any language.

We do not generate it from code. We hand-write it and the test suite
validates it stays in sync. (A v4.4 task is to add a CI check that
reflects every `route(...)` in `server-sovereign.mjs` to the spec.)

### 2. `qv-spec/wire-format.md`

The byte-level token layout. This is the hard part to get right and
the one document an SDK author cannot succeed without. It specifies:

- Magic, version, suite-byte, token-type-byte (with a registry).
- The exact 88-byte header layout, big-endian.
- The variable-length encrypted payload + 8-byte trailing counter.
- The signature region's bounds.
- The MutationChain ratchet formula
  (`state_n = SHA3-256(state_{n-1} || ctr_{n-1}_be64)`).
- The KOLMOGOROV nonce-entropy floor.
- Conformance MUSTs and SHOULDs.

A competent engineer writes a verifier in any language in a day from
this document.

### 3. `qv-spec/error-codes.md`

The stable error-code registry. Clients branch on
`error.code`; never on `error.message` (prose), HTTP status alone, or
stack traces. Codes never change spelling. New codes are additive.
Deprecated codes are announced, kept for ≥1 minor release, then
removed.

### 4. *(coming v4.3.0)* `qv-spec/test-vectors/`

Cross-language `(input, expected output)` fixtures. ~200 pairs:

- Token serialise / deserialise round-trips.
- Verify-success / verify-fail.
- Replay / counter / kolmogorov rejection paths.
- Each error-code path (one test per code).

Pass them all → your SDK gets the "QV Verified" badge.

## The container — `qv-server/Dockerfile`

Reproducible build:

```bash
docker build \
  --build-arg SOURCE_DATE_EPOCH=$(git log -1 --format=%ct) \
  -t qv-server:$(git rev-parse --short HEAD) .
```

The image is intentionally boring:

- `node:20.18.1-alpine3.20` base. Pinned full digest, not `:latest`.
- One non-root user (`qv`, uid/gid 10001).
- COPY of the 16 runtime `.mjs` files. **Nothing else.** No
  `node_modules`, no `package-lock.json`, no `npm install`.
- `/data` volume for the keystore and chain logs.
- Healthcheck on `/v3/live`.

Image weight: ~60 MB. Most of that is the Node.js binary. The
QuantumVault payload is roughly 180 KB of source.

## The chart — `qv-ops/helm/quantum-vault/`

A minimum-viable Helm chart. Defaults are safe-by-default:

- `replicaCount: 1` — because the MutationChain is single-writer.
- StatefulSet with stable identity (don't lose your chain log to a
  Pod recycle).
- PersistentVolumeClaim mounted at `/data` (1 GiB default; tune
  upward).
- Liveness / readiness probes wired to `/v3/live` and `/v3/ready`.
- `runAsNonRoot`, `readOnlyRootFilesystem`, `seccompProfile`,
  `capabilities.drop: [ALL]`.
- An `emptyDir` `tmpfs` mount at `/tmp` (size 16 MiB) so the
  container's root FS can stay read-only.
- `envFrom: secretRef` — operator supplies the admin token hash and
  master key (env or exec) via a Secret.

What the chart deliberately does NOT bundle:

- An Ingress. Operators decide on Cilium / Calico / Linkerd / Istio
  / Cloudflare Tunnel. We don't pretend to know.
- An admission webhook. Same reason.
- Network policy. Same reason.

Roadmap v4.4 ships an Operator (CRD `QuantumVault`) for shops that
want lifecycle automation rather than a chart.

## The SBOM — `qv-ops/scripts/sbom.mjs`

```bash
node qv-ops/scripts/sbom.mjs > sbom.cdx.json
```

CycloneDX 1.5. Every shipped file gets SHA-256 and SHA-512 hashes.
The `dependencies` array has exactly one entry — the qv-server
component itself — and it `dependsOn: []`. That empty array IS the
SBOM. The auditor's job is to match the file hashes against the
release tarball and verify there's nothing else inside the image.

A unit test (`test/sbom.test.mjs`) asserts:

- The script exits 0.
- The output parses as JSON with `bomFormat: "CycloneDX"`,
  `specVersion: "1.5"`.
- Every component has both `SHA-256` and `SHA-512`.
- `dependencies[0].dependsOn` is the empty array.
- The `qv:zero-dependency=true` metadata property is present.

If anyone ever adds an npm dependency, this test will fail loudly —
which is the whole point.

## Reproducibility checklist

Before cutting v4.3.0:

- [ ] Pin Node.js base image by digest (currently version-tag pinned;
      digest pin is a v4.3.0-rc step).
- [ ] `cosign sign` the image with a hardware-backed key.
- [ ] Attach the SBOM as an OCI artefact (`cosign attach sbom`).
- [ ] Tag the git commit with a GPG-signed annotated tag.
- [ ] Publish a signed release manifest containing:
  - image digest,
  - SBOM digest,
  - source tarball SHA-256,
  - public verification key.

This makes "did I run the real qv-server?" a one-command answer for
any operator: `cosign verify` + SHA-256 match.

## The contract, restated

- **Open**: `qv-spec/` is CC BY 4.0. SDKs are Apache-2.0. Anyone can
  build with QuantumVault without our permission.
- **Auditable**: SBOM proves zero deps. Reproducible Dockerfile
  proves the image equals the source. Cosign proves the image equals
  the publisher's intent.
- **Sovereign**: nothing in any of these artefacts requires a paid
  service from us. Run it on your laptop, in your DC, in air-gap.

The next chapter (21) covers what we *don't* open up — the
licence boundary, the trademark, the conformance mark, and the
patent strategy that lets the project stay viable while the spec
itself is free.
