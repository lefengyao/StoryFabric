import JSZip from 'jszip'
import type { FileStore } from '../storage/fileStore'
import { CURRENT_WORKSPACE_VERSION, migrateWorkspace } from './migration'

export interface WorkspaceArchive {
  fileName: string
  bytes: Uint8Array
}

export const WORKSPACE_ARCHIVE_MIME = 'application/zip'
export const WORKSPACE_ARCHIVE_MAX_BYTES = 50 * 1024 * 1024
export const WORKSPACE_ARCHIVE_MAX_ENTRIES = 5_000
export const WORKSPACE_ARCHIVE_MAX_ENTRY_BYTES = 10 * 1024 * 1024
export const WORKSPACE_ARCHIVE_MAX_UNCOMPRESSED_BYTES = 200 * 1024 * 1024

const ROOT_FILES = new Set(['storyfabric.json', 'relationships.json'])
const ROOT_DIRS = new Set(['characters', 'outline', 'settings', 'events', 'chapters', 'notes', '.storyfabric'])
const DERIVED_PATHS = new Set(['.storyfabric/index.json'])

interface ArchiveFile {
  path: string
  text: string
}

function safeEntry(path: string): string | null {
  if (!path || path.includes('\0')) return null
  const normalized = path.replaceAll('\\', '/')
  if (normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized)) return null
  const parts = normalized.split('/')
  if (parts.some((part) => !part || part === '.' || part === '..')) return null
  return normalized
}

function isPortablePath(path: string): boolean {
  if (ROOT_FILES.has(path)) return true
  const [root] = path.split('/', 1)
  if (!root || !ROOT_DIRS.has(root)) return false
  if (DERIVED_PATHS.has(path) || path.startsWith('.storyfabric/tmp/')) return false
  return !path.toLowerCase().endsWith('.tmp') && !path.toLowerCase().endsWith('.bak')
}

async function addTree(zip: JSZip, store: FileStore, dir: string): Promise<void> {
  for (const file of await store.listFiles(dir)) {
    const path = dir ? `${dir}/${file}` : file
    if (!isPortablePath(path)) continue
    const text = await store.readText(path)
    if (text !== null) zip.file(path, text)
  }
  for (const child of await store.listDirs(dir)) {
    const path = dir ? `${dir}/${child}` : child
    if (isPortablePath(`${path}/placeholder`)) await addTree(zip, store, path)
  }
}

async function assertEmpty(store: FileStore): Promise<void> {
  const [files, dirs] = await Promise.all([store.listFiles(''), store.listDirs('')])
  if (files.length || dirs.length) throw new Error('目标工作区必须为空')
}

function declaredSize(entry: JSZip.JSZipObject): number | null {
  const data = (entry as unknown as { _data?: { uncompressedSize?: unknown } })._data
  return typeof data?.uncompressedSize === 'number' && Number.isFinite(data.uncompressedSize) ? data.uncompressedSize : null
}

function validateMetadata(files: ArchiveFile[]): void {
  const metadata = files.find((file) => file.path === 'storyfabric.json')
  if (!metadata) throw new Error('压缩包不是有效的 StoryFabric 工作区')
  try {
    const value = JSON.parse(metadata.text) as { app?: unknown; version?: unknown }
    if (value.app !== 'storyfabric' || typeof value.version !== 'number' || !Number.isFinite(value.version) || value.version > CURRENT_WORKSPACE_VERSION) throw new Error('invalid')
  } catch {
    throw new Error('压缩包不是有效的 StoryFabric 工作区')
  }
}

async function readArchive(bytes: Uint8Array | ArrayBuffer): Promise<ArchiveFile[]> {
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  if (!input.byteLength || input.byteLength > WORKSPACE_ARCHIVE_MAX_BYTES) throw new Error('工作区压缩包大小无效或超过限制')

  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(input, { createFolders: false })
  } catch {
    throw new Error('无法读取工作区压缩包')
  }

  const files: ArchiveFile[] = []
  const paths = new Set<string>()
  const portablePaths = new Set<string>()
  let uncompressedBytes = 0
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue
    if (files.length >= WORKSPACE_ARCHIVE_MAX_ENTRIES) throw new Error('工作区压缩包文件数量超过限制')
    const original = entry.unsafeOriginalName ?? entry.name
    const path = safeEntry(original)
    if (!path) throw new Error('工作区压缩包包含非法路径')
    const portableKey = path.normalize('NFC').toLowerCase()
    if (path !== entry.name || paths.has(path) || portablePaths.has(portableKey)) throw new Error('工作区压缩包包含冲突路径')
    if (!isPortablePath(path)) throw new Error(`工作区压缩包包含不支持的文件：${path}`)
    const expectedSize = declaredSize(entry)
    if (expectedSize !== null && expectedSize > WORKSPACE_ARCHIVE_MAX_ENTRY_BYTES) throw new Error('工作区压缩包包含过大的文件')

    const content = await entry.async('uint8array')
    if (content.byteLength > WORKSPACE_ARCHIVE_MAX_ENTRY_BYTES) throw new Error('工作区压缩包包含过大的文件')
    uncompressedBytes += content.byteLength
    if (uncompressedBytes > WORKSPACE_ARCHIVE_MAX_UNCOMPRESSED_BYTES) throw new Error('工作区压缩包解压后超过限制')

    let text: string
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(content)
    } catch {
      throw new Error(`工作区压缩包包含非文本文件：${path}`)
    }
    paths.add(path)
    portablePaths.add(portableKey)
    files.push({ path, text })
  }

  if (!files.length) throw new Error('压缩包不是有效的 StoryFabric 工作区')
  validateMetadata(files)
  return files
}

export async function exportWorkspaceArchive(store: FileStore, name: string): Promise<WorkspaceArchive> {
  const zip = new JSZip()
  for (const file of await store.listFiles('')) {
    if (!isPortablePath(file)) continue
    const text = await store.readText(file)
    if (text !== null) zip.file(file, text)
  }
  for (const dir of ROOT_DIRS) await addTree(zip, store, dir)
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
  if (bytes.byteLength > WORKSPACE_ARCHIVE_MAX_BYTES) throw new Error('工作区导出后超过压缩包大小限制')
  return {
    fileName: `${name.replace(/[\\/:*?"<>|]/g, '').trim() || 'storyfabric'}.storyfabric.zip`,
    bytes
  }
}

export async function importWorkspaceArchive(store: FileStore, bytes: Uint8Array | ArrayBuffer): Promise<void> {
  await assertEmpty(store)
  const files = await readArchive(bytes)
  for (const file of files) await store.writeText(file.path, file.text)
  await migrateWorkspace(store)
}
