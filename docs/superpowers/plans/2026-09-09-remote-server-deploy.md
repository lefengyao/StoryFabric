# 远程服务器部署（SSH + Docker）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让桌面端通过 SSH 在远程 Linux 服务器上用 Docker 安装/更新 StoryFabric 服务，并把「服务地址 + 访问密钥」直接带进现有服务模式。

**Architecture:** 纯逻辑放 `src/core/deploy`（命令生成、输出解析、步骤状态机、bundle 清单），主进程 `deployService` 通过可替换的 `SshTransport` 执行（生产用 `ssh2`，测试用 `FakeTransport`），渲染层只做向导 UI 与进度展示；部署包由 `scripts/build-server-bundle.mjs` 生成并经 `extraResources` 随安装包分发。

**Tech Stack:** Electron + React 19 + TypeScript + Vitest 4；新增生产依赖 `ssh2`、开发依赖 `tar`。

**Spec:** `docs/superpowers/specs/2026-09-09-remote-server-deploy-design.md`

---

## File Structure

**新建**

| 文件 | 职责 |
| --- | --- |
| `src/core/deploy/shell.ts` | `shQuote` / `sudoPrefix`，防止命令注入 |
| `src/core/deploy/parse.ts` | 探测输出解析 |
| `src/core/deploy/state.ts` | 步骤序列与推进规则 |
| `src/core/deploy/commands.ts` | 生成带 `needsSudo` 元数据的远程命令 |
| `src/core/deploy/bundle.ts` | 部署包清单与文件名规则 |
| `src/main/services/ssh2Transport.ts` | `ssh2` 实现的 `SshTransport` |
| `src/main/services/deployTargetsStore.ts` | `deploy-targets.json` 读写（密码加密） |
| `src/main/services/deployService.ts` | 六步流水线、进度事件、取消、日志、卸载 |
| `src/main/services/__tests__/fakeTransport.ts` | 测试用传输层 |
| `src/main/services/__tests__/deployService.test.ts` | 流水线成功/失败/幂等/凭据 |
| `scripts/build-server-bundle.mjs` | 生成 `storyfabric-server-<version>.tar.gz` |
| `resources/Dockerfile.runtime` | 只 COPY 产物的运行时镜像 |
| `resources/compose.runtime.yml` | 可选 compose 模板 |
| `src/renderer/src/pages/welcome/DeployWizard.tsx` | 安装向导整页 |

**修改**

| 文件 | 改动 |
| --- | --- |
| `src/shared/types.ts` | 部署相关类型 |
| `src/shared/ipc.ts` / `src/shared/api.ts` | 新增通道与方法 |
| `src/main/ipc.ts` / `src/preload/index.ts` | 接线 |
| `src/renderer/src/platform/httpApi.ts` / `androidApi.ts` | 抛「仅桌面端支持」 |
| `src/renderer/src/pages/welcome/WelcomePage.tsx` | 「安装到服务器」入口 + 已保存服务器卡片 |
| `electron-builder.yml` / `scripts/build-win.ps1` / `package.json` | 打包接入 |
| `electron.vite.config.ts` | 主进程排除 `ssh2` 的 external 处理（保持 external，不改） |

---

### Task 1: 共享类型 + core 纯函数（shell / parse / state / bundle）

**Files:**
- Modify: `src/shared/types.ts`（追加在文件末尾）
- Create: `src/core/deploy/shell.ts`、`parse.ts`、`state.ts`、`bundle.ts`
- Test: `src/core/deploy/__tests__/shell.test.ts`、`parse.test.ts`、`state.test.ts`、`bundle.test.ts`

- [ ] **Step 1: 追加共享类型**

```ts
/* ---------------- 远程部署 ---------------- */

export type DeployStep = 'connect' | 'probe' | 'upload' | 'build' | 'run' | 'healthcheck'
export type DeployStepStatus = 'pending' | 'running' | 'ok' | 'failed' | 'skipped'

/** 单步进度（主进程 → 渲染进程） */
export interface DeployProgress {
  runId: string
  step: DeployStep
  status: DeployStepStatus
  message?: string
  output?: string
  at: number
}

export interface DeployProbeResult {
  os: string
  arch: string
  distro?: string
  isRoot: boolean
  /** `sudo -n true` 成功（免密 sudo） */
  passwordlessSudo: boolean
  dockerVersion?: string
  portFree: boolean
  portOwner?: string
  /** 服务器上现有 storyfabric 容器的镜像 tag */
  installedImage?: string
}

export interface DeployConnectionInput {
  targetId?: string
  host: string
  port: number
  username: string
  /** 缺省表示使用已保存密码 */
  password?: string
}

export interface DeployTestResult {
  fingerprint: string
  probe: DeployProbeResult
  /** 已保存目标且指纹不一致 */
  fingerprintChanged: boolean
}

export interface DeployOptions {
  installDir: string
  servicePort: number
  baseImage: string
}

export interface DeployRunResult {
  ok: boolean
  version?: string
  url?: string
  accessKey?: string
  failedStep?: DeployStep
  error?: string
}

export interface DeployTargetStored {
  id: string
  label: string
  host: string
  port: number
  username: string
  passwordEncrypted: string
  hostKeyFingerprint: string
  installDir: string
  servicePort: number
  baseImage: string
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

export type DeployTargetPublic = Omit<DeployTargetStored, 'passwordEncrypted'> & { hasPassword: boolean }

export interface DeployTargetInput {
  id?: string
  label: string
  host: string
  port: number
  username: string
  password?: string
  hostKeyFingerprint?: string
  installDir: string
  servicePort: number
  baseImage: string
}
```

- [ ] **Step 2: 写失败的测试**

`src/core/deploy/__tests__/shell.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { shQuote, sudoPrefix } from '../shell'

describe('shQuote', () => {
  it('普通值加单引号', () => {
    expect(shQuote('storyfabric')).toBe("'storyfabric'")
    expect(shQuote('/opt/story fabric')).toBe("'/opt/story fabric'")
  })

  it('单引号被正确转义', () => {
    expect(shQuote("it's")).toBe("'it'\\''s'")
  })

  it('命令替换与反引号被中和', () => {
    expect(shQuote('$(rm -rf /)')).toBe("'$(rm -rf /)'")
    expect(shQuote('`whoami`')).toBe("'`whoami`'")
    expect(shQuote('a\nb')).toBe("'a\nb'")
  })

  it('空串返回一对引号', () => {
    expect(shQuote('')).toBe("''")
  })
})

describe('sudoPrefix', () => {
  it('root 不加 sudo，非 root 用 sudo -S（从 stdin 读密码）', () => {
    expect(sudoPrefix(true)).toBe('')
    expect(sudoPrefix(false)).toBe('sudo -S ')
  })
})
```

`src/core/deploy/__tests__/parse.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { parseContainerImage, parseDockerVersion, parseOs, parseOsRelease, parsePasswordlessSudo, parsePortInUse } from '../parse'

describe('parseOs', () => {
  it('Linux 通过，其它拒绝', () => {
    expect(parseOs('Linux\n')).toBe('linux')
    expect(parseOs('Darwin')).toBe('unsupported')
    expect(parseOs('MINGW64_NT-10.0')).toBe('unsupported')
  })
})

describe('parseDockerVersion', () => {
  it('取出版本号，缺失返回 undefined', () => {
    expect(parseDockerVersion('27.1.1\n')).toBe('27.1.1')
    expect(parseDockerVersion('')).toBeUndefined()
    expect(parseDockerVersion('docker: command not found')).toBeUndefined()
  })
})

describe('parsePortInUse', () => {
  it('ss 输出含 LISTEN 视为占用', () => {
    expect(parsePortInUse('State Recv-Q Send-Q Local Address:Port\nLISTEN 0 128 0.0.0.0:8787 0.0.0.0:*')).toBe(true)
    expect(parsePortInUse('State Recv-Q Send-Q Local Address:Port')).toBe(false)
  })
})

describe('parsePasswordlessSudo', () => {
  it('退出码 0 表示免密 sudo 可用', () => {
    expect(parsePasswordlessSudo(0)).toBe(true)
    expect(parsePasswordlessSudo(1)).toBe(false)
  })
})

describe('parseOsRelease', () => {
  it('解析 ID 与 PRETTY_NAME', () => {
    const text = 'PRETTY_NAME="Ubuntu 24.04.1 LTS"\nID=ubuntu\n'
    expect(parseOsRelease(text)).toEqual({ id: 'ubuntu', prettyName: 'Ubuntu 24.04.1 LTS' })
  })
})

describe('parseContainerImage', () => {
  it('从 inspect 输出取镜像 tag', () => {
    expect(parseContainerImage('storyfabric:0.1.0\n')).toBe('storyfabric:0.1.0')
    expect(parseContainerImage('Error: No such object')).toBeUndefined()
  })
})
```

`src/core/deploy/__tests__/state.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { DEPLOY_STEPS, nextStep, stepIndex } from '../state'

describe('部署步骤', () => {
  it('顺序固定', () => {
    expect(DEPLOY_STEPS).toEqual(['connect', 'probe', 'upload', 'build', 'run', 'healthcheck'])
    expect(stepIndex('build')).toBe(3)
  })

  it('成功则前进，失败停在原地（可重试），最后一步成功返回 null', () => {
    expect(nextStep('connect', true)).toBe('probe')
    expect(nextStep('connect', false)).toBe('connect')
    expect(nextStep('healthcheck', true)).toBeNull()
    expect(nextStep('healthcheck', false)).toBe('healthcheck')
  })
})
```

