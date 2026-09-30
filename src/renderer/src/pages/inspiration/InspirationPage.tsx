import { FileSearch, FileText, FolderOpen, Lightbulb, Loader2, Save, Sparkles, Trash2, Upload } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../lib/api'
import { Button, Card, EmptyState, Field, Input } from '../../components/ui/primitives'
import { useSettings } from '../../stores/settingsStore'
import { useWorkspace } from '../../stores/workspaceStore'
import type { AgentEvent } from '../../../../shared/types'
import type { InspirationArtifactTarget, InspirationSource } from '../../../../shared/inspiration'

type DeskMode = 'name' | 'distill' | 'decompose'

const MODES: Array<{ key: DeskMode; label: string; hint: string }> = [
  { key: 'name', label: '智能起名', hint: '根据主题、人物或片段提供多个可选名称，并解释命名依据。' },
  { key: 'distill', label: '蒸馏小说', hint: '提炼故事、结构、人物和风格，可保存为 Skill、规则集或 docs。' },
  { key: 'decompose', label: '拆解作品', hint: '解释风格、节奏、结构和写法，不生成 Skill、规则集或长期文档。' }
]

export function InspirationPage(): React.ReactElement {
  const settings = useSettings((s) => s.settings)
  const summary = useWorkspace((s) => s.summary)
  const [mode, setMode] = useState<DeskMode>('name')
  const [sources, setSources] = useState<InspirationSource[]>([])
  const [selectedSource, setSelectedSource] = useState<string>('')
  const [prompt, setPrompt] = useState('')
  const [result, setResult] = useState('')
  const [running, setRunning] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saveTarget, setSaveTarget] = useState<InspirationArtifactTarget>('docs')
  const [saveName, setSaveName] = useState('灵感台分析')
  const [localPath, setLocalPath] = useState('')
  const sessionRef = useRef<string | null>(null)
  const desktopPathImport = typeof window !== 'undefined' && Boolean(window.api)

  const model = useMemo(() => {
    const preferred = settings?.defaultChatModel
    if (preferred) return preferred
    const provider = settings?.providers.find((item) => item.models.length > 0)
    return provider ? { providerId: provider.id, model: provider.models[0] } : null
  }, [settings])

  const reloadSources = async (): Promise<void> => {
    if (!api.listInspirationSources) return
    try { setSources(await api.listInspirationSources()) } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  }

  useEffect(() => { void reloadSources() }, [])

  useEffect(() => {
    const unsubscribe = api.onAgentEvent((envelope) => {
      if (!sessionRef.current || envelope.sessionId !== sessionRef.current) return
      const event = envelope.event as AgentEvent
      if (event.type === 'text-delta') setResult((current) => current + event.delta)
      if (event.type === 'error') { setError(event.message); setRunning(false) }
      if (event.type === 'done') setRunning(false)
    })
    return unsubscribe
  }, [])

  const importFile = async (file: File): Promise<void> => {
    if (!api.importInspirationSource) return
    setError(null)
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const imported = await api.importInspirationSource({ name: file.name, bytes })
      if (api.extractInspirationSource) await api.extractInspirationSource(imported.id)
      await reloadSources()
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  }

  const importPath = async (): Promise<void> => {
    const path = localPath.trim()
    if (!path || !api.importInspirationPath) return
    setError(null)
    try {
      const imported = await api.importInspirationPath(path)
      const sources = Array.isArray(imported) ? imported : [imported]
      if (api.extractInspirationSource) {
        for (const source of sources) await api.extractInspirationSource(source.id)
      }
      setLocalPath('')
      await reloadSources()
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  }

  const selectSource = async (source: InspirationSource): Promise<void> => {
    setSelectedSource(source.id)
    if (source.extraction === 'ready' && source.extractedChars === undefined && api.extractInspirationSource) {
      try { await api.extractInspirationSource(source.id); await reloadSources() } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    }
  }

  const removeSource = async (source: InspirationSource): Promise<void> => {
    if (source.origin !== 'imported' || !api.removeInspirationSource) return
    try { await api.removeInspirationSource(source.id); await reloadSources() } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  }

  const run = async (): Promise<void> => {
    if (!model) { setError('请先在设置中配置可用模型'); return }
    if (!prompt.trim() && mode === 'name') { setError('请先描述需要命名的对象'); return }
    setError(null); setResult(''); setRunning(true)
    try {
      const session = await api.createSession()
      sessionRef.current = session.id
      const sourceText = selectedSource && api.readInspirationSource ? await api.readInspirationSource(selectedSource, 60_000).catch(() => '') : ''
      const task = mode === 'name'
        ? `请为以下对象提供 8 个中文名称候选，每个说明语义、气质和适用场景。不要写正文。\n\n对象描述：${prompt}`
        : `${mode === 'distill' ? '请蒸馏以下资料' : '请拆解以下资料'}。${mode === 'distill' ? '输出故事核心、结构、人物、冲突、节奏、语言风格、可迁移写作规律，并明确区分原文事实与推断。' : '输出主题、结构、叙事视角、节奏、人物塑造、语言风格、场景组织和可观察写法；只分析，不生成 Skill、规则集、docs，也不写正文。'}\n\n用户补充：${prompt || '请从已选资料开始。'}\n\n资料内容：\n${sourceText || '当前没有已提取的资料，请先导入并提取资料。'}`
      await api.agentRun({ mode: 'inspiration', message: task, providerId: model.providerId, model: model.model, sessionId: session.id, approvalPolicy: 'strict' })
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); setRunning(false) }
  }

  const saveResult = async (): Promise<void> => {
    if (mode === 'decompose' || !result.trim() || !api.saveInspirationArtifact) return
    setSaving(true); setError(null)
    try { await api.saveInspirationArtifact({ target: saveTarget, name: saveName, content: result }); setError(null) }
    catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setSaving(false) }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-2">
        <Lightbulb size={16} className="text-accent" />
        <span className="text-sm font-semibold">灵感台</span>
        <span className="text-xs text-muted">不写正文，只做灵感、资料和方法提炼</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div data-android-inspiration-grid className="mx-auto grid max-w-6xl gap-5 p-5 lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="space-y-4">
            <Card className="p-3">
              <div className="mb-2 text-xs font-semibold text-muted">工作模块</div>
              <div className="space-y-1">
                {MODES.map((item) => <button key={item.key} type="button" onClick={() => setMode(item.key)} className={`flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left text-sm ${mode === item.key ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-elevated hover:text-fg'}`}><Sparkles size={15} className="mt-0.5 shrink-0" /><span><span className="block font-medium">{item.label}</span><span className="mt-0.5 block text-[11px] leading-4 opacity-75">{item.hint}</span></span></button>)}
              </div>
            </Card>
            <Card className="p-3">
              <div className="mb-2 flex items-center justify-between"><span className="text-xs font-semibold text-muted">灵感资料</span><label className="cursor-pointer rounded-md p-1.5 text-muted hover:bg-elevated hover:text-fg" title="导入资料"><Upload size={14} /><input type="file" accept=".txt,.md,.markdown,.csv,.tsv,.json,.yaml,.yml,.xml,.html,.htm,.rtf,.docx,.pdf,.js,.ts,.py,.java,.c,.cpp,.h,.hpp,.cs,.go,.rs,.sql,.sh,.ps1" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) void importFile(file); e.currentTarget.value = '' }} /></label></div>
              {desktopPathImport && <div className="mb-2 flex gap-1.5"><Input value={localPath} onChange={(e) => setLocalPath(e.target.value)} placeholder="输入电脑上的资料路径" className="min-w-0 flex-1 text-xs" /><Button size="sm" variant="outline" onClick={() => void importPath()} disabled={!localPath.trim()} title="从电脑路径导入"><FolderOpen size={13} /></Button></div>}
              {sources.length === 0 ? <EmptyState icon={<FileText size={22} />} title="暂无资料" hint="导入小说、样章或设定资料" /> : <div className="space-y-1">{sources.map((source) => <div key={source.id} className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-xs ${selectedSource === source.id ? 'bg-accent-soft text-accent' : 'text-muted'}`}><button type="button" className="min-w-0 flex-1 truncate text-left" onClick={() => void selectSource(source)} title={source.relativePath}>{source.displayName}<span className="ml-1 text-[10px] opacity-70">{source.extraction === 'ready' ? source.extractedChars ? `${source.extractedChars} 字` : '待提取' : source.extraction}</span></button>{source.extraction === 'ready' && source.extractedChars === undefined && <button type="button" title="提取文本" onClick={() => { if (api.extractInspirationSource) void api.extractInspirationSource(source.id).then(reloadSources).catch((err) => setError(err instanceof Error ? err.message : String(err))) }} className="text-faint hover:text-accent"><FileSearch size={13} /></button>}{source.origin === 'imported' && <button type="button" title="移除资料" onClick={() => void removeSource(source)} className="text-faint hover:text-danger"><Trash2 size={13} /></button>}</div>)}</div>}
            </Card>
          </aside>
          <section className="min-w-0 space-y-4">
            <Card className="space-y-4 p-4">
              <div><h2 className="text-base font-semibold">{MODES.find((item) => item.key === mode)?.label}</h2><p className="mt-1 text-xs text-muted">{MODES.find((item) => item.key === mode)?.hint}</p></div>
              <Field label={mode === 'name' ? '描述' : '任务补充'} hint={mode === 'name' ? '可以写主题、人物关系、时代气质或希望避开的词。' : '告诉智能体你最关心的角度，资料会作为只读参考。'}><textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={5} className="w-full resize-y rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none focus:border-accent" placeholder={mode === 'name' ? '例如：一部关于失忆航海家的悬疑小说，冷峻、克制' : '例如：重点关注前三章如何制造悬念，以及对白的节奏。'} /></Field>
              <div className="flex flex-wrap items-center gap-2"><Button variant="primary" onClick={() => void run()} disabled={running}><Sparkles size={14} />{running ? '分析中…' : '开始分析'}</Button>{selectedSource && <span className="text-xs text-muted">已选择资料：{sources.find((item) => item.id === selectedSource)?.displayName}</span>}{summary && <span className="ml-auto text-[11px] text-faint">工作区：{summary.name}</span>}</div>
            </Card>
            {(running || result || error) && <Card className="p-4"><div className="mb-2 flex items-center gap-2 text-xs font-semibold text-muted">{running && <Loader2 size={14} className="animate-spin" />}分析结果</div>{error && <div className="mb-3 rounded-md bg-danger-soft px-3 py-2 text-xs text-danger">{error}</div>}<div className="min-h-40 whitespace-pre-wrap text-sm leading-6 text-fg">{result || (running ? '智能体正在读取资料并整理分析…' : '')}</div>{result && mode === 'distill' && <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3"><Input value={saveName} onChange={(e) => setSaveName(e.target.value)} className="max-w-56" placeholder="保存名称" /><select value={saveTarget} onChange={(e) => setSaveTarget(e.target.value as InspirationArtifactTarget)} className="set-select"><option value="docs">保存到 docs</option><option value="skill">保存为 Skill</option><option value="rules">保存为规则集</option></select><Button size="sm" variant="outline" onClick={() => void saveResult()} disabled={saving}><Save size={13} />{saving ? '保存中…' : '保存结果'}</Button></div>}</Card>}
          </section>
        </div>
      </div>
    </div>
  )
}
