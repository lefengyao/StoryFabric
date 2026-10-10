import { randomUUID } from 'node:crypto'
import { lstatSync, readlinkSync, realpathSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { NodeFileStore } from '../core/storage/nodeFileStore'
import { importWorkspaceArchive } from '../core/workspace/archive'
import { listCharacters, listChapters, listEvents, listNotes, listOutline, listSettings, loadRelationships } from '../core/workspace/entityStore'
import { CURRENT_WORKSPACE_VERSION, migrateWorkspace, type WorkspaceMigrationOptions } from '../core/workspace/migration'
import { listTrash } from '../core/workspace/trash'
import { initializeWorkspace, loadSummary, loadWorkspaceListItem, setWorkspaceName, validateWorkspace } from '../core/workspace/workspaceService'
import type { FileStore } from '../core/storage/fileStore'
import type { VolumeMeta, WorkspaceListItem, WorkspaceSummary } from '../shared/types'
import { throwIfWorkspaceRequestAborted } from '../shared/api'

interface WorkspaceRecord {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  directory?: string
}

interface ImportRollbackReceipt {
  id: string
  root: string
  createdAt: number
  consumed: boolean
}

const importRollbackReceipt = Symbol('storyfabric.importRollbackReceipt')
type ImportedWorkspaceSummary = WorkspaceSummary & { [importRollbackReceipt]?: ImportRollbackReceipt }

interface RegistryFile {
  version: 1
  workspaces: WorkspaceRecord[]
}

function safeName(input: string): string {
  const value = input.replace(/[\\/:*?"<>|]/g, '').trim()
  if (!value) throw new Error('工作区名称不能为空')
  return value.slice(0, 120)
}

function isSafeId(id: string): boolean {
  return id === 'default' || /^ws_[a-z0-9]{12}$/.test(id)
}

function isWithin(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  return Boolean(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)
}

function isWithinOrEqual(parent: string, child: string): boolean {
  return parent === child || isWithin(parent, child)
}

async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path)
    return true
  } catch {
    return false
  }
}

async function loadReadOnlySummary(store: FileStore, fallbackName: string, path: string): Promise<WorkspaceSummary> {
  const [characters, relationships, outline, events, chapters, settings, notes] = await Promise.all([listCharacters(store), loadRelationships(store), listOutline(store), listEvents(store), listChapters(store), listSettings(store), listNotes(store)])
  let name = fallbackName
  const raw = await store.readText('storyfabric.json')
  if (raw) {
    try {
      const meta = JSON.parse(raw)
      if (typeof meta?.name === 'string' && meta.name) name = meta.name
    } catch { /* fallback */ }
  }
  let volumes: VolumeMeta[] = []
  const volumesRaw = await store.readText('chapters/volumes.json')
  if (volumesRaw) {
    try {
      const value = JSON.parse(volumesRaw)
      if (Array.isArray(value)) volumes = value.filter((v): v is VolumeMeta => typeof v?.id === 'string' && typeof v?.title === 'string' && typeof v?.order === 'number')
    } catch { volumes = [] }
  }
  let trashCount = 0
  try { trashCount = (await listTrash(store)).length } catch { /* damaged trash index does not block reading */ }
  const volumeOrder = new Map(volumes.map((volume) => [volume.id, volume.order]))
  chapters.sort((a, b) => Number(a.box === 'draft') - Number(b.box === 'draft') || (volumeOrder.get(a.volumeId ?? 'vol_default') ?? Number.MAX_SAFE_INTEGER) - (volumeOrder.get(b.volumeId ?? 'vol_default') ?? Number.MAX_SAFE_INTEGER) || a.order - b.order)
  return { name, path, version: CURRENT_WORKSPACE_VERSION, volumes, characters, relationships, outline, events, chapters, settings, notes, trashCount }
}

export class RevalidatedFileStore implements FileStore {
  constructor(private readonly loadStore: () => Promise<NodeFileStore>) {}

