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
  { match: 'secrets/storyfabric_key', result: { code: 0, stdout: 'test-access-key\n', stderr: '' } },
  { match: 'docker rm -f', result: { code: 0, stdout: 'storyfabric\n', stderr: '' } },
  { match: 'docker run -d', result: { code: 0, stdout: 'container-id\n', stderr: '' } },
  { match: 'docker rmi', result: { code: 0, stdout: 'Deleted: sha256:abc\n', stderr: '' } },
  { match: 'rm -rf', result: { code: 0, stdout: '', stderr: '' } },
  { match: 'mkdir -p', result: { code: 0, stdout: '', stderr: '' } },
  { match: 'tar -xzf', result: { code: 0, stdout: '', stderr: '' } }
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
      expect(result.error).not.toContain('未安装 Docker')
    }, rules)
  })

  it('sudo 可用但 docker 探测仍报 sudo 错误时，提示 sudo 而不是未安装', async () => {
    // 规则顺序即优先级：把 sudo-docker 放在通用 docker version 之前
    const rules: FakeRule[] = [
      { match: 'sudo -S docker version', result: { code: 1, stdout: '', stderr: 'sudo: 1 incorrect password attempt' } },
      ...linuxRules
    ]
    await withService(async (service) => {
      const result = await service.install(target, () => {})
      expect(result.ok).toBe(false)
      expect(result.error).toContain('sudo')
      expect(result.error).not.toContain('未安装 Docker')
    }, rules)
  })

  it('重装同一台服务器时新端口与安装目录会落盘', async () => {
    await withService(async (service, store) => {
      const first = await service.install(target, () => {})
      expect(first.ok).toBe(true)
      const [saved] = await store.list()
      const second = await service.install({ ...target, id: saved.id, servicePort: 9000, installDir: '/srv/sf' }, () => {})
      expect(second.ok).toBe(true)
      const [updated] = await store.list()
      expect(updated.servicePort).toBe(9000)
      expect(updated.installDir).toBe('/srv/sf')
    })
  })

  it('卸载会清理 staging 目录', async () => {
    await withService(async (service, store, transport) => {
      await service.install(target, () => {})
      const [saved] = await store.list()
      await service.uninstall(saved.id)
      expect(transport.calls.some((c) => c === "rm -rf '/home/me/.storyfabric-staging/0.1.0'")).toBe(true)
    })
  })

  it('首次安装失败也会记录 lastStatus 与 lastError', async () => {
    const rules = linuxRules.map((r) =>
      r.match === '.State.Health.Status' ? { ...r, result: { code: 0, stdout: 'starting\n', stderr: '' } } : r
    )
    await withService(async (service, store) => {
      const result = await service.install(target, () => {})
      expect(result.ok).toBe(false)
      const [saved] = await store.list()
      expect(saved.lastStatus).toBe('failed')
      expect(saved.lastError).toContain('健康检查超时')
    }, rules)
  })

  it('健康检查阶段取消会报「已取消」而不是超时', async () => {
    const rules = linuxRules.map((r) =>
      r.match === '.State.Health.Status' ? { ...r, result: { code: 0, stdout: 'starting\n', stderr: '' } } : r
    )
    await withService(async (service) => {
      const installPromise = service.install(target, () => {})
      await service.cancel()
      const result = await installPromise
      expect(result.ok).toBe(false)
      expect(result.error).toBe('已取消')
    }, rules)
  })

  it('testConnection 不会把渲染层传来的脏端口拼进命令', async () => {
    await withService(async (service, _store, transport) => {
      await service.testConnection({
        host: '10.0.0.5',
        port: 22,
        username: 'me',
        password: 'pw',
        servicePort: "1'; touch /tmp/pwned; #"
      } as never)
      expect(transport.calls.some((c) => c.includes('touch'))).toBe(false)
    })
  })

  it('未保存密码时 passwordStorage 为 none', async () => {
    await withService(async (service, store) => {
      await store.save({ ...target, password: undefined })
      const [saved] = await service.listTargets()
      expect(saved.hasPassword).toBe(false)
      expect(saved.passwordStorage).toBe('none')
    })
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

  it('用户名含非法字符时在连接前拒绝', async () => {
    await withService(async (service) => {
      const result = await service.install({ ...target, username: 'root; rm -rf /' }, () => {})
      expect(result.ok).toBe(false)
      expect(result.error).toContain('用户名')
    })
  })

  it('密码只出现在 stdin，绝不进入命令字符串', async () => {
    await withService(async (service, _store, transport) => {
      const result = await service.install(target, () => {})
      expect(result.ok).toBe(true)
      expect(transport.calls.some((c) => c.includes('pw'))).toBe(false)
      expect(transport.stdins.some((s) => s.stdin?.includes('pw'))).toBe(true)
    })
  })

  it('更新时端口被自己上一版容器占用不算冲突', async () => {
    const rules = [
      ...linuxRules.map((r) =>
        r.match === 'ss -ltn'
          ? { ...r, result: { code: 0, stdout: 'LISTEN 0 128 0.0.0.0:8787 0.0.0.0:*\n', stderr: '' } }
          : r.match === 'docker inspect --format'
            ? { ...r, result: { code: 0, stdout: 'storyfabric:0.0.9\n', stderr: '' } }
            : r
      )
    ]
    await withService(async (service) => {
      const result = await service.install(target, () => {})
      expect(result.ok).toBe(true)
    }, rules)
  })

  it('Docker 权限不足时给出「加入 docker 组」而不是「未安装」', async () => {
    const rules = linuxRules.map((r) =>
      r.match === 'docker version'
        ? { ...r, result: { code: 1, stdout: '', stderr: 'permission denied while trying to connect to the Docker daemon socket' } }
        : r
    )
    await withService(async (service) => {
      const result = await service.install(target, () => {})
      expect(result.ok).toBe(false)
      expect(result.error).toContain('权限')
    }, rules)
  })

  it('卸载失败时抛错，不静默成功', async () => {
    const rules = [{ match: 'docker rm -f', result: { code: 1, stdout: '', stderr: 'Cannot connect to the Docker daemon' } }]
    await withService(async (service, store) => {
      await store.save(target)
      const [saved] = await store.list()
      await expect(service.uninstall(saved.id)).rejects.toThrow('删除容器失败')
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
