# Linux 单用户服务

Linux 服务是 Windows Electron 工作区的外围 Web 适配，不改变 `src/core` 的工作区格式、检索和 Agent 规则，也不参与 Android 构建。

## 首次运行

```bash
mkdir -p secrets data
openssl rand -base64 32 > secrets/storyfabric_key
chmod 600 secrets/storyfabric_key
docker compose up -d --build
```

打开 `http://服务器地址:8787/`，输入 `secrets/storyfabric_key` 中的密钥登录。

服务将工作区保存到 `./data/workspace`，设置和供应商密钥保存到 `./data/settings.json`。容器不开放任意服务器路径，只有配置的单一工作区可访问。

## 生产部署

- 通过 Caddy、Nginx 或 Traefik 提供 HTTPS，并将 `STORYFABRIC_COOKIE_SECURE=1` 传入容器。
- 不要把访问密钥写入镜像、仓库或前端代码；使用 Docker Secret 或等效的密钥管理。
- `8787/healthz` 是不需要登录的健康检查；其余 `/api/*` 接口都需要 HttpOnly 会话 Cookie。
- `data/` 是唯一需要备份的目录；不要备份容器临时层。

## 开发构建

```bash
npm run web:build
npm run server:build
STORYFABRIC_ACCESS_KEY=local-dev-key \
STORYFABRIC_WORKSPACE_DIR=./data/workspace \
STORYFABRIC_SETTINGS_FILE=./data/settings.json \
npm run server:start
```

服务默认监听 `0.0.0.0:8787`。浏览器端使用现有 `StoryFabricApi` 的 HTTP 适配器，Agent 流式事件通过 SSE 传递。
