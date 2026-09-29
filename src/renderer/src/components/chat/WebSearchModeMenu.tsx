import { Brain, Check } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { RunAgentRequest } from '../../../../shared/types'

type WebSearchMode = NonNullable<RunAgentRequest['webSearchMode']>

const MODES: ReadonlyArray<{ value: WebSearchMode; label: string }> = [
  { value: 'off', label: '关闭' },
  { value: 'auto', label: '自动' },
  { value: 'native', label: '厂商原生' },
  { value: 'free', label: '免费托管' },
  { value: 'self-hosted', label: '本机自建' }
]

export function WebSearchModeMenu({ mode, onChange, disabled = false }: {
  mode: WebSearchMode
  onChange: (mode: WebSearchMode) => void
  disabled?: boolean
}): React.ReactElement {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const active = mode !== 'off'
  const modeLabel = MODES.find((item) => item.value === mode)?.label ?? '关闭'

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    const close = (): void => setOpen(false)
    document.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('blur', close)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('blur', close)
    }
  }, [open])

  useEffect(() => { if (disabled) setOpen(false) }, [disabled])

  return <div ref={rootRef} className="relative shrink-0">
    <button
      type="button"
      disabled={disabled}
      aria-label={`联网搜索：${modeLabel}`}
      aria-haspopup="menu"
      aria-expanded={open}
      title={`联网搜索：${modeLabel}`}
      onClick={() => setOpen((value) => !value)}
      className={`flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${active ? 'bg-sky-500/10 text-sky-500 hover:bg-sky-500/20' : 'text-muted hover:bg-elevated hover:text-fg'}`}
    >
      <Brain size={17} strokeWidth={active ? 2.2 : 1.9} />
    </button>
    {open && <div role="menu" aria-label="选择联网搜索模式" className="absolute bottom-10 left-0 z-40 w-40 rounded-xl border border-line bg-panel p-1.5 shadow-xl">
      <div className="px-2 py-1 text-[10px] text-faint">联网搜索</div>
      {MODES.map((item) => <button
        key={item.value}
        type="button"
        role="menuitemradio"
        aria-checked={mode === item.value}
        onClick={() => { onChange(item.value); setOpen(false) }}
        className={`flex w-full cursor-pointer items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs transition-colors ${mode === item.value ? 'bg-sky-500/10 text-sky-600 dark:text-sky-400' : 'text-fg hover:bg-elevated'}`}
      >
        <span>{item.label}</span>
        {mode === item.value && <Check size={13} />}
      </button>)}
    </div>}
  </div>
}
