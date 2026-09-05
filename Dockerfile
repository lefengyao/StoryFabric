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
    STORYFABRIC_WORKSPACE_DIR=/data/workspace \
    STORYFABRIC_SETTINGS_FILE=/data/settings.json \
    STORYFABRIC_WEB_DIST_DIR=/app/web \
    STORYFABRIC_ACCESS_KEY_FILE=/run/secrets/storyfabric_key

RUN groupadd --system storyfabric && useradd --system --gid storyfabric --home-dir /app storyfabric \
  && mkdir -p /data/workspace \
  && chown -R storyfabric:storyfabric /app /data

COPY --from=build /app/dist-server ./dist-server
COPY --from=build /app/out/web ./web

USER storyfabric
VOLUME ["/data"]
EXPOSE 8787
CMD ["node", "dist-server/index.mjs"]
