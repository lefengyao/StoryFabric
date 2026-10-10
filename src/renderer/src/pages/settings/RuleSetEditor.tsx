import { useEffect, useState } from 'react'
import type { RuleLayer } from '../../../../core/rules/types'
import { api } from '../../lib/api'
import { Badge, Button, Card, Spinner } from '../../components/ui/primitives'

export function RuleSetEditor(): React.ReactElement {
  const [layers, setLayers] = useState<RuleLayer[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  useEffect(() => { void api.listCreativeRules().then(setLayers).catch((error) => setMessage(error instanceof Error ? error.message : String(error))).finally(() => setLoading(false)) }, [])
  const save = async (): Promise<void> => {
    setSaving(true); setMessage(null)
    try { await api.saveCreativeRules(layers); setMessage('规则已保存') }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
    finally { setSaving(false) }
  }
  const add = (): void => setLayers((current) => [...current, { source: 'workspace', rules: [{ id: `rule_${Date.now().toString(36)}`, kind: 'guidance', target: 'all', key: 'writing-note', value: '', severity: 'prefer', enabled: true }] }])
  return <section>
    <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold">自定义规则集</h2><div className="flex gap-2"><Button size="sm" onClick={add}>新增规则</Button><Button size="sm" variant="soft" onClick={() => void save()} loading={saving}>保存</Button></div></div>
    <Card className="space-y-3 p-4">
      {loading && <div className="flex justify-center py-4"><Spinner /></div>}
      {!loading && layers.length === 0 && <p className="text-xs text-muted">还没有工作区规则。新增后可按阶段目标（如 write / review）限定生效范围。</p>}
      {layers.map((layer, layerIndex) => <div key={`${layer.source}-${layerIndex}`} className="space-y-2 rounded-lg border border-line p-3">
        <div className="flex items-center gap-2"><Badge>{layer.source}</Badge><span className="text-xs text-muted">规则 {layer.rules.length} 条</span></div>
        {layer.rules.map((rule, ruleIndex) => <div key={rule.id} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
          <input className="h-8 rounded border border-line bg-panel px-2 text-xs" value={rule.key} aria-label="规则键" onChange={(event) => setLayers((current) => current.map((item, index) => index === layerIndex ? { ...item, rules: item.rules.map((entry, i) => i === ruleIndex ? { ...entry, key: event.target.value } : entry) } : item))} />
          <input className="h-8 rounded border border-line bg-panel px-2 text-xs" value={String(rule.value ?? '')} aria-label="规则内容" onChange={(event) => setLayers((current) => current.map((item, index) => index === layerIndex ? { ...item, rules: item.rules.map((entry, i) => i === ruleIndex ? { ...entry, value: event.target.value } : entry) } : item))} />
          <input className="h-8 rounded border border-line bg-panel px-2 text-xs" value={rule.target} aria-label="规则目标" placeholder="all / write / review" onChange={(event) => setLayers((current) => current.map((item, index) => index === layerIndex ? { ...item, rules: item.rules.map((entry, i) => i === ruleIndex ? { ...entry, target: event.target.value } : entry) } : item))} />
          <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={rule.enabled} onChange={(event) => setLayers((current) => current.map((item, index) => index === layerIndex ? { ...item, rules: item.rules.map((entry, i) => i === ruleIndex ? { ...entry, enabled: event.target.checked } : entry) } : item))} />启用</label>
        </div>)}
      </div>)}
      {message && <p className="text-xs text-muted">{message}</p>}
    </Card>
  </section>
}
