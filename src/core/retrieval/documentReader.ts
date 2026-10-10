import type { FileStore } from '../storage/fileStore'
import { loadChapterDocuments, loadOutlineDocuments } from '../workspace/entityStore'
import { readCurrentDocument } from '../workspace/documentWrites'
import { coordinatorFor } from '../workspace/mutationCoordinator'
import { checkDocumentReadRevision } from './documentReadRevision'

export interface DocumentSlice {
  id: string
  title: string
  sourcePath: string
  writeRevision: string
  readRevision: string
  revision: string
  offset: number
  content: string
  returnedChars: number
  totalChars: number
  nextOffset?: number
  truncated: boolean
}

export class DocumentReaderError extends Error {
  constructor(readonly code: 'INVALID_ARGUMENT' | 'NOT_FOUND' | 'AMBIGUOUS_TARGET' | 'SOURCE_CHANGED', message: string) {
    super(message)
    this.name = 'DocumentReaderError'
  }
}

export interface ReadSliceOptions {
  offset?: number
  maxChars?: number
  expectedRevision?: string
}

const DEFAULT_MAX_CHARS = 8000
const MAX_MAX_CHARS = 20000

function boundedInteger(value: number | undefined, fallback: number, label: string, min: number, max: number): number {
  if (value === undefined) return fallback
  if (!Number.isInteger(value) || value < min || value > max) throw new DocumentReaderError('INVALID_ARGUMENT', `${label} 必须是 ${min}–${max} 的整数`)
  return value
}

function safeSliceEnd(text: string, start: number, end: number): number {
  let safeEnd = Math.min(text.length, Math.max(start, end))
  if (safeEnd > start && safeEnd < text.length) {
    const before = text.charCodeAt(safeEnd - 1)
    const after = text.charCodeAt(safeEnd)
    if (before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff) safeEnd -= 1
  }
  return safeEnd
}

function sliceDocument(input: {
  id: string
  title: string
  sourcePath: string
  content: string
  writeRevision: string
  readRevision: string
}, options: ReadSliceOptions): DocumentSlice {
  const offset = boundedInteger(options.offset, 0, 'offset', 0, Number.MAX_SAFE_INTEGER)
  const maxChars = boundedInteger(options.maxChars, DEFAULT_MAX_CHARS, 'maxChars', 1, MAX_MAX_CHARS)
  if (offset > input.content.length) {
    throw new DocumentReaderError('INVALID_ARGUMENT', `offset 超出文档长度：${input.content.length}`)
  }
  const end = safeSliceEnd(input.content, offset, offset + maxChars)
  const content = input.content.slice(offset, end)
  const nextOffset = end < input.content.length ? end : undefined
  return {
    id: input.id,
    title: input.title,
    sourcePath: input.sourcePath,
    writeRevision: input.writeRevision,
    readRevision: input.readRevision,
    revision: input.readRevision,
    offset,
    content,
    returnedChars: content.length,
    totalChars: input.content.length,
    ...(nextOffset === undefined ? {} : { nextOffset }),
    truncated: nextOffset !== undefined
  }
}

export async function readChapterSlice(
  store: FileStore,
  ref: { chapterId?: string; title?: string },
  options: ReadSliceOptions = {}
): Promise<DocumentSlice> {
  const chapters = await loadChapterDocuments(store)
  let matches = ref.chapterId
    ? chapters.filter(({ doc }) => doc.id === ref.chapterId)
    : ref.title?.trim()
      ? chapters.filter(({ doc }) => doc.title === ref.title?.trim() || doc.title.includes(ref.title!.trim()))
      : []
  if (!matches.length) throw new DocumentReaderError('NOT_FOUND', `未找到章节：${ref.chapterId ?? ref.title ?? ''}`)
  if (!ref.chapterId && new Set(matches.map(({ doc }) => doc.id)).size > 1) {
    throw new DocumentReaderError('AMBIGUOUS_TARGET', `章节标题存在多个候选：${matches.map(({ doc }) => `${doc.id} ${doc.title}`).join('；')}`)
  }
  const { doc, fileName } = matches[0]
  return coordinatorFor(store).run(`chapter:${doc.id}`, async () => {
    const snapshot = await readCurrentDocument(store, 'chapter', doc.id, `chapters/${fileName}`)
    const revision = checkDocumentReadRevision(store, 'chapter', doc.id, snapshot.sourceText, snapshot.writeRevision, options.expectedRevision)
    if (!revision.matches) throw new DocumentReaderError('SOURCE_CHANGED', '源文档已变化，请从第一页重新读取')
    return sliceDocument({ id: doc.id, title: snapshot.document.title, sourcePath: snapshot.path, content: snapshot.document.content, writeRevision: snapshot.writeRevision, readRevision: revision.readRevision }, options)
  })
}

export async function readOutlineSlice(
  store: FileStore,
  ref: { outlineId?: string; chapterId?: string; kind?: 'total' | 'chapter' },
  options: ReadSliceOptions = {}
): Promise<DocumentSlice> {
  const outlines = await loadOutlineDocuments(store)
  let matches = ref.outlineId
    ? outlines.filter(({ doc }) => doc.id === ref.outlineId)
    : ref.chapterId
      ? outlines.filter(({ doc }) => doc.kind === 'chapter' && doc.chapterId === ref.chapterId)
      : ref.kind
        ? outlines.filter(({ doc }) => (doc.kind ?? 'total') === ref.kind)
        : []
  if (!matches.length) throw new DocumentReaderError('NOT_FOUND', '未找到大纲文档')
  if (matches.length > 1) {
    throw new DocumentReaderError('AMBIGUOUS_TARGET', `大纲目标存在多个候选：${matches.map(({ doc }) => `${doc.id} ${doc.title}`).join('；')}`)
  }
  const { doc: outline, fileName } = matches[0]
  return coordinatorFor(store).run(`outline:${outline.id}`, async () => {
    const snapshot = await readCurrentDocument(store, 'outline', outline.id, `outline/${fileName}`)
    const revision = checkDocumentReadRevision(store, 'outline', outline.id, snapshot.sourceText, snapshot.writeRevision, options.expectedRevision)
    if (!revision.matches) throw new DocumentReaderError('SOURCE_CHANGED', '源文档已变化，请从第一页重新读取')
    return sliceDocument({ id: outline.id, title: snapshot.document.title, sourcePath: snapshot.path, content: snapshot.document.content, writeRevision: snapshot.writeRevision, readRevision: revision.readRevision }, options)
  })
}