`src/core/deploy/__tests__/bundle.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { BUNDLE_ENTRIES, bundleFileName } from '../bundle'

describe('部署包清单', () => {
  it('文件名带版本号', () => {
    expect(bundleFileName('0.1.0')).toBe('storyfabric-server-0.1.0.tar.gz')
  })

  it('清单包含服务端、前端与运行时文件', () => {
    expect(BUNDLE_ENTRIES).toEqual([
      'dist-server/index.mjs',
      'web',
      'Dockerfile.runtime',
      'docker-entrypoint.sh',
      'compose.runtime.yml',
      'VERSION',
      'SHA256SUMS'
    ])
  })
})
```

- [ ] **Step 3: 运行，确认失败**

Run: `npx vitest run src/core/deploy`
Expected: FAIL —— 模块不存在

- [ ] **Step 4: 实现四个模块**

`src/core/deploy/shell.ts`：

```ts
/** POSIX 单引号转义：所有进入远程命令的用户输入都必须经过它。 */
export function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** root 直接执行；非 root 用 `sudo -S`，密码由传输层写入 stdin（不进命令行）。 */
export function sudoPrefix(isRoot: boolean): string {
  return isRoot ? '' : 'sudo -S '
}
```

`src/core/deploy/parse.ts`：

```ts
/** 远程探测输出的解析。 */
export function parseOs(unameS: string): 'linux' | 'unsupported' {
  return unameS.trim().toLowerCase() === 'linux' ? 'linux' : 'unsupported'
}

export function parseDockerVersion(output: string): string | undefined {
  const text = output.trim()
  return /^\d+\.\d+\.\d+/.test(text) ? text.split('\n')[0].trim() : undefined
}

export function parsePortInUse(ssOutput: string): boolean {
  return /LISTEN/i.test(ssOutput)
}

export function parsePasswordlessSudo(exitCode: number): boolean {
  return exitCode === 0
}

export function parseOsRelease(text: string): { id?: string; prettyName?: string } {
  const id = /^ID=(.*)$/m.exec(text)?.[1]?.replace(/^"|"$/g, '')
  const prettyName = /^PRETTY_NAME=(.*)$/m.exec(text)?.[1]?.replace(/^"|"$/g, '')
  return { id, prettyName }
}

export function parseContainerImage(inspectOutput: string): string | undefined {
  const text = inspectOutput.trim()
  if (!text || /^error/i.test(text)) return undefined
  return text.split('\n')[0].trim()
}
```

`src/core/deploy/state.ts`：

```ts
import type { DeployStep } from '../../shared/types'

export const DEPLOY_STEPS: readonly DeployStep[] = ['connect', 'probe', 'upload', 'build', 'run', 'healthcheck']

export function stepIndex(step: DeployStep): number {
  return DEPLOY_STEPS.indexOf(step)
}

/** 成功则前进；失败停在当前步（可重试）；最后一步成功后返回 null。 */
export function nextStep(current: DeployStep, ok: boolean): DeployStep | null {
  if (!ok) return current
  const next = DEPLOY_STEPS[stepIndex(current) + 1]
  return next ?? null
}
```

`src/core/deploy/bundle.ts`：

```ts
/** 部署包（storyfabric-server-<version>.tar.gz）的清单与命名。 */
export const BUNDLE_ENTRIES = [
  'dist-server/index.mjs',
  'web',
  'Dockerfile.runtime',
  'docker-entrypoint.sh',
  'compose.runtime.yml',
  'VERSION',
  'SHA256SUMS'
] as const

export function bundleFileName(version: string): string {
  return `storyfabric-server-${version}.tar.gz`
}
```

- [ ] **Step 5: 运行，确认通过**

Run: `npx vitest run src/core/deploy`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add src/shared/types.ts src/core/deploy
git commit -m "feat(deploy): add deploy types and core pure helpers"
```

---

### Task 2: 远程命令生成（TDD）

**Files:**
- Create: `src/core/deploy/commands.ts`
- Test: `src/core/deploy/__tests__/commands.test.ts`

- [ ] **Step 1: 写失败的测试**

```ts
import { describe, expect, it } from 'vitest'
import { buildCommands, healthCommand, logsCommand, probeCommands, runCommands, uninstallCommands } from '../commands'

const ctx = {
  installDir: '/opt/storyfabric',
  servicePort: 8787,
  baseImage: 'node:22-bookworm-slim',
  version: '0.1.0',
  stagingDir: '/home/me/.storyfabric-staging/0.1.0',
  isRoot: false
}

describe('probeCommands', () => {
  it('包含系统、架构、docker、端口与现有镜像探测', () => {
    const ids = probeCommands(ctx).map((c) => c.id)
    expect(ids).toEqual(['probe.os', 'probe.arch', 'probe.distro', 'probe.user', 'probe.sudo', 'probe.docker', 'probe.port', 'probe.image'])
  })

  it('端口探测用用户配置的端口', () => {
    const port = probeCommands({ ...ctx, servicePort: 9000 }).find((c) => c.id === 'probe.port')
    expect(port?.command).toContain(':9000')
  })
})

describe('buildCommands', () => {
  it('非 root 时 build 与目录准备带 sudo -S', () => {
    const cmds = buildCommands(ctx)
    expect(cmds.find((c) => c.id === 'build')?.command).toBe(
      "cd '/home/me/.storyfabric-staging/0.1.0' && sudo -S docker build -f Dockerfile.runtime -t storyfabric:0.1.0 --build-arg BASE_IMAGE='node:22-bookworm-slim' ."
    )
    expect(cmds.find((c) => c.id === 'prepare.dir')?.command).toContain('sudo -S mkdir -p')
    expect(cmds.find((c) => c.id === 'image.exists')?.needsSudo).toBe(false)
  })

  it('root 时不加 sudo', () => {
    const cmds = buildCommands({ ...ctx, isRoot: true })
    expect(cmds.find((c) => c.id === 'build')?.command.startsWith('cd ')).toBe(true)
    expect(cmds.find((c) => c.id === 'build')?.command).not.toContain('sudo')
  })

  it('路径含空格时被正确转义', () => {
    const cmds = buildCommands({ ...ctx, installDir: '/opt/story fabric', isRoot: true })
    expect(cmds.find((c) => c.id === 'prepare.dir')?.command).toContain("'/opt/story fabric'")
  })
})

describe('runCommands', () => {
  it('先删旧容器再启动，挂载数据与密钥', () => {
    const cmds = runCommands(ctx)
    expect(cmds.map((c) => c.id)).toEqual(['key.generate', 'key.read', 'run.rm', 'run.start'])
    const start = cmds.find((c) => c.id === 'run.start')?.command ?? ''
    expect(start).toContain('-p 8787:8787')
    expect(start).toContain("-v '/opt/storyfabric/data':/data")
    expect(start).toContain("-v '/opt/storyfabric/secrets/storyfabric_key':/run/secrets/storyfabric_key:ro")
    expect(start).toContain('--restart unless-stopped')
    expect(start).toContain('storyfabric:0.1.0')
  })
})

describe('healthCommand / logsCommand / uninstallCommands', () => {
  it('健康检查读容器自带 HEALTHCHECK 状态', () => {
    expect(healthCommand(ctx).command).toContain('.State.Health.Status')
  })

  it('日志取最近 200 行', () => {
    expect(logsCommand(ctx).command).toBe('sudo -S docker logs --tail 200 storyfabric')
  })

  it('卸载删容器、镜像与 staging，不动数据目录', () => {
    const commands = uninstallCommands(ctx).map((c) => c.command).join('\n')
    expect(commands).toContain('docker rm -f storyfabric')
    expect(commands).toContain('docker rmi storyfabric:0.1.0')
    expect(commands).toContain("rm -rf '/home/me/.storyfabric-staging/0.1.0'")
    expect(commands).not.toContain('rm -rf /opt/storyfabric/data')
  })
})
```

- [ ] **Step 2: 运行，确认失败**

Run: `npx vitest run src/core/deploy/__tests__/commands.test.ts`
Expected: FAIL —— 模块不存在

- [ ] **Step 3: 实现 `commands.ts`**

```ts
/** 生成远程命令（集中在这里，禁止在别处拼接 shell 字符串）。 */
import { shQuote, sudoPrefix } from './shell'

export interface DeployCommand {
  id: string
  title: string
  command: string
  needsSudo: boolean
}

export interface DeployContext {
  installDir: string
  servicePort: number
  baseImage: string
  version: string
  stagingDir: string
  isRoot: boolean
}

export const CONTAINER_NAME = 'storyfabric'
export const IMAGE_NAME = 'storyfabric'

function cmd(ctx: DeployContext, id: string, title: string, body: string, needsSudo = false): DeployCommand {
  return { id, title, command: (needsSudo ? sudoPrefix(ctx.isRoot) : '') + body, needsSudo }
}

export function probeCommands(ctx: DeployContext): DeployCommand[] {
  return [
    cmd(ctx, 'probe.os', '检查系统', 'uname -s'),
    cmd(ctx, 'probe.arch', '检查架构', 'uname -m'),
    cmd(ctx, 'probe.distro', '检查发行版', 'cat /etc/os-release'),
    cmd(ctx, 'probe.user', '检查当前用户', 'id -u'),
    cmd(ctx, 'probe.sudo', '检查免密 sudo', 'sudo -n true'),
    cmd(ctx, 'probe.docker', '检查 Docker', "docker version --format '{{.Server.Version}}'"),
    cmd(ctx, 'probe.port', '检查端口占用', `ss -ltn 'sport = :${ctx.servicePort}'`),
    cmd(ctx, 'probe.image', '检查已安装版本', `docker inspect --format '{{.Config.Image}}' ${CONTAINER_NAME}`)
  ]
}

