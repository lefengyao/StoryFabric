import type { FileStore } from '../storage/fileStore'

export const PROJECT_DOC_MAX_BYTES = 256 * 1024
export const PROJECT_DOC_DEFAULT_CHARS = 20_000
export const PROJECT_DOC_MAX_CHARS = 50_000
export const PROJECT_DOC_DEFAULT_LIMIT = 50
export const PROJECT_DOC_MAX_LIMIT = 100

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })
const RESERVED_NAMES = /^(con|prn|aux|nul|clock\$|com[1-9]|lpt[1-9])(?:\.[^.]*)?$/i

export interface ProjectDocEntry { path: string; size: number }
export interface ProjectDocList { files: ProjectDocEntry[]; nextOffset?: number }
export interface ProjectDocRead { sourcePath: string; content: string; nextOffset?: number; truncated: boolean }

function fail(message: string): never { throw new Error(message) }

export function normalizeProjectDocPath(value: unknown): string {
  if (typeof value !== 'string' || !value || value !== value.trim()) fail('path 必须是 docs 根目录下的 .md 或 .txt 文件名')
  const path = value.trim()
  if (path.includes('/') || path.includes('\\') || path.includes('\0') || path === '.' || path === '..' || /^[A-Za-z]:/.test(path) || path.startsWith('.')) {
    fail('path 只能是 docs 根目录下的单层文件名')
  }
  const dot = path.lastIndexOf('.')
  const ext = dot >= 0 ? path.slice(dot).toLowerCase() : ''
  if (ext !== '.md' && ext !== '.txt') fail('项目文档只支持 .md 和 .txt')
  if (RESERVED_NAMES.test(path)) fail('path 使用了 Windows 保留文件名')
  return path
}

function textPath(path: string): string { return `docs/${path}` }

export async function listProjectDocs(store: FileStore, offset = 0, limit = PROJECT_DOC_DEFAULT_LIMIT): Promise<ProjectDocList> {
  if (!Number.isInteger(offset) || offset < 0) fail('offset 必须是非负整数')
  if (!Number.isInteger(limit) || limit < 1 || limit > PROJECT_DOC_MAX_LIMIT) fail(`limit 必须在 1-${PROJECT_DOC_MAX_LIMIT} 之间`)
  const names = (await store.listFiles('docs')).filter((name) => /\.(?:md|txt)$/i.test(name)).sort((a, b) => a.localeCompare(b, 'zh-CN'))
  const entries: ProjectDocEntry[] = []
  for (const name of names.slice(offset, offset + limit)) {
    const raw = await store.readBytes(textPath(name))
    if (raw === null) continue
    let content: string
    try { content = decoder.decode(raw) } catch { continue }
    const size = raw.byteLength
    if (size <= PROJECT_DOC_MAX_BYTES) entries.push({ path: name, size })
  }
  const nextOffset = offset + limit < names.length ? offset + limit : undefined
  return nextOffset === undefined ? { files: entries } : { files: entries, nextOffset }
}

export async function readProjectDoc(store: FileStore, rawPath: unknown, offset = 0, maxChars = PROJECT_DOC_DEFAULT_CHARS): Promise<ProjectDocRead> {
  const path = normalizeProjectDocPath(rawPath)
  if (!Number.isInteger(offset) || offset < 0) fail('offset 必须是非负整数')
  if (!Number.isInteger(maxChars) || maxChars < 1 || maxChars > PROJECT_DOC_MAX_CHARS) fail(`maxChars 必须在 1-${PROJECT_DOC_MAX_CHARS} 之间`)
  const raw = await store.readBytes(textPath(path))
  if (raw === null) fail(`未找到项目文档：${path}`)
  if (raw.byteLength > PROJECT_DOC_MAX_BYTES) fail(`项目文档超过 ${PROJECT_DOC_MAX_BYTES} 字节限制：${path}`)
  let content: string
  try { content = decoder.decode(raw) } catch { fail(`项目文档不是有效的 UTF-8 文本：${path}`) }
  const slice = content.slice(offset, offset + maxChars)
  const nextOffset = offset + slice.length < content.length ? offset + slice.length : undefined
  return { sourcePath: path, content: slice, ...(nextOffset === undefined ? {} : { nextOffset }), truncated: nextOffset !== undefined }
}

export interface ProjectDocSnapshot { path: string; beforeText: string; afterText: string; existed: boolean }

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
