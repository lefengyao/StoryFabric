# 远程服务器部署（SSH + Docker）设计

**日期：** 2026-09-09
**状态：** 已确认，待实现

## 背景

用户希望在欢迎页（主页）填 SSH 地址/端口/用户名/密码，由桌面端在远程 Linux 服务器上用 Docker 安装 StoryFabric 服务，并支持后续更新。目前只有手动流程（`docs/linux-server.md`：`docker compose up -d --build`）。

已有基础（本次复用，不重写）：

- `Dockerfile` / `docker-compose.yml` / `scripts/docker-entrypoint.sh`：容器跑 `dist-server/index.mjs`，`8787` 端口，`/healthz` 免登录健康检查，访问密钥从 `/run/secrets/storyfabric_key` 读取，数据在 `/data`。
- `vite.server.config.ts` 为 `ssr.noExternal: true` → `dist-server/index.mjs` **自包含单文件**（约 554KB），远程构建不需要 `npm install`。
- 欢迎页 `WelcomePage.tsx` 已有「本地 / 服务」切换，「服务」模式已能填「服务地址 + 访问密钥」并登录。
- `settingsService.encryptApiKey/decryptApiKey` 已封装 safeStorage（不可用时降级 `plain:` 前缀）。

## 目标

1. 欢迎页「服务」模式新增「安装到服务器」，用 SSH + Docker 在远程 Linux 服务器上安装 StoryFabric 服务。
2. 支持查看已安装服务器的版本、更新、查看日志、卸载（保留数据）。
3. 安装完成后可直接把「服务地址 + 访问密钥」带入现有服务模式。
4. 部署包随安装包一起分发；结构上预留「将来从网站拉取」。

## 非目标

- 不自动安装 Docker、不改服务器包管理器（只检测并给安装指引）。
- 不做 HTTPS / 域名 / 证书（沿用现有文档：由 Caddy / Nginx / Traefik 反代）。
- 只做密码登录，不做密钥登录；不做多服务器批量部署。
- 不支持 Windows / macOS 服务器（`uname -s` 必须为 `Linux`）。
- 本次不实现「从网站下载部署包」，只预留 `source` 字段与校验点。

## 术语

- **部署包（bundle）**：`storyfabric-server-<version>.tar.gz`，含预构建服务端与前端产物。
- **目标（target）**：一台已保存的服务器记录。
- **步骤（step）**：`connect / probe / upload / build / run / healthcheck`。

## 一、产物与打包

### bundle 结构

```
storyfabric-server-0.1.0.tar.gz
├── dist-server/index.mjs      预构建、自包含
├── web/**                     预构建前端（out/web）
├── Dockerfile.runtime         只 COPY 产物，不 npm install
├── docker-entrypoint.sh       复用 scripts/docker-entrypoint.sh
├── compose.runtime.yml        给想用 compose 的用户
├── VERSION                    纯文本版本号
└── SHA256SUMS                 各文件 sha256
```

`Dockerfile.runtime`：

```dockerfile
ARG BASE_IMAGE=node:22-bookworm-slim
FROM ${BASE_IMAGE}
WORKDIR /app
ENV NODE_ENV=production PORT=8787 HOST=0.0.0.0 \
    STORYFABRIC_DATA_DIR=/data \
    STORYFABRIC_WORKSPACE_DIR=/data/workspace \
    STORYFABRIC_SETTINGS_FILE=/data/settings.json \
    STORYFABRIC_WEB_DIST_DIR=/app/web \
    STORYFABRIC_ACCESS_KEY_FILE=/run/secrets/storyfabric_key
RUN apt-get update && apt-get install -y --no-install-recommends util-linux \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system storyfabric \
  && useradd --system --gid storyfabric --home-dir /app storyfabric \
  && mkdir -p /data && chown -R storyfabric:storyfabric /app /data
COPY dist-server ./dist-server
COPY web ./web
COPY --chmod=0755 docker-entrypoint.sh ./docker-entrypoint.sh
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node","-e","fetch('http://127.0.0.1:8787/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
ENTRYPOINT ["/app/docker-entrypoint.sh"]
```

