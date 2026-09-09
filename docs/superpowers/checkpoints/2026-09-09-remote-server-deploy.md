---
status: completed
branch: main
timestamp: 2026-09-09T22:50:00+08:00
files_modified:
  - src/shared/types.ts
  - src/shared/ipc.ts
  - src/shared/api.ts
  - src/core/deploy/shell.ts
  - src/core/deploy/parse.ts
  - src/core/deploy/state.ts
  - src/core/deploy/commands.ts
  - src/core/deploy/bundle.ts
  - src/main/services/ssh2Transport.ts
  - src/main/services/deployTargetsStore.ts
  - src/main/services/deployService.ts
  - src/main/ipc.ts
  - src/main/index.ts
  - src/preload/index.ts
  - src/renderer/src/pages/welcome/DeployWizard.tsx
  - src/renderer/src/pages/welcome/WelcomePage.tsx
  - src/renderer/src/platform/httpApi.ts
  - src/renderer/src/platform/androidApi.ts
  - scripts/build-server-bundle.mjs
  - scripts/build-win.ps1
  - resources/Dockerfile.runtime
  - resources/compose.runtime.yml
  - electron-builder.yml
---

## Completed: 远程服务器部署（SSH + Docker）

### Summary

用户在欢迎页填 SSH 地址/端口/用户名/密码，桌面端在远程 Linux 服务器上用 Docker 安装 StoryFabric 服务，并支持检查更新、更新、查看日志、卸载（保留数据）。设计见 `specs/2026-09-09-remote-server-deploy-design.md`，计划见 `plans/2026-09-09-remote-server-deploy.md`。

- **部署包**：`npm run server:bundle` → `release/storyfabric-server-<version>.tar.gz`（预构建 `dist-server/index.mjs` + `web/` + `Dockerfile.runtime` + entrypoint + `compose.runtime.yml` + `VERSION` + `SHA256SUMS`，约 0.66MB），经 `extraResources` 落到 `resources/server-bundle.tar.gz`。
- **core**：`shell.ts`（`shQuote` / `sudoPrefix` / 输入校验）、`parse.ts`、`state.ts`、`commands.ts`（探测/构建/启动/健康/卸载命令，sudo 只加在需要的子命令上）、`bundle.ts`。
- **主进程**：`ssh2Transport.ts`（密码认证 + sha256 主机指纹 pin + SFTP，exit 为 null 视为失败）、`deployTargetsStore.ts`（独立 `deploy-targets.json`，safeStorage 加密密码）、`deployService.ts`（六步流水线 + 进度事件 + 取消 + 日志 + 卸载）。
- **渲染层**：`DeployWizard.tsx`（连接 → 指纹核对 → 环境检查 → 配置 → 六步进度 → 完成页）+ 欢迎页「已部署的服务器」卡片（检查更新/更新/查看日志/卸载）。
- **提交**：`3f23f6e`、`6a6ce38`、`4641169`、`b3cf79c`、`dcb983a`、`1c5c722`、`9ea3ea1`、`59c7912`、`e490135`、`bc84a0a`。

### Verification Evidence

- `npm test -- --run`：**53 文件 / 309 用例通过**（新增 `src/core/deploy` 28 例 + `deployService` 20 例 + `sha256Fingerprint` 2 例）
- `npx tsc -b --pretty false`：exit 0
- `npm run build` / `npm run server:build:all` / `npm run dist:win`：exit 0
- 打包核验：`release/win-unpacked/resources/server-bundle.tar.gz`（686KB，含全部 7 项）；asar 内含 `ssh2` 及其完整依赖（`asn1` / `bcrypt-pbkdf` / `safer-buffer` / `tweetnacl`，`asar list` 实测）、`deploy:*` 通道与「安装到服务器」文案
- 假传输层覆盖：成功全流程六步转移、非 Linux、未装 Docker、端口占用、sudo 不可用、健康检查超时、镜像已存在跳过构建、密码只在 stdin、更新时端口自有、卸载失败抛错、用户名非法
- **真机走查：由用户执行**（本机无 Docker、无 Linux 服务器，端到端无法本地验证）

