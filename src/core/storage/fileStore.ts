/**
 * 平台无关的工作区文件存储契约。
 *
 * 共享业务层只使用相对路径（统一为 `/`），不感知 Node、Electron 或 Android 文件系统。
 */
export interface FileStore {
  exists(path: string): Promise<boolean>
  ensureDir(path: string): Promise<void>
  readText(path: string): Promise<string | null>
  writeText(path: string, text: string): Promise<void>
  move(from: string, to: string): Promise<void>
  remove(path: string): Promise<void>
  /** 文件修改时间；无法提供时返回 null，供清理策略保守跳过。 */
  modifiedAt?(path: string): Promise<number | null>
  listFiles(dir: string, extension?: string): Promise<string[]>
  listDirs(dir: string): Promise<string[]>
}

export function normalizeRelativePath(path: string, allowRoot = false): string {
  const raw = String(path).replaceAll('\\', '/')
  if (raw.startsWith('/') || /^[A-Za-z]:\//.test(raw)) throw new Error('FileStore 只接受工作区内相对路径')
  const parts = raw.split('/').filter(Boolean)
  if (parts.some((part) => part === '..')) throw new Error('禁止访问工作区外的路径')
  const normalized = parts.filter((part) => part !== '.').join('/')
  if (!normalized && !allowRoot) throw new Error('路径不能为空')
  return normalized
}

/** 用于共享核心单测和 Android 首版适配验证的内存实现。 */
export class MemoryFileStore implements FileStore {
  private readonly files = new Map<string, string>()
  private readonly mtimes = new Map<string, number>()
  private readonly dirs = new Set<string>([''])

  async exists(path: string): Promise<boolean> {
    const p = normalizeRelativePath(path)
    return this.files.has(p) || this.dirs.has(p)
  }

  async ensureDir(path: string): Promise<void> {
    const p = normalizeRelativePath(path, true)
    if (!p) return
    const parts = p.split('/')
    let current = ''
    for (const part of parts) {
      current = current ? `${current}/${part}` : part
      this.dirs.add(current)
    }
  }

  async readText(path: string): Promise<string | null> {
    return this.files.get(normalizeRelativePath(path)) ?? null
  }

  async writeText(path: string, text: string): Promise<void> {
    const p = normalizeRelativePath(path)
    const slash = p.lastIndexOf('/')
    await this.ensureDir(slash === -1 ? '' : p.slice(0, slash))
    this.files.set(p, text)
    this.mtimes.set(p, Date.now())
  }

  async move(from: string, to: string): Promise<void> {
    const source = normalizeRelativePath(from)
    const target = normalizeRelativePath(to)
    if (!source || !target) throw new Error('移动路径不能为空')
    const sourceFile = this.files.get(source)
    if (sourceFile !== undefined) {
      const slash = target.lastIndexOf('/')
      await this.ensureDir(slash === -1 ? '' : target.slice(0, slash))
      this.files.set(target, sourceFile)
      this.mtimes.set(target, this.mtimes.get(source) ?? Date.now())
      this.files.delete(source)
      this.mtimes.delete(source)
      return
    }
    if (!this.dirs.has(source)) throw new Error(`源路径不存在：${source}`)
    const sourcePrefix = `${source}/`
    const targetPrefix = `${target}/`
    const fileEntries = [...this.files.entries()].filter(([key]) => key.startsWith(sourcePrefix))
    const dirEntries = [...this.dirs].filter((key) => key === source || key.startsWith(sourcePrefix))
    await this.ensureDir(target)
    for (const [key, value] of fileEntries) {
      const next = `${targetPrefix}${key.slice(sourcePrefix.length)}`
      this.files.set(next, value)
      this.mtimes.set(next, this.mtimes.get(key) ?? Date.now())
    }
    for (const key of dirEntries) this.dirs.add(`${target}${key === source ? '' : `/${key.slice(sourcePrefix.length)}`}`)
    for (const [key] of fileEntries) {
      this.files.delete(key)
      this.mtimes.delete(key)
    }
    for (const key of dirEntries) this.dirs.delete(key)
  }

  async remove(path: string): Promise<void> {
    const p = normalizeRelativePath(path)
    this.files.delete(p)
    this.mtimes.delete(p)
    for (const d of [...this.dirs]) {
      if (d === p || d.startsWith(`${p}/`)) this.dirs.delete(d)
    }
  }

  async modifiedAt(path: string): Promise<number | null> {
    const p = normalizeRelativePath(path)
    return this.files.has(p) ? (this.mtimes.get(p) ?? null) : null
  }

  async listFiles(dir: string, extension?: string): Promise<string[]> {
    const prefix = normalizeRelativePath(dir, true)
    const start = prefix ? `${prefix}/` : ''
    return [...this.files.keys()]
      .filter((p) => p.startsWith(start) && !p.slice(start.length).includes('/'))
      .map((p) => p.slice(start.length))
      .filter((name) => !extension || name.toLowerCase().endsWith(extension.toLowerCase()))
      .sort()
  }

  async listDirs(dir: string): Promise<string[]> {
    const prefix = normalizeRelativePath(dir, true)
    const start = prefix ? `${prefix}/` : ''
    const names = new Set<string>()
    for (const d of this.dirs) {
      if (!d.startsWith(start) || d === prefix) continue
      const rest = d.slice(start.length)
      if (rest && !rest.includes('/')) names.add(rest)
    }
    return [...names].sort()
  }
}
