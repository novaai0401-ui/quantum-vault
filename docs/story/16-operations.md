# Chapter 16 — Operations Cookbook

## The eight env vars every production deploy must set

```bash
# 1. Refuse-to-start anchor. Mint with: npm run mint-token
QV_ADMIN_TOKEN_SHA256=<64 hex chars>

# 2. Bind to something reasonable. In K8s, the pod IP.
QV_HOST=0.0.0.0
QV_PORT=7433

# 3. Where the keystore lives. A persistent volume in K8s.
QV_DATA_DIR=/var/lib/qv

# 4. Where the master key is sourced from. Preferred.
QV_MASTER_KEY_HEX=<from your secrets manager>

# 5. Who's allowed to hit admin endpoints.
QV_ADMIN_ALLOW_CIDRS="10.0.0.0/8"

# 6. Rate limits matched to your steady-state traffic.
QV_RATE_ADMIN_RPM=120
QV_RATE_VERIFY_RPM=1200
# Optional: second-dimension per-keyId issue throttle. 0 = off (default).
# Stops a single noisy keyId from draining the IP bucket and starving
# sibling keys on the same NAT egress.
# QV_RATE_PER_KEY_ISSUE_RPM=600
# Per-keyId override map. 0 = unlimited for that key.
# QV_RATE_PER_KEY_OVERRIDES='{"<vip-keyId>":1200,"<unmetered>":0}'

# 7. Keep the audit file from filling the disk.
QV_AUDIT_ROTATE_BYTES=67108864   # 64 MiB
QV_AUDIT_ROTATE_KEEP=10

# 8. Let Kubernetes kill the pod cleanly.
QV_SHUTDOWN_TIMEOUT_MS=30000
```

If one of these isn't set for you, you haven't operated qv-server yet.

## TLS termination

qv-server speaks plain HTTP. Never expose it to the internet.
Terminate TLS one hop upstream. Example with Caddy:

```caddyfile
vault.example.com {
  tls admin@example.com
  reverse_proxy 127.0.0.1:7433 {
    header_up X-Forwarded-For {remote_host}
    header_up X-Forwarded-Proto https
  }
}
```

Nginx equivalent (omit headers Nginx sets already):

```nginx
server {
  listen 443 ssl http2;
  server_name vault.example.com;

  ssl_certificate     /etc/ssl/certs/fullchain.pem;
  ssl_certificate_key /etc/ssl/private/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:7433;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;  # last-hop only
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

**Important.** Strip any inbound `X-Forwarded-For` from the client.
Only the proxy should set it. Otherwise, the CIDR allowlist and rate
limiter can be bypassed by spoofing.

## Horizontal scaling

With v4.3:
- **Issue:** vertical only. One qv-server per master-key scope.
  A single process handles ~1 000+ issues/sec on a modern CPU.
- **Verify:** horizontal via read-only replicas. Ship the
  chain log append-only from the writer to N readers; readers
  verify up to their last synced counter and reject newer tokens
  with `MUTATION_CTR_STALE`.

Roadmap v4.4 ships the coordinator that removes this restriction.

## Prometheus scraping

Point your scrape job at `/v3/metrics`:

```yaml
scrape_configs:
  - job_name: sigvault
    scrape_interval: 15s
    authorization:
      type: Bearer
      credentials_file: /etc/prom/qv-bearer
    static_configs:
      - targets: ['vault:7433']
    metrics_path: /v3/metrics
```

Store the scrape token in `/etc/prom/qv-bearer` with mode 0400,
not as an env var on the prom side.

Key dashboards:

- **Issue rate** — `rate(qv_token_issue_total[5m])`
- **Verify rate + failure %** — `rate(qv_token_verify_total[5m])`
  split by `result`
- **Auth denials by reason** — `rate(qv_auth_denies_total[5m])`
- **Rate-limit denials** — `rate(qv_rate_limit_denies_total[5m])`
- **Verify queue saturation** — `qv_verify_queue_depth / QV_VERIFY_QUEUE_MAX`
- **p95 latency** — `histogram_quantile(0.95, rate(qv_http_request_duration_seconds_bucket[5m]))`

## Log aggregation

Stream `audit.log` (stdout by default) into Loki / Elasticsearch.
Example with promtail:

```yaml
scrape_configs:
  - job_name: qv-audit
    static_configs:
      - targets: [localhost]
        labels:
          job: qv-audit
          __path__: /var/lib/qv/audit.log
    pipeline_stages:
      - json:
          expressions:
            ts:       ts
            event:    event
            trace_id: traceId
            req_id:   requestId
```

Now Loki supports queries like:

```
{job="qv-audit"} |= "auth.deny" | json | reason="bad_token"
```

## Disaster recovery

Restore path:

1. `master.key` → replace from your secrets manager.
2. `keystore.json` → restore from backup.
3. `chains/` → restore from backup. If missing, every key's chain
   state is lost; re-issue is safe but old tokens will all
   `MUTATION_CTR_STALE` (acceptable after a disaster).
4. `revoked.json` → restore. If missing, revoked keys become
   un-revoked (accept the cost, then re-revoke from policy).

Backup policy: a periodic `tar czf <DATE>.tgz <DATA_DIR>/` pushed
off-host. Binary size ~1 MB for typical deploys.

## Key rotation

Per-key (preferred):

```bash
# 1. Provision a new key
curl -X POST https://vault/v3/keygen \
  -H "Authorization: Bearer $ADMIN" \
  -d '{"label":"api-gateway-2026-04"}'
# → {"keyId": "<new-uuid>"}

# 2. Cut traffic over at the caller
# 3. Revoke the old key
curl -X DELETE https://vault/v3/keys/<old-uuid> \
  -H "Authorization: Bearer $ADMIN"
```

Master rotation (manual in v4.3, scripted in v4.4): see Chapter 7.

## Smoke test after deploy

```bash
curl http://vault/v3/live                  # 200
curl http://vault/v3/ready                 # 200
curl -H "Authorization: Bearer $ADMIN" \
  http://vault/v3/metrics | head -20       # metrics text
```

## Chaos tests worth running

1. `kubectl delete pod qv-server-<id>` mid-request — should drain
   cleanly (inspect audit.log for `server.shutdown`).
2. Fill `/var/lib/qv` to 95 %. Verify audit rotation still works.
3. Null-route the reverse proxy for 30 s. Verify recovery.
4. Disable the rate limiter (`QV_RATE_LIMIT_DISABLED=true`) and
   flood `/v3/token/issue` to prove you *need* the limiter.
5. Steal the admin token and try it from an off-CIDR IP. Must fail.

## Anti-patterns (don't)

- **Don't** run qv-server on a public interface.
- **Don't** store `master.key` and `keystore.json` on the same
  filesystem volume as `audit.log`. If you must, ensure the
  backup process is separate.
- **Don't** disable rate-limit in production without a trusted
  mesh handling it.
- **Don't** use `QV_ADMIN_TOKEN` (plaintext) in production —
  always `QV_ADMIN_TOKEN_SHA256`.
- **Don't** set `QV_CORS_ORIGINS="*"` with credentials. The server
  refuses to start; that's the correct behaviour.
- **Don't** share one qv-server instance across unrelated tenants
  without operational isolation. The MutationChain is shared.

## Upgrade path

Minor (4.3.x): swap the binary; config-compatible.
Major (4.3 → 4.4): read the changelog. We commit to a
deprecation window of **one minor release** for any env-var change.

Next: Chapter 17, [Testing Philosophy](./17-testing.md).