### 生成脚本

`scripts/build-server-bundle.mjs`（`npm run server:bundle`）：

1. `npm run web:build && npm run server:build`；
2. 复制产物到临时目录，写入 `VERSION`（取 `package.json.version`）与 `SHA256SUMS`；
3. 用 devDependency `tar`（纯 JS）打成 `release/storyfabric-server-<version>.tar.gz`；
4. 输出路径与 sha256 到 stdout，便于打包脚本核验。

`electron-builder.yml` 增补：

```yaml
extraResources:
  - from: resources/icon.ico
    to: icon.ico
  - from: release/storyfabric-server-${version}.tar.gz
    to: server-bundle.tar.gz
```

`scripts/build-win.ps1` 在 `electron-vite build` 之前先跑 `npm run server:bundle`，保证打包时 bundle 存在。

### 将来从网站拉取

`DeployTargetStored.bundleSource`：`'bundled' | 'url'`，本次只实现 `bundled`（读 `process.resourcesPath/server-bundle.tar.gz`）。`url` 模式在实现时改为下载 + `SHA256SUMS` 校验，其余流程不变。

## 二、core 层（平台无关，可单测）

`src/core/deploy/`：

### `shell.ts`

```ts
/** POSIX 单引号转义：所有进入远程命令的用户输入都必须经过它 */
export function shQuote(value: string): string
/** sudo 前缀：root 直接执行，非 root 用 `sudo -S` 并从 stdin 喂密码 */
export function sudoPrefix(isRoot: boolean): string
```

### `commands.ts`

每个命令是 `{ id, title, command, needsSudo }`；`needsSudo` 的命令在非 root 时统一加 `sudo -S` 前缀，并由传输层把密码写入 stdin。核心命令：

| id | 命令 |
| --- | --- |
| `probe.os` | `uname -s` |
| `probe.arch` | `uname -m` |
| `probe.distro` | `cat /etc/os-release` |
| `probe.user` | `id -u` |
| `probe.sudo` | `sudo -n true` |
| `probe.docker` | `docker version --format '{{.Server.Version}}'` |
| `probe.port` | `ss -ltn 'sport = :<port>'` |
| `probe.image` | `docker inspect --format '{{.Config.Image}}' storyfabric` |
| `prepare.dir` | `mkdir -p <installDir>/{data,secrets}` |
| `build` | `cd <staging> && docker build -f Dockerfile.runtime -t storyfabric:<version> --build-arg BASE_IMAGE=<baseImage> .` |
| `image.exists` | `docker image inspect storyfabric:<version> >/dev/null 2>&1` |
| `key.generate` | `umask 077 && openssl rand -base64 32 > <installDir>/secrets/storyfabric_key` |
| `key.read` | `cat <installDir>/secrets/storyfabric_key` |
| `run.rm` | `docker rm -f storyfabric >/dev/null 2>&1 \|\| true` |
| `run.start` | `docker run -d --name storyfabric --restart unless-stopped -p <port>:8787 -v <installDir>/data:/data -v <installDir>/secrets/storyfabric_key:/run/secrets/storyfabric_key:ro -e STORYFABRIC_ACCESS_KEY_FILE=/run/secrets/storyfabric_key storyfabric:<version>` |
| `health` | `docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' storyfabric`（轮询到 `healthy`） |
| `logs` | `docker logs --tail 200 storyfabric` |
| `cleanup.staging` | `rm -rf <staging>` |
| `uninstall` | `docker rm -f storyfabric; docker rmi storyfabric:<version>; rm -rf <staging>` |

`<staging>` = `$HOME/.storyfabric-staging/<version>`（先上传到这里，再 `docker build`）。健康检查以容器自带的 `HEALTHCHECK` 为准，不依赖服务器上有 `curl`；另外桌面端会尝试直连 `http://<host>:<port>/healthz`，失败只作提示、不阻断。

### `parse.ts`

