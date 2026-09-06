# StoryFabric

StoryFabric 是一个依托智能体的小说创作工作台。项目使用可读的 Markdown / JSON 保存小说资料，并通过统一的核心层为 Windows 桌面端和 Linux Web 服务提供工作区、检索和 Agent 能力。

当前发行边界：

- Windows：Electron 桌面端，当前主要开发和验证平台。
- Linux：Node.js 服务 + Docker，单用户使用访问密钥登录，浏览器访问。
- Android：Capacitor 工程保留，但适配和发布暂缓，不属于当前验收范围。

## 功能

- 工作区：一部小说对应一个本地文件夹，数据可直接查看和备份。
- 章节：草稿箱、正文箱、回收站，正文按卷分组。
- 大纲：总纲和章纲。
- 角色：主要角色和次要角色，支持人物关系图谱。
- 设定：背景设定和其他设定。
- 事件与便签：时间线事件、置顶便签、搜索和回收。
- 智能体：流式对话，按需读取章节、前后文、设定和大纲；写回文件需要确认。
- 供应商：支持 OpenAI 兼容、Anthropic 和 Gemini 协议。
- 导入导出：工作区统一使用 `.storyfabric.zip`，导入会创建独立的新工作区；会话使用 `.storyfabric.session.json`。

## 技术结构

```text
src/core/       平台无关的工作区、文件存储、检索、Agent 和 LLM 适配器
src/main/       Electron 主进程和桌面端 IPC
src/preload/    Electron 安全桥接
src/renderer/   React 界面，以及 Web/Android 平台适配器
src/server/     Linux HTTP 服务、访问密钥认证、RPC 和 SSE
examples/       最小工作区示例和自动化测试 fixture
```

## 本地开发

环境要求：Node.js 22，npm。Windows 桌面端开发还需要 Electron 依赖；Linux 部署需要 Docker 和 Docker Compose。

```bash
npm install
npm run dev
```

常用检查和构建命令：

```bash
npm test                  # Vitest 单元测试
npx tsc -b --pretty false # TypeScript 检查
npm run build             # Electron 开发产物
npm run dist:win          # Windows 安装包和 portable 包，输出到 release/
npm run web:build         # Linux 服务使用的浏览器前端
npm run server:build      # Linux Node 服务
npm run server:build:all  # 同时构建 Web 前端和 Node 服务
```

## Linux Docker 服务

Linux 服务是现有核心的外围 Web 适配，不开放任意服务器路径。一个服务地址可管理多个工作区：工作区位于 `/data/workspaces/<workspace-id>/`，注册表为 `/data/workspaces/registry.json`，供应商设置为 `/data/settings.json`。旧版本的 `/data/workspace` 会在首次启动时安全迁移为 `default`；目标已存在或迁移失败时服务停止且不删除旧数据。

```bash
mkdir -p secrets data
openssl rand -base64 32 > secrets/storyfabric_key
chmod 600 secrets/storyfabric_key
docker compose up -d --build
docker compose ps
docker compose logs --tail=200 storyfabric
curl -fsS http://127.0.0.1:8787/healthz
```

打开 `http://服务器地址:8787/`，输入 `secrets/storyfabric_key` 中的访问密钥。

生产环境应在 Caddy、Nginx 或 Traefik 后提供 HTTPS，并设置 `STORYFABRIC_COOKIE_SECURE=1`。备份 `data/` 即可备份服务端工作区、注册表和供应商设置，不要把 `secrets/`、`.env` 或运行时数据提交到 Git。导入/导出通过鉴权的二进制 ZIP 接口完成，不传输服务器绝对路径。

容器启动时由 root-only Docker secret 初始化一个仅 `storyfabric` 用户可读的运行时密钥文件，然后以非 root 用户运行 Node 服务。若访问密钥曾经暴露，应在重启前重新生成：

```bash
openssl rand -base64 32 > secrets/storyfabric_key
chmod 600 secrets/storyfabric_key
docker compose up -d --build
```

部署配置以本 README 和 `docker-compose.yml` 为准；仓库外的辅助记录不参与发行包。

## 工作区示例

`examples/minimal-workspace` 是一个可直接打开的最小项目，包含卷、章节、总纲、章纲、角色、设定、事件、关系和便签。它也被工作区测试用作 fixture：

```text
examples/minimal-workspace
```

`.storyfabric/` 下的索引、会话和回收站数据属于运行时派生文件，已加入 Git 忽略规则。

## Git 约定

提交源码、构建配置、测试和示例；`.zcode/`、`.github/`、`docs/` 属于本地辅助资料，不纳入版本控制。不要提交依赖目录、构建目录、运行时工作区、访问密钥、供应商 API Key、截图或 APK/AAB。提交前建议执行：

```bash
npm test -- --run
npx tsc -b --pretty false
git diff --check
git status --short
```