  async exists(path: string): Promise<boolean> { return (await this.loadStore()).exists(path) }
  async ensureDir(path: string): Promise<void> { return (await this.loadStore()).ensureDir(path) }
  async readText(path: string): Promise<string | null> { return (await this.loadStore()).readText(path) }
  async readTextStrict(path: string): Promise<import('../core/storage/fileStore').SourceReadResult> { return (await this.loadStore()).readTextStrict(path) }
  async writeText(path: string, text: string): Promise<void> { return (await this.loadStore()).writeText(path, text) }
  async readBytes(path: string): Promise<Uint8Array | null> { return (await this.loadStore()).readBytes(path) }
  async writeBytes(path: string, bytes: Uint8Array): Promise<void> { return (await this.loadStore()).writeBytes(path, bytes) }
  async move(from: string, to: string): Promise<void> { return (await this.loadStore()).move(from, to) }
  async remove(path: string): Promise<void> { return (await this.loadStore()).remove(path) }
  async removeFile(path: string): Promise<void> { return (await this.loadStore()).removeFile(path) }
  async fileSize(path: string): Promise<number | null> { return (await this.loadStore()).fileSize(path) }
  async modifiedAt(path: string): Promise<number | null> { return (await this.loadStore()).modifiedAt(path) }
  async listFiles(dir: string, extension?: string): Promise<string[]> { return (await this.loadStore()).listFiles(dir, extension) }
  async listDirs(dir: string): Promise<string[]> { return (await this.loadStore()).listDirs(dir) }
}

/** Maps opaque server workspace IDs to directories beneath one managed root. */
export class WorkspaceRegistry {
  private readonly managedRoot: string
  private readonly registryPath: string
  private readonly importsRoot: string
  private managedRootBoundary = ''
  private readonly ready: Promise<void>
  private records: WorkspaceRecord[] = []
  private mutationQueue: Promise<void> = Promise.resolve()

  constructor(private readonly dataRoot: string, private readonly legacyWorkspaceRoot = join(dataRoot, 'workspace')) {
    this.managedRoot = resolve(dataRoot, 'workspaces')
    this.registryPath = join(this.managedRoot, 'registry.json')
    this.importsRoot = join(this.managedRoot, '.imports')
    this.ready = this.initialize()
  }

  static async open(dataRoot: string, legacyWorkspaceRoot?: string): Promise<WorkspaceRegistry> {
    const registry = new WorkspaceRegistry(dataRoot, legacyWorkspaceRoot)
    await registry.ensureReady()
    return registry
  }

  async ensureReady(): Promise<void> {
    await this.ready
  }

  private async initialize(): Promise<void> {
    await fs.mkdir(this.managedRoot, { recursive: true })
    this.managedRootBoundary = this.canonicalPath(await fs.realpath(this.managedRoot))
    await fs.mkdir(this.importsRoot, { recursive: true })
    await this.cleanupStaging()
    await this.loadRecords()
    await this.migrateLegacyWorkspace()
    if (!this.records.length) {
      const root = this.directoryOf({ id: 'default', name: 'StoryFabric', createdAt: 0, updatedAt: 0 }, true)
      await fs.mkdir(root, { recursive: true })
      await initializeWorkspace(new NodeFileStore(root, this.managedRootBoundary), 'StoryFabric')
      const now = Date.now()
      this.records = [{ id: 'default', name: 'StoryFabric', createdAt: now, updatedAt: now }]
      await this.saveRecords()
    }
  }

  private async cleanupStaging(): Promise<void> {
    const cutoff = Date.now() - 60 * 60 * 1000
    for (const entry of await fs.readdir(this.importsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith('workspace-')) continue
      const path = join(this.importsRoot, entry.name)
      try {
        const info = await fs.stat(path)
        if (info.mtimeMs < cutoff) await fs.rm(path, { recursive: true, force: true })
      } catch { /* a concurrently cleaned staging directory is harmless */ }
    }
  }

  private async loadRecords(): Promise<void> {
    if (!(await exists(this.registryPath))) return
    let parsed: RegistryFile
    try {
      parsed = JSON.parse(await fs.readFile(this.registryPath, 'utf8')) as RegistryFile
    } catch {
      throw new Error('服务器工作区注册表损坏')
    }
    if (parsed.version !== 1 || !Array.isArray(parsed.workspaces)) throw new Error('服务器工作区注册表格式无效')
    this.records = parsed.workspaces.filter((record): record is WorkspaceRecord => {
      return isSafeId(record?.id) && typeof record.name === 'string' && typeof record.createdAt === 'number' && typeof record.updatedAt === 'number'
    })
    if (this.records.length !== parsed.workspaces.length || new Set(this.records.map((record) => record.id)).size !== this.records.length) throw new Error('服务器工作区注册表包含非法记录')
    const directories = this.records.map((record) => this.canonicalPath(this.directoryOf(record, true)))
    if (new Set(directories).size !== directories.length) throw new Error('服务器工作区注册表包含重复目录')
  }

