import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { NodeFileStore } from '../core/storage/nodeFileStore'
import { importWorkspaceArchive } from '../core/workspace/archive'
import { listCharacters, listChapters, listEvents, listNotes, listOutline, listSettings, loadRelationships } from '../core/workspace/entityStore'
import { CURRENT_WORKSPACE_VERSION } from '../core/workspace/migration'
import { listTrash } from '../core/workspace/trash'
import { initializeWorkspace, loadSummary, loadWorkspaceListItem, setWorkspaceName, validateWorkspace } from '../core/workspace/workspaceService'
import type { VolumeMeta, WorkspaceListItem, WorkspaceSummary } from '../shared/types'

interface WorkspaceRecord {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  directory?: string
}

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

async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path)
    return true
  } catch {
    return false
  }
}

async function loadReadOnlySummary(store: NodeFileStore, fallbackName: string, path: string): Promise<WorkspaceSummary> {
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

/** Maps opaque server workspace IDs to directories beneath one managed root. */
export class WorkspaceRegistry {
  private readonly managedRoot: string
  private readonly registryPath: string
  private readonly importsRoot: string
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
    await fs.mkdir(this.importsRoot, { recursive: true })
    await this.cleanupStaging()
    await this.loadRecords()
    await this.migrateLegacyWorkspace()
    if (!this.records.length) {
      const root = this.directoryOf({ id: 'default', name: 'StoryFabric', createdAt: 0, updatedAt: 0 })
      await fs.mkdir(root, { recursive: true })
      await initializeWorkspace(new NodeFileStore(root), 'StoryFabric')
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
    const directories = await Promise.all(this.records.map((record) => this.identityOf(record)))
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

  private directoryOf(record: WorkspaceRecord): string {
    const directory = record.directory === undefined ? record.id : record.directory.trim()
    if (!directory || isAbsolute(directory) || directory.split(/[\\/]/).includes('..')) throw new Error('工作区目录无效')
    const root = resolve(this.managedRoot, directory)
    if (!isWithin(this.managedRoot, root)) throw new Error('工作区目录越界')
    return root
  }

  private rootOf(record: WorkspaceRecord): string {
    return this.directoryOf(record)
  }

  private canonicalPath(path: string): string {
    const normalized = resolve(path)
    return process.platform === 'win32' ? normalized.toLocaleLowerCase() : normalized
  }

  private async identityOf(record: WorkspaceRecord): Promise<string> {
    const root = this.rootOf(record)
    try {
      return this.canonicalPath(await fs.realpath(root))
    } catch {
      return this.canonicalPath(root)
    }
  }

  private async migrateLegacyWorkspace(): Promise<void> {
    const legacy = resolve(this.legacyWorkspaceRoot)
    const target = this.rootOf({ id: 'default', name: 'StoryFabric', createdAt: 0, updatedAt: 0 })
    if (legacy === target || !(await exists(join(legacy, 'storyfabric.json')))) return
    if (this.records.some((record) => record.id === 'default')) return
    if (await exists(target)) throw new Error('检测到旧工作区，但默认受管工作区已存在；为避免覆盖，服务未启动')

    await fs.rename(legacy, target)
    const summary = await loadSummary(new NodeFileStore(target), basename(target), 'default')
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
        results.push(await loadWorkspaceListItem(new NodeFileStore(this.rootOf(record)), record.name, record.id))
      } catch {
        /* A damaged workspace remains in the registry but is not offered for opening. */
      }
    }
    return results.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
  }

  async getStore(id: string): Promise<NodeFileStore> {
    await this.ensureReady()
    const record = this.getRecord(id)
    return new NodeFileStore(this.rootOf(record))
  }

  async summary(id: string): Promise<WorkspaceSummary> {
    await this.ensureReady()
    const record = this.getRecord(id)
    return loadSummary(new NodeFileStore(this.rootOf(record)), record.name, id)
  }

  async create(name: string): Promise<WorkspaceSummary> {
    await this.ensureReady()
    return this.mutate(async () => {
      const safe = safeName(name)
      const now = Date.now()
      const id = `ws_${randomUUID().replace(/-/g, '').slice(0, 12)}`
      const record = { id, name: safe, createdAt: now, updatedAt: now } satisfies WorkspaceRecord
      const root = this.rootOf(record)
      try {
        await fs.mkdir(root)
        await initializeWorkspace(new NodeFileStore(root), safe)
        const summary = await loadSummary(new NodeFileStore(root), safe, id)
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

  async importArchive(bytes: Uint8Array, suggestedName?: string): Promise<WorkspaceSummary> {
    await this.ensureReady()
    return this.mutate(async () => {
      const staging = await fs.mkdtemp(join(this.importsRoot, 'workspace-'))
      let root: string | null = null
      let id: string | null = null
      let published = false
      let recordAdded = false
      try {
        const stagingStore = new NodeFileStore(staging)
        await importWorkspaceArchive(stagingStore, bytes)
        const imported = await loadSummary(stagingStore, '导入工作区', 'pending')
        id = `ws_${randomUUID().replace(/-/g, '').slice(0, 12)}`
        root = this.rootOf({ id, name: '导入工作区', createdAt: 0, updatedAt: 0 })
        const displayName = suggestedName?.trim() ? safeName(suggestedName) : imported.name
        await setWorkspaceName(stagingStore, displayName)
        await fs.rename(staging, root)
        published = true
        const now = Date.now()
        this.records.push({ id, name: displayName, createdAt: now, updatedAt: now })
        recordAdded = true
        try {
          await this.saveRecords()
        } catch (error) {
          this.records = this.records.filter((record) => record.id !== id)
          throw error
        }
        return loadSummary(new NodeFileStore(root), displayName, id)
      } catch (error) {
        if (recordAdded && id) this.records = this.records.filter((record) => record.id !== id)
        await fs.rm(published && root ? root : staging, { recursive: true, force: true }).catch(() => undefined)
        throw error
      }
    })
  }

  async openPath(input: string): Promise<WorkspaceSummary> {
    await this.ensureReady()
    return this.mutate(async () => {
      const value = typeof input === 'string' ? input.trim() : ''
      if (!value) throw new Error('工作区路径不能为空')
      const requested = resolve(value)
      const managed = await fs.realpath(this.managedRoot)
      const target = await fs.realpath(requested).catch(() => { throw new Error('工作区路径不存在') })
      if (target === managed) throw new Error('不能打开服务器工作区根目录')
      if (!isWithin(managed, target)) throw new Error('工作区路径必须位于服务器工作区目录内')
      const info = await fs.stat(target)
      if (!info.isDirectory()) throw new Error('工作区路径必须是文件夹')
      const valid = await validateWorkspace(new NodeFileStore(target))
      if (!valid.ok) throw new Error(valid.reason)

      const targetIdentity = this.canonicalPath(target)
      for (const record of this.records) {
        if (await this.identityOf(record) === targetIdentity) return loadReadOnlySummary(new NodeFileStore(target), record.name, record.id)
      }

      const id = `ws_${randomUUID().replace(/-/g, '').slice(0, 12)}`
      const directory = relative(managed, target)
      const summary = await loadReadOnlySummary(new NodeFileStore(target), basename(target), id)
      const now = Date.now()
      this.records.push({ id, name: summary.name, directory, createdAt: now, updatedAt: now })
      try {
        await this.saveRecords()
      } catch (error) {
        this.records = this.records.filter((record) => record.id !== id)
        throw error
      }
      return { ...summary, path: id }
    })
  }
}
