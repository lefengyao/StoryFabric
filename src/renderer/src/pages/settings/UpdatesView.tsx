import { CheckCircle2, Download, ExternalLink, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button, Card, Field } from '../../components/ui/primitives'
import { DEFAULT_UPDATE_PREFERENCES, normalizeUpdatePreferences, type UpdateCheckResult } from '../../../../shared/updates'
import { useSettings } from '../../stores/settingsStore'
import { useAppUpdates } from '../../stores/appUpdateStore'
import { api } from '../../lib/api'
import { APP_VERSION } from '../../lib/appVersion'

const PLATFORM_NAMES = { windows: 'Windows 安装包', android: 'Android APK', linux: 'Linux 服务包', macos: 'macOS 安装包' }
export function updateStatusText(result: UpdateCheckResult | null): string {
  if (!result) return '检查是否有新版本'
  switch (result.status) {
    case 'available': return `发现新版本 v${result.latestVersion}`
    case 'current': return result.issues.length ? '可访问的更新源未发现新版本，请稍后再次检查' : '当前已是最新版本'
    case 'empty': return '更新源尚未发布版本或更新文件'
    case 'unavailable': return `发现 v${result.latestVersion}，暂未提供可下载的${PLATFORM_NAMES[result.platform]}`
    case 'error': return '暂时无法完成更新检测，请稍后重试'
  }
}
const sizeText = (bytes: number): string => `${(bytes / 1024 ** 2).toFixed(1)} MB`
export function UpdatesView(): React.ReactElement {
  const settings = useSettings((s) => s.settings)
  const update = useSettings((s) => s.update)
  const preferences = normalizeUpdatePreferences(settings?.updatePreferences)
  const { checking, result, download, check, syncDownload, startDownload, cancelDownload } = useAppUpdates()
  const sourceSignature = preferences.sources.join('\n')
  const [draft, setDraft] = useState(sourceSignature)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { setDraft(sourceSignature) }, [sourceSignature])
  useEffect(() => {
    if (!api.getUpdateDownloadState) return
    const sync = (): void => { void syncDownload().catch(() => {}) }
    sync()
    const timer = window.setInterval(sync, 750)
    return () => window.clearInterval(timer)
  }, [syncDownload])
  const act = async (fn: () => Promise<void>): Promise<void> => {
    setError(''); setBusy(true)
    try { await fn() } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusy(false) }
  }
  const saveSources = async (): Promise<void> => {
    const sources = [...new Set(draft.split('\n').map((v) => v.trim()).filter(Boolean))]
    if (!sources.length || sources.length > 5 || sources.some((source) => {
      try { const url = new URL(source); return url.protocol !== 'https:' || !!url.username || !!url.password } catch { return true }
    })) throw new Error('请填写 1–5 个 HTTPS 更新地址，每行一个')
    await update({ updatePreferences: { ...preferences, sources } })
    useAppUpdates.getState().reset()
  }
  const downloading = download?.status === 'downloading'
  const canDownload = result?.status === 'available' && !!result.asset
  const inAppDownload = canDownload && result.platform === 'windows' && !!result.asset?.sha256 && !!api.downloadAppUpdate
  return (
    <section className="space-y-4" data-update-settings>
      <div><h2 className="text-sm font-semibold">监测更新</h2><p className="mt-1 text-xs leading-5 text-muted">及时获取新版本，继续安心创作。</p></div>
      <Card className="space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><span className="text-xs text-muted">当前版本</span><div className="mt-1 text-lg font-semibold tabular-nums">v{APP_VERSION}</div></div>
          <Button onClick={() => void check()} loading={checking} disabled={downloading || busy || !api.checkAppUpdate} className="min-h-10"><RefreshCw size={14} />检查更新</Button>
        </div>
        <div role="status" aria-live="polite" className="rounded-lg bg-elevated p-3">
          <p className="text-sm leading-6">{checking ? '正在检查更新…' : updateStatusText(result)}</p>
          {result && <p className="mt-1 text-xs text-muted">上次检查：{new Date(result.checkedAt).toLocaleString()}</p>}
          {result?.status === 'empty' && <p className="mt-2 text-xs leading-5 text-muted">发布目录为空时不会生成下载入口。可以稍后再次检查。</p>}
          {result?.status === 'unavailable' && <p className="mt-2 text-xs leading-5 text-muted">更新文件可能尚未上传或已被移除，请等待发布完成后重试。</p>}
        </div>
        {result?.releaseNotes && <details className="text-sm"><summary className="cursor-pointer text-muted">版本说明</summary><p className="mt-3 whitespace-pre-wrap break-words text-xs leading-6">{result.releaseNotes}</p></details>}
        {canDownload && !downloading && download?.status !== 'ready' && (
          <div className="space-y-2">
            {inAppDownload ? <Button variant="primary" className="min-h-10" disabled={busy} onClick={() => void act(startDownload)}><Download size={14} />下载并校验更新</Button>
              : <a className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-accent-soft px-4 text-sm text-accent" href={result.asset!.url} target="_blank" rel="noopener noreferrer"><Download size={14} />下载{PLATFORM_NAMES[result.platform]}</a>}
            <p className="break-all text-xs text-muted">{result.asset!.fileName}{result.asset!.bytes !== null ? ` · ${sizeText(result.asset!.bytes)}` : ''}</p>
            {result.platform === 'linux' && <p className="text-xs leading-5 text-muted">服务包由管理员部署。更新前请备份并保留 data 目录和访问密钥。</p>}
            {result.platform === 'android' && <p className="text-xs leading-5 text-muted">下载后由系统安装器完成更新；测试版请使用相同签名的安装包。</p>}
            {!inAppDownload && result.asset!.sha256 && <details className="text-xs text-muted"><summary className="cursor-pointer">SHA-256 校验值</summary><p className="mt-2 break-all font-mono">{result.asset!.sha256}</p></details>}
          </div>
        )}
        {downloading && <div className="space-y-2" role="status">
          <div className="flex items-center justify-between gap-3 text-xs"><span>正在下载 v{download.version} · {sizeText(download.receivedBytes)}{download.totalBytes ? ` / ${sizeText(download.totalBytes)}` : ''}</span><Button size="sm" onClick={() => void act(cancelDownload)} disabled={busy}>取消</Button></div>
          <progress aria-label="更新下载进度" className="h-2 w-full accent-[var(--accent)]" value={download.totalBytes ? download.receivedBytes : undefined} max={download.totalBytes ?? undefined} />
        </div>}
        {download?.status === 'ready' && <div className="space-y-3">
          <p className="flex items-center gap-2 text-sm text-accent"><CheckCircle2 size={16} />v{download.version} 已下载并通过校验</p>
          <p className="text-xs leading-5 text-muted">请先保存正在编辑的内容，再启动安装程序，按提示完成更新。</p>
          <Button variant="primary" className="min-h-10" disabled={busy} onClick={() => void act(async () => { await api.installAppUpdate?.(); await syncDownload() })}>启动安装程序</Button>
        </div>}
        {(error || download?.error) && <p role="alert" className="text-xs leading-5 text-danger">{error || download?.error}</p>}
        {result?.issues.length ? <details className="text-xs text-muted"><summary className="cursor-pointer">更新源检测详情</summary><ul className="mt-2 space-y-2">{result.issues.map((issue, i) => <li key={i} className="break-all">{issue.source && `${issue.source}：`}{issue.message}</li>)}</ul></details> : null}
      </Card>
      <Card className="space-y-4 p-4">
        <label className="flex cursor-pointer items-start gap-3 text-sm"><input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-[var(--accent)]" checked={preferences.automatic} onChange={(e) => void act(() => update({ updatePreferences: { ...preferences, automatic: e.target.checked } }))} disabled={busy} /><span>自动检测更新<span className="mt-1 block text-xs leading-5 text-muted">启动后检查，使用期间每 6 小时检查一次。发现更新后在设置入口提示，由你决定何时安装。</span></span></label>
        <div className="border-t border-line pt-4"><div className="mb-2 text-xs font-medium">更新地址</div><div className="space-y-2">{preferences.sources.map((source, i) => <a key={source} href={source} target="_blank" rel="noopener noreferrer" className="flex min-w-0 items-start gap-2 text-xs leading-5 text-muted hover:text-accent"><ExternalLink size={13} className="mt-1 shrink-0" /><span className="min-w-0 break-all">{i + 1}. {source}</span></a>)}</div></div>
        <details className="text-sm"><summary className="cursor-pointer text-muted">管理更新地址</summary><div className="mt-4 space-y-3">
          <Field label="更新源" hint="每行一个地址，支持展示站下载页、版本清单或 GitHub 仓库。"><textarea aria-label="更新源" className="w-full rounded-lg border border-line bg-panel p-3 text-xs leading-5 outline-none focus:border-accent" rows={4} value={draft} onChange={(e) => setDraft(e.target.value)} /></Field>
          <div className="flex flex-wrap gap-2"><Button disabled={busy || downloading} onClick={() => void act(saveSources)}>保存地址</Button><Button disabled={busy || downloading} variant="ghost" onClick={() => void act(() => update({ updatePreferences: { ...preferences, sources: [...DEFAULT_UPDATE_PREFERENCES.sources] } }))}>恢复默认</Button></div>
        </div></details>
      </Card>
    </section>
  )
}