```ts
export function parseOs(unameS: string): 'linux' | 'unsupported'
export function parseDockerVersion(output: string): string | undefined
export function parsePortInUse(ssOutput: string): boolean
export function parsePasswordlessSudo(exitCode: number): boolean
export function parseOsRelease(text: string): { id?: string; prettyName?: string }
export function parseContainerImage(inspectOutput: string): string | undefined
```

### 探测结果

```ts
export interface DeployProbeResult {
  os: string
  arch: string
  distro?: string
  isRoot: boolean
  /** `sudo -n true` 成功：免密 sudo */
  passwordlessSudo: boolean
  dockerVersion?: string
  portFree: boolean
  portOwner?: string
  /** 服务器上现有 storyfabric 容器的镜像 tag，用于判断真实已装版本 */
  installedImage?: string
}
```

### `state.ts`

```ts
export const DEPLOY_STEPS = ['connect', 'probe', 'upload', 'build', 'run', 'healthcheck'] as const
export type DeployStep = (typeof DEPLOY_STEPS)[number]
export type DeployStepStatus = 'pending' | 'running' | 'ok' | 'failed' | 'skipped'
export interface DeployProgress { step: DeployStep; status: DeployStepStatus; message?: string; output?: string; at: number }
/** 只允许沿 DEPLOY_STEPS 前进；失败后同一步可重试 */
export function nextStep(current: DeployStep, ok: boolean): DeployStep | null
```

## 三、主进程

### 依赖与打包

新增生产依赖 **`ssh2`**（纯 JS；`cpu-features` 是可选的 native 依赖，缺失时 ssh2 自动走纯 JS 路径）。

`electron.vite.config.ts` 的 `externalizeDepsPlugin()` 会把 `ssh2` 外部化，因此 `electron-builder.yml` 的 `files` 必须显式包含它及其运行时依赖：

```yaml
files:
  - out/**
  - package.json
  - node_modules/ssh2/**
  - node_modules/asn1/**
  - node_modules/bcrypt-pbkdf/**
  - node_modules/safer-buffer/**
  - node_modules/tweetnacl/**
```

（`node_modules/cpu-features`、`node_modules/nan` 若被安装，一并排除，让 ssh2 走纯 JS 分支。）

### 传输层抽象

```ts
export interface SshExecResult { code: number; stdout: string; stderr: string }
export interface SshTransport {
  connect(config: { host: string; port: number; username: string; password: string; hostKeyFingerprint?: string }): Promise<{ fingerprint: string }>
  exec(command: string, options?: { stdin?: string; onData?: (chunk: string) => void }): Promise<SshExecResult>
  upload(localPath: string, remotePath: string): Promise<void>
  dispose(): Promise<void>
}
```

生产实现 `Ssh2Transport`（`src/main/services/ssh2Transport.ts`）：连接用 `ssh2.Client`，`hostVerifier` 首次返回真实指纹、之后比对 pin；`exec` 用 `client.exec`，`stdin` 用于 `sudo -S`；`upload` 用 `sftp`。

测试实现 `FakeTransport`（`src/main/services/__tests__/fakeTransport.ts`）：按命令前缀返回预设输出与退出码，记录调用序列。

### `deployService.ts`

- `testConnection(input)`：连接 → 取指纹 → 跑 `probe.*` → 返回 `DeployProbeResult`；未保存目标时只返回指纹与探测结果，不落盘。
- `install(targetId, options)` / `update(targetId)`：跑完整流水线，逐步 `emit({ step, status, output })`。
- `cancel(runId)`：中止当前 run（AbortSignal 语义），已上传的文件保留。
- `logs(targetId)` / `uninstall(targetId)`。
- 每步失败即停，保留 `lastError` 与最近 200 行输出；不自动回滚、不删数据。

### 目标存储 `deployTargetsStore.ts`

独立文件 `deploy-targets.json`（与 `usage.json` 同级的 userData 目录），不进 `settings.json`（服务端/Android 不需要）：

