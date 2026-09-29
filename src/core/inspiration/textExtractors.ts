import JSZip from 'jszip'
import { SaxesParser, type SaxesTagNS } from 'saxes'

export class TextExtractionError extends Error {
  constructor(readonly status: 'unsupported' | 'failed' | 'too-large', message: string) {
    super(message)
    this.name = 'TextExtractionError'
  }
}

export const MAX_EXTRACTED_TEXT_CHARS = 500_000
export const MAX_DOCX_DOCUMENT_XML_BYTES = 4 * 1024 * 1024
export const MAX_PDF_PAGES = 200
export const MAX_PDF_EXTRACTED_CHARS = MAX_EXTRACTED_TEXT_CHARS

/** Common UTF-8 text formats that are safe to keep in a project's docs folder. */
export const TEXT_EXTRACTION_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'yaml', 'yml', 'xml', 'html', 'htm', 'rtf',
  'css', 'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'py', 'java', 'kt', 'kts', 'go', 'rs', 'rb',
  'php', 'c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'swift', 'sql', 'sh', 'bash', 'zsh', 'bat', 'cmd',
  'ps1', 'vue', 'svelte', 'astro', 'toml', 'ini', 'conf', 'log', 'tex'
])

function extensionOf(path: string): string {
  const lastDot = path.lastIndexOf('.')
  return lastDot === -1 ? '' : path.slice(lastDot + 1).toLowerCase()
}

function tooLarge(message: string): TextExtractionError {
  return new TextExtractionError('too-large', message)
}

function decodeUtf8(bytes: Uint8Array, name: string, maxChars = MAX_EXTRACTED_TEXT_CHARS): string {
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true })
    const chunks: string[] = []
    let chars = 0
    for (let offset = 0; offset < bytes.byteLength; offset += 64 * 1024) {
      const chunk = decoder.decode(bytes.subarray(offset, Math.min(offset + 64 * 1024, bytes.byteLength)), { stream: true })
      chars += chunk.length
      if (chars > maxChars) throw tooLarge(`${name} 文本超过提取上限`)
      chunks.push(chunk)
    }
    const last = decoder.decode()
    chars += last.length
    if (chars > maxChars) throw tooLarge(`${name} 文本超过提取上限`)
    chunks.push(last)
    return chunks.join('')
  } catch (error) {
    if (error instanceof TextExtractionError) throw error
    throw new TextExtractionError('failed', `${name} 不是有效的 UTF-8 文本`)
  }
}

function xmlError(): TextExtractionError {
  return new TextExtractionError('unsupported', 'DOCX document.xml 无效')
}

/** Strict namespace-aware XML parsing, collecting only w:body/w:t text events. */
function extractDocxXml(xml: string): string {
  const paragraphs: string[] = []
  const looseTexts: string[] = []
  const parser = new SaxesParser({ xmlns: true })
  let invalid = false
  let rootName: string | null = null
  let bodyDepth = 0
  let paragraph: string[] | null = null
  let textDepth = 0

  parser.on('error', () => { invalid = true })
  // DOCX does not need a DTD. Rejecting it prevents custom/external entities from
  // entering the parser's entity table even when the document is otherwise well formed.
  parser.on('doctype', () => { invalid = true })
  parser.on('opentag', (tag: SaxesTagNS) => {
    if (rootName === null) rootName = tag.name
    if (tag.name === 'w:body') bodyDepth += 1
    if (tag.name === 'w:p' && bodyDepth > 0) {
      if (paragraph !== null) invalid = true
      paragraph = []
    }
    if (tag.name === 'w:t' && bodyDepth > 0) textDepth += 1
  })
  parser.on('text', (value) => {
    if (textDepth < 1 || bodyDepth < 1) return
    if (paragraph) paragraph.push(value)
    else looseTexts.push(value)
  })
  parser.on('closetag', (tag: SaxesTagNS) => {
    if (tag.name === 'w:t' && textDepth > 0) textDepth -= 1
    if (tag.name === 'w:p' && paragraph) {
      paragraphs.push(paragraph.join(''))
      paragraph = null
    }
    if (tag.name === 'w:body') bodyDepth -= 1
  })

  try {
    parser.write(xml).close()
  } catch {
    invalid = true
  }
  if (invalid || rootName !== 'w:document' || bodyDepth !== 0 || textDepth !== 0 || paragraph !== null) throw xmlError()
  return [...paragraphs, ...looseTexts].filter((value) => value.length > 0).join('\n')
}

