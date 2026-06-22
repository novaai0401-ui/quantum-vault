# Hardening Guide

This document is for operators who need to push Sigvault past its
out-of-the-box security posture into a defence-in-depth posture suitable
for FedRAMP High, PCI, HIPAA, or equivalent regulated workloads.

The defaults are already conservative. The opt-in modes here trade
operational friction for higher assurance.

## Layered defence overview

```
                     Layer                       Mitigates
  ─────────────────────────────────────────────  ───────────────────
  L7   Authoritative WAF / API gateway           DDoS, payload smuggling
  L6   TLS termination (operator-owned)          Eavesdropping, MITM
  L5   CIDR allowlist on admin + metrics         IP-spoof attempts
  L4   Bearer-token + auth-fail rate-limit       Stuffing, brute-force
  L3   Per-IP request rate limits                Abuse, exhaustion
  L2   Body + claims size + shape caps           Resource exhaustion
  L1   Cryptographic primitives (PQ + AEAD)      Forgery, replay, leakage
  L0   Pluggable master key (env / file / exec)  Key extraction at rest
```

## Master key — three deployment tiers

### Tier 1 (default) — `master.key` file

```bash
QV_DATA_DIR=/var/lib/sigvault   # 0700, owned by sigvault user
```

Atomic + fsync writes (`durable.mjs`). 0600 mode. Anyone who can read
the file decrypts every signing key.

### Tier 2 (recommended) — env var sourced from a secrets manager

```bash
export QV_MASTER_KEY_HEX="$(vault kv get -field=hex secret/sigvault/master)"
exec node server-sovereign.mjs
```

The key never touches disk. Anyone who can `cat /proc/<pid>/environ` can
still read it; mitigate with seccomp + no-shell pods.

### Tier 3 (compliance) — exec backend

```bash
export QV_MASTER_KEY_PROVIDER=exec
export QV_MASTER_KEY_EXEC=/etc/sigvault/fetch-master.sh
```

The wrapper script pulls from KMS / Vault / 1Password / sops on every
boot and prints 64 hex chars to stdout. The key never appears in env or
file. See [docs/story/18-secret-managers.md](./docs/story/18-secret-managers.md).

## Memory hardening

### Worker thread isolation

The verify-pool spawns N worker threads (default `cpus().length`). Each
inherits the master key in memory via the encrypt-key parameter. To
reduce blast radius:

```bash
QV_VERIFY_QUEUE_MAX=64    # smaller pool = fewer copies in memory
```

### Process privilege

In Kubernetes:

```yaml
securityContext:
  runAsNonRoot:           true
  runAsUser:              10001
  readOnlyRootFilesystem: true
  allowPrivilegeEscalation: false
  capabilities:
    drop: [ALL]
  seccompProfile:
    type: RuntimeDefault
```

Bare-metal: `systemd` unit with `ProtectSystem=strict`,
`NoNewPrivileges=yes`, `MemoryDenyWriteExecute=yes`,
`PrivateTmp=yes`, `PrivateDevices=yes`.

### Core-dump suppression

Crashes can dump heap to disk including the master key. Suppress:

```bash
ulimit -c 0
echo '|/bin/false' | sudo tee /proc/sys/kernel/core_pattern
```

In Kubernetes: `kernel.core_pattern=|/bin/false` via init container.

## Network surface

### TLS termination

Sigvault speaks plain HTTP. Terminate one hop upstream
(Caddy / nginx / Envoy). Recipes: [docs/story/16-operations.md](./docs/story/16-operations.md).

### Strip inbound `X-Forwarded-For`

If a client sets `X-Forwarded-For` themselves, they can spoof their IP
past the CIDR allowlist. The proxy MUST overwrite, not append:

**nginx:**
```nginx
proxy_set_header X-Forwarded-For $remote_addr;   # NOT $proxy_add_x_forwarded_for
```

**Caddy:**
```caddyfile
header_up X-Forwarded-For {remote_host}
```

### Cross-host writer-lock

Sigvault refuses to start if another live process owns the writer lock
on the same DATA_DIR (single-host). On a shared filesystem (NFS / EFS /
SMB), the writer-lock additionally **verifies its fence on every chain
write** — if a peer steals the lease while the running process is
hanging, it aborts loud (`WRITER_LOCK_LOST`) before corrupting the
chain log.

