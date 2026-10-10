import { useEffect, useState } from 'react'
import { ImageDown } from 'lucide-react'
import { Button } from '../../components/ui/primitives'
import { Modal } from '../../components/ui/modal'
import type { ImageExportResult } from './capture'
import { imageFileName, ImageExportSizeError } from './rasterPlan'
import { saveImageOutput } from './output'

export function ImageExportDialog({ open, onOpenChange, workspaceName, title, generate }: {
  open: boolean; onOpenChange: (open: boolean) => void; workspaceName: string; title: string;
  generate: (split: boolean) => Promise<ImageExportResult>
}): React.ReactElement {
  const [result, setResult] = useState<ImageExportResult | null>(null)
  const [urls, setUrls] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [oversized, setOversized] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [split, setSplit] = useState(false)
  useEffect(() => { setResult(null); setError(null); setOversized(false); setSplit(false) }, [open])
  useEffect(() => {
    if (!open || !result) { setUrls([]); return }
    const next = result.blobs.map((blob) => URL.createObjectURL(blob)); setUrls(next)
    return () => next.forEach((url) => URL.revokeObjectURL(url))
  }, [open, result])
  const capture = async (multiple: boolean): Promise<void> => {
    setBusy(true); setError(null); setResult(null); setOversized(false)
    try { setResult(await generate(multiple)); setSplit(multiple) }
    catch (cause) { const message = cause instanceof Error ? cause.message : String(cause); setError(message); setOversized(cause instanceof ImageExportSizeError || /尺寸|内存|编码/.test(message)) }
    finally { setBusy(false) }
  }
  const save = async (): Promise<void> => {
    if (!result) return
    setSaving(true); setError(null)
    const name = imageFileName(workspaceName, title)
    try { for (let i = 0; i < result.blobs.length; i++) await saveImageOutput(result.blobs[i], result.blobs.length > 1 ? name.replace(/\.png$/, `-${i + 1}.png`) : name) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setSaving(false) }
  }
  return <Modal open={open} onOpenChange={(next) => { if (!busy && !saving) onOpenChange(next) }} title={`导出图片 · ${title}`} description="PNG · 完整资料 · 生成预览后保存或分享" wide>
    {error && <p role="alert" className="mb-3 break-words text-sm text-danger">{error}</p>}
    {!result && <div className="space-y-3">
      <p className="text-sm text-muted">生成完整 PNG 预览。长图会分块绘制后拼接；超过单图尺寸时，可明确选择分成多张。</p>
      <div className="flex flex-wrap gap-2"><Button variant="primary" loading={busy} disabled={busy} onClick={() => void capture(false)}><ImageDown size={14} /> 生成整张预览</Button>
        {oversized && <Button disabled={busy} onClick={() => void capture(true)}>分成多张 PNG</Button>}</div>
    </div>}
    {result && <>
      <p className="mb-3 text-xs text-muted">{result.width} × {result.height} 像素 · {result.scale} 倍清晰度{split ? ` · ${result.blobs.length} 张` : ''}；预览可滚动查看完整内容。</p>
      <div className="max-h-[50vh] space-y-3 overflow-auto rounded-lg border border-line bg-elevated p-2">{urls.map((url, i) => <img key={url} src={url} alt={`${title}完整导出预览 ${i + 1}`} className="block h-auto w-full" />)}</div>
      <div className="mt-4 flex flex-wrap justify-end gap-2"><Button variant="ghost" disabled={saving} onClick={() => void capture(split)}>重新生成</Button><Button variant="primary" loading={saving} disabled={saving} onClick={() => void save()}>保存 / 分享 PNG</Button></div>
    </>}
  </Modal>
}
