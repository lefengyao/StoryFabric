import { FilePlus, ImagePlus, Plus } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Button } from '../ui/primitives'

export function AttachmentMenu({ open, onOpenChange, onFiles, onReference }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onFiles: (files: File[]) => void | Promise<void>
  onReference: () => void
}): React.ReactElement {
  const imageRef = useRef<HTMLInputElement | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onOpenChange(false) }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onOpenChange])

  const choose = (input: HTMLInputElement | null): void => { onOpenChange(false); input?.click() }
  const consume = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const files = [...(event.target.files ?? [])]
    if (files.length) void onFiles(files)
    event.target.value = ''
  }

  return <>
    <Button variant="ghost" size="sm" onClick={() => onOpenChange(!open)} title="添加图片或文件" aria-label="添加图片或文件"><Plus size={15} /></Button>
    <input ref={imageRef} type="file" accept="image/png,image/jpeg,image/webp" multiple className="hidden" onChange={consume} />
    <input ref={fileRef} type="file" accept=".txt,.md,.csv,.json,text/plain,text/markdown,text/csv,application/json" multiple className="hidden" onChange={consume} />
    {open && <div className="absolute bottom-12 left-0 z-30 w-52 rounded-xl border border-line bg-panel p-1.5 shadow-xl">
      <button className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs hover:bg-elevated" onClick={() => choose(imageRef.current)}><ImagePlus size={14} />添加图片</button>
      <button className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs hover:bg-elevated" onClick={() => choose(fileRef.current)}><FilePlus size={14} />添加文件</button>
      <button className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs hover:bg-elevated" onClick={onReference}>引用项目资料</button>
    </div>}
  </>
}
