import { registerPlugin } from '@capacitor/core'
import { normalizeRelativePath, type FileStore, type SourceReadResult } from '../../../core/storage/fileStore'
import { base64ToBytes, bytesToBase64 } from './archiveTransfer'

export interface DocumentTreePlugin {
  pickDirectory(): Promise<{ uri: string | null }>
  stat(input: SafRequest): Promise<{ exists: boolean; type?: 'file' | 'directory'; size?: number; mtime?: number }>
  list(input: SafRequest): Promise<{ entries: Array<{ name: string; type: 'file' | 'directory' }> }>
  mkdir(input: SafRequest & { exclusive?: boolean }): Promise<void>
  read(input: SafRequest): Promise<{ exists: boolean; data?: string }>
  write(input: SafRequest & { data: string; encoding: 'utf8' | 'base64' }): Promise<void>
  remove(input: SafRequest & { fileOnly?: boolean }): Promise<void>
  move(input: Omit<SafRequest, 'path'> & { from: string; to: string }): Promise<void>
}

interface SafRequest { treeUri: string; root: string; path: string }

export const documentTree = registerPlugin<DocumentTreePlugin>('StoryFabricDocuments')

export function makeSafPath(treeUri: string, root = ''): string {
  if (!treeUri.startsWith('content://')) throw new Error('外部目录必须通过 Android 系统选择器授权')
  if (root && (root === '.' || root === '..' || /[/\\]/.test(root))) throw new Error('无效的工作区目录名称')
  return `saf:${encodeURIComponent(treeUri)}|${encodeURIComponent(root)}`
}

export function parseSafPath(path: string): { treeUri: string; root: string } | null {
  if (!path.startsWith('saf:')) return null
  const separator = path.indexOf('|', 4)
  if (separator < 0) throw new Error('外部工作区路径无效')
  const treeUri = decodeURIComponent(path.slice(4, separator))
  const root = decodeURIComponent(path.slice(separator + 1))
  if (!treeUri.startsWith('content://') || (root && (root === '.' || root === '..' || /[/\\]/.test(root)))) throw new Error('外部工作区路径无效')
  return { treeUri, root }
}

/** A user-granted document tree. The Android plugin checks the persisted URI grant on every call. */
export class SafFileStore implements FileStore {
  private readonly treeUri: string
  private readonly root: string

  constructor(readonly workspacePath: string, private readonly plugin: DocumentTreePlugin = documentTree) {
    const parsed = parseSafPath(workspacePath)
    if (!parsed) throw new Error('外部工作区路径无效')
    this.treeUri = parsed.treeUri
    this.root = parsed.root
  }

  storageIdentity(): string { return this.workspacePath }

  private request(path: string, allowRoot = false): SafRequest {
    return { treeUri: this.treeUri, root: this.root, path: normalizeRelativePath(path, allowRoot) }
  }

  async exists(path: string): Promise<boolean> { return (await this.plugin.stat(this.request(path))).exists }
  async ensureDir(path: string): Promise<void> { await this.plugin.mkdir(this.request(path, true)) }

  async readBytes(path: string): Promise<Uint8Array | null> {
    const result = await this.plugin.read(this.request(path))
    return result.exists && typeof result.data === 'string' ? base64ToBytes(result.data) : null
  }

  async readText(path: string): Promise<string | null> {
    const bytes = await this.readBytes(path)
    return bytes === null ? null : new TextDecoder().decode(bytes)
  }

  async readTextStrict(path: string): Promise<SourceReadResult> {
    let bytes: Uint8Array | null
    try { bytes = await this.readBytes(path) }
    catch { return { ok: false, code: 'IO_ERROR' } }
    if (bytes === null) return { ok: false, code: 'NOT_FOUND' }
    try { return { ok: true, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) } }
    catch { return { ok: false, code: 'TEXT_DECODE_ERROR' } }
  }

  async writeText(path: string, text: string): Promise<void> {
    await this.plugin.write({ ...this.request(path), data: text, encoding: 'utf8' })
  }

  async writeBytes(path: string, bytes: Uint8Array): Promise<void> {
    await this.plugin.write({ ...this.request(path), data: bytesToBase64(bytes), encoding: 'base64' })
  }

  async move(from: string, to: string): Promise<void> {
    await this.plugin.move({ treeUri: this.treeUri, root: this.root, from: normalizeRelativePath(from), to: normalizeRelativePath(to) })
  }

  async remove(path: string): Promise<void> { await this.plugin.remove({ ...this.request(path) }) }
  async removeFile(path: string): Promise<void> { await this.plugin.remove({ ...this.request(path), fileOnly: true }) }

  async fileSize(path: string): Promise<number | null> {
    const info = await this.plugin.stat(this.request(path))
    return info.exists && info.type === 'file' && typeof info.size === 'number' ? info.size : null
  }

  async modifiedAt(path: string): Promise<number | null> {
    const info = await this.plugin.stat(this.request(path))
    return info.exists && info.type === 'file' && typeof info.mtime === 'number' ? info.mtime : null
  }

  async listFiles(dir: string, extension?: string): Promise<string[]> {
    const { entries } = await this.plugin.list(this.request(dir, true))
    return entries.filter((entry) => entry.type === 'file' && (!extension || entry.name.toLowerCase().endsWith(extension.toLowerCase()))).map((entry) => entry.name).sort()
  }

  async listDirs(dir: string): Promise<string[]> {
    const { entries } = await this.plugin.list(this.request(dir, true))
    return entries.filter((entry) => entry.type === 'directory').map((entry) => entry.name).sort()
  }
}
