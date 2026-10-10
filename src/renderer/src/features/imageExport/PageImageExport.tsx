import { useState, type RefObject } from 'react'
import { ImageDown } from 'lucide-react'
import { Button } from '../../components/ui/primitives'
import { captureElement } from './capture'
import { ImageExportDialog } from './ImageExportDialog'

/** Reuses the live page's rendered content; captureElement freezes its dataset synchronously. */
export function PageImageExport({ sourceRef, workspaceName, title }: { sourceRef: RefObject<HTMLElement | null>; workspaceName: string; title: string }): React.ReactElement {
  const [open, setOpen] = useState(false)
  return <>
    <Button data-image-export-action size="sm" variant="outline" onClick={() => setOpen(true)}><ImageDown size={13} /> 导出图片</Button>
    <ImageExportDialog open={open} onOpenChange={setOpen} workspaceName={workspaceName} title={title} generate={(split) => {
      if (!sourceRef.current) return Promise.reject(new Error('统计内容尚未加载'))
      return captureElement(sourceRef.current, split, `${workspaceName} · ${title}`)
    }} />
  </>
}
