import type { InspirationExtraction, InspirationImport, InspirationOrigin, InspirationSource } from '../../shared/inspiration'
import type { FileStore } from '../storage/fileStore'
import { InspirationError } from './sourceErrors'
import { TextExtractionError, extractTextFromBytes, supportsTextExtraction } from './textExtractors'

export { InspirationError } from './sourceErrors'

export const MAX_INSPIRATION_SOURCE_BYTES = 100 * 1024 * 1024
export const MAX_INSPIRATION_TOTAL_BYTES = 100 * 1024 * 1024
export const MAX_INSPIRATION_EXTRACTED_CHARS = 500_000
export const MAX_INSPIRATION_MODEL_CHARS = 80_000

const LIBRARY_ROOT = 'inspiration'
const IMPORTED_ROOT = `${LIBRARY_ROOT}/imported`
const CATALOG_PATH = '.storyfabric/inspiration/catalog.json'
const EXTRACTED_ROOT = '.storyfabric/inspiration/extracted'
const WINDOWS_RESERVED_SEGMENT = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i
const catalogLocks = new WeakMap<FileStore, Promise<void>>()

interface ImportedCatalogEntry {
  id: string
  name: string
  relativePath: string
  importedAt: number
}

interface ExtractionCatalogEntry {
  revision: string
  extraction: InspirationExtraction
  extractedChars?: number
}

interface CatalogFile {
  version: 1
  imported: Record<string, ImportedCatalogEntry>
  extraction: Record<string, ExtractionCatalogEntry>
}

interface ExtractedCache {
  version: 1
  sourceId: string
  relativePath: string
  revision: string
  text: string
}

export interface ReadExtractedOptions {
  maxChars?: number
}

function emptyCatalog(): CatalogFile {
  return { version: 1, imported: {}, extraction: {} }
}

async function withCatalogWriteLock<T>(files: FileStore, operation: () => Promise<T>): Promise<T> {
  const previous = catalogLocks.get(files)
  let release!: () => void
  const current = new Promise<void>((resolve) => { release = resolve })
  catalogLocks.set(files, current)
  if (previous) await previous.catch(() => undefined)
  try {
    return await operation()
  } finally {
    release()
    if (catalogLocks.get(files) === current) catalogLocks.delete(files)
  }
}

function extensionOf(path: string): string {
  const dot = path.lastIndexOf('.')
  return dot === -1 ? '' : path.slice(dot + 1).toLowerCase()
}

function sourceRevision(bytes: Uint8Array): string {
  let hash = 0x811c9dc5
  for (const byte of bytes) {
    hash ^= byte
    hash = Math.imul(hash, 0x01000193)
  }
  return `${bytes.byteLength.toString(36)}-${(hash >>> 0).toString(36)}`
}

function libraryId(relativePath: string): string {
  const bytes = new TextEncoder().encode(relativePath.normalize('NFC'))
  return `library_${sourceRevision(bytes).replace(/[^a-z0-9_-]/gi, '_')}`
}

function isSafeSegment(segment: string): boolean {
  return Boolean(segment)
    && segment !== '.'
    && segment !== '..'
    && !/[<>:"|?*\u0000-\u001f]/.test(segment)
    && !/[. ]$/.test(segment)
    && !WINDOWS_RESERVED_SEGMENT.test(segment)
}

function safeRelativeName(value: string): string {
  const normalized = String(value).replace(/\\/g, '/')
  if (!normalized || normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized)) {
    throw new InspirationError('INVALID_PATH', '导入资料必须使用工作区内的相对文件名')
  }
  const parts = normalized.split('/')
  if (parts.some((part) => !isSafeSegment(part))) {
    throw new InspirationError('INVALID_PATH', '导入资料包含不安全的路径段')
  }
  return parts.join('/')
}

/** An imported directory becomes removable only when this exact record proves its provenance. */
function importedRecordPath(id: string, record: ImportedCatalogEntry | undefined): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(id) || !record || record.id !== id || typeof record.name !== 'string' || typeof record.relativePath !== 'string' || !Number.isFinite(record.importedAt)) return null
  try {
    const path = `${IMPORTED_ROOT}/${id}/${safeRelativeName(record.name)}`
    return record.relativePath === path ? path : null
  } catch {
    return null
  }
}

