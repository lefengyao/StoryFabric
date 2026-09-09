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
  it('sudo 只加在需要特权的子命令上（cd 不能被 sudo 前缀）', () => {
    const cmds = buildCommands(ctx)
    expect(cmds.find((c) => c.id === 'build')?.command).toBe(
      "cd '/home/me/.storyfabric-staging/0.1.0' && sudo -S docker build -f Dockerfile.runtime -t 'storyfabric:0.1.0' --build-arg BASE_IMAGE='node:22-bookworm-slim' ."
    )
    expect(cmds.find((c) => c.id === 'prepare.dir')?.command).toBe(
      "sudo -S mkdir -p '/opt/storyfabric/data' '/opt/storyfabric/secrets'"
    )
    expect(cmds.find((c) => c.id === 'image.exists')?.needsSudo).toBe(true)
  })

  it('root 时不加 sudo', () => {
    const cmds = buildCommands({ ...ctx, isRoot: true })
    expect(cmds.find((c) => c.id === 'build')?.command).toBe(
      "cd '/home/me/.storyfabric-staging/0.1.0' && docker build -f Dockerfile.runtime -t 'storyfabric:0.1.0' --build-arg BASE_IMAGE='node:22-bookworm-slim' ."
    )
  })

  it('路径含空格时被正确转义', () => {
    const cmds = buildCommands({ ...ctx, installDir: '/opt/story fabric', isRoot: true })
    expect(cmds.find((c) => c.id === 'prepare.dir')?.command).toContain("'/opt/story fabric/data'")
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
    expect(start).toContain("'storyfabric:0.1.0'")
  })

  it('生成密钥时幂等：已存在则不覆盖', () => {
    const generate = runCommands(ctx).find((c) => c.id === 'key.generate')?.command ?? ''
    expect(generate.startsWith('sudo -S sh -c ')).toBe(true)
    expect(generate).toContain('umask 077')
    expect(generate).toContain('[ -f ')
    expect(generate).toContain('|| openssl rand -base64 32')
    expect(generate).toContain('/opt/storyfabric/secrets/storyfabric_key')
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
    expect(commands).toContain("docker rmi 'storyfabric:0.1.0'")
    expect(commands).toContain("rm -rf '/home/me/.storyfabric-staging/0.1.0'")
    expect(commands).not.toContain('rm -rf /opt/storyfabric/data')
    // 不再用 `|| true` 掩盖失败，由调用方按退出码判断
    expect(commands).not.toContain('|| true')
  })
})
