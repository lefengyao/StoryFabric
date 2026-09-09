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

## 桌面端一键部署（2026-09-09）

桌面端欢迎页「服务」模式提供「安装到服务器」向导，用 SSH + Docker 在远程 Linux 服务器上安装本服务。

**要求**

- 服务器为 Linux（`uname -s` 必须为 `Linux`），已安装 Docker（向导只检测并给安装指引，**不会自动安装**）。
- 能通过 SSH 密码登录；非 root 用户需要 `sudo` 权限，且 **SSH 密码与 sudo 密码相同**（向导用 `sudo -S` 从 stdin 喂密码）。
- 服务器首次构建需要能拉取基础镜像（默认 `node:22-bookworm-slim`，可在向导里改）。

**流程**：连接（首次会显示主机指纹供核对，之后 pin 住）→ 环境检查 → 上传部署包 → `docker build` → 生成访问密钥并启动容器 → 健康检查。

**装完是什么样**

- 容器名 `storyfabric`，`--restart unless-stopped`（服务器重启后自动恢复）。
- 数据在 `<安装目录>/data`（默认 `/opt/storyfabric/data`），访问密钥在 `<安装目录>/secrets/storyfabric_key`（0400，容器内只读挂载）。
- 访问 `http://<服务器>:<端口>/`，用向导显示的密钥登录。

**更新 / 卸载**

- 「检查更新」会读取容器实际镜像 tag 与本地部署包版本比对；「更新」= 重新上传部署包 → 构建新镜像 → 换容器，**数据卷不动**。
- 「卸载」只删容器、镜像与该次上传目录，**`<安装目录>/data` 一律保留**。

**部署包**：`npm run server:bundle` 生成 `release/storyfabric-server-<version>.tar.gz`（含预构建 `dist-server/index.mjs`、`web/`、`Dockerfile.runtime`、entrypoint 与 `SHA256SUMS`），打包时经 `extraResources` 放进安装包，运行时路径为 `resources/server-bundle.tar.gz`。

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