function safeSlice(text: string, maxChars: number): string {
  let end = Math.min(text.length, maxChars)
  if (end > 0 && end < text.length) {
    const before = text.charCodeAt(end - 1)
    const after = text.charCodeAt(end)
    if (before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff) end -= 1
  }
  return text.slice(0, end)
}

function parseCatalog(raw: string | null): CatalogFile {
  if (raw === null) return emptyCatalog()
  try {
    const parsed = JSON.parse(raw) as Partial<CatalogFile>
    if (parsed.version !== 1 || !parsed.imported || !parsed.extraction || typeof parsed.imported !== 'object' || typeof parsed.extraction !== 'object') return emptyCatalog()
    return { version: 1, imported: parsed.imported, extraction: parsed.extraction }
  } catch {
    return emptyCatalog()
  }
}

function parseCache(raw: string | null): ExtractedCache | null {
  if (raw === null) return null
  try {
    const parsed = JSON.parse(raw) as Partial<ExtractedCache>
    if (parsed.version !== 1 || typeof parsed.sourceId !== 'string' || typeof parsed.relativePath !== 'string' || typeof parsed.revision !== 'string' || typeof parsed.text !== 'string') return null
    return parsed as ExtractedCache
  } catch {
    return null
  }
}

export class SourceCatalog {
  private importCounter = 0

  constructor(private readonly files: FileStore) {}

  private cachePath(id: string): string {
    return `${EXTRACTED_ROOT}/${id}.json`
  }

  private async loadCatalog(): Promise<CatalogFile> {
    return parseCatalog(await this.files.readText(CATALOG_PATH))
  }

  private async saveCatalog(catalog: CatalogFile): Promise<void> {
    await this.files.ensureDir('.storyfabric/inspiration')
    await this.files.writeText(CATALOG_PATH, JSON.stringify(catalog, null, 2))
  }

  private async walkFiles(dir: string): Promise<string[]> {
    const files = (await this.files.listFiles(dir)).map((name) => `${dir}/${name}`)
    for (const child of await this.files.listDirs(dir)) {
      if (!isSafeSegment(child)) continue
      files.push(...await this.walkFiles(`${dir}/${child}`))
    }
    return files.sort()
  }

  private async rawSource(path: string, id: string, displayName: string, origin: InspirationOrigin, importedAt: number | undefined, catalog: CatalogFile): Promise<InspirationSource | null> {
    const metadataSize = await this.files.fileSize(path)
    if (metadataSize !== null && metadataSize > MAX_INSPIRATION_SOURCE_BYTES) {
      return {
        id,
        relativePath: path,
        displayName,
        origin,
        size: metadataSize,
        extraction: 'too-large',
        ...(importedAt === undefined ? {} : { importedAt })
      }
    }
    const bytes = await this.files.readBytes(path)
    if (bytes === null) return null
    const revision = sourceRevision(bytes)
    const remembered = catalog.extraction[id]
    let extraction: InspirationExtraction = !supportsTextExtraction(path)
      ? 'unsupported'
      : bytes.byteLength > MAX_INSPIRATION_SOURCE_BYTES
        ? 'too-large'
        : 'ready'
    let extractedChars: number | undefined
    if (remembered?.revision === revision && remembered.extraction !== 'ready') extraction = remembered.extraction
    if (extraction === 'ready') {
      const cache = parseCache(await this.files.readText(this.cachePath(id)))
      if (cache?.sourceId === id && cache.relativePath === path && cache.revision === revision) extractedChars = cache.text.length
    }
    return {
      id,
      relativePath: path,
      displayName,
      origin,
      size: metadataSize ?? bytes.byteLength,
      extraction,
      ...(extractedChars === undefined ? {} : { extractedChars }),
      ...(importedAt === undefined ? {} : { importedAt })
    }
  }

