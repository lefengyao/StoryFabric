import { extractTextFromBytes, TextExtractionError } from './textExtractors'

export const MAX_INDEXED_DOCUMENT_CHARS = 10_000_000
export const MAX_INDEXED_PDF_PAGES = 2000
export const DOCUMENT_SECTION_CHARS = 32_000
export const MAX_DOCUMENT_SECTIONS = 20_000

export interface DocumentSection { id: string; title: string; start: number; end: number }
export interface IndexedDocument { text: string; sections: DocumentSection[] }
export interface RevisionedDocument extends IndexedDocument { revision: string }

function splitBoundary(text: string, start: number, end: number): number {
  if (end < text.length && /[\ud800-\udbff]/.test(text[end - 1]) && /[\udc00-\udfff]/.test(text[end])) end--
  if (end <= start) throw new Error('读取长度无法容纳一个完整字符，请增大 maxChars')
  return end
}

export function sliceDocumentText(text: string, offset: number, maxChars: number): string {
  if (offset >= text.length) return ''
  if (offset > 0 && /[\udc00-\udfff]/.test(text[offset]) && /[\ud800-\udbff]/.test(text[offset - 1])) throw new Error('offset 位于字符中间，请使用返回的 nextOffset')
  return text.slice(offset, splitBoundary(text, offset, Math.min(text.length, offset + maxChars)))
}

/** Boundaries cover the complete text, including whitespace between source chapters. */
export function indexDocumentText(text: string, parts: Array<{ title: string; start: number }> = []): IndexedDocument {
  if (text.length > MAX_INDEXED_DOCUMENT_CHARS) throw new TextExtractionError('too-large', `正文超过 ${MAX_INDEXED_DOCUMENT_CHARS} 字符索引上限，请按卷拆分资料后导入`)
  if (!parts.length) {
    const headings = /^(?:#{1,6}[ \t]+[^\r\n]+|第[〇零一二三四五六七八九十百千万两\d]+[章节卷回部篇][^\r\n]*|chapter[ \t]+\d+[^\r\n]*)/gim
    for (const match of text.matchAll(headings)) {
      if (parts.length >= MAX_DOCUMENT_SECTIONS) throw new TextExtractionError('too-large', '标题数量超过 20000 个索引上限，请按卷拆分资料')
      parts.push({ title: match[0].slice(0, 100), start: match.index })
    }
  }
  if (!parts.length || parts[0].start !== 0) parts.unshift({ title: '正文', start: 0 })
  const sections: DocumentSection[] = []
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    const stop = parts[i + 1]?.start ?? text.length
    let start = part.start
    let number = 1
    while (start < stop) {
      let end = Math.min(stop, start + DOCUMENT_SECTION_CHARS)
      if (end < stop) {
        const newline = text.lastIndexOf('\n', end - 1)
        if (newline > start + DOCUMENT_SECTION_CHARS / 2) end = newline + 1
      }
      end = splitBoundary(text, start, end)
      const title = `${part.title.slice(0, 100)}${number > 1 ? `（片段 ${number}）` : ''}`
      if (sections.length >= MAX_DOCUMENT_SECTIONS) throw new TextExtractionError('too-large', '资料片段数量超过 20000 个索引上限，请按卷拆分资料')
      sections.push({ id: `s${sections.length + 1}`, title, start, end })
      start = end
      number++
    }
  }
  return { text, sections }
}

export async function extractIndexedDocument(path: string, bytes: Uint8Array): Promise<IndexedDocument> {
  const parts: Array<{ title: string; text: string }> = []
  const text = await extractTextFromBytes(path, bytes, {
    maxChars: MAX_INDEXED_DOCUMENT_CHARS,
    maxPdfPages: MAX_INDEXED_PDF_PAGES,
    maxDocxXmlBytes: 32 * 1024 * 1024,
    onPart: (part) => parts.push(part)
  })
  if (path.toLowerCase().endsWith('.pdf') && !text.trim()) throw new TextExtractionError('unsupported', 'PDF 没有可提取的文本；扫描件需先进行 OCR 转换')
  let cursor = 0
  const boundaries = parts.map((part) => {
    const start = text.indexOf(part.text, cursor)
    if (start < 0) throw new Error('提取正文与章节索引不一致')
    cursor = start + part.text.length
    return { title: part.title, start }
  })
  return indexDocumentText(text, boundaries)
}

