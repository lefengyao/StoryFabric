import type { ChapterDoc, OutlineDoc } from '../../shared/types'
import { lastItem } from '../../shared/runtimeCompatibility'
import type { DocumentFor, DocumentKind, DocumentSnapshot, DocumentWriteOptions } from '../../shared/documentHistory'
import type { FileStore } from '../storage/fileStore'
import { normalizeRelativePath } from '../storage/fileStore'
import { countWords, genId, loadChapterDocuments, loadOutlineDocuments, sanitizeFileName, serializeChapter, serializeOutlineDoc } from './entityStore'
import { normalizeChapterContent } from './chapterFormatting'
import { normalizeChapterStatus, resolveChapterPlacement } from '../../shared/chapterPlacement'
import { parseFrontMatter } from './frontMatter'
import { isWriteRevision, newWriteRevision } from './resourceRevision'
import { coordinatorFor } from './mutationCoordinator'
import { commitTextChanges, type JournalTextChange } from './mutationJournal'
import { appendHistoryVersion, createHistoryPlan, documentHistoryKey, historicalDocument, historyPlanChanges, readHistoryVersion, sameHistoricalDocument } from '../history/historyStore'
import { recordChapterWriting } from '../usage/writingStats'
import { listTrash } from './trash'

export { saveHistoryVersion, listHistoryVersions, getHistoryVersion, updateHistoryVersion, deleteHistoryVersion, restoreHistoryVersion } from '../history/historyService'

export interface CurrentDocumentState<K extends DocumentKind> extends DocumentSnapshot<K> { path: string }
const rawBaselines = new WeakMap<ReturnType<typeof coordinatorFor>, Map<string, { writeRevision: string; sourceText: string }>>()

function rememberSource(store: FileStore, kind: DocumentKind, snapshot: DocumentSnapshot): void {
  const coordinator = coordinatorFor(store)
  let baselines = rawBaselines.get(coordinator)
  if (!baselines) { baselines = new Map(); rawBaselines.set(coordinator, baselines) }
  const key = `${kind}:${snapshot.document.id}`
  if (baselines.get(key)?.writeRevision !== snapshot.writeRevision) baselines.set(key, { writeRevision: snapshot.writeRevision, sourceText: snapshot.sourceText })
}

export async function readCurrentDocument<K extends DocumentKind>(store: FileStore, kind: K, id: string, sourcePath?: string): Promise<CurrentDocumentState<K>> {
  documentHistoryKey(kind, id)
  const root = kind === 'chapter' ? 'chapters' : 'outline'
  let path: string
  let previous: ChapterDoc | OutlineDoc | undefined
  if (sourcePath !== undefined) {
    path = normalizeRelativePath(sourcePath)
    if (path !== sourcePath || !path.startsWith(`${root}/`) || !path.endsWith('.md') || path.includes('/trash/')) throw new Error('INVALID_ARGUMENT：当前文档路径无效')
  } else {
    const rows = kind === 'chapter' ? await loadChapterDocuments(store) : await loadOutlineDocuments(store)
    const hit = rows.find((row) => row.doc.id === id)
    if (!hit) throw new Error('NOT_FOUND：当前文档不存在；回收站文档须先恢复')
    path = `${root}/${hit.fileName}`
    previous = hit.doc
  }
  const sourceText = await store.readText(path)
  if (sourceText === null) throw new Error('NOT_FOUND：当前文档文件不存在')
  const parsed = parseFrontMatter(sourceText)
  const document = { ...previous, ...parsed.data, content: kind === 'chapter' ? normalizeChapterContent(parsed.content.replace(/^\n+/, '')) : parsed.content.replace(/^\n+/, '') } as DocumentFor<K>
  if (document.id !== id) throw new Error('SOURCE_CHANGED：当前路径指向其他文档')
  if (!isWriteRevision(document.writeRevision) || typeof document.updatedAt !== 'string') throw new Error('工作区文档需要按格式 5 重写：缺少当前修订或更新时间')
  if (kind === 'chapter') {
    const chapter = document as ChapterDoc
    chapter.box = path.startsWith('chapters/draft/') ? 'draft' : 'main'
    chapter.status = normalizeChapterStatus(chapter.status, chapter.box)
    chapter.wordCount = countWords(chapter.content)
    chapter.terms = chapter.terms ?? []
    chapter.volume = chapter.volume ?? '第一卷'
    chapter.volumeId = chapter.volumeId ?? 'vol_default'
  }
  const snapshot = { document, path, sourceText, writeRevision: document.writeRevision }
  rememberSource(store, kind, snapshot)
  return snapshot
}

export function validateDocumentBaseline<K extends DocumentKind>(store: FileStore, kind: K, current: CurrentDocumentState<K>, options: DocumentWriteOptions): void {
  const cached = rawBaselines.get(coordinatorFor(store))?.get(`${kind}:${current.document.id}`)
  if (!isWriteRevision(options.baseRevision) || options.baseRevision !== current.writeRevision
    || (options.baseText !== undefined && options.baseText !== current.sourceText)
    || (options.baseText === undefined && cached?.writeRevision === options.baseRevision && cached.sourceText !== current.sourceText)) throw new Error('SOURCE_CHANGED：当前文档已经变化，请重新读取后提交；本地草稿已保留')
}