export function prepareCommands(ctx: DeployContext): DeployCommand[] {
  return [
    cmd(ctx, 'prepare.dir', '创建安装目录', `mkdir -p ${shQuote(`${ctx.installDir}/data`)} ${shQuote(`${ctx.installDir}/secrets`)}`, true)
  ]
}

export function buildCommands(ctx: DeployContext): DeployCommand[] {
  const image = `${IMAGE_NAME}:${ctx.version}`
  return [
    ...prepareCommands(ctx),
    cmd(ctx, 'image.exists', '检查镜像是否已存在', `docker image inspect ${shQuote(image)} >/dev/null 2>&1`),
    cmd(
      ctx,
      'build',
      '构建镜像',
      `cd ${shQuote(ctx.stagingDir)} && docker build -f Dockerfile.runtime -t ${shQuote(image)} --build-arg BASE_IMAGE=${shQuote(ctx.baseImage)} .`,
      true
    )
  ]
}

export function runCommands(ctx: DeployContext): DeployCommand[] {
  const image = `${IMAGE_NAME}:${ctx.version}`
  const keyPath = `${ctx.installDir}/secrets/storyfabric_key`
  return [
    cmd(ctx, 'key.generate', '生成访问密钥', `umask 077 && openssl rand -base64 32 > ${shQuote(keyPath)}`, true),
    cmd(ctx, 'key.read', '读取访问密钥', `cat ${shQuote(keyPath)}`, true),
    cmd(ctx, 'run.rm', '移除旧容器', `docker rm -f ${CONTAINER_NAME} >/dev/null 2>&1 || true`, true),
    cmd(
      ctx,
      'run.start',
      '启动容器',
      [
        `docker run -d --name ${CONTAINER_NAME} --restart unless-stopped`,
        `-p ${ctx.servicePort}:8787`,
        `-v ${shQuote(`${ctx.installDir}/data`)}:/data`,
        `-v ${shQuote(keyPath)}:/run/secrets/storyfabric_key:ro`,
        '-e STORYFABRIC_ACCESS_KEY_FILE=/run/secrets/storyfabric_key',
        shQuote(image)
      ].join(' '),
      true
    )
  ]
}

export function healthCommand(ctx: DeployContext): DeployCommand {
  return cmd(
    ctx,
    'health',
    '健康检查',
    `docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' ${CONTAINER_NAME}`,
    true
  )
}

export function logsCommand(ctx: DeployContext): DeployCommand {
  return cmd(ctx, 'logs', '查看日志', `docker logs --tail 200 ${CONTAINER_NAME}`, true)
}

export function uninstallCommands(ctx: DeployContext): DeployCommand[] {
  return [
    cmd(ctx, 'uninstall.container', '删除容器', `docker rm -f ${CONTAINER_NAME} >/dev/null 2>&1 || true`, true),
    cmd(ctx, 'uninstall.image', '删除镜像', `docker rmi ${shQuote(`${IMAGE_NAME}:${ctx.version}`)} >/dev/null 2>&1 || true`, true),
    cmd(ctx, 'cleanup.staging', '清理上传目录', `rm -rf ${shQuote(ctx.stagingDir)}`)
  ]
}
```

- [ ] **Step 4: 运行，确认通过**

Run: `npx vitest run src/core/deploy`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/core/deploy/commands.ts src/core/deploy/__tests__/commands.test.ts
git commit -m "feat(deploy): generate remote docker commands with sudo handling"
```

---

### Task 3: 部署包生成脚本与打包接入

**Files:**
- Create: `resources/Dockerfile.runtime`、`resources/compose.runtime.yml`、`scripts/build-server-bundle.mjs`
- Modify: `package.json`、`electron-builder.yml`、`scripts/build-win.ps1`

- [ ] **Step 1: 安装打包依赖**

Run: `npm i -D tar`
Expected: `package.json` 的 devDependencies 出现 `tar`

- [ ] **Step 2: 写运行时镜像与 compose 模板**

`resources/Dockerfile.runtime`：内容与 spec §一 的 `Dockerfile.runtime` 完全一致。

`resources/compose.runtime.yml`：

```yaml
services:
  storyfabric:
    image: storyfabric:__VERSION__
    container_name: storyfabric
    restart: unless-stopped
    ports:
      - "__PORT__:8787"
    volumes:
      - __INSTALL_DIR__/data:/data
      - __INSTALL_DIR__/secrets/storyfabric_key:/run/secrets/storyfabric_key:ro
    environment:
      STORYFABRIC_ACCESS_KEY_FILE: /run/secrets/storyfabric_key
```

- [ ] **Step 3: 写生成脚本**

`scripts/build-server-bundle.mjs`：

```js
/** 生成随安装包分发的服务端部署包：release/storyfabric-server-<version>.tar.gz */
import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { execFileSync } from 'node:child_process'
import { create as tarCreate } from 'tar'

const root = resolve(import.meta.dirname, '..')
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf-8'))
const version = pkg.version
const releaseDir = join(root, 'release')
const stage = join(releaseDir, 'server-bundle')
const outFile = join(releaseDir, `storyfabric-server-${version}.tar.gz`)

execFileSync('npm', ['run', 'web:build'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' })
execFileSync('npm', ['run', 'server:build'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' })

await rm(stage, { recursive: true, force: true })
await mkdir(stage, { recursive: true })
await cp(join(root, 'dist-server'), join(stage, 'dist-server'), { recursive: true })
await cp(join(root, 'out', 'web'), join(stage, 'web'), { recursive: true })
await cp(join(root, 'resources', 'Dockerfile.runtime'), join(stage, 'Dockerfile.runtime'))
await cp(join(root, 'resources', 'compose.runtime.yml'), join(stage, 'compose.runtime.yml'))
await cp(join(root, 'scripts', 'docker-entrypoint.sh'), join(stage, 'docker-entrypoint.sh'))
await writeFile(join(stage, 'VERSION'), `${version}\n`, 'utf-8')

const sums = []
for (const entry of ['dist-server/index.mjs', 'Dockerfile.runtime', 'docker-entrypoint.sh', 'compose.runtime.yml', 'VERSION']) {
  const hash = createHash('sha256').update(await readFile(join(stage, entry))).digest('hex')
  sums.push(`${hash}  ${entry}`)
}
await writeFile(join(stage, 'SHA256SUMS'), `${sums.join('\n')}\n`, 'utf-8')

await rm(outFile, { force: true })
await pipeline(
  tarCreate({ gzip: true, cwd: stage, portable: true }, await readdir(stage)),
  createWriteStream(outFile)
)
const archiveHash = createHash('sha256').update(await readFile(outFile)).digest('hex')
console.log(`[server-bundle] ${outFile}`)
console.log(`[server-bundle] sha256=${archiveHash}`)
```

- [ ] **Step 4: 加 npm script**

`package.json` scripts 增加：

```json
"server:bundle": "node scripts/build-server-bundle.mjs",
```

- [ ] **Step 5: 打包配置接入**

`electron-builder.yml`：

```yaml
extraResources:
  - from: resources/icon.ico
    to: icon.ico
  - from: release/storyfabric-server-${version}.tar.gz
    to: server-bundle.tar.gz
files:
  - out/**
  - package.json
  - node_modules/ssh2/**
  - node_modules/asn1/**
  - node_modules/bcrypt-pbkdf/**
  - node_modules/safer-buffer/**
  - node_modules/tweetnacl/**
```

`scripts/build-win.ps1` 在 `npx electron-vite build` 之前插入：

```powershell
npm run server:bundle
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
```

- [ ] **Step 6: 验证产物**

Run: `npm run server:bundle`
Expected: 输出 `release/storyfabric-server-0.1.0.tar.gz` 与 sha256

Run: `node -e "const {execFileSync}=require('child_process');console.log(execFileSync('tar',['-tzf','release/storyfabric-server-0.1.0.tar.gz'],{encoding:'utf8'}))"`
Expected: 列出 `dist-server/`、`web/`、`Dockerfile.runtime`、`docker-entrypoint.sh`、`compose.runtime.yml`、`VERSION`、`SHA256SUMS`

- [ ] **Step 7: 提交**

```bash
git add package.json package-lock.json electron-builder.yml scripts/build-win.ps1 scripts/build-server-bundle.mjs resources/Dockerfile.runtime resources/compose.runtime.yml
git commit -m "build: ship prebuilt server bundle for remote docker deploy"
```

---

### Task 4: SSH 传输层（ssh2 + Fake）

**Files:**
- Create: `src/main/services/ssh2Transport.ts`、`src/main/services/__tests__/fakeTransport.ts`
- Modify: `package.json`（生产依赖）

- [ ] **Step 1: 安装依赖**

Run: `npm i ssh2 && npm i -D @types/ssh2`
Expected: `dependencies` 出现 `ssh2`

- [ ] **Step 2: 定义并实现传输层**

`src/main/services/ssh2Transport.ts`：

