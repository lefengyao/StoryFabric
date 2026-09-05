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
- 导入导出：工作区使用 `.storyfabric.zip`，会话使用 `.storyfabric.session.json`。

## 技术结构

```text
src/core/       平台无关的工作区、文件存储、检索、Agent 和 LLM 适配器
src/main/       Electron 主进程和桌面端 IPC
src/preload/    Electron 安全桥接
src/renderer/   React 界面，以及 Web/Android 平台适配器
src/server/     Linux HTTP 服务、访问密钥认证、RPC 和 SSE
examples/       最小工作区示例和自动化测试 fixture
docs/           设计、发行和部署文档
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

Linux 服务是现有核心的外围 Web 适配，不开放任意服务器路径。默认只挂载一个工作区，工作区和设置均保存在 `/data` 卷中。

```bash
mkdir -p secrets data
openssl rand -base64 32 > secrets/storyfabric_key
chmod 600 secrets/storyfabric_key
docker compose up -d --build
```

打开 `http://服务器地址:8787/`，输入 `secrets/storyfabric_key` 中的访问密钥。

生产环境应在 Caddy、Nginx 或 Traefik 后提供 HTTPS，并设置 `STORYFABRIC_COOKIE_SECURE=1`。备份 `data/` 即可备份服务端工作区和供应商设置，不要把 `secrets/`、`.env` 或运行时数据提交到 Git。

完整配置见 [docs/linux-server.md](docs/linux-server.md)。

## 工作区示例

`examples/minimal-workspace` 是一个可直接打开的最小项目，包含卷、章节、总纲、章纲、角色、设定、事件、关系和便签。它也被工作区测试用作 fixture：

```text
examples/minimal-workspace
```

`.storyfabric/` 下的索引、会话和回收站数据属于运行时派生文件，已加入 Git 忽略规则。

## 文档

- [Linux 单用户 Docker 部署](docs/linux-server.md)
- [Windows 与 Android 发行说明](docs/platform-release.md)
- [Windows 写作工作流](docs/windows-writing-workflow.md)
- [Android 暂停交接与兼容性要求](docs/android-handoff.md)
- [章节结构与混合检索计划](docs/superpowers/plans/2026-09-05-writing-structure-and-hybrid-retrieval.md)

## Git 约定

提交源码、配置、文档、测试和示例；不要提交依赖目录、构建目录、运行时工作区、访问密钥、供应商 API Key、截图或 APK/AAB。提交前建议执行：

```bash
npm test -- --run
npx tsc -b --pretty false
git diff --check
git status --short
```
