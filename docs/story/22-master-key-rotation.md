# Chapter 22 — Master Key Rotation

## The story

The master key seals every signing key in `keystore.json` (AES-256-GCM
with the keyId as Additional Authenticated Data). It is the single
secret whose compromise unwinds the entire trust posture.

Compliance frameworks ranging from PCI-DSS to FedRAMP High require
periodic rotation — typically every 12–24 months, immediately after
suspected compromise, and on personnel turnover. Without a tool, the
only paths are manual surgery on the keystore (error-prone) or fresh
keygen for every key (invalidates every issued token).

`qv-server/rotate-master.mjs` is the surgical path: same keyIds, same
existing tokens, new master.

## The protocol

```bash
# 1. Mint a new master from your secrets manager.
NEW=$(vault kv put -field=hex secret/sigvault/master = $(openssl rand -hex 32))

# 2. Stop qv-server (the rotation tool refuses to run otherwise).
systemctl stop sigvault-server   # or kubectl scale sts sigvault --replicas=0

# 3. Dry-run first to see what would change.
node qv-server/rotate-master.mjs \
  --data-dir=/var/lib/sigvault \
  --new-master-hex="$NEW"
# (no --confirm → DRY RUN, no files written)

# 4. Commit.
node qv-server/rotate-master.mjs \
  --data-dir=/var/lib/sigvault \
  --new-master-hex="$NEW" \
  --confirm

# 5. Restart qv-server with the new master.
QV_MASTER_KEY_HEX="$NEW" systemctl start sigvault-server

# 6. After 24-48 hours of healthy operation, delete the backups.
ls /var/lib/sigvault/*.bak.*
```

## What the tool does, in order

1. **Refuses to run** if the writer-lock is live (`pidAlive` &&
   `expiresAt > now`). qv-server must be stopped first.
2. **Reads** `keystore.json` and `master.key`.
3. **Decrypts** every entry under the *current* master. If any entry
   fails AEAD verification, aborts with `OPEN_FAILED` — the wrong
   master was supplied.
4. **Re-seals** every entry under the *new* master.
5. **Backs up** the originals to `keystore.json.bak.<ISO-ts>` and
   `master.key.bak.<ISO-ts>`.
6. **Atomic durable writes** the new keystore + new master (tmp +
   fsync + rename + dir-fsync, same primitives as
   `qv-server/durable.mjs`).
7. **Reports** the backup paths so you can confirm them in a runbook.

## Crash-safety properties

- Originals are renamed (atomic) before any new write. If a crash
  occurs after step 5 but before step 6, the .bak files remain on
  disk — you can recover by renaming them back.
- If a crash occurs after writing the new keystore but before writing
  the new master, the keystore on disk is sealed under the new master
  but the old master is still on disk. **Re-running the tool with the
  same `--new-master-hex` is idempotent**: the second pass detects
  the new keystore won't open under the old master and aborts; the
  recovery is to swap `master.key` from its `.bak` and re-run, or to
  manually replace `master.key` with the new hex.
- Legacy plaintext entries (pre-v4.0β) are migrated to sealed in the
  same operation.

## What the tool will NOT do

- Run while qv-server is up (refuses).
- Delete the backup files (the operator does this manually after
  validation).
- Re-keygen anything (rotation preserves signing keys, encrypt keys,
  and keyIds).
- Touch the chain log (the chain log is per-keyId, not per-master).
- Validate that the new master came from your secrets manager
  (operator's responsibility — it just needs to be 32 bytes of
  high-entropy randomness).

## Validation checklist (post-rotation)

```bash
# 1. Server boots cleanly.
journalctl -u sigvault-server -n 50

# 2. /v3/ready returns 200.
curl -fsS http://127.0.0.1:7433/v3/ready

# 3. An existing token still verifies (use a token issued before the
#    rotation; it must verify under the same keyId post-rotation).
curl -fsS http://127.0.0.1:7433/v3/token/verify \
  -H 'content-type: application/json' \
  -d '{"keyId":"<existing-keyId>","token":"<existing-token-hex>"}'

# 4. Issue a new token to confirm the writer path is healthy.
curl -fsS -H "Authorization: Bearer $ADMIN" http://127.0.0.1:7433/v3/token/issue \
  -H 'content-type: application/json' \
  -d '{"keyId":"<existing-keyId>","claims":{"sub":"rotation-probe"}}'

# 5. Audit log shows no auth.deny / failed verifies.
tail -n 50 /var/lib/sigvault/audit.log | grep -E 'auth.deny|invalid'
```

If any of these fail: stop the server, revert by renaming the
`.bak.<ts>` files back to `keystore.json` / `master.key`, restart
with the OLD `QV_MASTER_KEY_HEX`. The rotation has not yet "stuck"
— rolling back is safe.

## When NOT to use this tool

- **You suspect master key compromise.** Rotating the master alone
  doesn't help if the attacker can read the new one too. First
  rotate **the operator credentials** that pulled the master from
  your secrets manager, then the secrets-manager seal, then
  `rotate-master.mjs` last.
- **You need to rotate signing keys, not the master.** Use
  `POST /v3/keygen` for new signing keys + `DELETE /v3/keys/{id}`
  for the retired ones. The master is the wrap key, not a signing key.

## The evidence

- `qv-server/rotate-master.mjs` — the tool.
- `qv-server/test/rotate-master.test.mjs` — 7 unit tests covering
  dry-run, re-seal correctness, backup creation, OPEN_FAILED on
  wrong master, missing keystore, legacy migration, and idempotent
  round-trip.
