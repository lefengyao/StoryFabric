import { useState } from 'react'
import { cloneValue } from '../../../../shared/runtimeCompatibility'
import { ImageDown } from 'lucide-react'
import { Button } from '../../components/ui/primitives'
import { captureView } from './capture'
import { ImageExportDialog } from './ImageExportDialog'
import { ReadingImage, type ReadingImageProps } from './ReadingImage'

export function DocumentImageExport(props: ReadingImageProps & { beforeExport?: () => Promise<boolean>; disabled?: boolean }): React.ReactElement {
  const [open, setOpen] = useState(false)
  const [frozen, setFrozen] = useState<ReadingImageProps>(props)
  const [error, setError] = useState<string | null>(null)
  const begin = async (): Promise<void> => {
    try {
      if (props.beforeExport && !await props.beforeExport()) return
      // The caller supplies the displayed document after any required save.
      setFrozen(cloneValue({ kind: props.kind, document: props.document, workspaceName: props.workspaceName, chapterTitle: props.chapterTitle }) as ReadingImageProps)
      setError(null); setOpen(true)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }
  const title = frozen.kind === 'character' ? frozen.document.name : frozen.document.title
  return <>
    <Button size="sm" variant="ghost" disabled={props.disabled} onClick={() => void begin()}><ImageDown size={13} /> 导出图片</Button>
    {error && <span role="alert" className="text-xs text-danger">{error}</span>}
    <ImageExportDialog open={open} onOpenChange={setOpen} workspaceName={frozen.workspaceName} title={title} generate={(split) => captureView(<ReadingImage {...frozen} />, { split })} />
  </>
}