```ts
export interface DeployTargetStored {
  id: string
  label: string
  host: string
  port: number            // SSH 端口
  username: string
  passwordEncrypted: string   // 复用 encryptApiKey
  hostKeyFingerprint: string  // sha256 base64，pin
  installDir: string          // 默认 /opt/storyfabric
  servicePort: number         // 默认 8787
  baseImage: string           // 默认 node:22-bookworm-slim
  bundleSource: 'bundled' | 'url'
  os: 'linux'
  arch?: string
  distro?: string
  dockerVersion?: string
  installedVersion?: string
  lastDeployedAt?: number
  lastStatus?: 'ok' | 'failed'
  lastError?: string
}
```

渲染层可见态 `DeployTargetPublic = Omit<DeployTargetStored, 'passwordEncrypted'> & { hasPassword: boolean }`，**密码永不返回渲染层**；连接时 `password` 缺省表示用已存密码。

### IPC

`src/shared/ipc.ts` 新增：

```ts
DeployTestConnection: 'deploy:test',
DeployInstall: 'deploy:install',
DeployUpdate: 'deploy:update',
DeployCancel: 'deploy:cancel',
DeployLogs: 'deploy:logs',
DeployUninstall: 'deploy:uninstall',
DeployListTargets: 'deploy:targets:list',
DeploySaveTarget: 'deploy:targets:save',
DeployDeleteTarget: 'deploy:targets:delete',
DeployEvent: 'deploy:event'
```

`StoryFabricApi`（`src/shared/api.ts`）同步新增对应方法；桌面端走 IPC，服务端/Android 端实现为「不支持」并抛明确错误（该功能仅桌面端）。

## 四、渲染层

欢迎页「服务」模式：

1. 新增按钮「安装到服务器」→ 打开 `DeployWizard`（整页视图，参照 `ModelManagerView` 的做法）。
2. 向导步骤：
   - **① 连接**：SSH 地址、端口（默认 22）、用户名、密码、系统（只读显示 Linux）；「测试连接」→ 显示主机指纹（sha256）并要求勾选确认；未 pin 过的目标必须确认。
   - **② 探测**：发行版、架构、Docker 版本、目标端口占用、sudo 能力；不满足条件时给出可操作提示（例如「服务器未安装 Docker」+ 官方安装指引）。
   - **③ 配置**：安装目录（默认 `/opt/storyfabric`）、服务端口（默认 `8787`）、基础镜像（默认 `node:22-bookworm-slim`）。
   - **④ 执行**：六步进度 + 实时输出（可折叠），失败停在当前步并可「重试」。
   - **⑤ 完成**：服务地址、访问密钥（可复制）、版本号；按钮「填入服务模式」。
3. 已保存服务器卡片：名称、地址、当前版本、最后状态；操作：`检查更新` / `更新` / `查看日志` / `卸载`（卸载前确认，并明确提示数据目录位置）。
   - 「检查更新」= 探测 `probe.image` 得到容器真实镜像 tag，与本地 bundle 的 `VERSION` 比较：不同即显示「有新版本可更新」。
   - 「更新」= 重新上传 bundle → 构建新 tag → `docker rm -f` → `docker run`（数据卷不动）→ 健康检查。

## 五、安全

- **主机指纹**：首次连接返回真实指纹并要求用户确认；保存后 pin，指纹变化直接拒绝并提示「服务器指纹已改变」。
- **密码**：safeStorage 加密落盘（不可用时降级并标记）；不进日志、不返回渲染层；`sudo -S` 时经 stdin 传入，不出现在命令行（避免 `ps` 泄露）。
- **命令注入**：所有用户输入（host 不进入命令；installDir / 端口 / 用户名 / 版本号）经 `shQuote`；命令模板集中在 `commands.ts`，禁止字符串拼接绕过。
- **访问密钥**：在服务器上用 `openssl rand -base64 32` 生成，`umask 077` 写入 `secrets/storyfabric_key`（0400），容器内只读挂载。

## 六、幂等与错误处理