export function validDocumentIndex(value: unknown): value is IndexedDocument {
  if (!value || typeof value !== 'object') return false
  const doc = value as IndexedDocument
  if (typeof doc.text !== 'string' || doc.text.length > MAX_INDEXED_DOCUMENT_CHARS || !Array.isArray(doc.sections) || doc.sections.length > MAX_DOCUMENT_SECTIONS) return false
  let end = 0
  for (let i = 0; i < doc.sections.length; i++) {
    const section = doc.sections[i]
    if (!section || section.id !== `s${i + 1}` || typeof section.title !== 'string' || section.title.length > 120 || section.start !== end || !Number.isInteger(section.end) || section.end <= end || section.end > doc.text.length || section.end - end > DOCUMENT_SECTION_CHARS) return false
    end = section.end
  }
  return end === doc.text.length
}

export function listDocumentSections(doc: RevisionedDocument, offset = 0, limit = 50): object {
  integer(offset, 0, Number.MAX_SAFE_INTEGER, 'offset')
  integer(limit, 1, 100, 'limit')
  return { revision: doc.revision, totalChars: doc.text.length, sectionCount: doc.sections.length, sections: doc.sections.slice(offset, offset + limit), ...(offset + limit < doc.sections.length ? { nextOffset: offset + limit } : {}) }
}

export function readDocumentSection(doc: RevisionedDocument, sectionId: unknown, offset = 0, maxChars = 4000): { content: string; [key: string]: unknown } {
  integer(offset, 0, Number.MAX_SAFE_INTEGER, 'offset')
  integer(maxChars, 1, 20_000, 'maxChars')
  const section = doc.sections.find((item) => item.id === sectionId)
  if (!section) throw new Error('未找到章节片段，请先调用 list_document_sections')
  const text = doc.text.slice(section.start, section.end)
  const content = sliceDocumentText(text, offset, maxChars)
  const next = offset + content.length
  return { revision: doc.revision, sectionId, title: section.title, offset, totalChars: text.length, content, truncated: next < text.length, ...(next < text.length ? { nextOffset: next } : {}) }
}

export function searchDocument(doc: RevisionedDocument, query: unknown, offset = 0, limit = 10): object {
  if (typeof query !== 'string' || !query.trim() || query.length > 200) throw new Error('query 必须为 1-200 字符的关键词')
  integer(offset, 0, Number.MAX_SAFE_INTEGER, 'offset')
  integer(limit, 1, 20, 'limit')
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu')
  pattern.lastIndex = offset
  const hits: Array<{ sectionId: string; title: string; offset: number; sectionOffset: number; snippet: string }> = []
  let match: RegExpExecArray | null
  let nextOffset: number | undefined
  while ((match = pattern.exec(doc.text))) {
    if (hits.length === limit) { nextOffset = match.index; break }
    const section = doc.sections.find((item) => item.start <= match!.index && item.end > match!.index)
    if (!section) continue
    hits.push({ sectionId: section.id, title: section.title, offset: match.index, sectionOffset: match.index - section.start, snippet: doc.text.slice(Math.max(section.start, match.index - 120), Math.min(section.end, match.index + match[0].length + 120)) })
  }
  return { revision: doc.revision, query, hits, ...(nextOffset === undefined ? {} : { nextOffset }) }
}

function integer(value: number, min: number, max: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${name} 必须在 ${min}-${max} 之间`)
}