async function extractDocx(bytes: Uint8Array): Promise<string> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(bytes, { createFolders: false })
  } catch {
    throw new TextExtractionError('unsupported', '无法读取 DOCX 文件')
  }
  const document = zip.file('word/document.xml')
  if (!document) throw new TextExtractionError('unsupported', 'DOCX 缺少 word/document.xml')

  let xml: string
  try {
    const xmlBytes = await document.async('uint8array')
    if (xmlBytes.byteLength > MAX_DOCX_DOCUMENT_XML_BYTES) throw tooLarge('DOCX document.xml 超过提取上限')
    xml = decodeUtf8(xmlBytes, 'DOCX document.xml')
  } catch (error) {
    if (error instanceof TextExtractionError) throw error
    throw error
  }
  try {
    return extractDocxXml(xml)
  } catch (error) {
    if (error instanceof TextExtractionError) throw error
    throw xmlError()
  }
}

export interface PdfDocumentLike {
  numPages: number
  getPage(pageNumber: number): Promise<{ getTextContent(): Promise<{ items: unknown[] }> }>
  destroy(): Promise<unknown>
}

/** Extract from a loaded PDF document while enforcing page and text budgets. */
export async function extractPdfDocumentText(document: PdfDocumentLike): Promise<string> {
  if (!Number.isInteger(document.numPages) || document.numPages < 0 || document.numPages > MAX_PDF_PAGES) {
    throw tooLarge(`PDF 页数超过 ${MAX_PDF_PAGES} 页上限`)
  }
  const pages: string[] = []
  let chars = 0
  for (let number = 1; number <= document.numPages; number += 1) {
    const page = await document.getPage(number)
    const text = (await page.getTextContent()).items
      .map((item) => item && typeof item === 'object' && 'str' in item && typeof item.str === 'string' ? item.str : '')
      .filter(Boolean)
      .join(' ')
    chars += text.length
    if (chars > MAX_PDF_EXTRACTED_CHARS) throw tooLarge(`PDF 文本超过 ${MAX_PDF_EXTRACTED_CHARS} 字符上限`)
    if (text) pages.push(text)
  }
  return pages.join('\n')
}

async function extractPdf(bytes: Uint8Array): Promise<string> {
  try {
    // The legacy Node entrypoint uses pdf.js's Node fake-worker path and runs unchanged
    // under Vitest's Node environment.
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const loadingTask = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false })
    const document = await loadingTask.promise
    try {
      return await extractPdfDocumentText(document)
    } finally {
      await document.destroy()
    }
  } catch (error) {
    if (error instanceof TextExtractionError) throw error
    throw new TextExtractionError('unsupported', '无法读取或提取 PDF 文件')
  }
}

export function supportsTextExtraction(path: string): boolean {
  const extension = extensionOf(path)
  return TEXT_EXTRACTION_EXTENSIONS.has(extension) || extension === 'docx' || extension === 'pdf'
}

/** Extracts only text present in the source bytes; unsupported formats never get a synthetic fallback. */
export async function extractTextFromBytes(path: string, bytes: Uint8Array): Promise<string> {
  switch (extensionOf(path)) {
    case 'txt':
    case 'md':
    case 'markdown':
    case 'csv':
    case 'tsv':
    case 'json':
    case 'yaml':
    case 'yml':
    case 'xml':
    case 'html':
    case 'htm':
    case 'rtf':
    case 'css':
    case 'js':
    case 'jsx':
    case 'ts':
    case 'tsx':
    case 'mjs':
    case 'cjs':
    case 'py':
    case 'java':
    case 'kt':
    case 'kts':
    case 'go':
    case 'rs':
    case 'rb':
    case 'php':
    case 'c':
    case 'h':
    case 'cc':
    case 'cpp':
    case 'hpp':
    case 'cs':
    case 'swift':
    case 'sql':
    case 'sh':
    case 'bash':
    case 'zsh':
    case 'bat':
    case 'cmd':
    case 'ps1':
    case 'vue':
    case 'svelte':
    case 'astro':
    case 'toml':
    case 'ini':
    case 'conf':
    case 'log':
    case 'tex':
      return decodeUtf8(bytes, path)
    case 'docx':
      return extractDocx(bytes)
    case 'pdf':
      return extractPdf(bytes)
    default:
      throw new TextExtractionError('unsupported', `不支持提取此资料类型：${path}`)
  }
}
