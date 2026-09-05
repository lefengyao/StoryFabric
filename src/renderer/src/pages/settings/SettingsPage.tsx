import { KeyRound, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Badge, Button, Card, EmptyState, Field, Input, Spinner } from '../../components/ui/primitives'
import { Modal } from '../../components/ui/modal'
import { api } from '../../lib/api'
import { PROTOCOL_LABEL } from '../../lib/utils'
import type { Protocol, ProviderInput, ProviderPublic } from '../../../../shared/types'
import { useSettings } from '../../stores/settingsStore'

const PROTOCOLS: Protocol[] = ['openai', 'anthropic', 'gemini']

const PROTOCOL_HINTS: Record<Protocol, string> = {
  openai: 'Base URL 通常以 /v1 结尾，如 https://api.deepseek.com/v1',
  anthropic: 'Base URL 如 https://api.anthropic.com',
  gemini: 'Base URL 如 https://generativelanguage.googleapis.com'
}

export function SettingsPage(): React.ReactElement {
  const settings = useSettings((s) => s.settings)
  const reload = useSettings((s) => s.load)
  const update = useSettings((s) => s.update)

  const [editing, setEditing] = useState<ProviderInput | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [savingProvider, setSavingProvider] = useState(false)
  const [fetchingModels, setFetchingModels] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [promptDraft, setPromptDraft] = useState<string | null>(null)

  if (!settings) return <div className="flex h-full items-center justify-center"><Spinner /></div>

  const openCreate = (): void => {
    setEditingId(null)
    setFormError(null)
    setEditing({ name: '', protocol: 'openai', baseUrl: '', apiKey: undefined, models: [] })
  }

  const openEdit = (p: ProviderPublic): void => {
    setEditingId(p.id)
    setFormError(null)
    setEditing({ name: p.name, protocol: p.protocol, baseUrl: p.baseUrl, apiKey: undefined, models: [...p.models] })
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

  const doFetchModels = async (): Promise<void> => {
    if (!editing) return
    setFetchingModels(true)
    setFormError(null)
    try {
      const models = await api.fetchModels({
        providerId: editingId ?? undefined,
        protocol: editing.protocol,
        baseUrl: editing.baseUrl,
        apiKey: editing.apiKey
      })
      if (models.length === 0) setFormError('服务未返回任何模型，请检查 Base URL')
      setEditing({ ...editing, models })
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err))
    } finally {
      setFetchingModels(false)
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
    (key: 'defaultChatModel' | 'quickActionModel') =>
    async (v: string): Promise<void> => {
      const [providerId, model] = v.split('::')
      await update({ [key]: { providerId, model } })
    }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl space-y-6 p-6">
        {/* 供应商 */}
        <section>
          <div className="mb-3 flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold">模型供应商</h2>
              <p className="mt-0.5 text-xs leading-5 text-muted">支持 OpenAI 兼容、Anthropic、Gemini 三种协议；密钥经系统级加密存储在本机</p>
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
                    {p.hasKey ? <Badge tone="ok">Key {p.keyPreview}</Badge> : <Badge tone="danger">未配置密钥</Badge>}
                  </div>
                  <div className="mt-1 truncate text-xs text-faint">{p.baseUrl || '（未填 Base URL）'} · {p.models.length} 个模型</div>
                </div>
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

        {/* 智能体 */}
        <section>
          <h2 className="mb-3 text-sm font-semibold">智能体</h2>
          <Card className="space-y-4 p-4">
            <Field
              label="自定义提示词"
              hint="将附加在内置系统提示词之后，用于注入文风偏好、世界观规则等；失焦时自动保存，留空则不附加"
            >
              <textarea
                value={promptDraft ?? settings.customPrompt ?? ''}
                onChange={(e) => setPromptDraft(e.target.value)}
                onBlur={() => {
                  if (promptDraft !== null) {
                    void update({ customPrompt: promptDraft })
                    setPromptDraft(null)
                  }
                }}
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
            <Field label="快捷操作模型（续写/润色等轻量任务）">
              <select value={modelValue(settings.quickActionModel)} onChange={(e) => void modelOnChange('quickActionModel')(e.target.value)} className="set-select">
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

        {/* 外观 */}
        <section>
          <h2 className="mb-3 text-sm font-semibold">外观</h2>
          <Card className="p-4">
            <Field label="主题">
              <select value={settings.theme} onChange={(e) => void update({ theme: e.target.value as 'light' | 'dark' | 'system' })} className="set-select max-w-48">
                <option value="system">跟随系统</option>
                <option value="light">浅色</option>
                <option value="dark">深色</option>
              </select>
            </Field>
          </Card>
        </section>

        <p className="pb-4 text-center text-xs text-faint">StoryFabric v0.1 · 本地优先，所有数据保存在你自己的工作区文件夹中</p>
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
            <Field label={`模型列表（${editing.models.length} 个）`}>
              <textarea
                value={editing.models.join('\n')}
                onChange={(e) => setEditing({ ...editing, models: e.target.value.split('\n').map((x) => x.trim()).filter(Boolean) })}
                rows={5}
                className="w-full rounded-lg border border-line bg-panel px-3 py-2 font-mono text-xs outline-none focus:border-accent resize-y"
                placeholder={'deepseek-chat\ndeepseek-reasoner'}
              />
            </Field>
            <Button size="sm" variant="outline" onClick={() => void doFetchModels()} loading={fetchingModels} disabled={!editing.baseUrl.trim()}>
              <RefreshCw size={13} /> 从服务拉取模型列表
            </Button>

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
