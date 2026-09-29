import { FilePlus, ImagePlus, Minimize2, Plus } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { AgentMode } from '../../../../shared/types'
import { Button } from '../ui/primitives'

export function AttachmentMenu({ open, onOpenChange, onFiles, onReference, onCompressContext, compressing = false, agentMode, onAgentModeChange }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onFiles: (files: File[]) => void | Promise<void>
  onReference: () => void
  onCompressContext?: () => void | Promise<void>
  compressing?: boolean
  agentMode?: AgentMode
  onAgentModeChange?: (mode: AgentMode) => void
}): React.ReactElement {
  const imageRef = useRef<HTMLInputElement | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onOpenChange(false) }
    const closeOnViewport = (): void => onOpenChange(false)
    const onPointerDown = (event: PointerEvent): void => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) onOpenChange(false)
    }
    window.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('blur', closeOnViewport)
    window.addEventListener('resize', closeOnViewport)
    window.addEventListener('scroll', closeOnViewport, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('blur', closeOnViewport)
      window.removeEventListener('resize', closeOnViewport)
      window.removeEventListener('scroll', closeOnViewport, true)
    }
  }, [open, onOpenChange])

  const choose = (input: HTMLInputElement | null): void => { onOpenChange(false); input?.click() }
  const consume = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const files = [...(event.target.files ?? [])]
    if (files.length) void onFiles(files)
    event.target.value = ''
  }

  return <div ref={rootRef} className="relative">
    <Button variant="ghost" size="sm" onClick={() => onOpenChange(!open)} title="添加图片或文件" aria-label="添加图片或文件"><Plus size={15} /></Button>
    <input ref={imageRef} type="file" accept="image/png,image/jpeg,image/webp" multiple className="hidden" onChange={consume} />
    <input ref={fileRef} type="file" accept=".txt,.md,.csv,.json,text/plain,text/markdown,text/csv,application/json" multiple className="hidden" onChange={consume} />
    {open && <div className="absolute bottom-12 left-0 z-30 w-56 rounded-xl border border-line bg-panel p-1.5 shadow-xl">
      {agentMode && onAgentModeChange && <div className="mb-1.5 border-b border-line px-1 pb-1.5">
        <span className="mb-1 block px-1.5 text-[10px] text-faint">运行模式</span>
        <div className="grid grid-cols-2 gap-1">
          {(['normal', 'goal'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className={`cursor-pointer rounded-md px-2 py-1.5 text-left text-[11px] ${agentMode === mode ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-elevated'}`}
              onClick={() => { onAgentModeChange(mode); onOpenChange(false) }}
            >
              {mode === 'normal' ? '一般模式' : '目标模式'}
            </button>
          ))}
        </div>
      </div>}
      <button className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs hover:bg-elevated" onClick={() => choose(imageRef.current)}><ImagePlus size={14} />添加图片</button>
      <button className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs hover:bg-elevated" onClick={() => choose(fileRef.current)}><FilePlus size={14} />添加文件</button>
      <button className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs hover:bg-elevated" onClick={onReference}>引用项目资料</button>
      {onCompressContext && <button className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs hover:bg-elevated disabled:cursor-not-allowed disabled:opacity-50" disabled={compressing} onClick={() => { onOpenChange(false); void onCompressContext() }} title="压缩较早的会话上下文"><Minimize2 size={14} />{compressing ? '正在压缩上下文…' : '压缩上下文'}</button>}
    </div>}
  </div>
}
