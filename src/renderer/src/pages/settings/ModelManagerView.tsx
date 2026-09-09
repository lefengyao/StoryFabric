/** 模型管理整页：拉取、勾选添加、手动添加、搜索、逐模型展开面板。 */
import { ChevronDown, ChevronLeft, Plus, RefreshCw, Search, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Badge, Button, Card, Field, Input } from '../../components/ui/primitives'
import { api } from '../../lib/api'
import { PROTOCOL_LABEL } from '../../lib/utils'
import { CONTEXT_PRESETS, OUTPUT_PRESETS, formatTokens, modelParamOptions } from '../../lib/modelParamOptions'
import {
  addModels,
  filterModels,
  isValidModelName,
  mappingWarning,
  pendingModels,
  removeModel,
  resolveCapability,
  setMappingPath,
  setMappingValue
} from '../../lib/modelCapability'
import { profileForModel } from '../../../../core/llm/modelCatalog'
import type { ModelSettings, ProviderPublic, ReasoningLevel } from '../../../../shared/types'

const LEVELS: Array<{ value: ReasoningLevel; label: string }> = [
  { value: 'off', label: '关' },
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' }
]

interface Props {
  provider: ProviderPublic
  onClose: () => void
  onSaved: () => Promise<void>
}

export function ModelManagerView({ provider, onClose, onSaved }: Props): React.ReactElement {
  const [models, setModels] = useState<string[]>([...provider.models])
  const [modelSettings, setModelSettings] = useState<Record<string, ModelSettings>>({ ...provider.modelSettings })
  const [fetched, setFetched] = useState<string[] | null>(null)
  const [checked, setChecked] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [manual, setManual] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [fetching, setFetching] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dirty = useMemo(
    () =>
      JSON.stringify({ models, modelSettings }) !==
      JSON.stringify({ models: provider.models, modelSettings: provider.modelSettings }),
    [models, modelSettings, provider]
  )

  const patch = (model: string, next: Partial<ModelSettings>): void => {
    setModelSettings((prev) => ({ ...prev, [model]: { ...prev[model], ...next } }))
  }

  const doFetch = async (): Promise<void> => {
    setFetching(true)
    setError(null)
    try {
      const list = await api.fetchModels({ providerId: provider.id, protocol: provider.protocol, baseUrl: provider.baseUrl })
      if (list.length === 0) setError('服务未返回任何模型，请检查 Base URL')
      setFetched(list)
      setChecked([])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setFetching(false)
    }
  }

  const addManual = (): void => {
    const name = manual.trim()
    if (!isValidModelName(name)) {
      setError('模型名不能为空、不能含换行，且不超过 200 字符')
      return
    }
    setModels((prev) => addModels(prev, [name]))
    setManual('')
    setError(null)
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    setError(null)
    try {
      await api.saveProvider({
        id: provider.id,
        name: provider.name,
        protocol: provider.protocol,
        baseUrl: provider.baseUrl,
        models,
        modelSettings
      })
      await onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const back = (): void => {
    if (dirty && !window.confirm('有未保存的模型改动，放弃并返回？')) return
    onClose()
  }

  const pending = fetched ? pendingModels(models, fetched) : []
  const visible = filterModels(models, query)

  const mappingPlaceholder =
    provider.protocol === 'gemini'
      ? 'generationConfig.thinkingConfig.thinkingBudget'
      : provider.protocol === 'anthropic'
        ? 'thinking'
        : 'reasoning_effort / enable_thinking / thinking.type'
  const mappingHint =
    provider.protocol === 'anthropic'
      ? 'Anthropic 只认 thinking：值请写成完整 JSON 对象，如 {"type":"enabled","budget_tokens":4096}。'
      : provider.protocol === 'gemini'
        ? 'Gemini 的参数必须写在 generationConfig 下，如 generationConfig.thinkingConfig.thinkingBudget。'
        : '填了就以这里的参数为准（不再附加内置推理参数）；参数名用点号表示层级，值支持数字 / true / false / 字符串。'

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={back}>
          <ChevronLeft size={14} /> 返回
        </Button>
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">管理模型 · {provider.name}</h2>
        <Badge tone="accent">{PROTOCOL_LABEL[provider.protocol]}</Badge>
        <Button size="sm" variant="primary" onClick={() => void save()} loading={saving} disabled={!dirty}>
          保存
        </Button>
      </div>

      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => void doFetch()} loading={fetching}>
            <RefreshCw size={13} /> 从服务拉取
          </Button>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Input
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addManual()
              }}
              placeholder="手动添加模型名，如 gpt-5-internal"
            />
            <Button size="sm" variant="soft" onClick={addManual}>
              <Plus size={13} /> 添加
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Search size={14} className="text-faint" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索" className="w-40" />
          </div>
        </div>
        {error && <div className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">{error}</div>}
      </Card>

      {fetched && (
        <Card className="space-y-2 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-semibold text-muted">服务返回但未添加（{pending.length}）</h3>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setChecked(pending)} disabled={pending.length === 0}>
                全选
              </Button>
              <Button
                size="sm"
                variant="soft"
                onClick={() => {
                  setModels((prev) => addModels(prev, checked))
                  setChecked([])
                }}
                disabled={checked.length === 0}
              >
                添加选中（{checked.length}）
              </Button>
              <Button
                size="sm"
                variant="soft"
                onClick={() => {
                  setModels((prev) => addModels(prev, pending))
                  setChecked([])
                }}
                disabled={pending.length === 0}
              >
                全部添加
              </Button>
            </div>
          </div>
          {pending.length === 0 ? (
            <p className="text-xs text-faint">服务返回的模型都已添加</p>
          ) : (
            <div className="max-h-64 space-y-1 overflow-y-auto">
              {pending.map((model) => (
                <label key={model} className="flex items-center gap-2 rounded-md bg-app px-2 py-1.5 text-xs">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 accent-[var(--accent)]"
                    checked={checked.includes(model)}
                    onChange={(e) =>
                      setChecked((prev) => (e.target.checked ? [...prev, model] : prev.filter((x) => x !== model)))
                    }
                  />
                  <span className="min-w-0 flex-1 truncate font-mono">{model}</span>
                </label>
              ))}
            </div>
          )}
        </Card>
      )}

      <Card className="space-y-1.5 p-4">
        <h3 className="text-xs font-semibold text-muted">已添加（{models.length}）</h3>
        {models.length === 0 && <p className="text-xs text-faint">还没有模型，先拉取或手动添加</p>}
        {visible.map((model) => {
          const profile = profileForModel(model)
          const current = modelSettings[model] ?? {}
          const capability = resolveCapability(model, current)
          const open = expanded === model
          const warning = mappingWarning(current.reasoningMap, provider.protocol)
          return (
            <div key={model} className="rounded-md bg-app">
              <div className="flex items-center gap-2 px-2 py-1.5">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                  onClick={() => setExpanded(open ? null : model)}
                >
                  <ChevronDown size={13} className={`shrink-0 text-faint transition-transform ${open ? '' : '-rotate-90'}`} />
                  <span className="min-w-0 truncate font-mono text-xs" title={model}>
                    {model}
                  </span>
                </button>
                {capability.reasoning && <Badge tone="accent">思考</Badge>}
                {capability.vision && <Badge tone="ok">图片</Badge>}
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-danger hover:text-danger"
                  onClick={() => {
                    setModels((prev) => removeModel(prev, model))
                    setModelSettings((prev) => {
                      const next = { ...prev }
                      delete next[model]
                      return next
                    })
                  }}
                >
                  <Trash2 size={13} />
                </Button>
              </div>

              {open && (
                <div className="space-y-3 border-t border-line/60 px-3 py-3">
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[var(--accent)]"
                      checked={capability.reasoning}
                      onChange={(e) => patch(model, { reasoningSupport: e.target.checked })}
                    />
                    支持拓展思考
                  </label>

                  {capability.reasoning && (
                    <>
                      <Field label="思考强度">
                        <select
                          className="set-select"
                          value={current.reasoning ?? 'off'}
                          onChange={(e) => patch(model, { reasoning: e.target.value as ReasoningLevel })}
                        >
                          {LEVELS.map((level) => (
                            <option key={level.value} value={level.value}>
                              {level.label}
                            </option>
                          ))}
                        </select>
                      </Field>

                      <Field label="官方思考强度映射" hint={mappingHint}>
                        <div className="space-y-2">
                          <Input
                            value={current.reasoningMap?.path ?? ''}
                            onChange={(e) => patch(model, { reasoningMap: setMappingPath(current.reasoningMap, e.target.value) })}
                            placeholder={mappingPlaceholder}
                          />
                          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                            {LEVELS.map((level) => (
                              <label key={level.value} className="space-y-1">
                                <span className="text-[11px] text-faint">{level.label}</span>
                                <Input
                                  value={current.reasoningMap?.values[level.value] ?? ''}
                                  onChange={(e) =>
                                    patch(model, { reasoningMap: setMappingValue(current.reasoningMap, level.value, e.target.value) })
                                  }
                                  placeholder={level.value === 'off' ? '留空=不发' : '留空=用内置'}
                                />
                              </label>
                            ))}
                          </div>
                          {warning && <p className="text-[11px] text-danger">{warning}</p>}
                        </div>
                      </Field>
                    </>
                  )}

                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[var(--accent)]"
                      checked={capability.vision}
                      onChange={(e) => patch(model, { vision: e.target.checked })}
                    />
                    支持图片输入
                  </label>

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <Field label="上下文长度">
                      <select
                        className="set-select"
                        value={current.contextTokens ?? profile.contextTokens}
                        onChange={(e) => patch(model, { contextTokens: Number(e.target.value) })}
                      >
                        {modelParamOptions(CONTEXT_PRESETS, profile.contextTokens).map((value) => (
                          <option key={value} value={value}>
                            上下文 {formatTokens(value)}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="输出上限">
                      <select
                        className="set-select"
                        value={current.maxOutputTokens ?? profile.maxOutputTokens}
                        onChange={(e) => patch(model, { maxOutputTokens: Number(e.target.value) })}
                      >
                        {modelParamOptions(OUTPUT_PRESETS, profile.maxOutputTokens).map((value) => (
                          <option key={value} value={value}>
                            输出 {formatTokens(value)}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </Card>
    </div>
  )
}