Cross-host **strict** mode (Phase 3 / v4.4): use a real coordinator —
Postgres `SELECT … FOR UPDATE NOWAIT`, etcd lease+watch, or S3
conditional-put. Roadmap.

## Supply chain

### Pin Docker base by digest

Already done in `qv-server/Dockerfile`:

```dockerfile
FROM node:${NODE_VERSION}@${NODE_DIGEST} AS runtime
```

Verify before `docker pull`:

```bash
docker buildx imagetools inspect node:20.18.1-alpine3.20 \
  | grep -i sha256
```

Update `NODE_DIGEST` whenever the tag is bumped. CI fails the build if
the registry returns a different digest than the dockerfile claims.

### Cosign verify before deploy

Every released image is signed (keyless OIDC). Operators verify before
running:

```bash
cosign verify ghcr.io/novaai0401-ui/qv-server:4.3.0 \
  --certificate-identity-regexp '^https://github\.com/novaai0401-ui/quantum-vault/' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

Pull the SBOM as well:

```bash
cosign download attestation \
  --predicate-type=https://cyclonedx.org/bom \
  ghcr.io/novaai0401-ui/qv-server:4.3.0 > sbom.json
```

### Transitive dependency policy

The server's transitive depth is **0** (zero npm deps). The SDK's depth
is **1** (Noble suite, no transitive expansion). The dep-audit script
(`qv-ops/scripts/dep-audit.mjs`) refuses anything else. Run it on every
push:

```bash
node qv-ops/scripts/dep-audit.mjs
```

CI gates this in `.github/workflows/ci.yml`.

### Fuzz harness

```bash
QV_FUZZ_ITERS=1000000 node qv-server/fuzz.mjs
```

Mutates inputs against `validateClaims`, `parseTraceparent`,
`sanitizeTracestate`, and `matchesAny` (the request-path parsers).
Asserts no unstructured throws, no partial returns, no >100 ms parses.
CI runs a 10k smoke; nightly should run 1M.

## Audit + observability

### Sensitive-key blocklist

`qv-server/audit.mjs` redacts keys matching the regex
`/(token|secret|password|sk_|signing|apikey)/i` in any audit event.
If you add new operator-supplied fields, name them so the blocklist
already catches them, or extend the regex.

### Forward to OTLP

Set `QV_OTLP_ENDPOINT=https://collector.example/v1/traces` to ship
audit events to any OpenTelemetry collector (Tempo, Honeycomb,
Datadog, etc.) as OTLP/HTTP/JSON spans. Zero-dep — no protobuf
compiler, no runtime libraries.

```bash
QV_OTLP_ENDPOINT=https://collector.example/v1/traces \
QV_OTLP_TOKEN=$BEARER \
node server-sovereign.mjs
```

## Operational hygiene

| Practice | Why |
|----------|-----|
| Rotate admin tokens every 90 days | Limit blast radius of a leak |
| Rotate signing keys every 12 months | PFS for tokens issued before rotation |
| Backup `keystore.json` + `master.key` to separate volumes | Disaster recovery |
| Keep `chains/` on persistent storage | Without it, every prior token replays |
| Monitor `qv_auth_denies_total` | Spikes indicate stuffing / scanning |
| Monitor `qv_verify_queue_rejects_total` | Spikes indicate verify-pool exhaustion or attack |
| Set `QV_AUDIT_ROTATE_BYTES` ≤ disk free | Prevent log-fill DoS |

## What this guide does NOT promise

- **Memory-resident keys cannot be hidden from someone with `ptrace`
  or `/proc/<pid>/mem` access.** That requires per-operation HSM round
  trips, which trade ~1 ms latency per signature.
- **Side-channel attacks on the post-quantum primitives are an active
  research area.** ML-DSA-87 and Falcon are NIST-finalised, but
  practical implementation flaws (constant-time leaks, cache attacks)
  may emerge. Track the upstream Noble + PQClean advisories.
- **Quantum supremacy events.** ML-DSA-87 has a NIST-claimed security
  level of 5 (≥AES-256). If a 4096-qubit fault-tolerant quantum
  computer materialises, the entire cryptographic landscape revisits
  itself, including this product.

## Reporting weaknesses

See [SECURITY.md](./SECURITY.md). For non-vulnerability hardening
suggestions, open an issue using the
[security_concern](.github/ISSUE_TEMPLATE/security_concern.md) template.
