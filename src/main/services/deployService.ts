/** 六步部署流水线：连接 → 探测 → 上传 → 构建 → 启动 → 健康检查。 */
import { stat } from 'node:fs/promises'
import { basename } from 'node:path'
import {
  buildCommands,
  healthCommand,
  logsCommand,
  probeCommands,
  runCommands,
  uninstallCommands,
  type DeployCommand,
  type DeployContext
} from '../../core/deploy/commands'
import {
  parseContainerImage,
  parseDockerVersion,
  parseOs,
  parseOsRelease,
  parsePasswordlessSudo,
  parsePortInUse
} from '../../core/deploy/parse'
import { nextStep } from '../../core/deploy/state'
import { isSafeImage, isSafeInstallDir, isSafeUsername, shQuote, sudoPrefix } from '../../core/deploy/shell'
import type {
  DeployConnectionInput,
  DeployProbeResult,
  DeployProgress,
  DeployRunResult,
  DeployStep,
  DeployTargetInput,
  DeployTargetPublic,
  DeployTestResult
} from '../../shared/types'
import type { DeployTargetsStore } from './deployTargetsStore'
import type { SshExecResult, SshTransport } from './ssh2Transport'

export interface DeployServiceOptions {
  store: DeployTargetsStore
  createTransport: () => SshTransport
  /** 本地部署包路径（打包后是 process.resourcesPath/server-bundle.tar.gz） */
  bundlePath: string
  version: string
  /** 健康检查轮询次数与间隔（测试传 2 / 0，避免真等 60 秒） */
  healthAttempts?: number
  healthPollMs?: number
}

type ProgressSink = (progress: DeployProgress) => void

const PROBE_TIMEOUT_MS = 30_000
const BUILD_TIMEOUT_MS = 20 * 60_000
const RUN_TIMEOUT_MS = 3 * 60_000
const HEALTH_TIMEOUT_MS = 30_000

function byId(commands: DeployCommand[], id: string): DeployCommand {
  const found = commands.find((c) => c.id === id)
  if (!found) throw new Error(`缺少命令：${id}`)
  return found
}