```ts
/** ssh2 实现的 SshTransport：密码认证、主机指纹校验、SFTP 上传。 */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { Client } from 'ssh2'

export interface SshExecResult {
  code: number
  stdout: string
  stderr: string
}

export interface SshConnectConfig {
  host: string
  port: number
  username: string
  password: string
  /** 已 pin 的 sha256 指纹（base64）；缺省表示首次连接 */
  hostKeyFingerprint?: string
}

export interface SshTransport {
  connect(config: SshConnectConfig): Promise<{ fingerprint: string }>
  exec(command: string, options?: { stdin?: string; onData?: (chunk: string) => void; timeoutMs?: number }): Promise<SshExecResult>
  upload(localPath: string, remotePath: string): Promise<void>
  dispose(): Promise<void>
}

export class Ssh2Transport implements SshTransport {
  private client = new Client()
  private fingerprint = ''
  private pinned: string | undefined

  connect(config: SshConnectConfig): Promise<{ fingerprint: string }> {
    this.pinned = config.hostKeyFingerprint
    return new Promise((resolve, reject) => {
      this.client.on('ready', () => resolve({ fingerprint: this.fingerprint }))
      this.client.on('error', reject)
      this.client.connect({
        host: config.host,
        port: config.port,
        username: config.username,
        password: config.password,
        readyTimeout: 15000,
        hostVerifier: (key: Buffer) => {
          const fingerprint = createHash('sha256').update(key).digest('base64')
          this.fingerprint = fingerprint
          if (!this.pinned) return true
          return this.pinned === fingerprint
        }
      })
    })
  }

  exec(command: string, options: { stdin?: string; onData?: (chunk: string) => void; timeoutMs?: number } = {}): Promise<SshExecResult> {
    return new Promise((resolve, reject) => {
      this.client.exec(command, (err, stream) => {
        if (err) return reject(err)
        let stdout = ''
        let stderr = ''
        let code = 0
        const timer = options.timeoutMs
          ? setTimeout(() => {
              stream.close()
              reject(new Error(`命令超时：${command}`))
            }, options.timeoutMs)
          : null
        stream.on('data', (chunk: Buffer) => {
          const text = chunk.toString('utf-8')
          stdout += text
          options.onData?.(text)
        })
        stream.stderr.on('data', (chunk: Buffer) => {
          const text = chunk.toString('utf-8')
          stderr += text
          options.onData?.(text)
        })
        stream.on('exit', (exitCode: number | null) => {
          code = exitCode ?? 0
        })
        stream.on('close', () => {
          if (timer) clearTimeout(timer)
          resolve({ code, stdout, stderr })
        })
        if (options.stdin) stream.end(options.stdin)
      })
    })
  }

  upload(localPath: string, remotePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.sftp((err, sftp) => {
        if (err) return reject(err)
        sftp.fastPut(localPath, remotePath, (putErr) => (putErr ? reject(putErr) : resolve()))
      })
    })
  }

  dispose(): Promise<void> {
    this.client.end()
    return Promise.resolve()
  }
}

/** 供上传大文件时按需创建读取流（SFTP fastPut 内部使用路径，这里保留给未来分片上传）。 */
export function openRead(localPath: string): NodeJS.ReadableStream {
  return createReadStream(localPath)
}
```

`src/main/services/__tests__/fakeTransport.ts`：

```ts
import type { SshConnectConfig, SshExecResult, SshTransport } from '../ssh2Transport'

export interface FakeRule {
  /** 命中前缀即返回该结果 */
  match: string
  result: SshExecResult
}

export class FakeTransport implements SshTransport {
  readonly calls: string[] = []
  readonly uploads: Array<{ local: string; remote: string }> = []
  private rules: FakeRule[]

  constructor(rules: FakeRule[], private readonly fingerprint = 'fp-sha256-test') {
    this.rules = rules
  }

  async connect(config: SshConnectConfig): Promise<{ fingerprint: string }> {
    this.calls.push(`connect ${config.host}:${config.port}`)
    if (config.hostKeyFingerprint && config.hostKeyFingerprint !== this.fingerprint) {
      throw new Error('主机指纹不匹配')
    }
    return { fingerprint: this.fingerprint }
  }

  async exec(command: string, options: { stdin?: string; onData?: (chunk: string) => void } = {}): Promise<SshExecResult> {
    this.calls.push(command)
    const rule = this.rules.find((r) => command.includes(r.match))
    const result = rule?.result ?? { code: 0, stdout: '', stderr: '' }
    if (result.stdout) options.onData?.(result.stdout)
    if (result.stderr) options.onData?.(result.stderr)
    return result
  }

  async upload(local: string, remote: string): Promise<void> {
    this.calls.push(`upload ${remote}`)
    this.uploads.push({ local, remote })
  }

  async dispose(): Promise<void> {
    this.calls.push('dispose')
  }
}
```

- [ ] **Step 3: 类型检查**

Run: `npx tsc -b --pretty false`
Expected: exit 0（若 `ssh2` 类型缺失，确认 `@types/ssh2` 已安装）

- [ ] **Step 4: 提交**

```bash
git add package.json package-lock.json src/main/services/ssh2Transport.ts src/main/services/__tests__/fakeTransport.ts
git commit -m "feat(deploy): add ssh2 transport with injectable interface"
```

---

### Task 5: 部署流水线（TDD，用 FakeTransport）

**Files:**
- Create: `src/main/services/deployTargetsStore.ts`、`src/main/services/deployService.ts`
- Test: `src/main/services/__tests__/deployService.test.ts`

- [ ] **Step 1: 写失败的测试**

```ts
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DeployService } from '../deployService'
import { DeployTargetsStore } from '../deployTargetsStore'
import { FakeTransport, type FakeRule } from './fakeTransport'

const linuxRules: FakeRule[] = [
  { match: 'uname -s', result: { code: 0, stdout: 'Linux\n', stderr: '' } },
  { match: 'uname -m', result: { code: 0, stdout: 'x86_64\n', stderr: '' } },
  { match: 'cat /etc/os-release', result: { code: 0, stdout: 'PRETTY_NAME="Ubuntu 24.04 LTS"\nID=ubuntu\n', stderr: '' } },
  { match: 'id -u', result: { code: 0, stdout: '1000\n', stderr: '' } },
  { match: 'sudo -n true', result: { code: 0, stdout: '', stderr: '' } },
  { match: 'docker version', result: { code: 0, stdout: '27.1.1\n', stderr: '' } },
  { match: 'ss -ltn', result: { code: 0, stdout: 'State Recv-Q Send-Q Local Address:Port\n', stderr: '' } },
  { match: 'docker inspect --format', result: { code: 1, stdout: '', stderr: 'Error: No such object' } },
  { match: 'docker image inspect', result: { code: 1, stdout: '', stderr: '' } },
  { match: 'docker build', result: { code: 0, stdout: 'Successfully tagged storyfabric:0.1.0\n', stderr: '' } },
  { match: 'openssl rand', result: { code: 0, stdout: '', stderr: '' } },
  { match: 'cat /opt/storyfabric/secrets/storyfabric_key', result: { code: 0, stdout: 'test-access-key\n', stderr: '' } },
  { match: 'docker rm -f', result: { code: 0, stdout: 'storyfabric\n', stderr: '' } },
  { match: 'docker run -d', result: { code: 0, stdout: 'container-id\n', stderr: '' } },
  { match: '.State.Health.Status', result: { code: 0, stdout: 'healthy\n', stderr: '' } }
]

async function withService(run: (service: DeployService, store: DeployTargetsStore, transport: FakeTransport) => Promise<void>, rules = linuxRules): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'sf-deploy-'))
  const bundlePath = join(dir, 'server-bundle.tar.gz')
  await writeFile(bundlePath, 'fake-bundle')
  const store = new DeployTargetsStore(join(dir, 'deploy-targets.json'))
  const transport = new FakeTransport(rules)
  const service = new DeployService({
    store,
    createTransport: () => transport,
    bundlePath,
    version: '0.1.0',
    // 测试里不真的等 2 秒 × 30 次
    healthAttempts: 2,
    healthPollMs: 0
  })
  try {
    await run(service, store, transport)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** 把连续重复的 step:status 折叠掉，只看步骤转移 */
function transitions(events: string[]): string[] {
  return events.filter((event, index) => event !== events[index - 1])
}

const target = { label: '测试机', host: '10.0.0.5', port: 22, username: 'me', password: 'pw', installDir: '/opt/storyfabric', servicePort: 8787, baseImage: 'node:22-bookworm-slim' }

describe('DeployService', () => {
  it('成功安装：六步依次推进，返回地址与访问密钥', async () => {
    await withService(async (service) => {
      const events: string[] = []
      const result = await service.install(target, (p) => events.push(`${p.step}:${p.status}`))
      expect(result.ok).toBe(true)
      expect(result.url).toBe('http://10.0.0.5:8787')
      expect(result.accessKey).toBe('test-access-key')
      expect(result.version).toBe('0.1.0')
      expect(transitions(events)).toEqual([
        'connect:running', 'connect:ok',
        'probe:running', 'probe:ok',
        'upload:running', 'upload:ok',
        'build:running', 'build:ok',
        'run:running', 'run:ok',
        'healthcheck:running', 'healthcheck:ok'
      ])
    })
  })

  it('非 Linux 服务器直接失败在 probe', async () => {
    const rules = linuxRules.map((r) => (r.match === 'uname -s' ? { ...r, result: { code: 0, stdout: 'Darwin\n', stderr: '' } } : r))
    await withService(async (service) => {
      const result = await service.install(target, () => {})
      expect(result.ok).toBe(false)
      expect(result.failedStep).toBe('probe')
      expect(result.error).toContain('只支持 Linux')
    }, rules)
  })

  it('未安装 Docker 时失败并给出指引', async () => {
    const rules = linuxRules.map((r) => (r.match === 'docker version' ? { ...r, result: { code: 127, stdout: '', stderr: 'docker: command not found' } } : r))
    await withService(async (service) => {
      const result = await service.install(target, () => {})
      expect(result.ok).toBe(false)
      expect(result.error).toContain('未安装 Docker')
    }, rules)
  })

  it('端口被占用时失败在 probe', async () => {
    const rules = linuxRules.map((r) =>
      r.match === 'ss -ltn' ? { ...r, result: { code: 0, stdout: 'LISTEN 0 128 0.0.0.0:8787 0.0.0.0:*\n', stderr: '' } } : r
    )
    await withService(async (service) => {
      const result = await service.install(target, () => {})
      expect(result.ok).toBe(false)
      expect(result.failedStep).toBe('probe')
      expect(result.error).toContain('端口 8787 已被占用')
    }, rules)
  })

  it('sudo 不可用（非 root 且 sudo -n 失败）时给出明确提示', async () => {
    const rules = [
      ...linuxRules.map((r) => (r.match === 'sudo -n true' ? { ...r, result: { code: 1, stdout: '', stderr: 'sudo: a password is required' } } : r)),
      { match: 'sudo -S true', result: { code: 1, stdout: '', stderr: 'sudo: 1 incorrect password attempt' } }
    ]
    await withService(async (service) => {
      const result = await service.install(target, () => {})
      expect(result.ok).toBe(false)
      expect(result.failedStep).toBe('probe')
      expect(result.error).toContain('sudo')
    }, rules)
  })

  it('健康检查超时附带容器日志', async () => {
    const rules = [
      ...linuxRules.map((r) => (r.match === '.State.Health.Status' ? { ...r, result: { code: 0, stdout: 'starting\n', stderr: '' } } : r)),
      { match: 'docker logs', result: { code: 0, stdout: 'boom\n', stderr: '' } }
    ]
    await withService(async (service) => {
      const events: string[] = []
      const result = await service.install(target, (p) => events.push(p.output ?? ''))
      expect(result.ok).toBe(false)
      expect(result.failedStep).toBe('healthcheck')
      expect(events.join('')).toContain('boom')
    }, rules)
  })

  it('镜像已存在时跳过构建', async () => {
    const rules = linuxRules.map((r) => (r.match === 'docker image inspect' ? { ...r, result: { code: 0, stdout: '', stderr: '' } } : r))
    await withService(async (service, _store, transport) => {
      const statuses: string[] = []
      await service.install(target, (p) => statuses.push(`${p.step}:${p.status}`))
      expect(statuses).toContain('build:skipped')
      expect(transport.calls.some((c) => c.includes('docker build'))).toBe(false)
    }, rules)
  })

  it('保存目标后读回不含明文密码，且指纹被 pin', async () => {
    await withService(async (service, store) => {
      await service.install(target, () => {})
      const [saved] = await store.list()
      expect(saved.passwordEncrypted).not.toContain('pw')
      expect(saved.hostKeyFingerprint).toBe('fp-sha256-test')
      const publicList = await service.listTargets()
      expect(publicList[0].hasPassword).toBe(true)
      expect(JSON.stringify(publicList)).not.toContain('pw')
    })
  })
})
```

