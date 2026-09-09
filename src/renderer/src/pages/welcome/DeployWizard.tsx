/** 远程服务器安装向导：连接 → 指纹确认 → 配置 → 执行 → 完成。 */
import { ChevronLeft, Copy, Server } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge, Button, Card, Field, Input } from '../../components/ui/primitives'
import { api } from '../../lib/api'
import type { DeployProbeResult, DeployRunResult, DeployStep, DeployStepStatus } from '../../../../shared/types'

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

  useEffect(
    () =>
      api.onDeployEvent((progress) => {
        setStatuses((prev) => ({ ...prev, [progress.step]: progress.status }))
        if (progress.output) setOutput((prev) => `${prev}${progress.output}`.slice(-20000))
        if (progress.message && progress.status === 'failed') setError(progress.message)
      }),
    []
  )

  const test = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const result = await api.deployTestConnection({
        host: host.trim(),
        port: Number(port) || 22,
        username: username.trim(),
        password
      })
      setFingerprint(result.fingerprint)
      setProbe(result.probe)
      setFingerprintConfirmed(Boolean(result.fingerprintChanged))
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
    setResult(null)
    try {
      const result = await api.deployInstall({
        label: host.trim(),
        host: host.trim(),
        port: Number(port) || 22,
        username: username.trim(),
        password,
        hostKeyFingerprint: fingerprint,
        installDir: installDir.trim(),
        servicePort: Number(servicePort) || 8787,
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

  const probeBlockedReason = !probe
    ? null
    : probe.os.trim().toLowerCase() !== 'linux'
      ? '只支持 Linux 服务器'
      : !probe.dockerVersion
        ? '服务器未安装 Docker，请先安装后重试'
        : !probe.portFree
          ? `端口 ${servicePort} 已被占用，请换端口`
          : null

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto bg-app p-4 sm:p-8">
      <div className="mx-auto w-full max-w-2xl space-y-4">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={onClose}>
            <ChevronLeft size={14} /> 返回
          </Button>
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">
            <Server size={14} className="mr-1 inline" /> 安装 StoryFabric 服务
          </h2>
          <Badge tone="accent">Linux</Badge>
        </div>

        {phase === 'form' && (
          <Card className="space-y-3 p-4">
            <Field label="SSH 地址 *">
              <Input value={host} onChange={(e) => setHost(e.target.value)} placeholder="192.168.1.10 或 example.com" autoFocus />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="端口 *">
                <Input value={port} onChange={(e) => setPort(e.target.value)} />
              </Field>
              <Field label="用户名 *">
                <Input value={username} onChange={(e) => setUsername(e.target.value)} />
              </Field>
            </div>
            <Field label="密码 *" hint="用于 SSH 登录；非 root 时也会作为 sudo 密码">
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            {error && <div className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">{error}</div>}
            <Button variant="primary" onClick={() => void test()} loading={busy} disabled={!host.trim() || !username.trim() || !password}>
              测试连接
            </Button>
          </Card>
        )}

        {phase === 'verify' && probe && (
          <Card className="space-y-3 p-4">
            <Field label="服务器指纹（请核对后再继续）">
              <code className="block break-all rounded-lg bg-app px-3 py-2 text-xs">{fingerprint}</code>
            </Field>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[var(--accent)]"
                checked={fingerprintConfirmed}
                onChange={(e) => setFingerprintConfirmed(e.target.checked)}
              />
              我已核对指纹
            </label>
            <div className="space-y-1 text-xs text-muted">
              <div>
                系统：{probe.os} / {probe.arch}
                {probe.distro ? ` · ${probe.distro}` : ''}
              </div>
              <div>Docker：{probe.dockerVersion ?? '未安装'}</div>
              <div>
                端口 {servicePort}：{probe.portFree ? '可用' : '已被占用'}
              </div>
              <div>sudo：{probe.isRoot ? 'root' : probe.passwordlessSudo ? '免密可用' : '需密码（将用 SSH 密码）'}</div>
            </div>
            {probeBlockedReason && <p className="text-[11px] text-danger">{probeBlockedReason}</p>}
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setPhase('form')}>
                上一步
              </Button>
              <Button variant="primary" disabled={!fingerprintConfirmed || Boolean(probeBlockedReason)} onClick={() => setPhase('config')}>
                下一步
              </Button>
            </div>
          </Card>
        )}

        {phase === 'config' && (
          <Card className="space-y-3 p-4">
            <Field label="安装目录" hint="数据与访问密钥会放在这里">
              <Input value={installDir} onChange={(e) => setInstallDir(e.target.value)} />
            </Field>
            <Field label="服务端口" hint="对外访问端口，需在安全组/防火墙放行">
              <Input value={servicePort} onChange={(e) => setServicePort(e.target.value)} />
            </Field>
            <Field label="基础镜像" hint="服务器首次构建需要能拉取该镜像">
              <Input value={baseImage} onChange={(e) => setBaseImage(e.target.value)} />
            </Field>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setPhase('verify')}>
                上一步
              </Button>
              <Button variant="primary" onClick={() => void install()}>
                开始安装
              </Button>
            </div>
          </Card>
        )}

        {phase === 'run' && (
          <Card className="space-y-3 p-4">
            {STEPS.map((step) => {
              const status = statuses[step.key] ?? 'pending'
              return (
                <div key={step.key} className="flex items-center gap-2 text-xs">
                  <Badge tone={status === 'ok' ? 'ok' : status === 'failed' ? 'danger' : status === 'running' ? 'accent' : 'default'}>
                    {status}
                  </Badge>
                  <span>{step.label}</span>
                </div>
              )
            })}
            {output && <pre className="max-h-56 overflow-auto rounded-lg bg-app p-2 text-[11px] leading-4">{output}</pre>}
            {error && <div className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">{error}</div>}
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => void api.deployCancel()}>
                取消
              </Button>
              {!busy && error && (
                <Button variant="primary" onClick={() => void install()}>
                  重试
                </Button>
              )}
            </div>
          </Card>
        )}

        {phase === 'done' && result?.ok && (
          <Card className="space-y-3 p-4">
            <div className="text-sm font-medium">安装完成</div>
            <Field label="服务地址">
              <Input readOnly value={result.url ?? ''} />
            </Field>
            <Field label="访问密钥">
              <Input readOnly value={result.accessKey ?? ''} />
            </Field>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => void navigator.clipboard.writeText(result.accessKey ?? '')}>
                <Copy size={13} /> 复制密钥
              </Button>
              <Button variant="primary" onClick={() => onDone({ url: result.url ?? '', accessKey: result.accessKey ?? '' })}>
                填入服务模式
              </Button>
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}
