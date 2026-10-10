import JSZip from 'jszip'
import { SaxesParser, type SaxesTagNS } from 'saxes'
import { MAX_EXTRACTED_TEXT_CHARS, TextExtractionError } from './extractionErrors'
import type { ExtractionOptions } from './extractionErrors'

const CONTAINER_NS = 'urn:oasis:names:tc:opendocument:xmlns:container'
const OPF_NS = 'http://www.idpf.org/2007/opf'
const XHTML_NS = 'http://www.w3.org/1999/xhtml'
const ENCRYPTION_NS = 'http://www.w3.org/2001/04/xmlenc#'
const MAX_METADATA_BYTES = 1024 * 1024
const MAX_CHAPTER_BYTES = 4 * 1024 * 1024
const MAX_TOTAL_XML_BYTES = 32 * 1024 * 1024
const MAX_SPINE_ITEMS = 1000
const BLOCKS = new Set(['p', 'div', 'section', 'article', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'ul', 'ol', 'blockquote', 'pre', 'tr', 'br', 'hr'])
const OMIT = new Set(['script', 'style', 'nav', 'svg', 'math', 'noscript'])

function invalid(message: string): never { throw new TextExtractionError('unsupported', `EPUB ${message}`) }
function tooLarge(message: string): never { throw new TextExtractionError('too-large', `EPUB ${message}`) }
function attr(tag: SaxesTagNS, name: string): string { return tag.attributes[name]?.value ?? '' }

