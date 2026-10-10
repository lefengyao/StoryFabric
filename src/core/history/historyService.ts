import type { ChapterDoc, OutlineDoc } from '../../shared/types'
import { lastItem } from '../../shared/runtimeCompatibility'
import type { DocumentKind, DocumentSnapshot, HistorySaveOptions, HistoryVersion, HistoryVersionPatch, HistoryVersionRecord } from '../../shared/documentHistory'
import type { FileStore } from '../storage/fileStore'
import { appendHistoryVersion, createHistoryPlan, documentHistoryKey, historicalDocument, historyPlanChanges, historyRecordPath, patchHistoryMetadata, readHistoryVersion, sameHistoricalDocument } from './historyStore'
import { coordinatorFor } from '../workspace/mutationCoordinator'
import { commitTextChanges } from '../workspace/mutationJournal'
import { genId } from '../workspace/entityStore'
import { commitDocumentWrite, prepareDocumentWrite, readCurrentDocument, validateDocumentBaseline } from '../workspace/documentWrites'
import { boxForChapterStatus } from '../../shared/chapterPlacement'

async function commitHistory(store: FileStore, changes: Parameters<typeof commitTextChanges>[2]): Promise<void> {
  const result = await commitTextChanges(store, genId('history'), changes)
  if (!result.ok) throw new Error(result.recoveryRequired ? `RECOVERY_REQUIRED：${result.text}` : result.text)
}

export async function saveHistoryVersion<K extends DocumentKind>(store: FileStore, kind: K, id: string, options: HistorySaveOptions): Promise<HistoryVersionRecord<K>> {
  if (!options || !['manual', 'automatic', 'agent'].includes(options.source) || (options.label !== undefined && typeof options.label !== 'string')) throw new Error('INVALID_ARGUMENT：历史保存来源无效')
  return coordinatorFor(store).run(documentHistoryKey(kind, id), async () => {
    const current = await readCurrentDocument(store, kind, id)
    if (options.baseRevision !== undefined || options.baseText !== undefined) validateDocumentBaseline(store, kind, current, options)
    const plan = await createHistoryPlan(store, kind, id)
    const latest = lastItem(plan.manifest.versions)
    if (options.source === 'automatic' && latest) {
      const previous = await readHistoryVersion(store, kind, id, latest.historyVersionId, plan)
      if (sameHistoricalDocument(previous.document, historicalDocument(current.document))) return previous
    }
    const record = appendHistoryVersion(plan, current.document, options.source, options.label)
    await commitHistory(store, [{ path: current.path, beforeText: current.sourceText, afterText: current.sourceText }, ...historyPlanChanges(plan)])
    return record
  })
}

export async function listHistoryVersions(store: FileStore, kind: DocumentKind, id?: string): Promise<HistoryVersion[]> {
  if (kind !== 'chapter' && kind !== 'outline') throw new Error('INVALID_ARGUMENT：文档类型无效')
  const ids = id === undefined ? await store.listDirs(`.storyfabric/history/${kind === 'chapter' ? 'chapters' : 'outlines'}`) : [id]
  const versions: HistoryVersion[] = []
  for (const documentId of ids) versions.push(...await coordinatorFor(store).run(documentHistoryKey(kind, documentId), async () => (await createHistoryPlan(store, kind, documentId)).manifest.versions))
  return versions.sort((first, second) => first.entityId.localeCompare(second.entityId) || first.historySequence - second.historySequence)
}

export async function getHistoryVersion<K extends DocumentKind>(store: FileStore, kind: K, id: string, versionId: string): Promise<HistoryVersionRecord<K>> {
  return coordinatorFor(store).run(documentHistoryKey(kind, id), () => readHistoryVersion(store, kind, id, versionId))
}

export async function updateHistoryVersion(store: FileStore, kind: DocumentKind, id: string, versionId: string, patch: HistoryVersionPatch): Promise<HistoryVersion> {
  historyRecordPath(kind, id, versionId)
  return coordinatorFor(store).run(documentHistoryKey(kind, id), async () => {
    const plan = await createHistoryPlan(store, kind, id)
    const metadata = patchHistoryMetadata(plan, versionId, patch)
    await commitHistory(store, historyPlanChanges(plan))
    return metadata
  })
}

export async function deleteHistoryVersion(store: FileStore, kind: DocumentKind, id: string, versionId: string, allowPinned = false): Promise<void> {
  const path = historyRecordPath(kind, id, versionId)
  return coordinatorFor(store).run(documentHistoryKey(kind, id), async () => {
    const plan = await createHistoryPlan(store, kind, id)
    const metadata = plan.manifest.versions.find((version) => version.historyVersionId === versionId)
    if (!metadata) throw new Error('NOT_FOUND：未找到历史版本')
    if (metadata.pinned && allowPinned !== true) throw new Error('该历史版本已标记保留，需要明确确认后才能删除')
    const beforeText = await store.readText(path)
    if (beforeText === null) throw new Error('RECOVERY_REQUIRED：历史版本正文缺失')
    plan.manifest.versions = plan.manifest.versions.filter((version) => version.historyVersionId !== versionId)
    plan.changes.push({ path, beforeText, afterText: null })
    await commitHistory(store, historyPlanChanges(plan))
  })
}

export async function restoreHistoryVersion<K extends DocumentKind>(store: FileStore, kind: K, id: string, versionId: string, baseRevision: string, baseText?: string): Promise<DocumentSnapshot<K>> {
  return coordinatorFor(store).run(documentHistoryKey(kind, id), async () => {
    const current = await readCurrentDocument(store, kind, id)
    validateDocumentBaseline(store, kind, current, { baseRevision, baseText })
    const plan = await createHistoryPlan(store, kind, id)
    const selected = await readHistoryVersion(store, kind, id, versionId, plan)
    let input: Partial<ChapterDoc | OutlineDoc>
    if (kind === 'chapter') {
      const chapter = current.document as ChapterDoc
      const historical = selected.document as Omit<ChapterDoc, 'writeRevision' | 'updatedAt'>
      const status = boxForChapterStatus(historical.status) === chapter.box ? historical.status : chapter.status
      input = { ...historical, id, box: chapter.box, volume: chapter.volume, volumeId: chapter.volumeId, order: chapter.order, status }
    } else {
      const outline = current.document as OutlineDoc
      input = { ...selected.document, id, kind: outline.kind, chapterId: outline.chapterId, order: outline.order }
    }
    const latest = lastItem(plan.manifest.versions)
    const previous = latest ? await readHistoryVersion(store, kind, id, latest.historyVersionId, plan) : undefined
    if (!previous || !sameHistoricalDocument(previous.document, historicalDocument(current.document))) appendHistoryVersion(plan, current.document, 'before-restore')
    const prepared = await prepareDocumentWrite(store, kind, input as Parameters<typeof prepareDocumentWrite<K>>[2], current)
    appendHistoryVersion(plan, prepared.document, 'restored', '', selected.historyVersionId)
    return commitDocumentWrite(store, kind, prepared, current, historyPlanChanges(plan))
  })
}
