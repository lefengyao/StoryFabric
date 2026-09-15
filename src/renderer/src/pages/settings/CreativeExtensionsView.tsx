import { useEffect, useState } from 'react'
import type { CreativePackageSummary } from '../../../../shared/creative'
import { api } from '../../lib/api'
import { Badge, Button, Card, EmptyState, Spinner } from '../../components/ui/primitives'

/** Shared content-package manager used by desktop, web and Android settings. */
export function CreativeExtensionsView(): React.ReactElement {
  const [packages, setPackages] = useState<CreativePackageSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async (): Promise<void> => {
    setLoading(true)
    try { setPackages(await api.listCreativePackages()); setError(null) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [])

  const toggle = async (item: CreativePackageSummary): Promise<void> => {
    const next = await api.setCreativePackageEnabled(item.id, item.version, !item.enabled)
    setPackages((items) => items.map((current) => current.id === next.id && current.version === next.version ? next : current))
  }

  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold">创作扩展</h2>
      <Card className="space-y-3 p-4">
        <p className="text-xs leading-5 text-muted">启用的 Skill 会作为本次创作的指导输入；内容包只包含声明式文本，不执行脚本或外部依赖。</p>
        {loading && <div className="flex justify-center py-4"><Spinner /></div>}
        {!loading && error && <p className="text-xs text-danger">加载失败：{error}</p>}
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
