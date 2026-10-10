import { ArrowLeft, History, Pin, RotateCcw, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { DocumentKind, DocumentSnapshot, HistoricalDocument, HistoryVersion, HistoryVersionRecord } from '../../../../shared/documentHistory'
import { Badge, Button, EmptyState, Input, Spinner } from '../../components/ui/primitives'
import { Modal } from '../../components/ui/modal'
import { api } from '../../lib/api'
import { useWorkspace } from '../../stores/workspaceStore'
import { HistoryContent } from './HistoryContent'
import { buildHistoryEntities, historySourceLabel, type HistoryFilters } from './historyView'
import { registerDocumentLeaveGuard } from './navigationGuard'

export function HistoryVersionRow({ version, selected, onOpen }: { version: HistoryVersion; selected: boolean; onOpen: () => void }): React.ReactElement {
  return <button type="button" onClick={onOpen} className={`w-full rounded-lg border p-3 text-left ${selected ? 'border-accent/40 bg-accent-soft' : 'border-line hover:bg-elevated'}`}>
    <span className="flex items-center gap-2 text-sm font-medium"><span className="min-w-0 flex-1 truncate">{version.label || `历史版本 ${version.historySequence}`}</span>{version.pinned && <Pin size={13} aria-label="已标记保留" />}</span>
    <span className="mt-1 block text-xs text-muted">{new Date(version.createdAt).toLocaleString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}</span>
    <span className="mt-1 block text-[11px] text-faint">{historySourceLabel(version.source)} · {version.wordCount} 字 · 第 {version.historySequence} 版</span>
    {version.note && <span className="mt-2 block truncate text-xs text-muted">{version.note}</span>}
  </button>
}

export function HistoryPage(): React.ReactElement {
  const summary = useWorkspace((state) => state.summary)
  const uiSource = useWorkspace((state) => state.uiSource)
  const refresh = useWorkspace((state) => state.refresh)
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const kind: DocumentKind = params.get('kind') === 'outline' ? 'outline' : 'chapter'
  const entityId = params.get('id') ?? ''
  const [filters, setFilters] = useState<HistoryFilters>({})
  const [versions, setVersions] = useState<HistoryVersion[]>([])
  const [record, setRecord] = useState<HistoryVersionRecord | null>(null)
  const [compareId, setCompareId] = useState('')
  const [compare, setCompare] = useState<HistoricalDocument | null>(null)
  const [pageSize, setPageSize] = useState(40)
  const [stage, setStage] = useState<'entities' | 'versions' | 'detail'>(entityId ? 'versions' : 'entities')
  const [loading, setLoading] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [label, setLabel] = useState('')
  const [note, setNote] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [restoreOpen, setRestoreOpen] = useState(false)
  const [restoreSnapshot, setRestoreSnapshot] = useState<DocumentSnapshot | null>(null)
  const requestRef = useRef(0)
  const scopeRef = useRef('')
  const pendingMutationRef = useRef<Promise<void> | null>(null)
  const scope = JSON.stringify([summary?.path, uiSource, kind])
  scopeRef.current = scope
  useEffect(() => registerDocumentLeaveGuard(async () => {
    await pendingMutationRef.current
    return true
  }), [])
  const entities = useMemo(() => buildHistoryEntities(kind, versions, summary, filters), [kind, versions, summary, filters])
  const entity = entities.find((item) => item.id === entityId)
  const currentExists = (kind === 'chapter' ? summary?.chapters : summary?.outline)?.some((item) => item.id === entityId) ?? false
  const selectedVersions = useMemo(() => versions.filter((item) => item.entityId === entityId).sort((a, b) => b.historySequence - a.historySequence), [versions, entityId])

  const loadVersions = async (): Promise<void> => {
    const expectedScope = scope
    setLoading(true)
    try { const result = await api.listHistoryVersions(kind); if (scopeRef.current === expectedScope) { setVersions(result); setError(null) } }
    catch (failure) { if (scopeRef.current === expectedScope) setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { if (scopeRef.current === expectedScope) setLoading(false) }
  }
  useEffect(() => {
    requestRef.current++
    setVersions([]); setRecord(null); setCompare(null); setCompareId(''); setFilters({}); setMessage(null); setDetailLoading(false); setBusy(false)
    setRestoreOpen(false); setDeleteOpen(false); setEditOpen(false); setRestoreSnapshot(null)
    void loadVersions()
  }, [scope])
  useEffect(() => { requestRef.current++; setRecord(null); setCompare(null); setCompareId(''); setPageSize(40); setDetailLoading(false) }, [entityId])
  const selectEntity = (id: string): void => { if (busy) return; setParams({ kind, id }); setStage('versions') }
  const openVersion = async (version: HistoryVersion): Promise<void> => {
    const request = ++requestRef.current
    const expectedScope = scope
    setDetailLoading(true); setCompareId(''); setCompare(null); setError(null); setMessage(null)
    try {
      const result = await api.getHistoryVersion(kind, version.entityId, version.historyVersionId)
      if (request === requestRef.current && scopeRef.current === expectedScope) { setRecord(result); setStage('detail') }
    } catch (failure) { if (request === requestRef.current && scopeRef.current === expectedScope) setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { if (request === requestRef.current && scopeRef.current === expectedScope) setDetailLoading(false) }
  }
  const chooseCompare = async (id: string): Promise<void> => {
    setCompareId(id); setCompare(null)
    if (!id || !record) return
    const request = ++requestRef.current
    const expectedScope = scope
    setDetailLoading(true)
    try {
      const document = id === '__current__' ? (await api.getDocumentSnapshot(kind, entityId)).document : (await api.getHistoryVersion(kind, entityId, id)).document
      if (request === requestRef.current && scopeRef.current === expectedScope) setCompare(document)
    } catch (failure) { if (request === requestRef.current && scopeRef.current === expectedScope) setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { if (request === requestRef.current && scopeRef.current === expectedScope) setDetailLoading(false) }
  }
  const manage = async (operation: () => Promise<void>): Promise<void> => {
    if (pendingMutationRef.current) return
    const expectedScope = scope
    setBusy(true); setError(null)
    const pending = (async () => {
      try { await operation(); if (scopeRef.current === expectedScope) await loadVersions() }
      catch (failure) { if (scopeRef.current === expectedScope) setError(failure instanceof Error ? failure.message : String(failure)) }
      finally { if (scopeRef.current === expectedScope) setBusy(false) }
    })()
    pendingMutationRef.current = pending
    try { await pending } finally { if (pendingMutationRef.current === pending) pendingMutationRef.current = null }
  }
  const updateMetadata = async (patch: { pinned?: boolean; label?: string; note?: string }): Promise<void> => {
    if (!record) return
    const expectedScope = scope
    const result = await api.updateHistoryVersion(kind, entityId, record.historyVersionId, patch)
    if (scopeRef.current === expectedScope) setRecord((current) => current?.historyVersionId === record.historyVersionId ? { ...current, ...result } : current)
  }
  const beginRestore = async (): Promise<void> => {
    if (!record || !currentExists) return
    const expectedScope = scope
    setError(null); setBusy(true)
    try { const snapshot = await api.getDocumentSnapshot(kind, entityId); if (scopeRef.current === expectedScope) { setRestoreSnapshot(snapshot); setRestoreOpen(true) } }
    catch (failure) { if (scopeRef.current === expectedScope) setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { if (scopeRef.current === expectedScope) setBusy(false) }
  }
  const restore = async (): Promise<void> => {
    if (!record || !restoreSnapshot) return
    await manage(async () => {
      const expectedScope = scope
      const latest = await api.getDocumentSnapshot(kind, entityId)
      if (scopeRef.current !== expectedScope) throw new Error('工作区已切换，请在当前工作区重新选择历史版本。')
      if (latest.writeRevision !== restoreSnapshot.writeRevision || latest.sourceText !== restoreSnapshot.sourceText) {
        setRestoreSnapshot(latest)
        throw new Error('当前文件再次变化，已更新恢复预览，请重新确认。')
      }
      await api.restoreHistoryVersion(kind, entityId, record.historyVersionId, latest.writeRevision, latest.sourceText)
      await refresh()
      setRestoreOpen(false); setCompareId('__current__'); setCompare((await api.getDocumentSnapshot(kind, entityId)).document)
      setMessage('已恢复为当前文档，并保存恢复前保护版本与恢复结果。')
    })
  }
  const changeKind = (next: DocumentKind): void => { if (busy) return; setParams({ kind: next }); setStage('entities') }
  return <div className="flex h-full min-h-0 flex-col">
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line p-3">
      <History size={17} className="text-muted" />
      <Button size="sm" variant={kind === 'chapter' ? 'soft' : 'ghost'} onClick={() => changeKind('chapter')}>章节历史</Button>
      <Button size="sm" variant={kind === 'outline' ? 'soft' : 'ghost'} onClick={() => changeKind('outline')}>大纲历史</Button>
      <span className="hidden text-xs text-faint sm:inline">所有版本保留到主动删除；标记保留用于收藏和删除保护。</span>
      <Button size="sm" variant="ghost" onClick={() => void loadVersions()} loading={loading}>刷新</Button>
    </div>
    {error && <div role="alert" className="shrink-0 border-b border-danger/30 bg-danger-soft p-3 text-xs text-danger">{error}</div>}
    {message && <div role="status" className="shrink-0 border-b border-line bg-accent-soft p-3 text-xs text-accent">{message}</div>}
    <div className="grid min-h-0 flex-1 lg:grid-cols-[220px_270px_minmax(0,1fr)]">
      <section aria-label="历史文档目录" className={`${stage === 'entities' ? 'flex' : 'hidden'} min-h-0 flex-col border-r border-line lg:flex`}>
        <div className="grid gap-2 p-3">
          {kind === 'chapter' ? <>
            <select aria-label="章节箱位" value={filters.box ?? ''} onChange={(event) => setFilters({ ...filters, box: event.target.value })} className="set-select"><option value="">正文与草稿</option><option value="main">正文箱</option><option value="draft">草稿箱</option></select>
            <select aria-label="章节卷" value={filters.volumeId ?? ''} onChange={(event) => setFilters({ ...filters, volumeId: event.target.value })} className="set-select"><option value="">全部卷</option>{summary?.volumes?.map((volume) => <option key={volume.id} value={volume.id}>{volume.title}</option>)}</select>
          </> : <>
            <select aria-label="大纲类型" value={filters.outlineKind ?? ''} onChange={(event) => setFilters({ outlineKind: event.target.value })} className="set-select"><option value="">全部大纲</option><option value="total">总纲</option><option value="chapter">章纲</option></select>
            {filters.outlineKind !== 'total' && <select aria-label="关联章节" value={filters.chapterId ?? ''} onChange={(event) => setFilters({ ...filters, chapterId: event.target.value })} className="set-select"><option value="">全部关联</option><option value="__unassigned__">未关联章纲</option>{summary?.chapters.map((chapter) => <option key={chapter.id} value={chapter.id}>{chapter.title}</option>)}</select>}
          </>}
        </div>
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-3 pt-0">
          {entities.map((item) => <button type="button" key={item.id} onClick={() => selectEntity(item.id)} className={`w-full rounded-lg p-3 text-left ${entityId === item.id ? 'bg-accent-soft' : 'hover:bg-elevated'}`}><span className="block truncate text-sm">{item.title}</span><span className="mt-1 flex items-center gap-2 text-xs text-faint">{item.versionCount} 个版本{item.deleted && <Badge>原文档已删除</Badge>}</span></button>)}
          {!loading && entities.length === 0 && <p className="p-3 text-xs text-faint">此范围暂无文档或历史。</p>}
        </div>
      </section>
      <section aria-label="历史版本列表" className={`${stage === 'versions' ? 'flex' : 'hidden'} min-h-0 flex-col border-r border-line lg:flex`}>
        <div className="flex items-center gap-2 border-b border-line p-3"><Button size="sm" variant="ghost" className="lg:hidden" onClick={() => setStage('entities')}><ArrowLeft size={14} />文档</Button><span className="min-w-0 truncate text-sm font-medium">{entity?.title ?? '选择文档'}</span></div>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
          {selectedVersions.slice(0, pageSize).map((version) => <HistoryVersionRow key={version.historyVersionId} version={version} selected={record?.historyVersionId === version.historyVersionId} onOpen={() => void openVersion(version)} />)}
          {selectedVersions.length > pageSize && <Button size="sm" variant="ghost" onClick={() => setPageSize((count) => count + 40)}>加载更多版本（剩余 {selectedVersions.length - pageSize}）</Button>}
          {entityId && !loading && selectedVersions.length === 0 && <p className="p-3 text-xs text-muted">尚无历史版本。在编辑器选择「保存为新版本」开始留存。</p>}
        </div>
      </section>
      <section aria-label="历史正文与差异" className={`${stage === 'detail' ? 'flex' : 'hidden'} min-h-0 min-w-0 flex-col lg:flex`}>
        <Button size="sm" variant="ghost" className="m-2 self-start lg:hidden" onClick={() => setStage('versions')}><ArrowLeft size={14} />版本列表</Button>
        {record ? <>
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line p-3">
            <span className="mr-auto text-xs text-muted">历史版本 {record.historySequence} · {historySourceLabel(record.source)}</span>
            <Button size="sm" variant="ghost" loading={busy} onClick={() => void manage(() => updateMetadata({ pinned: !record.pinned }))}><Pin size={13} />{record.pinned ? '取消保留' : '标记保留'}</Button>
            <Button size="sm" variant="ghost" onClick={() => { setLabel(record.label); setNote(record.note); setEditOpen(true) }}>名称与备注</Button>
            <Button size="sm" variant="outline" disabled={!currentExists || busy} onClick={() => void beginRestore()}><RotateCcw size={13} />恢复</Button>
            <Button size="sm" variant="ghost" className="text-danger" disabled={busy} onClick={() => setDeleteOpen(true)}><Trash2 size={13} />删除</Button>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line p-3">
            <label className="flex items-center gap-2 text-xs text-muted">比较对象<select aria-label="比较对象" value={compareId} onChange={(event) => void chooseCompare(event.target.value)} className="h-8 max-w-56 rounded-md border border-line bg-panel px-2"><option value="">只读全文</option>{currentExists && <option value="__current__">当前文档</option>}{selectedVersions.filter((version) => version.historyVersionId !== record.historyVersionId).map((version) => <option key={version.historyVersionId} value={version.historyVersionId}>{version.label || `历史版本 ${version.historySequence}`}</option>)}</select></label>
            {currentExists && <Button size="sm" variant="ghost" disabled={busy} onClick={() => navigate(`${kind === 'chapter' ? '/chapters' : '/outline'}?id=${encodeURIComponent(entityId)}`)}>返回编辑器</Button>}
          </div>
          {!currentExists && <p className="shrink-0 border-b border-line bg-elevated p-3 text-xs text-muted">原文档已删除或位于回收站，此历史仍可阅读、比较和管理；恢复当前文档后才可原位恢复。</p>}
          {record.note && <p className="shrink-0 whitespace-pre-wrap border-b border-line p-3 text-xs text-muted">备注：{record.note}</p>}
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 sm:p-6">{detailLoading ? <Spinner /> : <HistoryContent record={record} compare={compare} />}</div>
        </> : <div className="flex min-h-0 flex-1 items-center justify-center">{detailLoading ? <Spinner /> : <EmptyState icon={<History size={30} />} title="选择一个历史版本" hint="历史正文只读，可与当前文档或另一版比较" />}</div>}
      </section>
    </div>
    <Modal open={editOpen} onOpenChange={setEditOpen} title="版本名称与备注">
      <label className="grid gap-2 text-xs text-muted">版本名称<Input value={label} onChange={(event) => setLabel(event.target.value)} placeholder={`历史版本 ${record?.historySequence ?? ''}`} /></label>
      <label className="mt-4 grid gap-2 text-xs text-muted">备注<textarea value={note} onChange={(event) => setNote(event.target.value)} rows={5} className="w-full resize-y rounded-lg border border-line bg-app p-3 text-sm text-fg" /></label>
      <div className="mt-5 flex justify-end gap-2"><Button variant="ghost" onClick={() => setEditOpen(false)}>取消</Button><Button variant="primary" loading={busy} onClick={() => void manage(async () => { await updateMetadata({ label, note }); setEditOpen(false) })}>保存</Button></div>
    </Modal>
    <Modal open={deleteOpen} onOpenChange={setDeleteOpen} title={`删除历史版本 ${record?.historySequence ?? ''}？`}>
      <p className="text-sm text-muted">删除不可撤销，当前文档不受影响。{record?.pinned && '该版本已标记保留，删除前将再次确认。'}</p>
      <div className="mt-5 flex justify-end gap-2"><Button variant="ghost" onClick={() => setDeleteOpen(false)}>取消</Button><Button variant="danger" loading={busy} onClick={() => {
        if (!record || (record.pinned && !window.confirm('此版本已标记保留。仍明确删除这个保留版本？'))) return
        void manage(async () => { await api.deleteHistoryVersion(kind, entityId, record.historyVersionId, record.pinned); setDeleteOpen(false); setRecord(null); setStage('versions') })
      }}>确认删除</Button></div>
    </Modal>
    <Modal open={restoreOpen} onOpenChange={setRestoreOpen} wide title={`恢复历史版本 ${record?.historySequence ?? ''}？`}>
      <p className="mb-4 text-sm text-muted">恢复标题、正文及可编辑内容元数据，保持当前文档箱位、卷、排序和章节关联；核心会留存恢复前保护版本，并生成新修订。</p>
      {record?.entityKind === 'chapter' && <p className="mb-4 text-xs text-muted">历史章节状态与当前箱位不适用时，保留当前状态。</p>}
      {record && restoreSnapshot && <div className="max-h-[45vh] overflow-y-auto"><HistoryContent record={record} compare={restoreSnapshot.document} /></div>}
      {error && <p role="alert" className="mt-3 text-xs text-danger">{error}</p>}
      <div className="mt-5 flex justify-end gap-2"><Button variant="ghost" onClick={() => setRestoreOpen(false)}>取消</Button><Button variant="primary" loading={busy} onClick={() => void restore()}>确认恢复</Button></div>
    </Modal>
  </div>
}