  private async discoveredSources(catalog: CatalogFile): Promise<InspirationSource[]> {
    const imported = new Map<string, { path: string; record: ImportedCatalogEntry }>()
    for (const [id, record] of Object.entries(catalog.imported)) {
      const path = importedRecordPath(id, record)
      if (path) imported.set(id, { path, record })
    }
    const importedPaths = new Set([...imported.values()].map((entry) => entry.path))
    const libraryPaths = (await this.walkFiles(LIBRARY_ROOT)).filter((path) => !importedPaths.has(path))
    const sources: InspirationSource[] = []
    for (const path of libraryPaths) {
      const source = await this.rawSource(path, libraryId(path), path.slice(path.lastIndexOf('/') + 1), 'library', undefined, catalog)
      if (source) sources.push(source)
    }

    for (const [id, { path, record }] of imported) {
      const source = await this.rawSource(path, id, record.name.slice(record.name.lastIndexOf('/') + 1), 'imported', record.importedAt, catalog)
      if (source) sources.push(source)
    }
    return sources.sort((a, b) => a.origin.localeCompare(b.origin) || a.relativePath.localeCompare(b.relativePath))
  }

  private async find(id: string, catalog?: CatalogFile): Promise<InspirationSource> {
    const source = (await this.discoveredSources(catalog ?? await this.loadCatalog())).find((candidate) => candidate.id === id)
    if (!source) throw new InspirationError('NOT_FOUND', '未找到灵感资料')
    return source
  }

  private async recordExtraction(source: InspirationSource, revision: string, extraction: InspirationExtraction, extractedChars?: number): Promise<void> {
    const catalog = await this.loadCatalog()
    catalog.extraction[source.id] = {
      revision,
      extraction,
      ...(extractedChars === undefined ? {} : { extractedChars })
    }
    await this.saveCatalog(catalog)
  }

  async list(): Promise<InspirationSource[]> {
    return this.discoveredSources(await this.loadCatalog())
  }

  async importBytes(input: InspirationImport): Promise<InspirationSource> {
    return withCatalogWriteLock(this.files, () => this.importBytesUnlocked(input))
  }

  private async importBytesUnlocked(input: InspirationImport): Promise<InspirationSource> {
    const name = safeRelativeName(input.name)
    const bytes = input.bytes instanceof Uint8Array ? input.bytes : new Uint8Array(input.bytes)
    if (!supportsTextExtraction(name)) throw new InspirationError('UNSUPPORTED', '只支持导入常见文本、DOCX 或 PDF 资料')
    if (!bytes.byteLength) throw new InspirationError('UNSUPPORTED', '不能导入空资料')
    if (bytes.byteLength > MAX_INSPIRATION_SOURCE_BYTES) throw new InspirationError('TOO_LARGE', '单份灵感资料不能超过 100 MiB')

    const existingBytes = (await this.list()).reduce((sum, source) => sum + source.size, 0)
    if (existingBytes + bytes.byteLength > MAX_INSPIRATION_TOTAL_BYTES) {
      throw new InspirationError('TOO_LARGE', '灵感资料总量不能超过 100 MiB')
    }

    const catalog = await this.loadCatalog()
    let id: string
    do {
      id = `source_${Date.now().toString(36)}_${(++this.importCounter).toString(36)}_${Math.floor(Math.random() * 0xffff).toString(36)}`
    } while (catalog.imported[id] || await this.files.exists(`${IMPORTED_ROOT}/${id}`))
    const relativePath = `${IMPORTED_ROOT}/${id}/${name}`
    await this.files.writeBytes(relativePath, bytes)
    const importedAt = Date.now()
    catalog.imported[id] = { id, name, relativePath, importedAt }
    await this.saveCatalog(catalog)
    return {
      id,
      relativePath,
      displayName: name.slice(name.lastIndexOf('/') + 1),
      origin: 'imported',
      size: bytes.byteLength,
      extraction: 'ready',
      importedAt
    }
  }

  async removeImported(id: string): Promise<void> {
    return withCatalogWriteLock(this.files, () => this.removeImportedUnlocked(id))
  }

  private async removeImportedUnlocked(id: string): Promise<void> {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new InspirationError('INVALID_PATH', '无效的导入资料 ID')
    const catalog = await this.loadCatalog()
    const sourcePath = importedRecordPath(id, catalog.imported[id])
    if (!sourcePath || !await this.files.exists(sourcePath)) {
      const existing = await this.find(id, catalog).catch((error: unknown) => error instanceof InspirationError && error.code === 'NOT_FOUND' ? null : Promise.reject(error))
      if (existing?.origin === 'library') throw new InspirationError('INVALID_PATH', '手工资料不能由导入资料删除接口移除')
      throw new InspirationError('NOT_FOUND', '未找到可删除的导入资料')
    }
    // Delete the single catalog-provenanced file only; adjacent hand-placed files stay intact.
    await this.files.removeFile(sourcePath)
    await this.files.remove(this.cachePath(id))
    delete catalog.imported[id]
    delete catalog.extraction[id]
    await this.saveCatalog(catalog)
  }