- [ ] **Step 2: 运行，确认失败**

Run: `npx vitest run src/main/services/__tests__/deployService.test.ts`
Expected: FAIL —— 模块不存在

- [ ] **Step 3: 实现 `deployTargetsStore.ts`**

```ts
/** 部署目标持久化（deploy-targets.json，密码经 safeStorage 加密）。 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { DeployTargetInput, DeployTargetPublic, DeployTargetStored } from '../../shared/types'
import { decryptApiKey, encryptApiKey } from './settingsService'

export class DeployTargetsStore {
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly file: string) {}

  private serialized<T>(run: () => Promise<T>): Promise<T> {
    const next = this.queue.then(run, run)
    this.queue = next.catch(() => undefined)
    return next
  }

  private async loadRaw(): Promise<DeployTargetStored[]> {
    try {
      const parsed = JSON.parse(await readFile(this.file, 'utf-8')) as unknown
      return Array.isArray(parsed) ? (parsed as DeployTargetStored[]) : []
    } catch {
      return []
    }
  }

  private async saveRaw(list: DeployTargetStored[]): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true })
    await writeFile(this.file, JSON.stringify(list, null, 2), 'utf-8')
  }

  list(): Promise<DeployTargetStored[]> {
    return this.serialized(() => this.loadRaw())
  }

  toPublic(target: DeployTargetStored): DeployTargetPublic {
    const { passwordEncrypted, ...rest } = target
    return { ...rest, hasPassword: Boolean(passwordEncrypted) }
  }

  passwordOf(target: DeployTargetStored): string {
    return target.passwordEncrypted ? decryptApiKey(target.passwordEncrypted) : ''
  }

  save(input: DeployTargetInput): Promise<DeployTargetStored> {
    return this.serialized(async () => {
      const list = await this.loadRaw()
      const idx = input.id ? list.findIndex((t) => t.id === input.id) : -1
      const old = idx >= 0 ? list[idx] : undefined
      const stored: DeployTargetStored = {
        id: old?.id ?? `dep_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        label: input.label,
        host: input.host,
        port: input.port,
        username: input.username,
        passwordEncrypted: input.password ? encryptApiKey(input.password) : old?.passwordEncrypted ?? '',
        hostKeyFingerprint: input.hostKeyFingerprint ?? old?.hostKeyFingerprint ?? '',
        installDir: input.installDir,
        servicePort: input.servicePort,
        baseImage: input.baseImage,
        bundleSource: 'bundled',
        os: 'linux',
        arch: old?.arch,
        distro: old?.distro,
        dockerVersion: old?.dockerVersion,
        installedVersion: old?.installedVersion,
        lastDeployedAt: old?.lastDeployedAt,
        lastStatus: old?.lastStatus,
        lastError: old?.lastError
      }
      if (idx >= 0) list[idx] = stored
      else list.push(stored)
      await this.saveRaw(list)
      return stored
    })
  }

  patch(id: string, patch: Partial<DeployTargetStored>): Promise<void> {
    return this.serialized(async () => {
      const list = await this.loadRaw()
      const idx = list.findIndex((t) => t.id === id)
      if (idx < 0) return
      list[idx] = { ...list[idx], ...patch }
      await this.saveRaw(list)
    })
  }

  remove(id: string): Promise<void> {
    return this.serialized(async () => {
      const list = (await this.loadRaw()).filter((t) => t.id !== id)
      await this.saveRaw(list)
    })
  }
}
```

- [ ] **Step 4: 实现 `deployService.ts`**

```ts
/** 六步部署流水线：连接 → 探测 → 上传 → 构建 → 启动 → 健康检查。 */
import { stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { buildCommands, healthCommand, logsCommand, probeCommands, runCommands, uninstallCommands, type DeployCommand, type DeployContext } from '../../core/deploy/commands'
import { parseContainerImage, parseDockerVersion, parseOs, parseOsRelease, parsePasswordlessSudo, parsePortInUse } from '../../core/deploy/parse'
import { nextStep } from '../../core/deploy/state'
import type {
  DeployConnectionInput,
  DeployOptions,
  DeployProbeResult,
  DeployProgress,
  DeployRunResult,
  DeployStep,
  DeployTargetInput,
  DeployTargetPublic,
  DeployTestResult
} from '../../shared/types'
import { DeployTargetsStore } from './deployTargetsStore'
import type { SshTransport } from './ssh2Transport'

export interface DeployServiceOptions {
  store: DeployTargetsStore
  createTransport: () => SshTransport
  /** 本地部署包路径（打包后是 process.resourcesPath/server-bundle.tar.gz） */
  bundlePath: string
  version: string
  /** 健康检查轮询次数与间隔（测试里传 2 / 0，避免真等 60 秒） */
  healthAttempts?: number
  healthPollMs?: number
}

type ProgressSink = (progress: DeployProgress) => void

function byId(commands: DeployCommand[], id: string): DeployCommand {
  const found = commands.find((c) => c.id === id)
  if (!found) throw new Error(`缺少命令：${id}`)
  return found
}

export class DeployService {
  private runId: string | null = null
  private aborted = false

  constructor(private readonly options: DeployServiceOptions) {}

  async listTargets(): Promise<DeployTargetPublic[]> {
    return (await this.options.store.list()).map((t) => this.options.store.toPublic(t))
  }

  async saveTarget(input: DeployTargetInput): Promise<DeployTargetPublic> {
    return this.options.store.toPublic(await this.options.store.save(input))
  }

  async deleteTarget(id: string): Promise<void> {
    await this.options.store.remove(id)
  }

  /** 连接 + 探测，不落盘（除非传了 targetId 用于校验指纹）。 */
  async testConnection(input: DeployConnectionInput): Promise<DeployTestResult> {
    const saved = input.targetId ? (await this.options.store.list()).find((t) => t.id === input.targetId) : undefined
    const password = input.password ?? (saved ? this.options.store.passwordOf(saved) : '')
    const transport = this.options.createTransport()
    try {
      const { fingerprint } = await transport.connect({
        host: input.host,
        port: input.port,
        username: input.username,
        password,
        hostKeyFingerprint: saved?.hostKeyFingerprint || undefined
      })
      const probe = await this.probe(transport, { installDir: saved?.installDir ?? '/opt/storyfabric', servicePort: saved?.servicePort ?? 8787, baseImage: saved?.baseImage ?? 'node:22-bookworm-slim', version: this.options.version, stagingDir: '', isRoot: false })
      return { fingerprint, probe, fingerprintChanged: Boolean(saved?.hostKeyFingerprint && saved.hostKeyFingerprint !== fingerprint) }
    } finally {
      await transport.dispose()
    }
  }

  private async probe(transport: SshTransport, base: DeployContext): Promise<DeployProbeResult> {
    const commands = probeCommands(base)
    const text = async (id: string): Promise<string> => (await transport.exec(byId(commands, id).command)).stdout
    const code = async (id: string): Promise<number> => (await transport.exec(byId(commands, id).command)).code
    const unameS = await text('probe.os')
    const arch = await text('probe.arch')
    const distroText = await text('probe.distro')
    const uid = await text('probe.user')
    const sudoCode = await code('probe.sudo')
    const dockerResult = await transport.exec(byId(commands, 'probe.docker').command)
    const portResult = await transport.exec(byId(commands, 'probe.port').command)
    const imageResult = await transport.exec(byId(commands, 'probe.image').command)
    return {
      os: unameS.trim(),
      arch: arch.trim(),
      distro: parseOsRelease(distroText).prettyName,
      isRoot: uid.trim() === '0',
      passwordlessSudo: parsePasswordlessSudo(sudoCode),
      dockerVersion: parseDockerVersion(dockerResult.stdout),
      portFree: !parsePortInUse(portResult.stdout),
      installedImage: parseContainerImage(imageResult.stdout)
    }
  }

  install(input: DeployTargetInput, onProgress: ProgressSink = () => {}): Promise<DeployRunResult> {
    return this.run(input, onProgress)
  }

  async update(targetId: string, onProgress: ProgressSink = () => {}): Promise<DeployRunResult> {
    const saved = (await this.options.store.list()).find((t) => t.id === targetId)
    if (!saved) return { ok: false, error: '未找到该服务器记录' }
    return this.run({ ...this.options.store.toPublic(saved), id: saved.id, password: this.options.store.passwordOf(saved) }, onProgress)
  }

  private async run(input: DeployTargetInput, onProgress: ProgressSink): Promise<DeployRunResult> {
    this.runId = `run_${Date.now().toString(36)}`
    this.aborted = false
    const emit = (step: DeployStep, status: DeployProgress['status'], extra: Partial<DeployProgress> = {}): void =>
      onProgress({ runId: this.runId as string, step, status, at: Date.now(), ...extra })

    const transport = this.options.createTransport()
    let step: DeployStep = 'connect'
    const fail = async (error: string): Promise<DeployRunResult> => {
      emit(step, 'failed', { message: error })
      if (input.id) await this.options.store.patch(input.id, { lastStatus: 'failed', lastError: error })
      return { ok: false, failedStep: step, error }
    }

    try {
      emit(step, 'running')
      const password = input.password ?? ''
      if (!password) return await fail('缺少密码')
      const { fingerprint } = await transport.connect({ host: input.host, port: input.port, username: input.username, password, hostKeyFingerprint: input.hostKeyFingerprint })
      emit(step, 'ok')
      step = nextStep(step, true) as DeployStep

      emit(step, 'running')
      const probe = await this.probe(transport, {
        installDir: input.installDir,
        servicePort: input.servicePort,
        baseImage: input.baseImage,
        version: this.options.version,
        stagingDir: '',
        isRoot: false
      })
      if (parseOs(probe.os) !== 'linux') return await fail('只支持 Linux 服务器')
      if (!probe.dockerVersion) return await fail('服务器未安装 Docker，请先安装后重试（Debian/Ubuntu: curl -fsSL https://get.docker.com | sh）')
      if (!probe.portFree) return await fail(`端口 ${input.servicePort} 已被占用，请换一个端口`)
      if (!probe.isRoot && !probe.passwordlessSudo) {
        const check = await transport.exec('sudo -S true', { stdin: `${password}\n` })
        if (check.code !== 0) return await fail('sudo 不可用：SSH 密码与 sudo 密码不一致，或该用户不在 sudoers 中')
      }
      emit(step, 'ok', { message: `Docker ${probe.dockerVersion} · ${probe.distro ?? probe.os}` })
      step = nextStep(step, true) as DeployStep

      emit(step, 'running')
      const saved = input.id ? (await this.options.store.list()).find((t) => t.id === input.id) : undefined
      const targetId = saved?.id ?? (await this.options.store.save({ ...input, hostKeyFingerprint: fingerprint })).id
      const ctx: DeployContext = { installDir: input.installDir, servicePort: input.servicePort, baseImage: input.baseImage, version: this.options.version, stagingDir: `/home/${input.username}/.storyfabric-staging/${this.options.version}`, isRoot: probe.isRoot }
      await transport.exec(`mkdir -p ${ctx.stagingDir}`)
      const bundle = await stat(this.options.bundlePath).catch(() => null)
      if (!bundle) return await fail(`部署包不存在：${this.options.bundlePath}`)
      await transport.upload(this.options.bundlePath, `${ctx.stagingDir}/${basename(this.options.bundlePath)}`)
      await transport.exec(`cd ${ctx.stagingDir} && tar -xzf ${basename(this.options.bundlePath)}`)
      emit(step, 'ok')
      step = nextStep(step, true) as DeployStep

      const build = buildCommands(ctx)
      emit(step, 'running')
      const exists = await transport.exec(build.find((c) => c.id === 'image.exists')!.command)
      if (exists.code === 0) {
        emit(step, 'skipped', { message: '镜像已存在，跳过构建' })
      } else {
        const prepare = await transport.exec(build.find((c) => c.id === 'prepare.dir')!.command, { stdin: `${password}\n`, onData: (text) => emit(step, 'running', { output: text }) })
        if (prepare.code !== 0) return await fail(`创建安装目录失败：${prepare.stderr.trim() || prepare.code}`)
        const result = await transport.exec(build.find((c) => c.id === 'build')!.command, { stdin: `${password}\n`, onData: (text) => emit(step, 'running', { output: text }) })
        if (result.code !== 0) return await fail(`构建镜像失败：${result.stderr.trim().slice(0, 400)}`)
        emit(step, 'ok')
      }
      step = nextStep(step, true) as DeployStep

      emit(step, 'running')
      let accessKey = ''
      for (const command of runCommands(ctx)) {
        const result = await transport.exec(command.command, { stdin: `${password}\n`, onData: (text) => emit(step, 'running', { output: text }) })
        if (result.code !== 0) return await fail(`${command.title}失败：${result.stderr.trim().slice(0, 400)}`)
        if (command.id === 'key.read') accessKey = result.stdout.trim()
      }
      emit(step, 'ok')
      step = nextStep(step, true) as DeployStep

      emit(step, 'running')
      const health = await this.waitHealthy(transport, ctx, password, (text) => emit(step, 'running', { output: text }))
      if (!health) {
        const logs = await transport.exec(logsCommand(ctx).command, { stdin: `${password}\n` })
        emit(step, 'running', { output: logs.stdout.slice(-4000) })
        return await fail('健康检查超时，请查看容器日志')
      }
      emit(step, 'ok')
      await this.options.store.patch(targetId, {
        hostKeyFingerprint: fingerprint,
        installedVersion: this.options.version,
        arch: probe.arch,
        distro: probe.distro,
        dockerVersion: probe.dockerVersion,
        lastDeployedAt: Date.now(),
        lastStatus: 'ok',
        lastError: undefined
      })
      return { ok: true, version: this.options.version, url: `http://${input.host}:${input.servicePort}`, accessKey }
    } catch (err) {
      return await fail(err instanceof Error ? err.message : String(err))
    } finally {
      await transport.dispose()
      this.runId = null
    }
  }

  private async waitHealthy(transport: SshTransport, ctx: DeployContext, password: string, onData: (text: string) => void): Promise<boolean> {
    const attempts = this.options.healthAttempts ?? 30
    const pollMs = this.options.healthPollMs ?? 2000
    for (let i = 0; i < attempts; i += 1) {
      if (this.aborted) return false
      const result = await transport.exec(healthCommand(ctx).command, { stdin: `${password}\n` })
      const status = result.stdout.trim()
      if (status === 'healthy') return true
      if (status === 'none') {
        const fallback = await transport.exec(`docker exec storyfabric node -e "fetch('http://127.0.0.1:8787/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"`, { stdin: `${password}\n` })
        if (fallback.code === 0) return true
      }
      if (pollMs > 0) await new Promise((resolve) => setTimeout(resolve, pollMs))
    }
    onData('健康检查超时\n')
    return false
  }

  async cancel(): Promise<void> {
    this.aborted = true
  }

  async logs(targetId: string): Promise<string> {
    const saved = (await this.options.store.list()).find((t) => t.id === targetId)
    if (!saved) throw new Error('未找到该服务器记录')
    const transport = this.options.createTransport()
    try {
      await transport.connect({ host: saved.host, port: saved.port, username: saved.username, password: this.options.store.passwordOf(saved), hostKeyFingerprint: saved.hostKeyFingerprint || undefined })
      const ctx: DeployContext = { installDir: saved.installDir, servicePort: saved.servicePort, baseImage: saved.baseImage, version: saved.installedVersion ?? this.options.version, stagingDir: '', isRoot: false }
      return (await transport.exec(logsCommand(ctx).command, { stdin: `${this.options.store.passwordOf(saved)}\n` })).stdout
    } finally {
      await transport.dispose()
    }
  }

  async uninstall(targetId: string): Promise<void> {
    const saved = (await this.options.store.list()).find((t) => t.id === targetId)
    if (!saved) throw new Error('未找到该服务器记录')
    const password = this.options.store.passwordOf(saved)
    const transport = this.options.createTransport()
    try {
      await transport.connect({ host: saved.host, port: saved.port, username: saved.username, password, hostKeyFingerprint: saved.hostKeyFingerprint || undefined })
      const ctx: DeployContext = { installDir: saved.installDir, servicePort: saved.servicePort, baseImage: saved.baseImage, version: saved.installedVersion ?? this.options.version, stagingDir: `/home/${saved.username}/.storyfabric-staging/${saved.installedVersion ?? this.options.version}`, isRoot: false }
      for (const command of uninstallCommands(ctx)) await transport.exec(command.command, { stdin: `${password}\n` })
    } finally {
      await transport.dispose()
    }
  }
}
```

- [ ] **Step 5: 运行，确认通过**

Run: `npx vitest run src/main/services/__tests__/deployService.test.ts`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add src/main/services/deployService.ts src/main/services/deployTargetsStore.ts src/main/services/__tests__/deployService.test.ts src/main/services/__tests__/fakeTransport.ts
git commit -m "feat(deploy): implement ssh deploy pipeline with injectable transport"
```

---

### Task 6: IPC / preload / API 接线

**Files:**
- Modify: `src/shared/ipc.ts`、`src/shared/api.ts`、`src/main/ipc.ts`、`src/preload/index.ts`、`src/renderer/src/platform/httpApi.ts`、`src/renderer/src/platform/androidApi.ts`、`src/server/server.ts`

- [ ] **Step 1: 加通道常量与方法签名**

`src/shared/ipc.ts` 增加：

```ts
  /* 远程部署 */
  DeployTestConnection: 'deploy:test',
  DeployInstall: 'deploy:install',
  DeployUpdate: 'deploy:update',
  DeployCancel: 'deploy:cancel',
  DeployLogs: 'deploy:logs',
  DeployUninstall: 'deploy:uninstall',
  DeployListTargets: 'deploy:targets:list',
  DeploySaveTarget: 'deploy:targets:save',
  DeployDeleteTarget: 'deploy:targets:delete',
  DeployEvent: 'deploy:event',
```

`src/shared/api.ts` 的 `StoryFabricApi` 增加：

```ts
  /* 远程部署（仅桌面端） */
  deployTestConnection(input: import('./types').DeployConnectionInput): Promise<import('./types').DeployTestResult>
  deployInstall(input: import('./types').DeployTargetInput): Promise<import('./types').DeployRunResult>
  deployUpdate(targetId: string): Promise<import('./types').DeployRunResult>
  deployCancel(): Promise<void>
  deployLogs(targetId: string): Promise<string>
  deployUninstall(targetId: string): Promise<void>
  deployListTargets(): Promise<import('./types').DeployTargetPublic[]>
  deploySaveTarget(input: import('./types').DeployTargetInput): Promise<import('./types').DeployTargetPublic>
  deployDeleteTarget(id: string): Promise<void>
  onDeployEvent(cb: (progress: import('./types').DeployProgress) => void): () => void
```

- [ ] **Step 2: 主进程接线**

`src/main/ipc.ts` 的 `AppContext` 增加 `deploy: DeployService`，并在装配函数里注册（沿用文件里现有的 `ipcMain.handle` 风格）：

```ts
  ipcMain.handle(IPC.DeployTestConnection, (_e, input: DeployConnectionInput) => ctx.deploy.testConnection(input))
  ipcMain.handle(IPC.DeployInstall, (_e, input: DeployTargetInput) =>
    ctx.deploy.install(input, (progress) => ctx.win()?.webContents.send(IPC.DeployEvent, progress))
  )
  ipcMain.handle(IPC.DeployUpdate, (_e, targetId: string) =>
    ctx.deploy.update(targetId, (progress) => ctx.win()?.webContents.send(IPC.DeployEvent, progress))
  )
  ipcMain.handle(IPC.DeployCancel, () => ctx.deploy.cancel())
  ipcMain.handle(IPC.DeployLogs, (_e, targetId: string) => ctx.deploy.logs(targetId))
  ipcMain.handle(IPC.DeployUninstall, (_e, targetId: string) => ctx.deploy.uninstall(targetId))
  ipcMain.handle(IPC.DeployListTargets, () => ctx.deploy.listTargets())
  ipcMain.handle(IPC.DeploySaveTarget, (_e, input: DeployTargetInput) => ctx.deploy.saveTarget(input))
  ipcMain.handle(IPC.DeployDeleteTarget, (_e, id: string) => ctx.deploy.deleteTarget(id))
```

`src/main/index.ts` 构造并注入：

```ts
import { join } from 'node:path'
import { DeployService } from './services/deployService'
import { DeployTargetsStore } from './services/deployTargetsStore'
import { Ssh2Transport } from './services/ssh2Transport'

const deploy = new DeployService({
  store: new DeployTargetsStore(join(app.getPath('userData'), 'deploy-targets.json')),
  createTransport: () => new Ssh2Transport(),
  bundlePath: join(process.resourcesPath, 'server-bundle.tar.gz'),
  version: app.getVersion()
})
```

（开发态 `process.resourcesPath` 指向 electron 的 resources 目录，部署包不存在 → `install` 会在上传步骤报「部署包不存在」，这是预期行为；用 `npm run server:bundle` 后手动放到该目录即可本地联调。）

- [ ] **Step 3: preload 接线**

`src/preload/index.ts` 的 `api` 对象增加 10 个方法（`onDeployEvent` 与 `onAgentEvent` 同构）。

- [ ] **Step 4: 非桌面端抛明确错误**

`src/renderer/src/platform/httpApi.ts` 与 `androidApi.ts`：每个 deploy 方法 `throw new Error('远程部署仅支持桌面端')`；`onDeployEvent` 返回空清理函数。`src/server/server.ts` 的 RPC 白名单不注册这些方法（未注册即返回「未知方法」）。

- [ ] **Step 5: 验证**

Run: `npx tsc -b --pretty false`
Expected: exit 0

Run: `npx vitest run src/renderer/src/platform/__tests__/platformApi.test.ts src/server/__tests__/server.test.ts`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add src/shared/ipc.ts src/shared/api.ts src/main/ipc.ts src/main/index.ts src/preload/index.ts src/renderer/src/platform/httpApi.ts src/renderer/src/platform/androidApi.ts
git commit -m "feat(deploy): expose deploy api over ipc"
```

---

### Task 7: 渲染层向导与欢迎页入口

**Files:**
- Create: `src/renderer/src/pages/welcome/DeployWizard.tsx`
- Modify: `src/renderer/src/pages/welcome/WelcomePage.tsx`

- [ ] **Step 1: 实现向导组件**

`src/renderer/src/pages/welcome/DeployWizard.tsx`：

```tsx
/** 远程服务器安装向导：连接 → 指纹确认 → 探测 → 配置 → 执行 → 完成。 */
import { ChevronLeft, Copy, Server } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge, Button, Card, Field, Input } from '../../components/ui/primitives'
import { api } from '../../lib/api'
import type { DeployProbeResult, DeployProgress, DeployRunResult, DeployStep, DeployStepStatus } from '../../../../shared/types'

