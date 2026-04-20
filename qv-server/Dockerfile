# syntax=docker/dockerfile:1.7
#
# QuantumVault sovereign REST server — zero-npm Node container.
#
#   docker build -t qv-server .
#   docker run -p 7433:7433 \
#     -e QV_MASTER_KEY_HEX=$(openssl rand -hex 32) \
#     -e QV_CORS_ORIGIN='*' \
#     qv-server
#
# Image weight: ~60 MB (node:20-alpine base, no npm packages installed).

FROM node:20-alpine AS runtime

LABEL org.opencontainers.image.title="QuantumVault Server"
LABEL org.opencontainers.image.description="Post-quantum token REST server (ML-DSA-87, Falcon-512/1024) — zero npm dependencies, Node stdlib only."
LABEL org.opencontainers.image.source="https://github.com/007krcs/quantum-vault"
LABEL org.opencontainers.image.licenses="Apache-2.0"

# Run as non-root for defense-in-depth.
RUN addgroup -S qv && adduser -S qv -G qv
WORKDIR /app

# Only the server file is needed — zero npm install.
COPY --chown=qv:qv server-sovereign.mjs ./

# Ephemeral data dir — mount a volume at /data for persistence.
RUN mkdir -p /data && chown qv:qv /data
ENV QV_DATA_DIR=/data \
    QV_HOST=0.0.0.0 \
    QV_PORT=7433 \
    QV_WORKERS=2 \
    QV_CORS_ORIGIN=""

EXPOSE 7433
USER qv

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:7433/v3/health || exit 1

CMD ["node", "server-sovereign.mjs"]