  async extract(id: string): Promise<InspirationSource> {
    return withCatalogWriteLock(this.files, () => this.extractUnlocked(id))
  }

  private async extractUnlocked(id: string): Promise<InspirationSource> {
    const catalog = await this.loadCatalog()
    const source = await this.find(id, catalog)
    if (source.extraction === 'unsupported' || source.extraction === 'too-large') return source
    const bytes = await this.files.readBytes(source.relativePath)
    if (bytes === null) throw new InspirationError('NOT_FOUND', '灵感资料已不存在')
    const revision = sourceRevision(bytes)
    try {
      const text = await extractTextFromBytes(source.relativePath, bytes)
      if (text.length > MAX_INSPIRATION_EXTRACTED_CHARS) {
        await this.files.remove(this.cachePath(id))
        await this.recordExtraction(source, revision, 'too-large')
        return { ...source, extraction: 'too-large' }
      }
      const rechecked = await this.files.readBytes(source.relativePath)
      if (rechecked === null || sourceRevision(rechecked) !== revision) {
        await this.files.remove(this.cachePath(id))
        throw new InspirationError('SOURCE_CHANGED', '灵感资料在提取期间已变化')
      }
      await this.files.ensureDir(EXTRACTED_ROOT)
      const cache: ExtractedCache = { version: 1, sourceId: id, relativePath: source.relativePath, revision, text }
      await this.files.writeText(this.cachePath(id), JSON.stringify(cache))
      await this.recordExtraction(source, revision, 'ready', text.length)
      return { ...source, extraction: 'ready', extractedChars: text.length }
    } catch (error) {
      if (!(error instanceof TextExtractionError)) throw error
      await this.files.remove(this.cachePath(id))
      const extraction = error.status === 'too-large' ? 'too-large' : error.status === 'unsupported' ? 'unsupported' : 'failed'
      await this.recordExtraction(source, revision, extraction)
      return { ...source, extraction }
    }
  }

  async readExtracted(id: string, options: ReadExtractedOptions | number = {}): Promise<string> {
    const maxChars = typeof options === 'number' ? options : options.maxChars ?? MAX_INSPIRATION_MODEL_CHARS
    if (!Number.isInteger(maxChars) || maxChars < 1) throw new InspirationError('INVALID_PATH', 'maxChars 必须是正整数')
    if (maxChars > MAX_INSPIRATION_MODEL_CHARS) throw new InspirationError('TOO_LARGE', `模型读取上限为 ${MAX_INSPIRATION_MODEL_CHARS} 字符`)
    const source = await this.find(id)
    if (source.extraction === 'too-large') throw new InspirationError('TOO_LARGE', '灵感资料提取内容超过上限')
    if (source.extraction === 'unsupported' || source.extraction === 'failed') {
      throw new InspirationError('UNSUPPORTED', '灵感资料当前无法提取为文本')
    }
    const before = await this.files.readBytes(source.relativePath)
    if (before === null) throw new InspirationError('NOT_FOUND', '灵感资料已不存在')
    const beforeRevision = sourceRevision(before)
    const cache = parseCache(await this.files.readText(this.cachePath(id)))
    if (!cache) throw new InspirationError('NOT_FOUND', '灵感资料尚未提取')
    const after = await this.files.readBytes(source.relativePath)
    if (after === null) throw new InspirationError('NOT_FOUND', '灵感资料已不存在')
    if (beforeRevision !== sourceRevision(after) || cache.sourceId !== id || cache.relativePath !== source.relativePath || cache.revision !== beforeRevision) {
      await this.files.remove(this.cachePath(id))
      throw new InspirationError('SOURCE_CHANGED', '灵感资料已变化，请重新提取')
    }
    return safeSlice(cache.text, maxChars)
  }
}
