import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { normalizeRelativePath, type FileStore } from '../../../core/storage/fileStore'
import { base64ToBytes, bytesToBase64 } from './archiveTransfer'

/** Capacitor Android 应用私有目录适配器；所有路径均相对于一个工作区根目录。 */
export class CapacitorFileStore implements FileStore {
  constructor(private readonly root = '') {}

  private path(path: string, allowRoot = false): string {
    const clean = normalizeRelativePath(path, allowRoot)
    return this.root ? (clean ? `${this.root}/${clean}` : this.root) : clean
  }

  async exists(path: string): Promise<boolean> {
    try {
      await Filesystem.stat({ path: this.path(path), directory: Directory.Data })
      return true
    } catch {
      return false
    }
  }

  async ensureDir(path: string): Promise<void> {
    const target = this.path(path, true)
    try {
      await Filesystem.mkdir({ path: target, directory: Directory.Data, recursive: true })
    } catch (error) {
      try {
        const stat = await Filesystem.stat({ path: target, directory: Directory.Data })
        if (stat.type === 'directory') return
      } catch {
        /* Preserve the original mkdir error when the target is not an existing directory. */
      }
      throw error
    }
  }

  async readText(path: string): Promise<string | null> {
    try {
      const result = await Filesystem.readFile({ path: this.path(path), directory: Directory.Data, encoding: Encoding.UTF8 })
      return typeof result.data === 'string' ? result.data : null
    } catch {
      return null
    }
  }

  async readBytes(path: string): Promise<Uint8Array | null> {
    try {
      const result = await Filesystem.readFile({ path: this.path(path), directory: Directory.Data })
      if (typeof result.data !== 'string') return null
      return base64ToBytes(result.data)
    } catch {
      return null
    }
  }

  async writeText(path: string, text: string): Promise<void> {
    const clean = normalizeRelativePath(path)
    const slash = clean.lastIndexOf('/')
    if (slash > 0) await this.ensureDir(clean.slice(0, slash))
    await Filesystem.writeFile({ path: this.path(clean), directory: Directory.Data, data: text, encoding: Encoding.UTF8, recursive: true })
  }

  async writeBytes(path: string, bytes: Uint8Array): Promise<void> {
    const clean = normalizeRelativePath(path)
    const slash = clean.lastIndexOf('/')
    if (slash > 0) await this.ensureDir(clean.slice(0, slash))
    await Filesystem.writeFile({ path: this.path(clean), directory: Directory.Data, data: bytesToBase64(bytes), recursive: true })
  }

  async move(from: string, to: string): Promise<void> {
    await Filesystem.rename({
      from: this.path(from),
      to: this.path(to),
      directory: Directory.Data
    })
  }

  async modifiedAt(path: string): Promise<number | null> {
    try {
      const stat = await Filesystem.stat({ path: this.path(path), directory: Directory.Data })
      return typeof stat.mtime === 'number' ? stat.mtime : null
    } catch {
      return null
    }
  }

  async remove(path: string): Promise<void> {
    const target = this.path(path)
    try {
      await Filesystem.deleteFile({ path: target, directory: Directory.Data })
      return
    } catch {
      /* 目录删除走 rmdir */
    }
    try {
      await Filesystem.rmdir({ path: target, directory: Directory.Data, recursive: true })
    } catch {
      /* 删除不存在路径视为成功 */
    }
  }

  async listFiles(dir: string, extension?: string): Promise<string[]> {
    try {
      const result = await Filesystem.readdir({ path: this.path(dir, true), directory: Directory.Data })
      return result.files
        .filter((entry) => entry.type === 'file' || !entry.type)
        .map((entry) => entry.name)
        .filter((name) => !extension || name.toLowerCase().endsWith(extension.toLowerCase()))
        .sort()
    } catch {
      return []
    }
  }

  async listDirs(dir: string): Promise<string[]> {
    try {
      const result = await Filesystem.readdir({ path: this.path(dir, true), directory: Directory.Data })
      return result.files
        .filter((entry) => entry.type === 'directory')
        .map((entry) => entry.name)
        .sort()
    } catch {
      return []
    }
  }
}
