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
import type { SshTransport } from './ssh2Transport'

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

  /** 连接 + 探测；传了 targetId 时会校验已 pin 的指纹。 */
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
      const probe = await this.probe(transport, this.contextOf(input, saved))
      return {
        fingerprint,
        probe,
        fingerprintChanged: Boolean(saved?.hostKeyFingerprint && saved.hostKeyFingerprint !== fingerprint)
      }
    } finally {
      await transport.dispose()
    }
  }

  private contextOf(input: DeployTargetInput, saved?: { installDir: string; servicePort: number; baseImage: string }): DeployContext {
    return {
      installDir: input.installDir || saved?.installDir || '/opt/storyfabric',
      servicePort: input.servicePort || saved?.servicePort || 8787,
      baseImage: input.baseImage || saved?.baseImage || 'node:22-bookworm-slim',
      version: this.options.version,
      stagingDir: '',
      isRoot: false
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
      const probe = await this.probe(transport, this.contextOf(input))
      if (parseOs(probe.os) !== 'linux') return await fail('只支持 Linux 服务器')
      if (!probe.dockerVersion) {
        return await fail('服务器未安装 Docker，请先安装后重试（Debian/Ubuntu: curl -fsSL https://get.docker.com | sh）')
      }
      if (!probe.portFree) return await fail(`端口 ${input.servicePort} 已被占用，请换一个端口`)
      if (!probe.isRoot && !probe.passwordlessSudo) {
        const check = await transport.exec('sudo -S true', { stdin: `${password}\n` })
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
      const mkdirResult = await transport.exec(`mkdir -p ${ctx.stagingDir}`)
      if (mkdirResult.code !== 0) return await fail(`创建上传目录失败：${mkdirResult.stderr.trim() || mkdirResult.code}`)
      await transport.upload(this.options.bundlePath, `${ctx.stagingDir}/${bundleName}`)
      const extract = await transport.exec(`cd ${ctx.stagingDir} && tar -xzf ${bundleName}`)
      if (extract.code !== 0) return await fail(`解压部署包失败：${extract.stderr.trim() || extract.code}`)
      emit(step, 'ok')
      step = nextStep(step, true) as DeployStep

      const build = buildCommands(ctx)
      emit(step, 'running')
      const exists = await transport.exec(byId(build, 'image.exists').command, { stdin: `${password}\n` })
      if (exists.code === 0) {
        emit(step, 'skipped', { message: '镜像已存在，跳过构建' })
      } else {
        const prepare = await transport.exec(byId(build, 'prepare.dir').command, {
          stdin: `${password}\n`,
          onData: (text) => emit(step, 'running', { output: text })
        })
        if (prepare.code !== 0) return await fail(`创建安装目录失败：${prepare.stderr.trim() || prepare.code}`)
        const result = await transport.exec(byId(build, 'build').command, {
          stdin: `${password}\n`,
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
      if (this.aborted) return false
      const result = await transport.exec(healthCommand(ctx).command, { stdin: `${password}\n` })
      const status = result.stdout.trim()
      if (status === 'healthy') return true
      if (status === 'none') {
        const fallback = await transport.exec(
          `docker exec storyfabric node -e "fetch('http://127.0.0.1:8787/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"`,
          { stdin: `${password}\n` }
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
      const ctx: DeployContext = {
        installDir: saved.installDir,
        servicePort: saved.servicePort,
        baseImage: saved.baseImage,
        version: saved.installedVersion ?? this.options.version,
        stagingDir: '',
        isRoot: false
      }
      return (await transport.exec(logsCommand(ctx).command, { stdin: `${password}\n` })).stdout
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
      const version = saved.installedVersion ?? this.options.version
      const ctx: DeployContext = {
        installDir: saved.installDir,
        servicePort: saved.servicePort,
        baseImage: saved.baseImage,
        version,
        stagingDir: `/home/${saved.username}/.storyfabric-staging/${version}`,
        isRoot: false
      }
      for (const command of uninstallCommands(ctx)) {
        await transport.exec(command.command, { stdin: `${password}\n` })
      }
    } finally {
      await transport.dispose()
    }
  }
}