export async function getDocumentSnapshot<K extends DocumentKind>(store: FileStore, kind: K, id: string): Promise<DocumentSnapshot<K>> {
  return coordinatorFor(store).run(documentHistoryKey(kind, id), async () => {
    const { path: _path, ...snapshot } = await readCurrentDocument(store, kind, id)
    return snapshot
  })
}

export interface PreparedDocumentWrite<K extends DocumentKind> {
  document: DocumentFor<K>
  sourceText: string
  path: string
  changes: JournalTextChange[]
  totalWords?: number
}

/** Plans current files without writing them so history and moves share the same journal. */
export async function prepareDocumentWrite<K extends DocumentKind>(store: FileStore, kind: K, input: Partial<K extends 'chapter' ? ChapterDoc : OutlineDoc>, current?: CurrentDocumentState<K>): Promise<PreparedDocumentWrite<K>> {
  const pathFields = kind === 'chapter' ? ['title', 'order', 'volumeId'] : ['title', 'order', 'kind', 'chapterId']
  const unchangedFields = current && pathFields.every((key) => !(key in input) || (input as Record<string, unknown>)[key] === undefined || (input as Record<string, unknown>)[key] === (current.document as unknown as Record<string, unknown>)[key])
  const samePlacement = kind !== 'chapter' || (current && resolveChapterPlacement(current.document as ChapterDoc, input as Partial<ChapterDoc>).box === (current.document as ChapterDoc).box)
  const stablePath = Boolean(unchangedFields && samePlacement)
  const needsTotal = kind === 'chapter' && !(await store.exists('.storyfabric/writing-stats/current.json'))
  const rows = !stablePath || needsTotal ? kind === 'chapter' ? await loadChapterDocuments(store) : await loadOutlineDocuments(store) : undefined
  const id = current?.document.id ?? input.id ?? genId(kind === 'chapter' ? 'cha' : 'out')
  documentHistoryKey(kind, id)
  const patch = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined))
  const defaults = kind === 'chapter'
    ? { title: input.title?.trim() || '未命名章节', volume: '第一卷', volumeId: 'vol_default', box: 'main', terms: [], order: rows?.length ? Math.max(...rows.map((row) => row.doc.order)) + 1 : 1, status: 'body', wordCount: 0, content: '' }
    : { title: input.title?.trim() || '未命名大纲', order: rows?.length ? Math.max(...rows.map((row) => row.doc.order)) + 1 : 1, kind: 'total', content: '' }
  const document = { ...(current?.document ?? defaults), ...patch, id, writeRevision: newWriteRevision(), updatedAt: new Date().toISOString() } as DocumentFor<K>
  let folder: string
  if (kind === 'chapter') {
    const chapter = document as ChapterDoc
    const placement = resolveChapterPlacement((current?.document as ChapterDoc) ?? null, input as Partial<ChapterDoc>)
    chapter.box = placement.box
    chapter.status = placement.status
    chapter.content = normalizeChapterContent(chapter.content)
    chapter.wordCount = countWords(chapter.content)
    chapter.volumeId = chapter.volumeId ?? 'vol_default'
    if (!/^[a-zA-Z0-9_-]+$/.test(chapter.volumeId)) throw new Error('INVALID_ARGUMENT：卷 ID 无效')
    chapter.terms = chapter.terms ?? []
    folder = chapter.box === 'draft' ? 'chapters/draft' : `chapters/main/${chapter.volumeId}`
  } else {
    const outline = document as OutlineDoc
    outline.kind = outline.kind === 'chapter' ? 'chapter' : 'total'
    outline.chapterId = outline.kind === 'chapter' && typeof outline.chapterId === 'string' && outline.chapterId.trim() ? outline.chapterId.trim() : undefined
    if (outline.chapterId && !/^[a-zA-Z0-9_-]+$/.test(outline.chapterId)) throw new Error('INVALID_ARGUMENT：关联章节 ID 无效')
    folder = outline.kind === 'chapter' ? outline.chapterId ? `outline/chapters/${outline.chapterId}` : 'outline/unassigned' : 'outline/total'
  }
  const order = String(Math.max(0, Math.floor(document.order))).padStart(4, '0')
  const base = `${order}-${sanitizeFileName(document.title)}`
  let path = stablePath ? current!.path : `${folder}/${base}.md`
  const root = kind === 'chapter' ? 'chapters' : 'outline'
  if (rows?.some((row) => `${root}/${row.fileName}` === path && row.doc.id !== id)) path = `${folder}/${base}_${id.split('_')[1] ?? id}.md`
  if (current?.path !== path && await store.exists(path)) throw new Error('CONFLICT：目标文件已存在，请保留文件并修改标题')
  const sourceText = kind === 'chapter' ? serializeChapter(document as ChapterDoc) : serializeOutlineDoc(document as OutlineDoc)
  const changes: JournalTextChange[] = [{ path, beforeText: current?.path === path ? current.sourceText : null, afterText: sourceText }]
  if (current && current.path !== path) changes.push({ path: current.path, beforeText: current.sourceText, afterText: null })
  const totalWords = kind === 'chapter' && rows ? rows.reduce((sum, row) => sum + countWords(row.doc.content), 0) - countWords(current?.document.content ?? '') + countWords(document.content) : undefined
  return { document, sourceText, path, changes, totalWords }
}