/** Resolve only archive-local paths, including percent-encoded EPUB references. */
function archivePath(reference: string, base = ''): string {
  let decoded: string
  try { decoded = decodeURIComponent(reference.split(/[?#]/, 1)[0]) } catch { return invalid('资源路径编码无效') }
  if (!decoded || decoded.startsWith('/') || /[\\:\u0000-\u001f]/.test(decoded)) invalid('资源路径无效或引用了外部资源')
  const segments = base ? base.split('/').slice(0, -1) : []
  for (const segment of decoded.split('/')) {
    if (segment === '..') {
      if (!segments.length) invalid('资源路径越过电子书根目录')
      segments.pop()
    } else if (segment && segment !== '.') segments.push(segment)
  }
  if (!segments.length) invalid('资源路径为空')
  return segments.join('/')
}

interface XmlHandlers {
  open?: (tag: SaxesTagNS, parents: SaxesTagNS[]) => void
  close?: (tag: SaxesTagNS) => void
  text?: (value: string) => void
}

function parseXml(xml: string, root: string, namespace: string, handlers: XmlHandlers, xhtml = false): void {
  const parser = new SaxesParser({ xmlns: true })
  const parents: SaxesTagNS[] = []
  let seenRoot = false
  // EPUB 2 XHTML commonly uses these named entities. Never resolve external DTDs.
  if (xhtml) Object.assign(parser.ENTITIES, { nbsp: '\u00a0', copy: '©', reg: '®', hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”' })
  parser.on('error', () => invalid(`${root} XML 无效`))
  parser.on('doctype', (value) => {
    if (!xhtml || !/^html(?:\s|$)/i.test(value.trim()) || value.includes('[')) invalid('不支持自定义 XML 实体或 DTD')
  })
  parser.on('opentag', (tag) => {
    if (!seenRoot) {
      seenRoot = true
      if (tag.local !== root || (tag.uri !== namespace && !(xhtml && tag.uri === ''))) invalid(`${root} 根元素无效`)
    }
    if (tag.attributes['xml:base']) invalid('暂不支持 xml:base 资源路径')
    handlers.open?.(tag, parents)
    parents.push(tag)
  })
  parser.on('closetag', (tag) => { handlers.close?.(tag); parents.pop() })
  parser.on('text', (value) => handlers.text?.(value))
  parser.on('cdata', (value) => handlers.text?.(value))
  try { parser.write(xml).close() } catch (error) {
    if (error instanceof TextExtractionError) throw error
    invalid(`${root} XML 无效`)
  }
  if (!seenRoot) invalid(`${root} XML 为空`)
}

async function readXml(zip: JSZip, path: string, limit: number, budget: { bytes: number }): Promise<string> {
  const file = zip.file(path)
  if (!file || (file.unsafeOriginalName && file.unsafeOriginalName !== file.name)) invalid(`缺少或无法读取资源：${path}`)
  // JSZip exposes internalStream publicly but omits it from JSZipObject typings.
  const stream = (file as JSZip.JSZipObject & { internalStream(type: 'uint8array'): JSZip.JSZipStreamHelper<Uint8Array> }).internalStream('uint8array')
  const bytes = await new Promise<Uint8Array>((resolve, reject) => {
    const chunks: Uint8Array[] = []
    let size = 0
    let stopped = false
    stream.on('data', (chunk) => {
      if (stopped) return
      size += chunk.byteLength
      budget.bytes += chunk.byteLength
      if (size > limit || budget.bytes > MAX_TOTAL_XML_BYTES) {
        stopped = true
        stream.pause()
        chunks.length = 0
        reject(new TextExtractionError('too-large', `EPUB 资源 ${path} 解压超过 ${limit} 字节或累计 XML 超过 ${MAX_TOTAL_XML_BYTES} 字节，请按卷拆分电子书`))
      } else chunks.push(chunk)
    }).on('error', () => { stopped = true; reject(new TextExtractionError('unsupported', `EPUB 无法解压资源：${path}`)) })
      .on('end', () => {
        if (stopped) return
        const output = new Uint8Array(size)
        let offset = 0
        for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength }
        resolve(output)
      }).resume()
  })
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { return invalid(`资源不是有效 UTF-8 XML：${path}`) }
}

function chapterText(xml: string, maxChars: number): string {
  const parts: string[] = []
  let bodyDepth = 0
  let omitDepth = 0
  let chars = 0
  parseXml(xml, 'html', XHTML_NS, {
    open: (tag) => {
      if (tag.local === 'body') bodyDepth++
      if (omitDepth || OMIT.has(tag.local) || 'hidden' in tag.attributes || attr(tag, 'aria-hidden') === 'true') omitDepth++
      if (bodyDepth && !omitDepth && BLOCKS.has(tag.local)) parts.push('\n')
      if (bodyDepth && !omitDepth && (tag.local === 'td' || tag.local === 'th')) parts.push(' ')
    },
    close: (tag) => {
      if (bodyDepth && !omitDepth && BLOCKS.has(tag.local)) parts.push('\n')
      if (omitDepth) omitDepth--
      if (tag.local === 'body') bodyDepth--
    },
    text: (value) => {
      if (!bodyDepth || omitDepth) return
      chars += value.length
      if (chars > maxChars) tooLarge(`正文超过 ${maxChars} 字符提取上限，请拆分电子书`)
      parts.push(value.replace(/\s+/g, ' '))
    }
  }, true)
  return parts.join('').split('\n').map((line) => line.replace(/[ \t\u00a0]+/g, ' ').trim()).filter(Boolean).join('\n')
}

/** EPUB 2/3: read the package spine, never enumerate ZIP files as reading order. */
export async function extractEpub(bytes: Uint8Array, options: ExtractionOptions = {}): Promise<string> {
  const maxChars = options.maxChars ?? MAX_EXTRACTED_TEXT_CHARS
  let zip: JSZip
  try { zip = await JSZip.loadAsync(bytes, { createFolders: false }) } catch { return invalid('无法读取电子书文件') }
  const budget = { bytes: 0 }
  let packagePath = ''
  parseXml(await readXml(zip, 'META-INF/container.xml', MAX_METADATA_BYTES, budget), 'container', CONTAINER_NS, {
    open: (tag, parents) => {
      if (!packagePath && tag.uri === CONTAINER_NS && tag.local === 'rootfile' && parents[parents.length - 1]?.local === 'rootfiles' && attr(tag, 'media-type') === 'application/oebps-package+xml') packagePath = archivePath(attr(tag, 'full-path'))
    }
  })
  if (!packagePath) invalid('缺少 OPF 包文档')
  const manifest = new Map<string, { href: string; media: string; nav: boolean }>()
  const spine: string[] = []
  parseXml(await readXml(zip, packagePath, MAX_METADATA_BYTES, budget), 'package', OPF_NS, {
    open: (tag, parents) => {
      if (tag.uri !== OPF_NS) return
      if (tag.local === 'item' && parents[parents.length - 1]?.local === 'manifest') {
        const id = attr(tag, 'id')
        if (!id || manifest.has(id)) invalid('manifest 资源 ID 无效或重复')
        manifest.set(id, { href: attr(tag, 'href'), media: attr(tag, 'media-type'), nav: attr(tag, 'properties').split(/\s+/).includes('nav') })
      }
      if (tag.local === 'itemref' && parents[parents.length - 1]?.local === 'spine' && attr(tag, 'linear') !== 'no') {
        spine.push(attr(tag, 'idref'))
        if (spine.length > MAX_SPINE_ITEMS) tooLarge('章节数量超过 1000 章提取上限，请按卷拆分电子书')
      }
    }
  })
  if (!spine.length) invalid('缺少正文阅读顺序 spine')
  const encrypted = new Set<string>()
  if (zip.file('META-INF/encryption.xml')) {
    parseXml(await readXml(zip, 'META-INF/encryption.xml', MAX_METADATA_BYTES, budget), 'encryption', CONTAINER_NS, {
      open: (tag) => {
        if (tag.uri === ENCRYPTION_NS && tag.local === 'CipherReference') encrypted.add(archivePath(attr(tag, 'URI')))
      }
    })
  }
  if (encrypted.has(packagePath)) invalid('OPF 包文档已加密，暂不支持 DRM 电子书')
  const chapters: string[] = []
  const read = new Set<string>()
  let chars = 0
  for (const id of spine) {
    const item = manifest.get(id)
    if (!item) invalid(`spine 引用了不存在的资源：${id}`)
    if (item.nav) continue
    if (item.media !== 'application/xhtml+xml') invalid(`暂不支持正文资源类型：${item.media}`)
    const path = archivePath(item.href, packagePath)
    if (encrypted.has(path)) invalid('正文已加密，暂不支持 DRM 电子书')
    if (read.has(path)) continue
    read.add(path)
    const text = chapterText(await readXml(zip, path, MAX_CHAPTER_BYTES, budget), maxChars)
    if (!text) continue
    chars += text.length + (chapters.length ? 2 : 0)
    if (chars > maxChars) tooLarge(`正文超过 ${maxChars} 字符提取上限，请拆分电子书`)
    chapters.push(text)
    options.onPart?.({ title: text.split('\n', 1)[0].slice(0, 120), text })
  }
  if (!chapters.length) invalid('没有可提取的正文文本；图片电子书需先转换为文字')
  return chapters.join('\n\n')
}
