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
- 智能体：流式对话，按需读取章节、前后文、设定和大纲；支持 EPUB、PDF、DOCX 和常见文本附件，写回文件需要确认。
- 供应商：支持 OpenAI 兼容、Anthropic 和 Gemini 协议。
- 导入导出：工作区统一使用 `.storyfabric.zip`，导入会创建独立的新工作区；会话使用 `.storyfabric.session.json`。

## 智能体读取资料

在聊天输入框的「+ → 添加文件」中选择 EPUB、PDF、DOCX、TXT、Markdown、CSV、JSON、YAML 等资料，应用会先提取文字，再发送给智能体。也可以在灵感台导入资料进行蒸馏和拆解，或把文件放入工作区 `docs/`（支持子目录），让智能体用 `list_project_docs` 和 `read_project_doc` 分段读取。

EPUB 支持 EPUB 2/3 的 XHTML 正文，按书籍的 spine 阅读顺序提取章节，保留段落并跳过导航、脚本和样式。加密正文、损坏的文档和只有图片的电子书会显示无法提取的错误；扫描 PDF 需要先做 OCR。常见文本文件使用 UTF-8 编码。

每条消息最多 8 个附件，单个文件及总附件原始大小均不能超过 100 MiB，灵感资料原文件总量不能超过 100 MiB。每份资料可索引最多 10,000,000 字符、20,000 个片段；PDF 最多 2,000 页，EPUB 最多 1,000 个正文条目，单章解压 XML 最多 4 MiB、累计 XML 最多 32 MiB，DOCX 正文 XML 最多 32 MiB。超过这些上限会明确提示拆分资料，不会静默丢弃末尾。

超过 20,000 字符的聊天附件会保存原文件到当前项目的灵感资料库，聊天只携带索引引用与最多 2,000 字符的预览，重新打开会话后仍可读取；可在灵感台移除原资料。智能体通过 `list_document_sections` 查看目录、`search_document` 搜索完整资料、`read_document_section` 按需读取，单次默认 4,000、最多 20,000 字符，使用 `nextOffset` 翻页和 `revision` 校验资料版本。EPUB 按阅读顺序分章，PDF 按页分组，文本和 DOCX 按标题、段落和长度分段。`read_project_doc` 的 offset 分页也可读取超过旧 500,000 字符上限的文档。灵感台使用同样的目录和读取工具，分析会说明实际阅读范围。EPUB、PDF 和 DOCX 原文件只能读取，可将分析或摘录另存为文本项目文档。

## 监测更新

设置中的「监测更新」默认在启动后、以及使用期间每 6 小时检测一次，也可以手动检查或关闭自动检测。默认更新源为：

- 官网下载页：`https://storyfabric.fengyao.xin:10048/download`
- GitHub 仓库：`https://github.com/lefengyao/StoryFabric`

官网使用 storyfabric-web 的 `/releases/versions.json`（`catalogFormat: 2`）；GitHub 使用已发布的 Releases。检测按语义版本比较，跳过草稿和预发布版本，绝不推荐降级。相同版本的官网文件缺失时尝试 GitHub；目录尚未发布、安装包不存在、请求失败分别提示，不推测下载地址。

Windows 可以在应用内下载，校验文件体积及 SHA-256 后手动启动安装程序；没有校验值的包只能通过外部下载入口获取。Android 提供已发布 APK 的下载链接，由系统安装器处理；Linux Web 提供服务包，由管理员保留 `data/` 和访问密钥后手动部署。下载不会自动退出应用，启动安装前请保存编辑中的内容。

发布时应先上传版本对应的文件，再更新官网清单的 `latestId`、版本、平台、文件地址、体积和 SHA-256，或创建带对应资产的 GitHub Release。空目录、404 和缺少当前平台文件都不会显示可安装更新。

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

章节编辑器左侧提供快捷词栏，默认收集角色名、别名和设定名。点击词语可定位当前章节的匹配，使用上一处、下一处循环查找；「编辑」可添加自定义词语或隐藏项目词语。词表保存在工作区的 `.storyfabric/writing-tools.json`，随工作区 ZIP 备份导出和恢复。快捷词栏可收起，给正文留出更多空间。

快捷词栏的「排版」和章节扩展栏的「一键排版」会统一正文首行两字缩进、段间一个空行，保留 Markdown 标题、列表、表格和围栏代码块，可通过撤销恢复原文。排版结果沿用章节的保存和自动保存机制。

Android 呼出正文键盘时，键盘上方显示可横向滑动的常用标点栏，点击后保留正文焦点。候选字尚未确认时，标点会等待候选字确认后插入，避免拼音残留。键盘位置使用原生 IME 可见区域测量，适配方式参照 [Android 键盘布局说明](https://developer.android.com/develop/ui/views/layout/sw-keyboard)。

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

## 工作区交互修正（0.2.37）

侧栏支持结构化需求问答与稍后回答；差异审查提交失败保留原变更并允许重试，关闭弹窗仅表示稍后审查，显式拒绝才会拒绝变更。完整工作台与侧栏在用户向上阅读时保留位置，提供“回到最新”。工具卡支持参数详情，并明确标记参数和结果截断。

本次服务端产物为 release/0.2.39/storyfabric-server-0.2.39.tar.gz，包内 VERSION 与源码版本一致，内容可通过 SHA256SUMS 校验。该包按已有手动部署流程安装，保留数据目录。0.2.39 支持人物资料卡、可选人物关系、单篇大纲、可选事件脉络和完整用量长图导出；章节与大纲提供独立历史页、手动及五分钟留存、比较和恢复。智能体提交需选择是否留存历史，当前修订与长期版本严格分离。新版工作区规范见 [WORKSPACE_FORMAT.md](WORKSPACE_FORMAT.md)。打开或导入格式 4 项目时需明确确认「备份并升级」，应用先保留原稿，再转换当前资料；升级失败会回滚，无法安全恢复时保留备份和恢复记录并提示处理。升级原稿随工作区 ZIP 备份携带，更早格式仍需按规范重写。Trailblazer 接入说明见 [docs/trailblazer-integration.md](docs/trailblazer-integration.md)。

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