async function planWritingStatistics(store: FileStore, before: string, after: string, initialTotal?: number): Promise<JournalTextChange[]> {
  const planned = new Map<string, JournalTextChange>()
  const staged = new Proxy(store, {
    get(target, key) {
      if (key === 'writeText') return async (path: string, text: string) => {
        if (!path.startsWith('.storyfabric/writing-stats/')) throw new Error('写作统计只能写入统计目录')
        const prior = planned.get(path)
        planned.set(path, { path, beforeText: prior ? prior.beforeText : await target.readText(path), afterText: text })
      }
      if (key === 'readText') return async (path: string) => planned.has(path) ? planned.get(path)!.afterText : target.readText(path)
      if (key === 'exists') return async (path: string) => planned.has(path) || await target.exists(path)
      const value = Reflect.get(target, key)
      return typeof value === 'function' ? value.bind(target) : value
    }
  })
  await recordChapterWriting(staged, before, after, await store.exists('.storyfabric/writing-stats/current.json') ? undefined : initialTotal)
  return [...planned.values()]
}

export async function commitDocumentWrite<K extends DocumentKind>(store: FileStore, kind: K, prepared: PreparedDocumentWrite<K>, current?: CurrentDocumentState<K>, extraChanges: JournalTextChange[] = []): Promise<DocumentSnapshot<K>> {
  const commit = async (): Promise<DocumentSnapshot<K>> => {
    const statistics = kind === 'chapter' ? await planWritingStatistics(store, current?.document.content ?? '', prepared.document.content, prepared.totalWords) : []
    const indexText = await store.readText('.storyfabric/index.json')
    const indexChanges: JournalTextChange[] = indexText === null ? [] : [{ path: '.storyfabric/index.json', beforeText: indexText, afterText: null }]
    const transaction = await commitTextChanges(store, genId('document'), [...prepared.changes, ...extraChanges, ...statistics, ...indexChanges])
    if (!transaction.ok) throw new Error(transaction.recoveryRequired ? `RECOVERY_REQUIRED：${transaction.text}` : transaction.text)
    const snapshot = { document: prepared.document, sourceText: prepared.sourceText, writeRevision: prepared.document.writeRevision }
    rememberSource(store, kind, snapshot)
    return snapshot
  }
  return kind === 'chapter' ? coordinatorFor(store).run('document-writing-stats', commit) : commit()
}

export async function saveDocument<K extends DocumentKind>(store: FileStore, kind: K, input: Partial<K extends 'chapter' ? ChapterDoc : OutlineDoc>, options: DocumentWriteOptions = {}): Promise<DocumentFor<K>> {
  const id = input.id ?? genId(kind === 'chapter' ? 'cha' : 'out')
  return coordinatorFor(store).run(documentHistoryKey(kind, id), async () => {
    let current: CurrentDocumentState<K> | undefined
    try { current = await readCurrentDocument(store, kind, id, options.sourcePath) } catch (error) {
      if (!(error instanceof Error) || !error.message.startsWith('NOT_FOUND')) throw error
      if (options.baseRevision) throw new Error('SOURCE_CHANGED：当前文档已经删除')
      if ((await listTrash(store)).some((entry) => entry.id === id && entry.kind === kind)) throw new Error('NOT_FOUND：文档位于回收站，须先恢复')
    }
    if (current) validateDocumentBaseline(store, kind, current, options)
    if (options.history && (!['manual', 'automatic', 'agent'].includes(options.history.source) || (options.history.label !== undefined && typeof options.history.label !== 'string'))) throw new Error('INVALID_ARGUMENT：历史保存来源无效')
    const prepared = await prepareDocumentWrite(store, kind, { ...input, id }, current)
    let extraChanges: JournalTextChange[] = []
    if (options.history || (options.establishHistoryBaseline === true && current)) {
      const plan = await createHistoryPlan(store, kind, id)
      const latest = lastItem(plan.manifest.versions)
      const lastRecord = latest ? await readHistoryVersion(store, kind, id, latest.historyVersionId, plan) : undefined
      if (!plan.manifest.versions.length && current) appendHistoryVersion(plan, current.document, 'baseline')
      if (options.history && (options.history.source !== 'automatic' || !lastRecord || !sameHistoricalDocument(lastRecord.document, historicalDocument(prepared.document)))) appendHistoryVersion(plan, prepared.document, options.history.source, options.history.label)
      extraChanges = historyPlanChanges(plan)
    }
    return (await commitDocumentWrite(store, kind, prepared, current, extraChanges)).document
  })
}
