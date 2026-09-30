import { Brain, KeyRound, Pencil, Plus, Settings2, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Badge, Button, Card, EmptyState, Field, Input, Spinner } from '../../components/ui/primitives'
import { Modal } from '../../components/ui/modal'
import { ModelManagerView } from './ModelManagerView'
import { api } from '../../lib/api'
import { PROTOCOL_LABEL } from '../../lib/utils'
import { isValidHexColor } from '../../lib/accent'
import { EDITOR_FONT_SIZES, EDITOR_LINE_HEIGHTS } from '../../lib/editorStyle'
import { CHAT_FONT_SIZES } from '../../lib/chatTypography'
import { createKeyedDebounce } from '../../lib/pendingCommit'
import { playCompletionSound } from '../../lib/completionSound'
import type { ChatDensity, EditorFontFamily, Protocol, ProviderInput, ProviderPublic, SendShortcut } from '../../../../shared/types'
import { useSettings } from '../../stores/settingsStore'
import { OrchestrationSettingsView } from './OrchestrationSettingsView'
import { useWorkspace } from '../../stores/workspaceStore'

const PROTOCOLS: Protocol[] = ['openai', 'anthropic', 'gemini']

const PROTOCOL_HINTS: Record<Protocol, string> = {
  openai: 'Base URL 通常以 /v1 结尾；Gemini 的 OpenAI 兼容模式填写 https://generativelanguage.googleapis.com/v1beta/openai',
  anthropic: 'Base URL 如 https://api.anthropic.com',
  gemini: 'Gemini 原生协议填写 https://generativelanguage.googleapis.com/v1beta；也接受主机根地址'
}

const TABS = [
  { key: 'models', label: '模型与供应商' },
  { key: 'agent', label: '智能体' },
  { key: 'orchestration', label: '编排' },
  { key: 'appearance', label: '外观' },
  { key: 'notifications', label: '通知' }
] as const

type TabKey = (typeof TABS)[number]['key']

const ACCENT_PRESETS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6']