  private async saveRecords(): Promise<void> {
    const temp = `${this.registryPath}.${randomUUID()}.tmp`
    await fs.writeFile(temp, JSON.stringify({ version: 1, workspaces: this.records } satisfies RegistryFile, null, 2), 'utf8')
    await fs.rename(temp, this.registryPath)
  }

  private async mutate<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.mutationQueue.catch(() => undefined).then(operation)
    this.mutationQueue = run.then(() => undefined, () => undefined)
    return run
  }

  private relativeDirectoryOf(record: WorkspaceRecord): string {
    const directory = record.directory === undefined ? record.id : record.directory.trim()
    if (!directory || isAbsolute(directory) || directory.split(/[\\/]/).includes('..')) throw new Error('工作区目录无效')
    const root = resolve(this.managedRoot, directory)
    if (this.canonicalPath(root) === this.canonicalPath(this.managedRootBoundary)) throw new Error('工作区目录不能是托管根目录')
    if (!isWithin(this.managedRoot, root)) throw new Error('工作区目录越界')
    return root
  }

  private directoryOf(record: WorkspaceRecord, allowMissing = false): string {
    const candidate = this.relativeDirectoryOf(record)
    const managed = this.managedRootBoundary
    try {
      const actual = realpathSync(candidate)
      if (!isWithin(this.canonicalPath(managed), this.canonicalPath(actual))) throw new Error('工作区目录越界')
      return actual
    } catch {
      this.validateMissingPath(candidate, managed)
      if (!allowMissing) throw new Error('工作区目录不存在')
      return candidate
    }
  }

  private validateMissingPath(candidate: string, managed: string): void {
    let current = candidate
    while (true) {
      let entry: ReturnType<typeof lstatSync> | null = null
      try { entry = lstatSync(current) } catch { /* continue to the existing parent */ }
      if (entry?.isSymbolicLink()) {
        const linkTarget = resolve(dirname(current), readlinkSync(current))
        try {
          const actual = realpathSync(current)
          if (!isWithinOrEqual(this.canonicalPath(managed), this.canonicalPath(actual))) throw new Error('工作区目录越界')
        } catch (error) {
          if (!isWithinOrEqual(this.canonicalPath(managed), this.canonicalPath(linkTarget))) throw new Error('工作区目录越界')
          if (error instanceof Error && error.message === '工作区目录越界') throw error
          throw new Error('工作区目录不存在')
        }
        return
      }
      if (entry) {
        const actual = realpathSync(current)
        if (!isWithinOrEqual(this.canonicalPath(managed), this.canonicalPath(actual))) throw new Error('工作区目录越界')
        return
      }
      const parent = dirname(current)
      if (parent === current) throw new Error('工作区目录不存在')
      current = parent
    }
  }

  private rootOf(record: WorkspaceRecord, allowMissing = false): string {
    return this.directoryOf(record, allowMissing)
  }

  private storeForPath(path: string): FileStore {
    return new RevalidatedFileStore(async () => {
      const target = await fs.realpath(path).catch(() => { throw new Error('工作区路径不存在') })
      if (this.canonicalPath(target) === this.managedRootBoundary || !isWithin(this.managedRootBoundary, this.canonicalPath(target))) throw new Error('工作区目录越界')
      return new NodeFileStore(target, this.managedRootBoundary)
    })
  }

  private canonicalPath(path: string): string {
    const normalized = resolve(path)
    return process.platform === 'win32' ? normalized.toLocaleLowerCase() : normalized
  }

  private async migrateLegacyWorkspace(): Promise<void> {
    const legacy = resolve(this.legacyWorkspaceRoot)
    const target = this.rootOf({ id: 'default', name: 'StoryFabric', createdAt: 0, updatedAt: 0 }, true)
    if (legacy === target || !(await exists(join(legacy, 'storyfabric.json')))) return
    if (this.records.some((record) => record.id === 'default')) return
    if (await exists(target)) throw new Error('检测到旧工作区，但默认受管工作区已存在；为避免覆盖，服务未启动')

    await fs.rename(legacy, target)
    const summary = await loadWorkspaceListItem(new NodeFileStore(target, this.managedRootBoundary), basename(target), 'default')
    const now = Date.now()
    this.records.push({ id: 'default', name: summary.name, createdAt: now, updatedAt: now })
    await this.saveRecords()
  }

  private getRecord(id: string): WorkspaceRecord {
    if (!isSafeId(id)) throw new Error('工作区不存在')
    const record = this.records.find((item) => item.id === id)
    if (!record) throw new Error('工作区不存在')
    return record
  }

  async list(): Promise<WorkspaceListItem[]> {
    await this.ensureReady()
    const results: WorkspaceListItem[] = []
    for (const record of [...this.records]) {
      try {
        results.push(await loadWorkspaceListItem(new NodeFileStore(this.rootOf(record), this.managedRootBoundary), record.name, record.id))
      } catch {
        /* A damaged workspace remains in the registry but is not offered for opening. */
      }
    }
    return results.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
  }

  async getStore(id: string): Promise<FileStore> {
    await this.ensureReady()
    const record = this.getRecord(id)
    return new RevalidatedFileStore(async () => new NodeFileStore(this.rootOf(record), this.managedRootBoundary))
  }

  async summary(id: string, options?: WorkspaceMigrationOptions): Promise<WorkspaceSummary> {
    await this.ensureReady()
    const record = this.getRecord(id)
    return loadSummary(new NodeFileStore(this.rootOf(record), this.managedRootBoundary), record.name, id, options)
  }

  async rename(id: string, name: string): Promise<WorkspaceListItem> {
    await this.ensureReady()
    return this.mutate(async () => {
      const record = this.getRecord(id)
      const store = new NodeFileStore(this.rootOf(record), this.managedRootBoundary)
      const previousName = (await loadWorkspaceListItem(store, record.name, id)).name
      await setWorkspaceName(store, name)
      const oldRecordName = record.name
      const oldUpdatedAt = record.updatedAt
      record.name = name.trim()
      record.updatedAt = Date.now()
      try {
        await this.saveRecords()
      } catch (error) {
        record.name = oldRecordName
        record.updatedAt = oldUpdatedAt
        await setWorkspaceName(store, previousName).catch(() => undefined)
        throw error
      }
      return loadWorkspaceListItem(store, record.name, id)
    })
  }

  async create(name: string): Promise<WorkspaceSummary> {
    await this.ensureReady()
    return this.mutate(async () => {
      const safe = safeName(name)
      const now = Date.now()
      const id = `ws_${randomUUID().replace(/-/g, '').slice(0, 12)}`
      const record = { id, name: safe, createdAt: now, updatedAt: now } satisfies WorkspaceRecord
      const root = this.rootOf(record, true)
      try {
        await fs.mkdir(root)
        await initializeWorkspace(new NodeFileStore(root, this.managedRootBoundary), safe)
        const summary = await loadSummary(new NodeFileStore(root, this.managedRootBoundary), safe, id)
        this.records.push({ ...record, name: summary.name })
        try {
          await this.saveRecords()
        } catch (error) {
          this.records = this.records.filter((record) => record.id !== id)
          throw error
        }
        return summary
      } catch (error) {
        await fs.rm(root, { recursive: true, force: true }).catch(() => undefined)
        throw error
      }
    })
  }

  async importArchive(bytes: Uint8Array, suggestedName?: string, signal?: AbortSignal, options?: WorkspaceMigrationOptions): Promise<WorkspaceSummary> {
    await this.ensureReady()
    return this.mutate(async () => {
      throwIfWorkspaceRequestAborted(signal)
      const staging = await fs.mkdtemp(join(this.importsRoot, 'workspace-'))
      let root: string | null = null
      let id: string | null = null
      let published = false
      let recordAdded = false
      try {
        const stagingStore = new NodeFileStore(staging, this.managedRootBoundary)
        await importWorkspaceArchive(stagingStore, bytes, options)
        throwIfWorkspaceRequestAborted(signal)
        const imported = await loadSummary(stagingStore, '导入工作区', 'pending')
        id = `ws_${randomUUID().replace(/-/g, '').slice(0, 12)}`
        root = this.rootOf({ id, name: '导入工作区', createdAt: 0, updatedAt: 0 }, true)
        const displayName = suggestedName?.trim() ? safeName(suggestedName) : imported.name
        await setWorkspaceName(stagingStore, displayName)
        throwIfWorkspaceRequestAborted(signal)
        await fs.rename(staging, root)
        published = true
        throwIfWorkspaceRequestAborted(signal)
        const now = Date.now()
        this.records.push({ id, name: displayName, createdAt: now, updatedAt: now })
        recordAdded = true
        try {
          await this.saveRecords()
          throwIfWorkspaceRequestAborted(signal)
        } catch (error) {
          this.records = this.records.filter((record) => record.id !== id)
          throw error
        }
        const summary = await loadSummary(new NodeFileStore(root, this.managedRootBoundary), displayName, id)
        Object.defineProperty(summary, importRollbackReceipt, {
          value: { id, root: this.canonicalPath(root), createdAt: now, consumed: false } satisfies ImportRollbackReceipt,
          enumerable: false
        })
        return summary
      } catch (error) {
        if (recordAdded && id) {
          this.records = this.records.filter((record) => record.id !== id)
          await this.saveRecords().catch(() => undefined)
        }
        await fs.rm(published && root ? root : staging, { recursive: true, force: true }).catch(() => undefined)
        throw error
      }
    })
  }

  async removeImported(summary: WorkspaceSummary): Promise<void> {
    const receipt = (summary as ImportedWorkspaceSummary)[importRollbackReceipt]
    if (!receipt || receipt.consumed) return
    receipt.consumed = true
    try {
      await this.ensureReady()
      await this.mutate(async () => {
        const index = this.records.findIndex((record) => record.id === receipt.id)
        if (index < 0) return
        const record = this.records[index]
        if (record.createdAt !== receipt.createdAt) return

        let root: string
        try { root = this.rootOf(record, true) } catch { return }
        if (this.canonicalPath(root) !== receipt.root) return

        const previous = this.records
        this.records = this.records.filter((_record, recordIndex) => recordIndex !== index)
        try {
          await this.saveRecords()
          await fs.rm(root, { recursive: true, force: true })
        } catch (error) {
          this.records = previous
          await this.saveRecords().catch(() => undefined)
          throw error
        }
      })
    } catch (error) {
      receipt.consumed = false
      throw error
    }
  }

  async openPath(input: string, signal?: AbortSignal, options?: WorkspaceMigrationOptions): Promise<WorkspaceSummary> {
    await this.ensureReady()
    return this.mutate(async () => {
      throwIfWorkspaceRequestAborted(signal)
      const value = typeof input === 'string' ? input.trim() : ''
      if (!value) throw new Error('工作区路径不能为空')
      const requested = resolve(value)
      const managed = this.managedRootBoundary
      const target = await fs.realpath(requested).catch(() => { throw new Error('工作区路径不存在') })
      if (this.canonicalPath(target) === managed) throw new Error('不能打开服务器工作区根目录')
      if (!isWithin(managed, this.canonicalPath(target))) throw new Error('工作区路径必须位于服务器工作区目录内')
      const info = await fs.stat(target)
      if (!info.isDirectory()) throw new Error('工作区路径必须是文件夹')
      const valid = await validateWorkspace(new NodeFileStore(target, this.managedRootBoundary))
      if (!valid.ok) throw new Error(valid.reason)
      throwIfWorkspaceRequestAborted(signal)

      const targetIdentity = this.canonicalPath(target)
      const store = this.storeForPath(target)
      await migrateWorkspace(store, options)
      throwIfWorkspaceRequestAborted(signal)
      for (const record of this.records) {
        try {
          if (this.canonicalPath(this.rootOf(record)) === targetIdentity) return loadReadOnlySummary(store, record.name, record.id)
        } catch {
          /* A damaged registry record must not block opening another valid workspace. */
        }
      }

      const id = `ws_${randomUUID().replace(/-/g, '').slice(0, 12)}`
      const directory = relative(managed, target)
      const summary = await loadReadOnlySummary(store, basename(target), id)
      const now = Date.now()
      this.records.push({ id, name: summary.name, directory, createdAt: now, updatedAt: now })
      try {
        await this.saveRecords()
        throwIfWorkspaceRequestAborted(signal)
      } catch (error) {
        this.records = this.records.filter((record) => record.id !== id)
        await this.saveRecords().catch(() => undefined)
        throw error
      }
      return { ...summary, path: id }
    })
  }
}