| 情况 | 行为 |
| --- | --- |
| `uname -s` 非 Linux | 停止，提示「只支持 Linux 服务器」 |
| 未安装 Docker | 停止，按发行版给 2–3 条官方安装命令，不自动执行 |
| 非 root 且 `sudo -n` 不可用 | 用 `sudo -S` 从 stdin 喂密码；失败则提示「密码与 sudo 密码不一致」 |
| 目标端口被占用 | 报告 `ss` 输出的占用进程，让用户改端口，不自动杀 |
| 同版本镜像已存在 | `docker image inspect` 命中则跳过 `build`（步骤标记 `skipped`） |
| 容器已存在 | `docker rm -f storyfabric` 后重建；`<installDir>/data` 不动 |
| 健康检查超时 | 附带 `docker logs --tail 200`，停在 `healthcheck` 步可重试 |
| 重跑安装 | 全流程幂等：目录复用、镜像复用、容器重建、密钥不覆盖（已存在则读取） |
| 卸载 | 只删容器、镜像与该次 staging 目录，保留 `<installDir>/data`，界面明确告知数据位置 |

## 七、测试计划

core（`src/core/deploy/__tests__/`）：

- `shell.test.ts`：`shQuote` 对空格/单引号/换行/`$()`/反引号/中文；`sudoPrefix`。
- `commands.test.ts`：命令快照（含路径含空格、非默认端口、root 与非 root）；`needsSudo` 标记正确。
- `parse.test.ts`：`uname -s` 各种输出、Docker 版本解析、`ss` 占用判断、sudo 退出码、os-release 解析。
- `state.test.ts`：步骤推进、失败后重试、`skipped` 语义。

main（`src/main/services/__tests__/deployService.test.ts`，用 `FakeTransport`）：

- 成功全流程：六步依次 `running → ok`，返回 url/version/accessKey。
- 失败分支：非 Linux、Docker 缺失、端口占用、sudo 失败、健康检查超时（各断言停在哪一步 + 错误文案）。
- 幂等：镜像已存在 → `build` 为 `skipped`；容器已存在 → 先 `rm -f`。
- 凭据：保存后读回不含明文密码；`hasPassword` 为 true。

打包与验证：

- `npm run server:bundle` 产物 tar 清单与 `SHA256SUMS` 校验。
- 打包后 asar 内包含 `server-bundle.tar.gz` 与 `node_modules/ssh2/**`（用 node 读 asar 二进制核验字符串）。
- 真机走查（用户执行）：安装 → 服务器重启后容器自愈 → 更新 → 卸载保留数据；失败时贴向导日志。

## 八、验收标准

1. 欢迎页「服务」模式有「安装到服务器」入口，能填 SSH 地址/端口/用户名/密码。
2. 首次连接展示主机指纹并可确认；指纹变化时拒绝连接。
3. 探测结果正确显示，非 Linux / 无 Docker / 端口占用 / sudo 不可用都有明确提示。
4. 安装成功后能从 `http://<host>:<port>/` 用界面显示的访问密钥登录。
5. 「更新」能把服务器换成新版本且数据保留；「卸载」删容器与镜像但保留数据目录。
6. 服务器重启后容器自动恢复（`--restart unless-stopped`）。
7. 全量测试与构建通过，打包产物含 bundle 与 `ssh2`。

## 九、风险与取舍

- **`ssh2` 打包**：主进程外部化依赖 + electron-builder `files` 白名单，漏一个依赖就会在运行时 `Cannot find module`。缓解：显式列出依赖、打包后用 asar 内容核验、真机走查覆盖。
- **远程构建依赖网络**：首次 `docker build` 需要拉 `node:22-bookworm-slim`。缓解：基础镜像可配置；失败时提示改用镜像源或预拉取；将来切到 `source: url` 直接拉预构建镜像。
- **密码认证 + `sudo -S`**：要求 SSH 密码等于 sudo 密码，否则只能安装到用户目录。缓解：明确报错并提示；本次不做密钥登录。
- **无 Docker 的本机开发环境**：无法在本地跑真实镜像验证。缓解：传输层抽象 + 假传输层单测覆盖全部步骤与失败分支；真机走查由用户执行。
- **不自动装 Docker**：用户多一步手动操作，但避免改坏服务器。
