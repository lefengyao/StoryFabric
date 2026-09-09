import { mkdtemp, rm, writeFile } from 'node:fs/promises'
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
  // 注意顺序：健康检查也含 'docker inspect --format'，必须排在下面那条前面
  { match: '.State.Health.Status', result: { code: 0, stdout: 'healthy\n', stderr: '' } },
  { match: 'docker inspect --format', result: { code: 1, stdout: '', stderr: 'Error: No such object' } },
  { match: 'docker image inspect', result: { code: 1, stdout: '', stderr: '' } },
  { match: 'docker build', result: { code: 0, stdout: 'Successfully tagged storyfabric:0.1.0\n', stderr: '' } },
  { match: 'openssl rand', result: { code: 0, stdout: '', stderr: '' } },
  { match: "cat '/opt/storyfabric/secrets", result: { code: 0, stdout: 'test-access-key\n', stderr: '' } },
  { match: 'docker rm -f', result: { code: 0, stdout: 'storyfabric\n', stderr: '' } },
  { match: 'docker run -d', result: { code: 0, stdout: 'container-id\n', stderr: '' } }
]

const target = {
  label: '测试机',
  host: '10.0.0.5',
  port: 22,
  username: 'me',
  password: 'pw',
  installDir: '/opt/storyfabric',
  servicePort: 8787,
  baseImage: 'node:22-bookworm-slim'
}

async function withService(
  run: (service: DeployService, store: DeployTargetsStore, transport: FakeTransport) => Promise<void>,
  rules: FakeRule[] = linuxRules
): Promise<void> {
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
    healthAttempts: 2,
    healthPollMs: 0
  })
  try {
    await run(service, store, transport)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** 折叠连续重复的 step:status，只看步骤转移 */
function transitions(events: string[]): string[] {
  return events.filter((event, index) => event !== events[index - 1])
}

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
    const rules = linuxRules.map((r) =>
      r.match === 'docker version' ? { ...r, result: { code: 127, stdout: '', stderr: 'docker: command not found' } } : r
    )
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
      ...linuxRules.map((r) =>
        r.match === 'sudo -n true' ? { ...r, result: { code: 1, stdout: '', stderr: 'sudo: a password is required' } } : r
      ),
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
      const output: string[] = []
      const result = await service.install(target, (p) => output.push(p.output ?? ''))
      expect(result.ok).toBe(false)
      expect(result.failedStep).toBe('healthcheck')
      expect(output.join('')).toContain('boom')
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
      const list = await service.listTargets()
      expect(list[0].hasPassword).toBe(true)
      expect(JSON.stringify(list)).not.toContain('pw')
    })
  })
})