### 质量审查（2026-09-09）

独立只读审查共三轮，最终 **PASS**：

**第一轮 FAIL（范围 `dabd7d9..59c7912`）：2 阻塞 + 5 重大 + 7 轻微**，已修（`e490135`、`bc84a0a`）：

1. **[阻塞]** 更新永远过不了探测：`ss` 会看到自己上一版容器占用端口 → 改为「容器镜像是 storyfabric:* 时不判端口冲突」。
2. **[阻塞]** 访问密钥每次重装都重新生成、更新后旧密钥失效 → `key.generate` 改为「已存在则保留」，前端更新后同步密钥。
3. **[重大]** `stagingDir` 里的用户名未转义（注入面）→ 校验用户名 + 全部 `shQuote`。
4. **[重大]** 端口未校验就进入命令 → `validateDeployInput()` 在 `run()` 与 `testConnection()` 都执行。
5. **[重大]** docker 探测不带 sudo，非 root 用户被误报「未安装 Docker」→ 探测按 `isRoot` 加 sudo，并按 stderr 区分未安装/无权限/守护进程未运行。
6. **[重大]** `logs`/`uninstall` 硬编码非 root 且吞掉退出码 → 持久化 `isRoot`、检查退出码、只放行「不存在」。
7. **[重大]** 向导把刚看到的指纹当作 pin、并在指纹变化时预先勾选确认框 → 按主机匹配已有记录传 `id` 与已存指纹，确认框永不预勾选，指纹不一致给出中文警告。
8. **[轻微]** ssh2 `exit` 为 null 视为失败 + 每步超时；`prepare.dir` 每次都跑；向导传 `id` 避免重复记录；并发运行拒绝；健康循环响应取消；明文降级在卡片上标注；健康兜底加 sudo；`FakeTransport` 记录 stdin、未声明命令返回 127，并新增「密码不进命令」「卸载失败抛错」「更新端口自有」等测试。

**第二轮 FAIL（范围 `bc84a0a`）：原 2 阻塞 + 7 重大全部确认修复，但修复本身引入 2 新重大 + 5 轻微**，已修（`cbb71ab`）：

9. **[重大]** 非 root 的 docker 探测加了 sudo 后，「sudo 密码错误」被误报成「未安装 Docker」→ sudo 能力检查提前到 docker 探测之前（`probe.sudoError`），并映射 `dockerError` 里的 `sudo:`；向导据此阻断下一步。
10. **[重大]** 向导总是传 `id` 后，重装时新端口/安装目录不再落盘（后续「更新」会对着旧数据目录）→ `store.save` 改为无条件按 id upsert。
11. **[轻微]** 卸载恢复清理 staging 目录；首次安装失败也落 `lastStatus/lastError/isRoot`；健康检查阶段取消报「已取消」；`testConnection` 只用已保存/默认参数拼命令（堵住残留注入）；未保存密码时 `passwordStorage` 为 `none`。

**第三轮 PASS（范围 `cbb71ab`）**：审查者独立重跑 53 文件 / 308 用例、`tsc -b` exit 0，并用 esbuild 重新打包 `deployService.ts`/`commands.ts` 驱动流水线复现了 R1–R7 的修复；仅剩两条非阻塞 nit（fake 规则顺序导致 `/sudo:/` 分支未覆盖、checkpoint 数字过时），已补测试（`sudo 可用但 docker 探测仍报 sudo 错误`）并刷新本文档。

### Notes and Risks

- **真机行为未验证**：安装/重启自愈/更新/卸载保留数据，需要用户在一台 Linux 服务器上走查；失败时把向导日志贴出来即可定位。
- 服务器首次构建需要能拉 `node:22-bookworm-slim`（可在向导改基础镜像）；Docker 缺失只提示不自动安装。
- 只支持密码登录；非 root 时要求 SSH 密码等于 sudo 密码。
- 卸载只删容器/镜像/staging，`<安装目录>/data` 一律保留。
- `hostVerifier` 的 pin 逻辑有纯函数单测与路径审查，但没有真实服务器级别的自动化测试。
