import type { ChapterDoc, OutlineDoc } from '../../shared/types'
import type { FileStore } from '../storage/fileStore'
import { getChapterBody, listChapters, listOutline } from '../workspace/entityStore'
import { resourceRevision } from '../workspace/resourceRevision'

export interface DocumentSlice {
  id: string
  title: string
  sourcePath: string
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
  revision: string
}, options: ReadSliceOptions): DocumentSlice {
  const offset = boundedInteger(options.offset, 0, 'offset', 0, Number.MAX_SAFE_INTEGER)
  const maxChars = boundedInteger(options.maxChars, DEFAULT_MAX_CHARS, 'maxChars', 1, MAX_MAX_CHARS)
  if (options.expectedRevision && options.expectedRevision !== input.revision) {
    throw new DocumentReaderError('SOURCE_CHANGED', '源文档已变化，请从第一页重新读取')
  }
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
    revision: input.revision,
    offset,
    content,
    returnedChars: content.length,
    totalChars: input.content.length,
    ...(nextOffset === undefined ? {} : { nextOffset }),
    truncated: nextOffset !== undefined
  }
}

function chapterRevision(chapter: ChapterDoc, chapterPath: string): string {
  return resourceRevision(chapterPath, chapter.id, chapter.title, chapter.volumeId ?? '', chapter.box ?? '', chapter.order, chapter.status ?? '', chapter.content)
}

function outlineRevision(outline: OutlineDoc, sourcePath: string): string {
  return resourceRevision(sourcePath, outline.id, outline.title, outline.kind ?? 'total', outline.chapterId ?? '', outline.order, outline.content)
}

export async function readChapterSlice(
  store: FileStore,
  ref: { chapterId?: string; title?: string },
  options: ReadSliceOptions = {}
): Promise<DocumentSlice> {
  const metas = await listChapters(store)
  let matches = ref.chapterId
    ? metas.filter((chapter) => chapter.id === ref.chapterId)
    : ref.title?.trim()
      ? metas.filter((chapter) => chapter.title === ref.title?.trim() || chapter.title.includes(ref.title!.trim()))
      : []
  if (!matches.length) throw new DocumentReaderError('NOT_FOUND', `未找到章节：${ref.chapterId ?? ref.title ?? ''}`)
  if (!ref.chapterId && new Set(matches.map((chapter) => chapter.id)).size > 1) {
    throw new DocumentReaderError('AMBIGUOUS_TARGET', `章节标题存在多个候选：${matches.map((chapter) => `${chapter.id} ${chapter.title}`).join('；')}`)
  }
  const meta = matches[0]
  const content = (await getChapterBody(store, meta.id)) ?? ''
  const sourcePath = `chapters/${meta.box ?? 'main'}/${meta.id}.md`
  return sliceDocument({
    id: meta.id,
    title: meta.title,
    sourcePath,
    content,
    revision: chapterRevision({ ...meta, content } as ChapterDoc, sourcePath)
  }, options)
}

export async function readOutlineSlice(
  store: FileStore,
  ref: { outlineId?: string; chapterId?: string; kind?: 'total' | 'chapter' },
  options: ReadSliceOptions = {}
): Promise<DocumentSlice> {
  const outlines = await listOutline(store)
  let matches = ref.outlineId
    ? outlines.filter((outline) => outline.id === ref.outlineId)
    : ref.chapterId
      ? outlines.filter((outline) => outline.kind === 'chapter' && outline.chapterId === ref.chapterId)
      : ref.kind
        ? outlines.filter((outline) => (outline.kind ?? 'total') === ref.kind)
        : []
  if (!matches.length) throw new DocumentReaderError('NOT_FOUND', '未找到大纲文档')
  if (matches.length > 1) {
    throw new DocumentReaderError('AMBIGUOUS_TARGET', `大纲目标存在多个候选：${matches.map((outline) => `${outline.id} ${outline.title}`).join('；')}`)
  }
  const outline = matches[0]
  const sourcePath = outline.kind === 'chapter'
    ? `outline/chapters/${outline.chapterId ?? 'unknown'}/${outline.id}.md`
    : `outline/total/${outline.id}.md`
  return sliceDocument({
    id: outline.id,
    title: outline.title,
    sourcePath,
    content: outline.content,
    revision: outlineRevision(outline, sourcePath)
  }, options)
}
