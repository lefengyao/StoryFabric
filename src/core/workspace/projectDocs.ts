import type { FileStore } from '../storage/fileStore'
import { bytesContentRevision, contentRevision } from './resourceRevision'
import { extractTextFromBytes, supportsTextExtraction, TextExtractionError } from '../inspiration/textExtractors'

export const PROJECT_DOC_MAX_BYTES = 100 * 1024 * 1024
export const PROJECT_DOC_DEFAULT_CHARS = 20_000
export const PROJECT_DOC_MAX_CHARS = 50_000
export const PROJECT_DOC_DEFAULT_LIMIT = 50
export const PROJECT_DOC_MAX_LIMIT = 100

const encoder = new TextEncoder()
const RESERVED_NAMES = /^(con|prn|aux|nul|clock\$|com[1-9]|lpt[1-9])(?:\.[^.]*)?$/i

export interface ProjectDocEntry {
  path: string
  size: number
  readable: boolean
  format: 'text' | 'docx' | 'pdf' | 'unsupported'
}
export interface ProjectDocList { files: ProjectDocEntry[]; nextOffset?: number }
export interface ProjectDocRead { sourcePath: string; writeRevision: string; revision: string; fileRevision: string; content: string; nextOffset?: number; truncated: boolean }

function fail(message: string): never { throw new Error(message) }

function extensionOf(path: string): string {
  const dot = path.lastIndexOf('.')
  return dot === -1 ? '' : path.slice(dot + 1).toLowerCase()
}

function formatOf(path: string): ProjectDocEntry['format'] {
  const extension = extensionOf(path)
  if (extension === 'docx') return 'docx'
  if (extension === 'pdf') return 'pdf'
  return supportsTextExtraction(path) ? 'text' : 'unsupported'
}

function textPath(path: string): string { return `docs/${path}` }

