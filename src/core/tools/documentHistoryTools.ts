import type { ChapterDoc, OutlineDoc, PendingChange, ToolDefJson } from '../../shared/types'
import type { DocumentKind, DocumentSnapshot, HistoryVersion, HistoryVersionRecord } from '../../shared/documentHistory'
import type { FileStore } from '../storage/fileStore'
import type { ToolOutcome } from './registry'
import { getDocumentSnapshot, getHistoryVersion, listHistoryVersions, restoreHistoryVersion } from '../workspace/documentWrites'
import { genId, serializeChapter, serializeOutlineDoc } from '../workspace/entityStore'
import { boxForChapterStatus } from '../../shared/chapterPlacement'
import { sameHistoricalDocument } from '../history/historyStore'
import { validateToolArguments } from './toolArguments'
import { assertDocumentReadSourceUnchanged } from '../retrieval/documentReadRevision'
import { DOCUMENT_READ_BASELINE_SCHEMA } from './writeSchemas'

const reference = { kind: { type: 'string', enum: ['chapter', 'outline'] }, id: { type: 'string', minLength: 1 } }
const historyReference = { ...reference, historyVersionId: { type: 'string', minLength: 1 } }
export const DOCUMENT_HISTORY_TOOL_DEFS: ToolDefJson[] = [
  {
    name: 'list_document_history',
    description: '仅在用户明确请求回看、比较或恢复章节/大纲历史时调用。分页列出长期版本元数据，不读取正文，不提供当前写入基线。id 可省略以发现同类文档及原文档已删除的历史；历史不属于默认检索或当前设定。',
    parameters: { type: 'object', additionalProperties: false, properties: { ...reference, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 100 } }, required: ['kind'] }
  },
  {
    name: 'get_document_history',
    description: '仅在用户明确请求阅读、比较或恢复历史时调用。读取指定章节/大纲历史的正文，默认 4000、最多 20000 字符，使用 nextOffset 分页；历史只读，返回值不能作为当前文档写入基线。',
    parameters: { type: 'object', additionalProperties: false, properties: { ...historyReference, offset: { type: 'integer', minimum: 0 }, maxChars: { type: 'integer', minimum: 1, maximum: 20000 } }, required: ['kind', 'id', 'historyVersionId'] }
  },
  {
    name: 'restore_document_history',
    description: '仅在用户明确请求恢复历史时调用。先重新读取当前文档，baseRevision 为本次当前 writeRevision，baseReadRevision 为本次 readRevision，不能填写历史版本号。生成恢复差异供用户确认，保持当前箱位/卷/顺序和大纲关联；恢复必须保存修改前保护快照及恢复后的来源记录，任何批准策略均须等待用户确认。',
    parameters: { type: 'object', additionalProperties: false, properties: { ...historyReference, baseRevision: { type: 'string', minLength: 1 }, baseReadRevision: DOCUMENT_READ_BASELINE_SCHEMA }, required: ['kind', 'id', 'historyVersionId', 'baseRevision'] }
  }
]
export const TOOL_DEFS = DOCUMENT_HISTORY_TOOL_DEFS

function publicMetadata(version: HistoryVersion): Omit<HistoryVersion, 'sourceWriteRevision'> {
  const { sourceWriteRevision: _provenance, ...metadata } = version
  return metadata
}

function restorePreview(snapshot: DocumentSnapshot, version: HistoryVersionRecord, kind: DocumentKind): string {
  if (kind === 'chapter') {
    const current = snapshot.document as ChapterDoc
    const historical = version.document as Omit<ChapterDoc, 'writeRevision' | 'updatedAt'>
    const status = boxForChapterStatus(historical.status) === current.box ? historical.status : current.status
    return serializeChapter({ ...historical, id: current.id, box: current.box, volume: current.volume, volumeId: current.volumeId, order: current.order, status, writeRevision: current.writeRevision, updatedAt: current.updatedAt })
  }
  const current = snapshot.document as OutlineDoc
  return serializeOutlineDoc({ ...version.document, id: current.id, kind: current.kind, chapterId: current.chapterId, order: current.order, writeRevision: current.writeRevision, updatedAt: current.updatedAt })
}

export async function executeDocumentHistoryTool(store: FileStore, name: string, args: Record<string, unknown>): Promise<ToolOutcome> {
  const definition = DOCUMENT_HISTORY_TOOL_DEFS.find((tool) => tool.name === name)
  if (!definition) throw new Error('INVALID_ARGUMENT：未知历史工具')
  validateToolArguments(definition, args)
  const kind = args.kind as DocumentKind
  const id = args.id as string
  const offset = (args.offset as number | undefined) ?? 0
  if (name === 'list_document_history') {
    const versions = await listHistoryVersions(store, kind, args.id as string | undefined)
    const limit = (args.limit as number | undefined) ?? 20
    const result = { schemaVersion: 1, entityKind: kind, ...(id ? { entityId: id } : {}), offset, totalVersions: versions.length,
      versions: versions.slice(offset, offset + limit).map(publicMetadata), ...(offset + limit < versions.length ? { nextOffset: offset + limit } : {}) }
    return { kind: 'result', ok: true, text: JSON.stringify(result), preview: `历史列表：${result.versions.length} / ${versions.length} 个版本` }
  }
  const versionId = args.historyVersionId as string
  const version = await getHistoryVersion(store, kind, id, versionId)
  if (name === 'get_document_history') {
    const maxChars = (args.maxChars as number | undefined) ?? 4_000
    const { content, ...fields } = version.document
    if (offset > content.length) throw new Error(`INVALID_ARGUMENT：offset 超出历史正文范围，共 ${content.length} 字符`)
    const end = Math.min(content.length, offset + maxChars)
    const result = { ...publicMetadata(version), document: { ...fields, content: content.slice(offset, end) }, offset, totalChars: content.length, ...(end < content.length ? { nextOffset: end } : {}) }
    return { kind: 'result', ok: true, text: JSON.stringify(result), preview: `读取历史版本 ${version.historySequence}：${end - offset} 字符` }
  }
  const captured = await getDocumentSnapshot(store, kind, id)
  if (args.baseRevision !== captured.writeRevision) throw new Error('SOURCE_CHANGED：当前文档已经变化，请重新读取最新修订后恢复')
  assertDocumentReadSourceUnchanged(store, kind, id, captured.sourceText, captured.writeRevision, args.baseReadRevision as string | undefined)
  const change: PendingChange & { historyRequired: true; historyVersionId: string } = {
    id: genId('chg'), toolName: 'restore_document_history', entityKind: kind, entityId: id,
    title: `恢复历史版本 ${version.historySequence}：${version.title}`, beforeText: captured.sourceText, afterText: restorePreview(captured, version, kind),
    historyVersionId: versionId, historyEligible: true, historyRequired: true, mutationKind: 'restore'
  }
  return {
    kind: 'pending', change,
    apply: async (decision) => {
      if (decision?.saveHistory !== true) return { ok: false, text: '恢复历史必须明确确认保存保护版本；当前内容未修改' }
      try {
        const selected = await getHistoryVersion(store, kind, id, versionId)
        if (!sameHistoricalDocument(selected.document, version.document)) return { ok: false, text: 'SOURCE_CHANGED：待恢复历史内容已变化，请重新查看差异' }
        await restoreHistoryVersion(store, kind, id, versionId, captured.writeRevision, captured.sourceText)
        return { ok: true, text: `已恢复历史版本 ${version.historySequence}，并保存恢复保护和来源记录` }
      } catch (error) { return { ok: false, text: error instanceof Error ? error.message : String(error) } }
    }
  }
}