/** 校验用户输入，返回错误文案；null 表示通过。 */
export function validateDeployInput(input: Partial<DeployTargetInput>): string | null {
  if (!input.username || !isSafeUsername(input.username)) return '用户名包含非法字符'
  if (!input.installDir || !isSafeInstallDir(input.installDir)) return '安装目录必须是绝对路径且不含换行'
  if (!input.baseImage || !isSafeImage(input.baseImage)) return '基础镜像名包含非法字符'
  const port = input.servicePort
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) return '服务端口无效'
  if (typeof input.port !== 'number' || !Number.isInteger(input.port) || input.port < 1 || input.port > 65535) {
    return 'SSH 端口无效'
  }
  if (!input.host || /[\s]/.test(input.host)) return '服务器地址无效'
  return null
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

  /** 连接 + 探测；传了 targetId 时会校验已 pin 的指纹。 */
  async testConnection(input: DeployConnectionInput): Promise<DeployTestResult> {
    const saved = input.targetId ? (await this.options.store.list()).find((t) => t.id === input.targetId) : undefined
    const invalid = validateDeployInput({
      host: input.host,
      port: input.port,
      username: input.username,
      installDir: saved?.installDir ?? '/opt/storyfabric',
      servicePort: saved?.servicePort ?? 8787,
      baseImage: saved?.baseImage ?? 'node:22-bookworm-slim'
    })
    if (invalid) throw new Error(invalid)
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
      const probe = await this.probe(transport, this.contextOf(input, saved), password)
      return {
        fingerprint,
        probe,
        fingerprintChanged: Boolean(saved?.hostKeyFingerprint && saved.hostKeyFingerprint !== fingerprint),
        bundleVersion: this.options.version
      }
    } finally {
      await transport.dispose()
    }
  }

  private contextOf(
    input: Partial<DeployTargetInput>,
    saved?: { installDir: string; servicePort: number; baseImage: string }
  ): DeployContext {
    return {
      installDir: input.installDir || saved?.installDir || '/opt/storyfabric',
      servicePort: input.servicePort || saved?.servicePort || 8787,
      baseImage: input.baseImage || saved?.baseImage || 'node:22-bookworm-slim',
      version: this.options.version,
      stagingDir: '',
      isRoot: false
    }
  }

  private async probe(transport: SshTransport, base: DeployContext, password = ''): Promise<DeployProbeResult> {
    // 先确定是否 root，再决定 docker 相关探测要不要加 sudo
    const initial = probeCommands({ ...base, isRoot: false })
    const text = async (id: string): Promise<string> => (await transport.exec(byId(initial, id).command)).stdout
    const unameS = await text('probe.os')
    const arch = await text('probe.arch')
    const distroText = await text('probe.distro')
    const uid = await text('probe.user')
    const isRoot = uid.trim() === '0'
    const sudoCode = (await transport.exec(byId(initial, 'probe.sudo').command)).code

    const commands = probeCommands({ ...base, isRoot })
    const dockerResult = await transport.exec(byId(commands, 'probe.docker').command, { stdin: `${password}\n` })
    const portResult = await transport.exec(byId(commands, 'probe.port').command)
    const imageResult = await transport.exec(byId(commands, 'probe.image').command, { stdin: `${password}\n` })

    return {
      os: unameS.trim(),
      arch: arch.trim(),
      distro: parseOsRelease(distroText).prettyName,
      isRoot,
      passwordlessSudo: parsePasswordlessSudo(sudoCode),
      dockerVersion: parseDockerVersion(dockerResult.stdout),
      dockerError: dockerResult.code === 0 ? undefined : dockerResult.stderr.trim().slice(0, 300),
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
    return this.run(
      {
        ...this.options.store.toPublic(saved),
        id: saved.id,
        password: this.options.store.passwordOf(saved)
      },
      onProgress
    )
  }

  private async run(input: DeployTargetInput, onProgress: ProgressSink): Promise<DeployRunResult> {
    if (this.runId) return { ok: false, error: '已有部署任务正在进行，请等待或取消' }
    this.runId = `run_${Date.now().toString(36)}`
    this.aborted = false
    const emit = (step: DeployStep, status: DeployProgress['status'], extra: Partial<DeployProgress> = {}): void =>
      onProgress({ runId: this.runId as string, step, status, at: Date.now(), ...extra })

    const transport = this.options.createTransport()
    const password = input.password ?? ''
    let step: DeployStep = 'connect'

    const fail = async (error: string): Promise<DeployRunResult> => {
      emit(step, 'failed', { message: error })
      if (input.id) await this.options.store.patch(input.id, { lastStatus: 'failed', lastError: error })
      return { ok: false, failedStep: step, error }
    }

    try {
      emit(step, 'running')
      if (!password) return await fail('缺少密码')
      const invalid = validateDeployInput(input)
      if (invalid) return await fail(invalid)
      const { fingerprint } = await transport.connect({
        host: input.host,
        port: input.port,
        username: input.username,
        password,
        hostKeyFingerprint: input.hostKeyFingerprint
      })
      emit(step, 'ok')
      step = nextStep(step, true) as DeployStep

      emit(step, 'running')
      const probe = await this.probe(transport, this.contextOf(input), password)
      if (parseOs(probe.os) !== 'linux') return await fail('只支持 Linux 服务器')
      if (!probe.dockerVersion) {
        const detail = probe.dockerError ?? ''
        if (/permission denied/i.test(detail)) {
          return await fail('Docker 需要权限：请把该用户加入 docker 组，或改用 root 登录')
        }
        if (/cannot connect to the docker daemon|is the docker daemon running/i.test(detail)) {
          return await fail('Docker 守护进程未运行，请在服务器上启动 Docker 后重试')
        }
        return await fail('服务器未安装 Docker，请先安装后重试（Debian/Ubuntu: curl -fsSL https://get.docker.com | sh）')
      }
      // 更新时端口被自己上一版容器占用是正常的
      const ownsPort = Boolean(probe.installedImage?.startsWith('storyfabric:'))
      if (!probe.portFree && !ownsPort) return await fail(`端口 ${input.servicePort} 已被占用，请换一个端口`)
      if (!probe.isRoot && !probe.passwordlessSudo) {
        const check = await transport.exec('sudo -S true', { stdin: `${password}\n`, timeoutMs: PROBE_TIMEOUT_MS })
        if (check.code !== 0) return await fail('sudo 不可用：SSH 密码与 sudo 密码不一致，或该用户不在 sudoers 中')
      }
      emit(step, 'ok', { message: `Docker ${probe.dockerVersion}${probe.distro ? ` · ${probe.distro}` : ''}` })
      step = nextStep(step, true) as DeployStep

      emit(step, 'running')
      const saved = input.id ? (await this.options.store.list()).find((t) => t.id === input.id) : undefined
      const targetId = saved?.id ?? (await this.options.store.save({ ...input, hostKeyFingerprint: fingerprint })).id
      const ctx: DeployContext = {
        ...this.contextOf(input, saved),
        stagingDir: `/home/${input.username}/.storyfabric-staging/${this.options.version}`,
        isRoot: probe.isRoot
      }
      const bundleName = basename(this.options.bundlePath)
      const bundle = await stat(this.options.bundlePath).catch(() => null)
      if (!bundle) return await fail(`部署包不存在：${this.options.bundlePath}`)
      const mkdirResult = await transport.exec(`mkdir -p ${shQuote(ctx.stagingDir)}`, { timeoutMs: PROBE_TIMEOUT_MS })
      if (mkdirResult.code !== 0) return await fail(`创建上传目录失败：${mkdirResult.stderr.trim() || mkdirResult.code}`)
      await transport.upload(this.options.bundlePath, `${ctx.stagingDir}/${bundleName}`)
      const extract = await transport.exec(`cd ${shQuote(ctx.stagingDir)} && tar -xzf ${shQuote(bundleName)}`, {
        timeoutMs: RUN_TIMEOUT_MS
      })
      if (extract.code !== 0) return await fail(`解压部署包失败：${extract.stderr.trim() || extract.code}`)
      emit(step, 'ok')
      step = nextStep(step, true) as DeployStep

      const build = buildCommands(ctx)
      emit(step, 'running')
      // 目录每次都准备（幂等）：用户可能清掉过 secrets 目录
      const prepare = await transport.exec(byId(build, 'prepare.dir').command, {
        stdin: `${password}\n`,
        timeoutMs: PROBE_TIMEOUT_MS,
        onData: (text) => emit(step, 'running', { output: text })
      })
      if (prepare.code !== 0) return await fail(`创建安装目录失败：${prepare.stderr.trim() || prepare.code}`)
      const exists = await transport.exec(byId(build, 'image.exists').command, { stdin: `${password}\n`, timeoutMs: PROBE_TIMEOUT_MS })
      if (exists.code === 0) {
        emit(step, 'skipped', { message: '镜像已存在，跳过构建' })
      } else {
        const result = await transport.exec(byId(build, 'build').command, {
          stdin: `${password}\n`,
          timeoutMs: BUILD_TIMEOUT_MS,
          onData: (text) => emit(step, 'running', { output: text })
        })
        if (result.code !== 0) return await fail(`构建镜像失败：${result.stderr.trim().slice(0, 400)}`)
        emit(step, 'ok')
      }
      step = nextStep(step, true) as DeployStep

      emit(step, 'running')
      let accessKey = ''
      for (const command of runCommands(ctx)) {
        const result = await transport.exec(command.command, {
          stdin: `${password}\n`,
          timeoutMs: RUN_TIMEOUT_MS,
          onData: (text) => emit(step, 'running', { output: text })
        })
        if (result.code !== 0) return await fail(`${command.title}失败：${result.stderr.trim().slice(0, 400)}`)
        if (command.id === 'key.read') accessKey = result.stdout.trim()
      }
      emit(step, 'ok')
      step = nextStep(step, true) as DeployStep

      emit(step, 'running')
      const healthy = await this.waitHealthy(transport, ctx, password, (text) => emit(step, 'running', { output: text }))
      if (!healthy) {
        const logs = await transport.exec(logsCommand(ctx).command, { stdin: `${password}\n`, timeoutMs: PROBE_TIMEOUT_MS })
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
        isRoot: probe.isRoot,
        lastDeployedAt: Date.now(),
        lastStatus: 'ok',
        lastError: undefined
      })
      return {
        ok: true,
        version: this.options.version,
        url: `http://${input.host}:${input.servicePort}`,
        accessKey
      }
    } catch (err) {
      return await fail(err instanceof Error ? err.message : String(err))
    } finally {
      await transport.dispose()
      this.runId = null
    }
  }

  private async waitHealthy(
    transport: SshTransport,
    ctx: DeployContext,
    password: string,
    onData: (text: string) => void
  ): Promise<boolean> {
    const attempts = this.options.healthAttempts ?? 30
    const pollMs = this.options.healthPollMs ?? 2000
    for (let i = 0; i < attempts; i += 1) {
      if (this.aborted) {
        onData('已取消\n')
        return false
      }
      const result = await transport.exec(healthCommand(ctx).command, { stdin: `${password}\n`, timeoutMs: HEALTH_TIMEOUT_MS })
      const status = result.stdout.trim()
      if (status === 'healthy') return true
      if (status === 'none') {
        const fallback = await transport.exec(
          `${sudoPrefix(ctx.isRoot)}docker exec storyfabric node -e "fetch('http://127.0.0.1:8787/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"`,
          { stdin: `${password}\n`, timeoutMs: HEALTH_TIMEOUT_MS }
        )
        if (fallback.code === 0) return true
      }
      if (pollMs > 0) await new Promise((resolve) => setTimeout(resolve, pollMs))
    }
    onData('健康检查超时\n')
    return false
  }

  cancel(): Promise<void> {
    this.aborted = true
    return Promise.resolve()
  }

  private contextOfStored(saved: {
    installDir: string
    servicePort: number
    baseImage: string
    installedVersion?: string
    isRoot?: boolean
  }): DeployContext {
    const version = saved.installedVersion ?? this.options.version
    return {
      installDir: saved.installDir,
      servicePort: saved.servicePort,
      baseImage: saved.baseImage,
      version,
      stagingDir: '',
      isRoot: Boolean(saved.isRoot)
    }
  }

  async logs(targetId: string): Promise<string> {
    const saved = (await this.options.store.list()).find((t) => t.id === targetId)
    if (!saved) throw new Error('未找到该服务器记录')
    const password = this.options.store.passwordOf(saved)
    const transport = this.options.createTransport()
    try {
      await transport.connect({
        host: saved.host,
        port: saved.port,
        username: saved.username,
        password,
        hostKeyFingerprint: saved.hostKeyFingerprint || undefined
      })
      const result = await transport.exec(logsCommand(this.contextOfStored(saved)).command, {
        stdin: `${password}\n`,
        timeoutMs: PROBE_TIMEOUT_MS
      })
      if (result.code !== 0 && !/no such container/i.test(result.stderr)) {
        throw new Error(`读取日志失败：${result.stderr.trim().slice(0, 300) || result.code}`)
      }
      return result.stdout
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
      await transport.connect({
        host: saved.host,
        port: saved.port,
        username: saved.username,
        password,
        hostKeyFingerprint: saved.hostKeyFingerprint || undefined
      })
      for (const command of uninstallCommands(this.contextOfStored(saved))) {
        const result = await transport.exec(command.command, { stdin: `${password}\n`, timeoutMs: RUN_TIMEOUT_MS })
        if (result.code !== 0 && !/no such (container|image)/i.test(result.stderr)) {
          throw new Error(`${command.title}失败：${result.stderr.trim().slice(0, 300) || result.code}`)
        }
      }
    } finally {
      await transport.dispose()
    }
  }
}

/** 便于单测断言：探测结果里的 docker 错误文案 */
export type { SshExecResult }
