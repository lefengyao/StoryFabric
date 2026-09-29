import { Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { CreativePackageSummary } from '../../../../shared/creative'
import type { ContentPackage } from '../../../../core/skills/types'
import { decodeContentPackageArchive } from '../../../../core/skills/packageArchive'
import { api } from '../../lib/api'
import { Badge, Button, Card, EmptyState, Spinner } from '../../components/ui/primitives'

/** Shared global content-package manager used by desktop, web and Android settings. */
export function CreativeExtensionsView(): React.ReactElement {
  const [packages, setPackages] = useState<CreativePackageSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [installing, setInstalling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const importInput = useRef<HTMLInputElement>(null)

  const load = async (): Promise<void> => {
    setLoading(true)
    try { setPackages(await api.listCreativePackages()); setError(null) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [])

  const toggle = async (item: CreativePackageSummary): Promise<void> => {
    try {
      const next = await api.setCreativePackageEnabled(item.id, item.version, !item.enabled)
      setPackages((items) => items.map((current) => current.id === next.id && current.version === next.version ? next : current))
      setError(null)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }

  const install = async (file: File): Promise<void> => {
    setInstalling(true)
    setError(null)
    setNotice(null)
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('内容包文件不能超过 2 MB')
      const isArchive = file.name.toLowerCase().endsWith('.storyfabric.plugin.zip') || file.name.toLowerCase().endsWith('.zip') || file.type === 'application/zip'
      const input = isArchive
        ? await decodeContentPackageArchive(new Uint8Array(await file.arrayBuffer()))
        : JSON.parse(await file.text()) as ContentPackage
      const next = await api.installCreativePackage(input)
      setPackages((items) => [...items.filter((item) => item.id !== next.id || item.version !== next.version), next].sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`)))
      setNotice(`已安装并启用：${next.name} v${next.version}`)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally {
      setInstalling(false)
      if (importInput.current) importInput.current.value = ''
    }
  }

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Skill 与插件</h2>
          <p className="mt-1 text-xs text-muted">全局 Skill 库：支持 .storyfabric.plugin.zip 内容包，也兼容 JSON；内容包只包含声明式文本，不执行脚本或外部依赖。</p>
        </div>
        <Button size="sm" variant="soft" onClick={() => importInput.current?.click()} loading={installing} className="shrink-0">
          <Upload size={13} /> 安装内容包
        </Button>
        <input
          ref={importInput}
          type="file"
          accept="application/zip,.storyfabric.plugin.zip,.zip,application/json,.json"
          className="hidden"
          onChange={(event) => { const file = event.target.files?.[0]; if (file) void install(file) }}
        />
      </div>
      <Card className="space-y-3 p-4">
        {loading && <div className="flex justify-center py-4"><Spinner /></div>}
        {!loading && error && <p className="text-xs text-danger">加载失败：{error}</p>}
        {!loading && notice && <p className="text-xs text-ok">{notice}</p>}
        {!loading && !error && packages.length === 0 && <EmptyState title="暂无内容包" hint="内置创作 Skill 将随应用提供。" />}
        {!loading && !error && <div className="space-y-2">
          {packages.map((item) => <div key={`${item.id}@${item.version}`} className="flex items-start gap-3 rounded-lg border border-line p-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2"><span className="text-sm font-medium">{item.name}</span><Badge tone="accent">v{item.version}</Badge>{item.enabled ? <Badge tone="ok">已启用</Badge> : <Badge>已停用</Badge>}</div>
              <p className="mt-1 text-xs leading-5 text-muted">{item.description}</p>
              <p className="mt-1 text-[11px] text-faint">Skill {item.skills.length} · 规则集 {item.ruleSets.length}</p>
            </div>
            <Button size="sm" variant={item.enabled ? 'ghost' : 'soft'} onClick={() => void toggle(item)}>{item.enabled ? '停用' : '启用'}</Button>
          </div>)}
        </div>}
        <Button size="sm" onClick={() => void load()} disabled={loading}>刷新</Button>
      </Card>
    </section>
  )
}
