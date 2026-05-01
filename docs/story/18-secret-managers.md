# Chapter 18 — Secret Manager Integration

## The story

The master key seals every signing key at rest. If you can read the
master key, you can decrypt the keystore. So the question every
operator asks first is the same:

> "Where does the master key actually live?"

Three answers, ranked by trust:

1. **File on a 0600 volume** — fine for a laptop, weak for production.
2. **Env var injected by your secrets manager at container start** — the
   90 % production answer.
3. **A command that pulls from KMS / Vault / Azure KV / 1Password
   on every boot** — the 100 % answer for compliance-driven shops.

Sigvault supports all three through a single pluggable interface,
`MasterKeyProvider`, in `qv-server/master-key.mjs`. Zero npm deps. No
hard dependency on any one cloud.

## The interface

```javascript
import { loadMasterKey } from './master-key.mjs';

const { key, source } = loadMasterKey({
  filePath: '/var/lib/qv/master.key',  // file backend target
  env:      process.env,                // selection knobs
});
```

Resolution order (`auto` mode, the default):

```
QV_MASTER_KEY_HEX  → env backend  (highest priority)
QV_MASTER_KEY_EXEC → exec backend
master.key on disk → file backend  (generates on miss)
```

To pin one backend explicitly, set `QV_MASTER_KEY_PROVIDER=env|file|exec`.

## Backend 1 — env

The simplest path. Your secrets manager (Vault, AWS SM, Azure KV) gives
you a 64-char hex string at container boot through the env.

```bash
export QV_MASTER_KEY_HEX="$(vault kv get -field=hex secret/qv/master)"
node server-sovereign.mjs
```

Pros: zero parsing surface, no extra processes.
Cons: env vars are visible to anyone who can `cat /proc/<pid>/environ`.
Mitigation: keep the qv-server pod's namespace tight; mount no shells.

## Backend 2 — file

Generated on first boot, chmod 0600, atomic + fsync (`durable.mjs`).
The default for laptops and single-machine deployments.

```bash
ls -la /var/lib/qv/master.key
# -rw-------  1 qv qv 32  ...
```

If you delete the file, all sealed signing keys become unrecoverable.
That is by design — delete to rotate.

## Backend 3 — exec (the universal escape hatch)

The whole point of this backend is that Sigvault should not have a
hardcoded list of supported KMSes. Instead: you write a 5-line wrapper
script that prints the key on stdout. qv-server runs the script on
boot and validates the output is 64 hex chars.

```bash
export QV_MASTER_KEY_PROVIDER=exec
export QV_MASTER_KEY_EXEC='/etc/qv/fetch-master.sh'
```

The contract:

- Command runs once at startup with `shell: true`.
- Stdout: first 64-char hex run is the key. Surrounding text is
  ignored, so you can pipe through `jq` / `grep` / `awk` freely.
- Exit code 0 → success; any non-zero → boot fails with stderr
  surfaced.
- Timeout 30 s (configurable in `master-key.mjs` if you really need
  longer; we don't expose it as an env var to keep boot deterministic).
- Stdout cap 64 KiB so a runaway provider can't fill memory.

### Recipe: AWS KMS

```bash
#!/usr/bin/env bash
# /etc/qv/fetch-master.sh
set -euo pipefail
aws kms decrypt \
  --ciphertext-blob fileb:///etc/qv/master.key.enc \
  --output text \
  --query Plaintext \
  | base64 -d \
  | xxd -p -c 64
```

The CLI returns base64; we decode to bytes and hex-encode. 32 bytes →
64 hex chars.

### Recipe: HashiCorp Vault transit engine

```bash
#!/usr/bin/env bash
set -euo pipefail
vault write -field=plaintext transit/decrypt/qv-master \
  ciphertext="$(cat /etc/qv/master.ciphertext)" \
  | base64 -d \
  | xxd -p -c 64
```

### Recipe: Azure Key Vault (CLI)

```bash
#!/usr/bin/env bash
set -euo pipefail
az keyvault secret show \
  --vault-name my-vault \
  --name qv-master-hex \
  --query value -o tsv
```

The secret value is already 64 hex chars (you stored it that way).

### Recipe: GCP KMS

```bash
#!/usr/bin/env bash
set -euo pipefail
gcloud kms decrypt \
  --location=global --keyring=qv --key=master \
  --ciphertext-file=/etc/qv/master.enc \
  --plaintext-file=- \
  | xxd -p -c 64
```

### Recipe: 1Password CLI

```bash
#!/usr/bin/env bash
op item get qv-master --field hex
```

### Recipe: sops + age

```bash
sops -d /etc/qv/master.enc.yaml | yq -r .hex
```

## Why exec, not a plugin API?

A plugin API requires either:

1. A native module (violates zero-dep), or
2. A subprocess protocol (which is what exec already is, just
   slightly fancier).

`exec` is honest: the operator owns the wrapper script, qv-server
owns the boot validation. No version-skew, no plugin marketplace, no
supply-chain attack surface inside the qv-server process. The
wrapper script's safety is the operator's, not ours.

## What we deliberately do not do

- **Auto-fetch on every signing operation.** The master key is read
  once at boot, kept in process memory. Re-fetching per request would
  add KMS roundtrip latency to every issue.
- **Hot-rotate without restart.** Master rotation requires a managed
  swap of the keystore (re-seal each entry under the new key). That's
  a v4.4 roadmap item (`rotate-master.mjs`), not a v4.3 item.
- **Cache the key on disk after fetch.** The exec backend's whole
  point is the master is *not* on disk. We never write back.
- **Try multiple providers and pick the first one that works.** Auto
  has a strict priority order; explicit is explicit. No fallbacks.

## Failure semantics

| Backend | Failure → server behaviour |
|---------|----------------------------|
| env  | `QV_MASTER_KEY_HEX` missing or non-hex → throws `MK_ENV_MISSING` / hex error → boot aborts |
| file | wrong-length file → boot aborts; missing + `allowGenerate=false` → `MK_FILE_MISSING` |
| exec | non-zero exit → boot aborts with stderr; empty stdout → boot aborts |

In every failure case the server refuses to start. Better to crash
loud than serve with the wrong key.

## The evidence

- `qv-server/master-key.mjs` — the provider
- `test/master-key.test.mjs` — 21 unit tests across all backends
- `test/integration.master-key.test.mjs` — 4 integration tests:
  env, file, exec round-trip + exec-failure-aborts-boot

Next: Chapter 19, [Roadmap and what's next](./19-roadmap.md). _(stub)_
