# syntax=docker/dockerfile:1.7
#
# Sigvault Sovereign Server — reproducible, zero-npm container.
#
# Build (reproducible — pinned digest, deterministic timestamps):
#
#   docker build \
#     --build-arg SOURCE_DATE_EPOCH=$(git log -1 --format=%ct) \
#     -t qv-server:$(git rev-parse --short HEAD) .
#
# Run (production):
#
#   docker run -d --name qv \
#     -p 127.0.0.1:7433:7433 \
#     -v /var/lib/qv:/data \
#     -e QV_MASTER_KEY_HEX="$(vault kv get -field=hex secret/qv/master)" \
#     -e QV_ADMIN_TOKEN_SHA256="$(cat /etc/qv/admin.sha256)" \
#     -e QV_ADMIN_ALLOW_CIDRS="10.0.0.0/8" \
#     qv-server:<sha>
#
# Image weight: ~60 MB (node:20-alpine base, no npm packages installed).
# Layers: 4 (base, user, copy, runtime). No build stage — there's nothing
# to compile, the source IS the artefact.

# Pin the base by digest AND tag. The digest is the supply-chain anchor:
# a registry compromise that swaps a tag (the 2024 Docker Hub
# typosquatting incidents proved this is a real risk) cannot swap a
# pinned digest. Update both together when bumping Node.
ARG NODE_VERSION=20.18.1-alpine3.20
ARG NODE_DIGEST=sha256:f8578958d4b9b1d21b7ff04ce3b395601ad20d020468bc359b4c4416150e244f
FROM node:${NODE_VERSION}@${NODE_DIGEST} AS runtime

LABEL org.opencontainers.image.title="Sigvault Server"
LABEL org.opencontainers.image.description="Post-quantum token REST server (ML-DSA-87, Falcon-512/1024) — zero npm dependencies, Node stdlib only."
LABEL org.opencontainers.image.source="https://github.com/007krcs/quantum-vault"
LABEL org.opencontainers.image.url="https://github.com/007krcs/quantum-vault"
LABEL org.opencontainers.image.documentation="https://github.com/007krcs/quantum-vault/tree/main/docs/story"
LABEL org.opencontainers.image.licenses="AGPL-3.0-only"
LABEL org.opencontainers.image.vendor="007krcs"

# ── Hardened runtime ────────────────────────────────────────────────────────
# Run as a non-root system user for defense-in-depth. UID/GID pinned so
# volume permissions don't drift across image rebuilds.
RUN addgroup -S -g 10001 qv \
 && adduser  -S -u 10001 -G qv -h /home/qv qv
WORKDIR /app

# Copy ONLY the runtime source. Tests, docs, and dev configs stay out of
# the image (smaller surface, smaller image). The server is pure
# Node-stdlib so there's no npm-install step.
COPY --chown=qv:qv \
    server-sovereign.mjs \
    auth.mjs \
    audit.mjs \
    ratelimit.mjs \
    security.mjs \
    shutdown.mjs \
    metrics.mjs \
    claims.mjs \
    cidr.mjs \
    trace.mjs \
    durable.mjs \
    chain-log.mjs \
    master-key.mjs \
    writer-lock.mjs \
    verify-pool.mjs \
    verify-worker.mjs \
    otlp.mjs \
    fuzz.mjs \
    ./

# Persistent data lives on a mounted volume; the container itself is
# ephemeral. /data must be writable by uid 10001.
RUN mkdir -p /data && chown qv:qv /data
VOLUME ["/data"]

ENV QV_DATA_DIR=/data \
    QV_HOST=0.0.0.0 \
    QV_PORT=7433 \
    QV_AUDIT_STDOUT=true \
    NODE_OPTIONS="--enable-source-maps"

EXPOSE 7433
USER qv:qv

# Liveness probe targets /v3/live (always 200 once the process is up).
# Readiness should be wired separately by the orchestrator (Kubernetes
# readinessProbe on /v3/ready).
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${QV_PORT:-7433}/v3/live" >/dev/null 2>&1 || exit 1

# `dumb-init`-equivalent: Node 20+ handles SIGTERM correctly when run as
# PID 1 in alpine, so we don't need an init shim. Graceful shutdown is
# implemented in shutdown.mjs.
CMD ["node", "server-sovereign.mjs"]
