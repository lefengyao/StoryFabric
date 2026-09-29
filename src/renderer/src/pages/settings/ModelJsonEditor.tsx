import { useEffect, useMemo, useRef, useState } from 'react'
import type { ModelSettings, Protocol } from '../../../../shared/types'
import { Button } from '../../components/ui/primitives'
import { formatModelConfigJson, parseModelConfigJson } from '../../lib/modelJsonConfig'

interface Props {
  model: string
  protocol: Protocol
  settings: ModelSettings
  onApply: (settings: ModelSettings) => void
}

/** A draft belongs to one expanded model and never mutates settings until validation succeeds. */
export function ModelJsonEditor({ model, protocol, settings, onApply }: Props): React.ReactElement {
  const generated = useMemo(() => formatModelConfigJson(model, settings), [model, settings])
  const [draft, setDraft] = useState(generated)
  const [error, setError] = useState<string | null>(null)
  const previousGenerated = useRef(generated)

  useEffect(() => {
    const previous = previousGenerated.current
    previousGenerated.current = generated
    setDraft((value) => value === previous ? generated : value)
  }, [generated])

  const apply = (): void => {
    try {
      const next = parseModelConfigJson(draft, protocol)
      onApply(next)
      setDraft(formatModelConfigJson(model, next))
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <section className="space-y-2 border-t border-line/60 pt-3" aria-label={`${model} 的 JSON 配置`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-semibold text-muted">完整 JSON 配置</h4>
        {draft !== generated && <span className="text-[11px] text-faint">JSON 草稿尚未应用</span>}
      </div>
      <p className="text-[11px] leading-5 text-faint">
        可粘贴另一模型的同格式 JSON。应用只修改当前模型，随后点击页顶「保存」。
      </p>
      <details className="text-[11px] leading-5 text-faint">
        <summary className="cursor-pointer select-none text-muted">查看 JSON v1 字段规范</summary>
        <p className="mt-1">必须包含 schemaVersion: 1、reasoningSupport / vision（布尔值）、reasoning（off / low / medium / high）、reasoningMap（null 或 path + values）、contextTokens / maxOutputTokens（正整数，输出不大于上下文）。不接受额外字段。</p>
        <p className="mt-1">reasoningMap.values 的 off / low / medium / high 值均为字符串；Anthropic 的 path 为 thinking，Gemini 的 path 以 generationConfig. 开头。不使用自定义映射时填写 null。</p>
      </details>
      <textarea
        aria-label={`${model} JSON 配置内容`}
        spellCheck={false}
        value={draft}
        onChange={(event) => { setDraft(event.target.value); setError(null) }}
        className="min-h-56 w-full resize-y rounded-lg border border-line bg-panel p-3 font-mono text-xs leading-5 text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
      />
      {error && <p className="text-xs text-danger" role="alert">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" variant="soft" type="button" onClick={apply}>应用 JSON</Button>
        <Button size="sm" variant="ghost" type="button" onClick={() => { setDraft(generated); setError(null) }}>恢复当前配置</Button>
      </div>
    </section>
  )
}