export function SettingsPage(): React.ReactElement {
  const settings = useSettings((s) => s.settings)
  const reload = useSettings((s) => s.load)
  const update = useSettings((s) => s.update)
  const workspace = useWorkspace((s) => s.summary)
  const previewAccent = useSettings((s) => s.previewAccent)
  // 两个取色器各有独立定时器：先改浅色再改深色时不会取消前者；离开页面时让定时器照常落盘。
  const accentCommit = useRef<ReturnType<typeof createKeyedDebounce<'accentColorLight' | 'accentColorDark'>> | null>(null)

  const [params, setParams] = useSearchParams()
  const active: TabKey = TABS.find((tab) => tab.key === params.get('tab'))?.key ?? 'models'

  const [editing, setEditing] = useState<ProviderInput | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [managingId, setManagingId] = useState<string | null>(null)
  const [savingProvider, setSavingProvider] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [promptDraft, setPromptDraft] = useState<string | null>(null)
  const [projectPrompt, setProjectPrompt] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const workspaceKey = workspace?.path ?? null
    setPromptDraft(null)
    setProjectPrompt(null)
    if (!workspaceKey || !api.readInspirationDoc) return () => { cancelled = true }
    void api.readInspirationDoc('system-prompt.md').then((content) => {
      if (!cancelled) setProjectPrompt(content ?? '')
    }).catch(() => { if (!cancelled) setProjectPrompt('') })
    return () => { cancelled = true }
  }, [workspace?.path])

  if (!settings) return <div className="flex h-full items-center justify-center"><Spinner /></div>

  const managing = managingId ? settings.providers.find((p) => p.id === managingId) ?? null : null
  if (managing) {
    // 保存模型后刷新弹窗里的模型列表，避免用旧列表覆盖刚做的改动（名称/Base URL 等未保存输入保留）
    const handleModelsSaved = async (): Promise<void> => {
      await reload()
      setEditing((prev) => {
        if (!prev || !editingId) return prev
        const fresh = useSettings.getState().settings?.providers.find((p) => p.id === editingId)
        return fresh ? { ...prev, models: [...fresh.models], modelSettings: { ...fresh.modelSettings } } : prev
      })
    }
    return <ModelManagerView provider={managing} onClose={() => setManagingId(null)} onSaved={handleModelsSaved} />
  }

  const openCreate = (): void => {
    setEditingId(null)
    setFormError(null)
    setEditing({ name: '', protocol: 'openai', baseUrl: '', apiKey: undefined, models: [], modelSettings: {} })
  }

  const openEdit = (p: ProviderPublic): void => {
    setEditingId(p.id)
    setFormError(null)
    setEditing({ name: p.name, protocol: p.protocol, baseUrl: p.baseUrl, apiKey: undefined, models: [...p.models], modelSettings: { ...p.modelSettings } })
  }

  const saveProvider = async (): Promise<void> => {
    if (!editing) return
    setSavingProvider(true)
    setFormError(null)
    try {
      await api.saveProvider({ ...editing, id: editingId ?? undefined })
      await reload()
      setEditing(null)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err))
    } finally {
      setSavingProvider(false)
    }
  }

  const removeProvider = async (id: string): Promise<void> => {
    await api.deleteProvider(id)
    await reload()
  }

  /* 模型选择公共数据 */
  const modelOptions = settings.providers.filter((p) => p.models.length > 0)
  const modelValue = (ref?: { providerId: string; model: string }): string => (ref ? `${ref.providerId}::${ref.model}` : '')
  const modelOnChange =
    (key: 'defaultChatModel') =>
    async (v: string): Promise<void> => {
      const [providerId, model] = v.split('::')
      await update({ [key]: { providerId, model } })
    }

  /** 取色器只接受合法 hex，文本输入非法时不污染预览 */
  const accentValue = (value: string, fallback: string): string => (isValidHexColor(value) ? value : fallback)

  /** 拖动取色时即时预览（只改 CSS 变量），停手 400ms 后才落盘，避免每个 input 事件都走一次 IPC。 */
  const commitAccent = (key: 'accentColorLight' | 'accentColorDark', value: string): void => {
    previewAccent(value)
    if (!accentCommit.current) {
      accentCommit.current = createKeyedDebounce<'accentColorLight' | 'accentColorDark'>(400, (patchKey, patchValue) => {
        void update({ [patchKey]: patchValue }).catch(() => {})
      })
    }
    accentCommit.current.schedule(key, value)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-line px-4 py-2">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setParams({ tab: tab.key })}
            className={`shrink-0 rounded-lg px-3 py-1.5 text-xs transition-colors ${
              active === tab.key ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-elevated hover:text-fg'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl space-y-6 p-6">
          {active === 'models' && (
            <>
              {/* 供应商 */}
              <section>
                <div className="mb-3 flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold">模型供应商</h2>
                    <p className="mt-0.5 text-xs leading-5 text-muted">支持 OpenAI 兼容、Anthropic、Gemini 三种协议；密钥优先使用系统级加密存储</p>
                  </div>
                  <Button size="sm" variant="primary" onClick={openCreate} className="shrink-0 whitespace-nowrap px-2.5 sm:px-3">
                    <Plus size={13} /> <span className="hidden sm:inline">添加供应商</span><span className="sm:hidden">添加</span>
                  </Button>
                </div>

                {settings.providers.length === 0 && (
                  <Card>
                    <EmptyState icon={<KeyRound size={26} />} title="还没有供应商" hint="添加 DeepSeek / Kimi / OpenRouter 等任意 OpenAI 兼容服务即可开始" />
                  </Card>
                )}

                <div className="space-y-2">
                  {settings.providers.map((p) => (
                    <Card key={p.id} className="flex items-center gap-3 p-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{p.name}</span>
                          <Badge tone="accent">{PROTOCOL_LABEL[p.protocol]}</Badge>
                          {p.hasKey ? <Badge tone={p.keyStorage === 'plain' ? 'danger' : 'ok'}>Key {p.keyPreview}</Badge> : <Badge tone="danger">未配置密钥</Badge>}
                          {p.keyStorage === 'plain' && <Badge tone="danger">明文降级</Badge>}
                        </div>
                        <div className="mt-1 truncate text-xs text-faint">{p.baseUrl || '（未填 Base URL）'} · {p.models.length} 个模型</div>
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => setManagingId(p.id)} title="管理模型">
                        <Settings2 size={13} />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => openEdit(p)}>
                        <Pencil size={13} />
                      </Button>
                      <Button size="sm" variant="ghost" className="text-danger hover:text-danger" onClick={() => void removeProvider(p.id)}>
                        <Trash2 size={13} />
                      </Button>
                    </Card>
                  ))}
                </div>
              </section>

              {/* 默认模型 */}
              <section>
                <h2 className="mb-3 text-sm font-semibold">默认模型</h2>
                <Card className="space-y-4 p-4">
                  <Field label="智能体对话模型">
                    <select value={modelValue(settings.defaultChatModel)} onChange={(e) => void modelOnChange('defaultChatModel')(e.target.value)} className="set-select">
                      <option value="">请选择</option>
                      {modelOptions.map((p) => (
                        <optgroup key={p.id} label={p.name}>
                          {p.models.map((m) => (
                            <option key={m} value={`${p.id}::${m}`}>{m}</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </Field>
                </Card>
              </section>
            </>
          )}

          {active === 'agent' && (
            <section>
              <h2 className="mb-3 text-sm font-semibold">智能体</h2>
              <Card className="space-y-4 p-4">
                <Field
                  label="智能体温度"
                  hint="数值越高越精准稳定，越低越发散创新。当前值会映射到模型原始 temperature。"
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={settings.agentGeneration.agentTemperature}
                      onChange={(e) => void update({ agentGeneration: { ...settings.agentGeneration, agentTemperature: Number(e.target.value) } })}
                      className="min-w-0 flex-1 accent-[var(--accent)]"
                      aria-label="智能体温度"
                    />
                    <output className="w-12 rounded-md border border-line bg-panel px-2 py-1 text-center text-xs tabular-nums">{settings.agentGeneration.agentTemperature}</output>
                  </div>
                  <div className="mt-1 flex justify-between text-[11px] text-faint"><span>发散 / 创新</span><span>精准 / 稳定</span></div>
                </Field>
                <label className="flex items-start gap-2.5 text-sm">
                  <input
                    type="checkbox"
                    checked={settings.agentGeneration.proseAlternativesEnabled}
                    onChange={(e) => void update({ agentGeneration: { ...settings.agentGeneration, proseAlternativesEnabled: e.target.checked } })}
                    className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
                  />
                  <span><span className="block">正文生成提供多种方案</span><span className="mt-0.5 block text-xs text-muted">开启后，智能体在写正文时给出多个候选供你挑选；不会自动覆盖章节。</span></span>
                </label>
                <label className="flex items-start gap-2.5 text-sm">
                  <input type="checkbox" checked={settings.agentGeneration.polishAgentEnabled !== false} onChange={(e) => void update({ agentGeneration: { ...settings.agentGeneration, polishAgentEnabled: e.target.checked } })} className="mt-0.5 h-4 w-4 accent-[var(--accent)]" />
                  <span><span className="block">AI 润色智能体</span><span className="mt-0.5 block text-xs text-muted">普通模式下对选定章节提出润色候选，确认后再写回。</span></span>
                </label>
                <label className="flex items-start gap-2.5 text-sm">
                  <input type="checkbox" checked={settings.agentGeneration.deAiAgentEnabled !== false} onChange={(e) => void update({ agentGeneration: { ...settings.agentGeneration, deAiAgentEnabled: e.target.checked } })} className="mt-0.5 h-4 w-4 accent-[var(--accent)]" />
                  <span><span className="block">去 AI 风格智能体</span><span className="mt-0.5 block text-xs text-muted">普通模式下减少模板化表达，不改变事实和人物关系。</span></span>
                </label>
                <Field label="普通模式连续工具调用轮次上限" hint="默认 100，范围 1 至 1000。仅控制普通模式的连续工具循环，与编排模式的模型调用预算分开。">
                  <Input
                    key={settings.agentGeneration.maxToolRounds ?? 100}
                    type="number"
                    min={1}
                    max={1000}
                    step={1}
                    defaultValue={settings.agentGeneration.maxToolRounds ?? 100}
                    onBlur={(event) => {
                      const input = event.currentTarget
                      const current = settings.agentGeneration.maxToolRounds ?? 100
                      const raw = input.value.trim()
                      const value = raw ? Number(raw) : current
                      const next = Number.isInteger(value) ? Math.max(1, Math.min(1000, value)) : current
                      input.value = String(next)
                      if (next !== current) {
                        void update({ agentGeneration: { ...settings.agentGeneration, maxToolRounds: next } }).catch(() => {
                          input.value = String(current)
                        })
                      }
                    }}
                    className="max-w-32"
                  />
                </Field>
                <div className="flex flex-wrap items-center gap-4 text-sm">
                  <Link to="/memory" className="inline-flex min-h-9 items-center gap-2 text-accent hover:underline">
                    <Brain size={15} />管理记忆
                  </Link>
                </div>
                <Field
                  label="自定义提示词"
                  hint={workspace ? '仅保存到当前项目 docs/system-prompt.md；用于注入文风偏好、世界观规则等，失焦时自动保存。' : '请先打开项目；系统提示词按项目分别保存。'}
                >
                  <textarea
                    value={promptDraft ?? projectPrompt ?? ''}
                    onChange={(e) => setPromptDraft(e.target.value)}
                    onBlur={() => {
                      if (promptDraft !== null && workspace && api.saveInspirationDoc) {
                        const value = promptDraft
                        void api.saveInspirationDoc('system-prompt.md', value).then(() => setProjectPrompt(value)).catch(() => undefined)
                        setPromptDraft(null)
                      }
                    }}
                    disabled={!workspace || !api.saveInspirationDoc}
                    rows={6}
                    className="w-full resize-y rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none focus:border-accent"
                    placeholder={'例如：\n· 行文偏克制冷峻，少用感叹号\n· 世界中不存在魔法，一切异象源于古科技\n· 人物对话避免现代网络用语'}
                  />
                </Field>
                <label className="flex items-center gap-2.5 text-sm">
                  <input
                    type="checkbox"
                    checked={settings.showSessionLength}
                    onChange={(e) => void update({ showSessionLength: e.target.checked })}
                    className="h-4 w-4 accent-[var(--accent)]"
                  />
                  在会话顶部显示会话长度（消息数与约计字数）
                </label>
              </Card>
            </section>
          )}

          {active === 'orchestration' && <OrchestrationSettingsView settings={settings} update={update} />}

          {active === 'appearance' && (
            <>
              <section>
                <h2 className="mb-3 text-sm font-semibold">主题</h2>
                <Card className="p-4">
                  <Field label="明暗模式">
                    <select value={settings.theme} onChange={(e) => void update({ theme: e.target.value as 'light' | 'dark' | 'system' })} className="set-select max-w-48">
                      <option value="system">跟随系统</option>
                      <option value="light">浅色</option>
                      <option value="dark">深色</option>
                    </select>
                  </Field>
                </Card>
              </section>

              <section>
                <h2 className="mb-3 text-sm font-semibold">主题色</h2>
                <Card className="space-y-4 p-4">
                  <Field label="浅色主题强调色">
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        aria-label="浅色主题强调色"
                        value={accentValue(settings.accentColorLight, '#6366f1')}
                        onChange={(e) => commitAccent('accentColorLight', e.target.value)}
                        className="h-8 w-12 shrink-0 cursor-pointer rounded border border-line bg-panel"
                      />
                      <Input
                        key={settings.accentColorLight}
                        defaultValue={settings.accentColorLight}
                        onBlur={(e) => void update({ accentColorLight: e.target.value })}
                        className="max-w-32 font-mono text-xs"
                      />
                      <Button size="sm" onClick={() => void update({ accentColorLight: '#6366f1' })}>
                        重置
                      </Button>
                    </div>
                  </Field>
                  <Field label="深色主题强调色">
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        aria-label="深色主题强调色"
                        value={accentValue(settings.accentColorDark, '#818cf8')}
                        onChange={(e) => commitAccent('accentColorDark', e.target.value)}
                        className="h-8 w-12 shrink-0 cursor-pointer rounded border border-line bg-panel"
                      />
                      <Input
                        key={settings.accentColorDark}
                        defaultValue={settings.accentColorDark}
                        onBlur={(e) => void update({ accentColorDark: e.target.value })}
                        className="max-w-32 font-mono text-xs"
                      />
                      <Button size="sm" onClick={() => void update({ accentColorDark: '#818cf8' })}>
                        重置
                      </Button>
                    </div>
                  </Field>
                  <div>
                    <div className="mb-2 text-xs text-muted">预设（同时应用到浅色与深色）</div>
                    <div className="flex flex-wrap gap-2">
                      {ACCENT_PRESETS.map((color) => (
                        <button
                          key={color}
                          type="button"
                          title={color}
                          aria-label={`预设主题色 ${color}`}
                          onClick={() => void update({ accentColorLight: color, accentColorDark: color })}
                          className="h-6 w-6 rounded-full border border-line transition-transform hover:scale-110"
                          style={{ background: color }}
                        />
                      ))}
                    </div>
                  </div>
                </Card>
              </section>

              <section>
                <h2 className="mb-3 text-sm font-semibold">编辑器</h2>
                <Card className="space-y-4 p-4">
                  <Field label="正文字号">
                    <select
                      value={settings.editorFontSize}
                      onChange={(e) => void update({ editorFontSize: Number(e.target.value) })}
                      className="set-select max-w-32"
                    >
                      {EDITOR_FONT_SIZES.map((size) => (
                        <option key={size} value={size}>
                          {size}px
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="行距">
                    <select
                      value={settings.editorLineHeight}
                      onChange={(e) => void update({ editorLineHeight: Number(e.target.value) })}
                      className="set-select max-w-32"
                    >
                      {EDITOR_LINE_HEIGHTS.map((lineHeight) => (
                        <option key={lineHeight} value={lineHeight}>
                          {lineHeight}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="字体">
                    <select
                      value={settings.editorFontFamily}
                      onChange={(e) => void update({ editorFontFamily: e.target.value as EditorFontFamily })}
                      className="set-select max-w-48"
                    >
                      <option value="sans">系统默认</option>
                      <option value="serif">衬线（宋体）</option>
                      <option value="mono">等宽</option>
                    </select>
                  </Field>
                  <Field label="自动保存" hint="编辑章节时，停止输入后按此间隔自动保存；若检测到外部修改仍会先征求确认">
                    <select
                      value={settings.autosaveSeconds}
                      onChange={(e) => void update({ autosaveSeconds: Number(e.target.value) })}
                      className="set-select max-w-48"
                    >
                      <option value={0}>关闭</option>
                      <option value={5}>空闲 5 秒</option>
                      <option value={15}>空闲 15 秒</option>
                      <option value={30}>空闲 30 秒</option>
                    </select>
                  </Field>
                </Card>
              </section>

              <section>
                <h2 className="mb-3 text-sm font-semibold">聊天</h2>
                <Card className="space-y-4 p-4">
                  <Field label="消息气泡密度">
                    <select
                      value={settings.chatDensity}
                      onChange={(e) => void update({ chatDensity: e.target.value as ChatDensity })}
                      className="set-select max-w-48"
                    >
                      <option value="compact">紧凑</option>
                      <option value="comfortable">舒适</option>
                      <option value="spacious">宽松</option>
                    </select>
                  </Field>
                  <Field label="会话窗口字号" hint="只影响聊天消息、输入框、工具回执、编排信息和智能体活动信息">
                    <select
                      value={settings.chatFontSize}
                      onChange={(e) => void update({ chatFontSize: Number(e.target.value) })}
                      className="set-select max-w-32"
                    >
                      {CHAT_FONT_SIZES.map((size) => (
                        <option key={size} value={size}>{size}px</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="发送快捷键">
                    <select
                      value={settings.sendShortcut}
                      onChange={(e) => void update({ sendShortcut: e.target.value as SendShortcut })}
                      className="set-select max-w-64"
                    >
                      <option value="enter">Enter 发送（Shift+Enter 换行）</option>
                      <option value="mod+enter">Ctrl/⌘+Enter 发送（Enter 换行）</option>
                    </select>
                  </Field>
                </Card>
              </section>
            </>
          )}

          {active === 'notifications' && (
            <section>
              <h2 className="mb-3 text-sm font-semibold">通知</h2>
              <Card className="flex items-center justify-between gap-4 p-4">
                <div className="min-w-0">
                  <div className="text-sm">对话完成提示音</div>
                  <div className="mt-0.5 text-xs text-muted">智能体回答完成时播放一声柔和提示音；被中止或出错时不响</div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <Button size="sm" onClick={() => playCompletionSound()}>
                    试听
                  </Button>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={settings.completionSound}
                      onChange={(e) => void update({ completionSound: e.target.checked })}
                      className="h-4 w-4 accent-[var(--accent)]"
                    />
                    启用
                  </label>
                </div>
              </Card>
            </section>
          )}

          <p className="pb-4 text-center text-xs text-faint">StoryFabric v0.2.1 · 本地优先，所有数据保存在你自己的工作区文件夹中</p>
        </div>
      </div>

      {/* 供应商编辑弹窗 */}
      {editing && (
        <Modal open onOpenChange={() => setEditing(null)} title={editingId ? `编辑供应商：${editing.name}` : '添加供应商'}>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="名称 *">
                <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="DeepSeek" autoFocus />
              </Field>
              <Field label="协议 *">
                <select value={editing.protocol} onChange={(e) => setEditing({ ...editing, protocol: e.target.value as Protocol })} className="set-select">
                  {PROTOCOLS.map((p) => (
                    <option key={p} value={p}>{PROTOCOL_LABEL[p]}</option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Base URL *" hint={PROTOCOL_HINTS[editing.protocol]}>
              <Input value={editing.baseUrl} onChange={(e) => setEditing({ ...editing, baseUrl: e.target.value })} placeholder="https://api.deepseek.com/v1" />
            </Field>
            <Field label={editingId ? 'API Key（留空则沿用原密钥）' : 'API Key'}>
              <Input type="password" value={editing.apiKey ?? ''} onChange={(e) => setEditing({ ...editing, apiKey: e.target.value || undefined })} placeholder="sk-…" />
            </Field>
            <Field label="模型" hint="模型列表与逐模型能力改到「管理模型」里设置（拉取、勾选、手动添加、思考强度映射）">
              <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-panel px-3 py-2 text-xs">
                <span className="text-muted">已配置 {editing.models.length} 个模型</span>
                <Button size="sm" variant="outline" onClick={() => setManagingId(editingId)} disabled={!editingId}>
                  <Settings2 size={13} /> 管理模型
                </Button>
              </div>
            </Field>
            {!editingId && <p className="text-[11px] leading-4 text-faint">先保存供应商，才能进入模型管理</p>}

            {formError && <div className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">{formError}</div>}

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={() => setEditing(null)}>
                取消
              </Button>
              <Button variant="primary" onClick={() => void saveProvider()} loading={savingProvider} disabled={!editing.name.trim() || !editing.baseUrl.trim()}>
                保存
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
