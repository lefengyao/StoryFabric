FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run web:build && npm run server:build

FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production \
    PORT=8787 \
    HOST=0.0.0.0 \
    STORYFABRIC_DATA_DIR=/data \
    STORYFABRIC_WORKSPACE_DIR=/data/workspace \
    STORYFABRIC_SETTINGS_FILE=/data/settings.json \
    STORYFABRIC_WEB_DIST_DIR=/app/web \
    STORYFABRIC_ACCESS_KEY_FILE=/run/secrets/storyfabric_key

RUN groupadd --system storyfabric && useradd --system --gid storyfabric --home-dir /app storyfabric \
  && mkdir -p /data \
  && chown -R storyfabric:storyfabric /app /data

COPY --from=build /app/dist-server ./dist-server
COPY --from=build /app/out/web ./web
COPY --chmod=0755 scripts/docker-entrypoint.sh ./docker-entrypoint.sh

VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:8787/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
ENTRYPOINT ["/app/docker-entrypoint.sh"]
