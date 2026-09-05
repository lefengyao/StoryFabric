import { promises as fs } from 'fs'
import { randomUUID } from 'node:crypto'
import { isAbsolute, join, normalize as normalizePath, relative, sep } from 'path'
import { normalizeRelativePath, type FileStore } from './fileStore'

/** Node/Electron 工作区文件适配器。共享核心只看到 FileStore。 */
export class NodeFileStore implements FileStore {
  private readonly writeQueues = new Map<string, Promise<void>>()

  constructor(private readonly root: string) {}

  private resolve(path: string): string {
    const safePath = normalizeRelativePath(path)
    if (isAbsolute(safePath)) throw new Error('FileStore 只接受工作区内相对路径')
    const target = normalizePath(join(this.root, safePath.replaceAll('/', sep)))
    const rel = relative(this.root, target)
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new Error('禁止访问工作区外的路径')
    }
    return target
  }

  async exists(path: string): Promise<boolean> {
    try {
      await fs.access(this.resolve(path))
      return true
    } catch {
      return false
    }
  }

  async ensureDir(path: string): Promise<void> {
    await fs.mkdir(this.resolve(path), { recursive: true })
  }

  async readText(path: string): Promise<string | null> {
    try {
      return await fs.readFile(this.resolve(path), 'utf-8')
    } catch {
      return null
    }
  }

  async writeText(path: string, text: string): Promise<void> {
    const target = this.resolve(path)
    const previous = this.writeQueues.get(target) ?? Promise.resolve()
    const operation = previous.catch(() => undefined).then(async () => {
      await fs.mkdir(join(target, '..'), { recursive: true })
      const temp = `${target}.${randomUUID()}.tmp`
      try {
        await fs.writeFile(temp, text, 'utf-8')
        await fs.rename(temp, target)
      } finally {
        await fs.rm(temp, { force: true }).catch(() => undefined)
      }
    })
    this.writeQueues.set(target, operation)
    try {
      await operation
    } finally {
      if (this.writeQueues.get(target) === operation) this.writeQueues.delete(target)
    }
  }

  async move(from: string, to: string): Promise<void> {
    const source = this.resolve(from)
    const target = this.resolve(to)
    await fs.mkdir(join(target, '..'), { recursive: true })
    await fs.rename(source, target)
  }

  async modifiedAt(path: string): Promise<number | null> {
    try {
      const stat = await fs.stat(this.resolve(path))
      return stat.mtimeMs
    } catch {
      return null
    }
  }

  async remove(path: string): Promise<void> {
    await fs.rm(this.resolve(path), { recursive: true, force: true })
  }

  async listFiles(dir: string, extension?: string): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.resolve(dir), { withFileTypes: true })
      return entries
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .filter((name) => !extension || name.toLowerCase().endsWith(extension.toLowerCase()))
        .sort()
    } catch {
      return []
    }
  }

  async listDirs(dir: string): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.resolve(dir), { withFileTypes: true })
      return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
    } catch {
      return []
    }
  }
}