function safeSegments(value: string): string[] {
  const normalized = value.replace(/\\/g, '/')
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized) || normalized.includes('\0')) {
    fail('path 必须是 docs 目录下的相对文件路径')
  }
  const segments = normalized.split('/').filter(Boolean)
  if (!segments.length || segments.some((segment) => segment === '.' || segment === '..' || RESERVED_NAMES.test(segment) || /[<>:"|?*\u0000-\u001f]/.test(segment) || /[. ]$/.test(segment))) {
    fail('path 包含不安全的路径段')
  }
  return segments
}

export function normalizeProjectDocPath(value: unknown, options: { readable?: boolean } = {}): string {
  if (typeof value !== 'string' || !value || value !== value.trim()) fail('path 必须是 docs 目录下的文件路径')
  const path = safeSegments(value.trim()).join('/')
  if (options.readable && !supportsTextExtraction(path)) fail('项目文档暂不支持此文件类型；请使用常见文本、DOCX 或 PDF 文件')
  return path
}

async function listDocPaths(store: FileStore, dir = 'docs'): Promise<string[]> {
  const paths = (await store.listFiles(dir)).map((name) => `${dir}/${name}`)
  for (const child of await store.listDirs(dir)) paths.push(...await listDocPaths(store, `${dir}/${child}`))
  return paths.map((path) => path.slice('docs/'.length)).sort((a, b) => a.localeCompare(b, 'zh-CN'))
}

export async function listProjectDocs(store: FileStore, offset = 0, limit = PROJECT_DOC_DEFAULT_LIMIT): Promise<ProjectDocList> {
  if (!Number.isInteger(offset) || offset < 0) fail('offset 必须是非负整数')
  if (!Number.isInteger(limit) || limit < 1 || limit > PROJECT_DOC_MAX_LIMIT) fail(`limit 必须在 1-${PROJECT_DOC_MAX_LIMIT} 之间`)
  const names = await listDocPaths(store)
  const files: ProjectDocEntry[] = []
  for (const name of names.slice(offset, offset + limit)) {
    const path = textPath(name)
    const size = await store.fileSize(path)
    if (size === null) continue
    const format = formatOf(name)
    files.push({ path: name, size, readable: format !== 'unsupported' && size <= PROJECT_DOC_MAX_BYTES, format })
  }
  const nextOffset = offset + limit < names.length ? offset + limit : undefined
  return nextOffset === undefined ? { files } : { files, nextOffset }
}

export async function readProjectDoc(store: FileStore, rawPath: unknown, offset = 0, maxChars = PROJECT_DOC_DEFAULT_CHARS): Promise<ProjectDocRead> {
  const path = normalizeProjectDocPath(rawPath, { readable: true })
  if (!Number.isInteger(offset) || offset < 0) fail('offset 必须是非负整数')
  if (!Number.isInteger(maxChars) || maxChars < 1 || maxChars > PROJECT_DOC_MAX_CHARS) fail(`maxChars 必须在 1-${PROJECT_DOC_MAX_CHARS} 之间`)
  const source = textPath(path)
  const size = await store.fileSize(source)
  if (size === null) fail(`未找到项目文档：${path}`)
  if (size > PROJECT_DOC_MAX_BYTES) fail(`项目文档超过 ${PROJECT_DOC_MAX_BYTES} 字节限制：${path}`)
  const raw = await store.readBytes(source)
  if (raw === null) fail(`未找到项目文档：${path}`)
  let content: string
  try {
    content = await extractTextFromBytes(path, raw)
  } catch (error) {
    if (error instanceof TextExtractionError) fail(error.message)
    throw error
  }
  const slice = content.slice(offset, offset + maxChars)
  const nextOffset = offset + slice.length < content.length ? offset + slice.length : undefined
  const writeRevision = contentRevision(content)
  const fileRevision = formatOf(path) === 'text' ? writeRevision : bytesContentRevision(raw)
  return { sourcePath: path, writeRevision, revision: writeRevision, fileRevision, content: slice, ...(nextOffset === undefined ? {} : { nextOffset }), truncated: nextOffset !== undefined }
}

export interface ProjectDocSnapshot { path: string; beforeText: string; afterText: string; existed: boolean }

export interface ProjectDocRenameSnapshot {
  fromPath: string
  toPath: string
  beforeRevision: string
}

async function projectDocBytes(store: FileStore, path: string): Promise<Uint8Array> {
  const bytes = await store.readBytes(textPath(path))
  if (bytes === null) fail(`未找到项目文档：${path}`)
  if (bytes.byteLength > PROJECT_DOC_MAX_BYTES) fail(`项目文档超过 ${PROJECT_DOC_MAX_BYTES} 字节限制：${path}`)
  return bytes
}

async function projectDocRevision(store: FileStore, path: string, bytes: Uint8Array): Promise<string> {
  if (formatOf(path) !== 'text') return bytesContentRevision(bytes)
  const text = await store.readText(textPath(path))
  return text === null ? bytesContentRevision(bytes) : contentRevision(text)
}

export async function snapshotProjectDocRename(store: FileStore, rawFromPath: unknown, rawToPath: unknown, expectedRevision: unknown): Promise<ProjectDocRenameSnapshot> {
  const fromPath = normalizeProjectDocPath(rawFromPath)
  const toPath = normalizeProjectDocPath(rawToPath)
  if (fromPath === toPath) fail('源路径和目标路径不能相同')
  const before = await projectDocBytes(store, fromPath)
  if (await store.exists(textPath(toPath))) fail(`目标项目文档已存在：${toPath}`)
  const beforeRevision = await projectDocRevision(store, fromPath, before)
  // A caller must pass the revision returned by read_project_doc. For binary
  // docs this is fileRevision; for text docs it equals writeRevision.
  if (typeof expectedRevision !== 'string' || expectedRevision !== beforeRevision) fail('项目文档版本已变化，请重新读取后重命名')
  return { fromPath, toPath, beforeRevision }
}

export async function applyProjectDocRename(store: FileStore, snapshot: ProjectDocRenameSnapshot): Promise<{ ok: boolean; text: string }> {
  let source: Uint8Array
  try {
    source = await projectDocBytes(store, snapshot.fromPath)
  } catch {
    return { ok: false, text: `项目文档已不存在，未重命名：${snapshot.fromPath}` }
  }
  if (await projectDocRevision(store, snapshot.fromPath, source) !== snapshot.beforeRevision) return { ok: false, text: `项目文档已被修改，未重命名：${snapshot.fromPath}` }
  if (await store.exists(textPath(snapshot.toPath))) return { ok: false, text: `目标项目文档已存在，未重命名：${snapshot.toPath}` }
  await store.move(textPath(snapshot.fromPath), textPath(snapshot.toPath))
  return { ok: true, text: `已将项目文档「${snapshot.fromPath}」重命名为「${snapshot.toPath}」` }
}

export function validateProjectDocContent(content: unknown): string {
  if (typeof content !== 'string') fail('content 必须是字符串')
  if (encoder.encode(content).byteLength > PROJECT_DOC_MAX_BYTES) fail(`项目文档不能超过 ${PROJECT_DOC_MAX_BYTES} 字节`)
  return content
}

export async function snapshotProjectDoc(store: FileStore, rawPath: unknown, rawContent: unknown): Promise<ProjectDocSnapshot> {
  const path = normalizeProjectDocPath(rawPath)
  const afterText = validateProjectDocContent(rawContent)
  const before = await store.readText(textPath(path))
  if (before !== null && encoder.encode(before).byteLength > PROJECT_DOC_MAX_BYTES) fail(`现有项目文档超过 ${PROJECT_DOC_MAX_BYTES} 字节限制：${path}`)
  return { path, beforeText: before ?? '', afterText, existed: before !== null }
}

export async function applyProjectDocSnapshot(store: FileStore, snapshot: ProjectDocSnapshot): Promise<{ ok: boolean; text: string }> {
  const current = await store.readText(textPath(snapshot.path))
  if ((current !== null) !== snapshot.existed || (current ?? '') !== snapshot.beforeText) {
    return { ok: false, text: `项目文档已被修改，未覆盖：${snapshot.path}` }
  }
  await store.writeText(textPath(snapshot.path), snapshot.afterText)
  return { ok: true, text: `已保存项目文档「${snapshot.path}」` }
}