const STEPS: Array<{ key: DeployStep; label: string }> = [
  { key: 'connect', label: '连接服务器' },
  { key: 'probe', label: '环境检查' },
  { key: 'upload', label: '上传部署包' },
  { key: 'build', label: '构建镜像' },
  { key: 'run', label: '启动容器' },
  { key: 'healthcheck', label: '健康检查' }
]

type Phase = 'form' | 'verify' | 'config' | 'run' | 'done'

interface Props {
  onClose: () => void
  onDone: (result: { url: string; accessKey: string }) => void
}

export function DeployWizard({ onClose, onDone }: Props): React.ReactElement {
  const [phase, setPhase] = useState<Phase>('form')
  const [host, setHost] = useState('')
  const [port, setPort] = useState('22')
  const [username, setUsername] = useState('root')
  const [password, setPassword] = useState('')
  const [fingerprint, setFingerprint] = useState('')
  const [fingerprintConfirmed, setFingerprintConfirmed] = useState(false)
  const [probe, setProbe] = useState<DeployProbeResult | null>(null)
  const [installDir, setInstallDir] = useState('/opt/storyfabric')
  const [servicePort, setServicePort] = useState('8787')
  const [baseImage, setBaseImage] = useState('node:22-bookworm-slim')
  const [statuses, setStatuses] = useState<Record<string, DeployStepStatus>>({})
  const [output, setOutput] = useState('')
  const [result, setResult] = useState<DeployRunResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => api.onDeployEvent((progress: DeployProgress) => {
    setStatuses((prev) => ({ ...prev, [progress.step]: progress.status }))
    if (progress.output) setOutput((prev) => `${prev}${progress.output}`.slice(-20000))
    if (progress.message && progress.status === 'failed') setError(progress.message)
  }), [])

  const test = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const test = await api.deployTestConnection({ host: host.trim(), port: Number(port), username: username.trim(), password })
      setFingerprint(test.fingerprint)
      setProbe(test.probe)
      setFingerprintConfirmed(Boolean(test.fingerprintChanged))
      setPhase('verify')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const install = async (): Promise<void> => {
    setPhase('run')
    setBusy(true)
    setError(null)
    setStatuses({})
    setOutput('')
    try {
      const result = await api.deployInstall({
        label: host.trim(),
        host: host.trim(),
        port: Number(port),
        username: username.trim(),
        password,
        hostKeyFingerprint: fingerprint,
        installDir: installDir.trim(),
        servicePort: Number(servicePort),
        baseImage: baseImage.trim()
      })
      setResult(result)
      if (result.ok) setPhase('done')
      else setError(result.error ?? '安装失败')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const canProbe = probe?.os.toLowerCase() === 'linux' && Boolean(probe?.dockerVersion) && probe?.portFree !== false

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-6">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={onClose}><ChevronLeft size={14} /> 返回</Button>
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold"><Server size={14} className="mr-1 inline" /> 安装 StoryFabric 服务</h2>
        <Badge tone="accent">Linux</Badge>
      </div>

      {phase === 'form' && (
        <Card className="space-y-3 p-4">
          <Field label="SSH 地址 *"><Input value={host} onChange={(e) => setHost(e.target.value)} placeholder="192.168.1.10 或 example.com" autoFocus /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="端口 *"><Input value={port} onChange={(e) => setPort(e.target.value)} /></Field>
            <Field label="用户名 *"><Input value={username} onChange={(e) => setUsername(e.target.value)} /></Field>
          </div>
          <Field label="密码 *"><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          {error && <div className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">{error}</div>}
          <Button variant="primary" onClick={() => void test()} loading={busy} disabled={!host.trim() || !username.trim() || !password}>测试连接</Button>
        </Card>
      )}

      {phase === 'verify' && probe && (
        <Card className="space-y-3 p-4">
          <Field label="服务器指纹（请核对后再继续）">
            <code className="block break-all rounded-lg bg-app px-3 py-2 text-xs">{fingerprint}</code>
          </Field>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={fingerprintConfirmed} onChange={(e) => setFingerprintConfirmed(e.target.checked)} />
            我已核对指纹
          </label>
          <div className="space-y-1 text-xs text-muted">
            <div>系统：{probe.os} / {probe.arch} {probe.distro ? `· ${probe.distro}` : ''}</div>
            <div>Docker：{probe.dockerVersion ?? '未安装'}</div>
            <div>端口 {servicePort}：{probe.portFree ? '可用' : '已被占用'}</div>
            <div>sudo：{probe.isRoot ? 'root' : probe.passwordlessSudo ? '免密可用' : '需密码（将用 SSH 密码）'}</div>
          </div>
          {error && <div className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">{error}</div>}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setPhase('form')}>上一步</Button>
            <Button variant="primary" disabled={!fingerprintConfirmed || !canProbe} onClick={() => setPhase('config')}>下一步</Button>
          </div>
          {!canProbe && <p className="text-[11px] text-danger">{probe.os.toLowerCase() !== 'linux' ? '只支持 Linux 服务器' : !probe.dockerVersion ? '服务器未安装 Docker，请先安装后重试' : '端口已被占用，请换端口'}</p>}
        </Card>
      )}

      {phase === 'config' && (
        <Card className="space-y-3 p-4">
          <Field label="安装目录" hint="数据与密钥会放在这里"><Input value={installDir} onChange={(e) => setInstallDir(e.target.value)} /></Field>
          <Field label="服务端口" hint="对外访问端口，需在安全组/防火墙放行"><Input value={servicePort} onChange={(e) => setServicePort(e.target.value)} /></Field>
          <Field label="基础镜像" hint="服务器首次构建需要能拉取该镜像"><Input value={baseImage} onChange={(e) => setBaseImage(e.target.value)} /></Field>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setPhase('verify')}>上一步</Button>
            <Button variant="primary" onClick={() => void install()}>开始安装</Button>
          </div>
        </Card>
      )}

      {phase === 'run' && (
        <Card className="space-y-3 p-4">
          {STEPS.map((step) => {
            const status = statuses[step.key] ?? 'pending'
            return (
              <div key={step.key} className="flex items-center gap-2 text-xs">
                <Badge tone={status === 'ok' ? 'ok' : status === 'failed' ? 'danger' : status === 'running' ? 'accent' : 'default'}>{status}</Badge>
                <span>{step.label}</span>
              </div>
            )
          })}
          {output && <pre className="max-h-56 overflow-auto rounded-lg bg-app p-2 text-[11px] leading-4">{output}</pre>}
          {error && <div className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">{error}</div>}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => void api.deployCancel()}>取消</Button>
            {!busy && error && <Button variant="primary" onClick={() => void install()}>重试</Button>}
          </div>
        </Card>
      )}

      {phase === 'done' && result?.ok && (
        <Card className="space-y-3 p-4">
          <div className="text-sm font-medium">安装完成</div>
          <Field label="服务地址"><Input readOnly value={result.url ?? ''} /></Field>
          <Field label="访问密钥"><Input readOnly value={result.accessKey ?? ''} /></Field>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => void navigator.clipboard.writeText(result.accessKey ?? '')}><Copy size={13} /> 复制密钥</Button>
            <Button variant="primary" onClick={() => onDone({ url: result.url ?? '', accessKey: result.accessKey ?? '' })}>填入服务模式</Button>
          </div>
        </Card>
      )}
    </div>
  )
}
```

- [ ] **Step 2: 欢迎页接线**

`WelcomePage.tsx` 服务模式区块增加：

```tsx
<Button size="sm" variant="outline" onClick={() => setDeployOpen(true)}>
  <Server size={13} /> 安装到服务器
</Button>
```

`deployOpen` 为真时渲染 `<DeployWizard onClose={...} onDone={({ url, accessKey }) => { setServiceUrl(url); setServiceKey(accessKey) }} />`；服务模式下方增加「已保存的服务器」卡片列表（`api.deployListTargets()`），每张卡片显示名称/地址/版本/最后状态 + `检查更新` / `更新` / `查看日志` / `卸载`。

- [ ] **Step 3: 验证**

Run: `npx tsc -b --pretty false`
Expected: exit 0

Run: `npm run build`
Expected: exit 0

- [ ] **Step 4: 提交**

```bash
git add src/renderer/src/pages/welcome/DeployWizard.tsx src/renderer/src/pages/welcome/WelcomePage.tsx
git commit -m "feat(renderer): add remote server deploy wizard"
```

---

### Task 8: 全量验证与打包

**Files:** 无代码改动

- [ ] **Step 1: 全量测试与类型检查**

Run: `npm test -- --run`
Expected: 全部通过

Run: `npx tsc -b --pretty false`
Expected: exit 0

- [ ] **Step 2: 三端构建**

Run: `npm run build`
Run: `npm run server:build:all`
Expected: exit 0

- [ ] **Step 3: 打包（需先关闭正在运行的应用）**

Run: `npm run dist:win`
Expected: exit 0，`release/win-unpacked/StoryFabric.exe` 与安装包更新

- [ ] **Step 4: 产物核验**

```powershell
node -e "const fs=require('fs');const b=fs.readFileSync('release/win-unpacked/resources/app.asar');for(const s of ['deploy:install','ssh2/lib/client.js','Ssh2Transport','安装到服务器','storyfabric-server']) console.log(s, b.includes(Buffer.from(s)));"
Test-Path "release\win-unpacked\resources\server-bundle.tar.gz"
```

Expected: 关键字全部 `true`，且 `server-bundle.tar.gz` 存在

- [ ] **Step 5: 真机走查（用户执行）**

1. 欢迎页 → 服务 → 「安装到服务器」→ 填 SSH 信息 → 测试连接 → 核对指纹。
2. 探测页确认 Docker/端口/sudo 状态。
3. 安装 → 观察六步进度 → 完成后用显示的密钥访问 `http://<host>:<port>/`。
4. 服务器 `reboot` 后确认容器自动恢复。
5. 客户端「检查更新」→「更新」→ 数据仍在。
6. 「卸载」→ 容器与镜像消失、`/opt/storyfabric/data` 保留。

- [ ] **Step 6: 提交（若走查有微调）**

```bash
git add -A -- src scripts resources electron-builder.yml
git commit -m "fix(deploy): address walkthrough findings"
```

---

### Task 9: 独立质量审查与修复

**Files:** 视结论而定

- [ ] **Step 1: 派独立只读审查子代理**

审查重点：

1. 命令注入面：所有用户输入是否都过 `shQuote`；`sudo -S` 密码是否只走 stdin。
2. 指纹 pin：首次接受、之后不匹配必须拒绝；`testConnection` 与 `install` 行为一致。
3. 幂等：镜像复用、容器重建、密钥不覆盖、数据卷不删。
4. 凭据：明文密码不落盘、不返回渲染层、不进日志。
5. 失败路径：非 Linux / 无 Docker / 端口占用 / sudo 失败 / 健康超时是否停在该步并可重试。
6. 打包：`ssh2` 及其运行时依赖是否真的进了 asar；`server-bundle.tar.gz` 是否随包。
7. 测试质量：每条断言在行为回归时是否真的会失败。

- [ ] **Step 2: 逐条复现并修复，复审至 PASS**

- [ ] **Step 3: 提交**

```bash
git add -A -- src scripts resources electron-builder.yml
git commit -m "fix(deploy): address review findings"
```

---

### Task 10: 文档收尾

**Files:**
- Modify: `docs/linux-server.md`、`docs/superpowers/backlog.md`
- Create: `docs/superpowers/checkpoints/2026-09-09-remote-server-deploy.md`

- [ ] **Step 1: `docs/linux-server.md` 增加「桌面端一键部署」小节**（入口、要求、数据位置、卸载影响）

- [ ] **Step 2: backlog 增加第 5 节**，勾选已实现项，列出未做项（密钥登录、HTTPS、多服务器批量、从官网拉取）

- [ ] **Step 3: 写 checkpoint**（提交号、验证数字、真机走查结果、审查结论、风险）

- [ ] **Step 4: 提交**

```bash
git add -f docs
git commit -m "docs: document remote server deploy"
```

---

## 验收对照

| Spec 要求 | 实现任务 |
| --- | --- |
| 欢迎页填写 SSH 信息并安装 | Task 7 |
| 部署包随安装包分发 | Task 3 |
| 命令生成 / 解析 / 状态机 | Task 1、2 |
| SSH 传输（密码 + 指纹 pin + SFTP） | Task 4 |
| 六步流水线与失败分支 | Task 5 |
| IPC / 非桌面端拒绝 | Task 6 |
| 幂等、数据保留、卸载语义 | Task 2、5 |
| 全量验证与打包 | Task 8 |
| 独立审查 | Task 9 |
