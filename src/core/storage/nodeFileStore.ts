import { promises as fs } from 'fs'
import { randomUUID } from 'node:crypto'
import { dirname, isAbsolute, join, normalize as normalizePath, relative, resolve, sep } from 'path'
import { normalizeRelativePath, type FileStore } from './fileStore'

/** Node/Electron 工作区文件适配器。共享核心只看到 FileStore。 */
export class NodeFileStore implements FileStore {
  private readonly writeQueues = new Map<string, Promise<void>>()

  constructor(private readonly root: string, private readonly boundaryRoot = root) {}

  private resolveLexically(path: string, allowRoot = false): string {
    const safePath = normalizeRelativePath(path, allowRoot)
    if (isAbsolute(safePath)) throw new Error('FileStore 只接受工作区内相对路径')
    const target = normalizePath(join(this.root, safePath.replaceAll('/', sep)))
    const rel = relative(this.root, target)
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new Error('禁止访问工作区外的路径')
    }
    return target
  }

  private isWithinOrEqual(parent: string, child: string): boolean {
    const rel = relative(this.canonicalPath(parent), this.canonicalPath(child))
    return !rel || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
  }

  private canonicalPath(path: string): string {
    const normalized = resolve(path)
    return process.platform === 'win32' ? normalized.toLocaleLowerCase() : normalized
  }

  private boundaryError(): Error {
    return new Error('禁止访问工作区外的路径')
  }

  private isBoundaryError(error: unknown): boolean {
    return error instanceof Error && error.message === '禁止访问工作区外的路径'
  }

  private async validatePath(target: string): Promise<void> {
    const boundary = this.canonicalPath(this.boundaryRoot)
    try {
      const actual = await fs.realpath(target)
      if (!this.isWithinOrEqual(boundary, actual)) throw this.boundaryError()
      return
    } catch (error) {
      if (this.isBoundaryError(error)) throw error
    }

    let current = target
    while (true) {
      const entry = await fs.lstat(current).catch(() => null)
      if (entry?.isSymbolicLink()) {
        const linkTarget = resolve(dirname(current), await fs.readlink(current))
        try {
          const actual = await fs.realpath(current)
          if (!this.isWithinOrEqual(boundary, actual)) throw this.boundaryError()
        } catch (error) {
          if (!this.isWithinOrEqual(boundary, linkTarget)) throw this.boundaryError()
          if (this.isBoundaryError(error)) throw error
        }
        return
      }
      if (entry) {
        const actual = await fs.realpath(current)
        if (!this.isWithinOrEqual(boundary, actual)) throw this.boundaryError()
        return
      }
      if (this.canonicalPath(current) === boundary) return
      const parent = dirname(current)
      if (parent === current) throw this.boundaryError()
      current = parent
    }
  }

  private async secureResolve(path: string, allowRoot = false): Promise<string> {
    const target = this.resolveLexically(path, allowRoot)
    await this.validatePath(target)
    return target
  }

  async exists(path: string): Promise<boolean> {
    try {
      await fs.access(await this.secureResolve(path))
      return true
    } catch (error) {
      if (this.isBoundaryError(error)) throw error
      return false
    }
  }

  async ensureDir(path: string): Promise<void> {
    await fs.mkdir(await this.secureResolve(path, true), { recursive: true })
  }

  async readText(path: string): Promise<string | null> {
    try {
      return await fs.readFile(await this.secureResolve(path), 'utf-8')
    } catch (error) {
      if (this.isBoundaryError(error)) throw error
      return null
    }
  }

  async writeText(path: string, text: string): Promise<void> {
    const target = await this.secureResolve(path)
    const previous = this.writeQueues.get(target) ?? Promise.resolve()
    const operation = previous.catch(() => undefined).then(async () => {
      const checkedTarget = await this.secureResolve(path)
      await fs.mkdir(dirname(checkedTarget), { recursive: true })
      const temp = `${checkedTarget}.${randomUUID()}.tmp`
      try {
        await fs.writeFile(temp, text, 'utf-8')
        await fs.rename(temp, checkedTarget)
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
    const source = await this.secureResolve(from)
    const target = await this.secureResolve(to)
    await fs.mkdir(dirname(target), { recursive: true })
    await fs.rename(source, target)
  }

  async modifiedAt(path: string): Promise<number | null> {
    try {
      const stat = await fs.stat(await this.secureResolve(path))
      return stat.mtimeMs
    } catch (error) {
      if (this.isBoundaryError(error)) throw error
      return null
    }
  }

  async remove(path: string): Promise<void> {
    const safePath = normalizeRelativePath(path)
    if (!safePath) throw new Error('禁止删除工作区根目录')
    await fs.rm(await this.secureResolve(safePath), { recursive: true, force: true })
  }

  async listFiles(dir: string, extension?: string): Promise<string[]> {
    try {
      const entries = await fs.readdir(await this.secureResolve(dir, true), { withFileTypes: true })
      return entries
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .filter((name) => !extension || name.toLowerCase().endsWith(extension.toLowerCase()))
        .sort()
    } catch (error) {
      if (this.isBoundaryError(error)) throw error
      return []
    }
  }

  async listDirs(dir: string): Promise<string[]> {
    try {
      const entries = await fs.readdir(await this.secureResolve(dir, true), { withFileTypes: true })
      return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
    } catch (error) {
      if (this.isBoundaryError(error)) throw error
      return []
    }
  }
}
