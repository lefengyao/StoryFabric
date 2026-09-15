import type { FileStore } from '../storage/fileStore'
import { validateContentPackage } from './packageValidator'
import type { ContentPackage, InstalledContentPackage } from './types'
import type { CreativePackageSummary } from '../../shared/creative'

export function summarizeContentPackage(pkg: InstalledContentPackage): CreativePackageSummary {
  return {
    id: pkg.manifest.id,
    version: pkg.manifest.version,
    name: pkg.manifest.name,
    description: pkg.manifest.description,
    enabled: pkg.enabled,
    skills: pkg.manifest.skills.map((item) => item.id),
    ruleSets: pkg.manifest.ruleSets.map((item) => item.id)
  }
}

export class ContentPackageStore {
  constructor(private readonly store: FileStore, private readonly root = '.storyfabric/creative/packages') {}

  async save(pkg: ContentPackage, enabled = false): Promise<InstalledContentPackage> {
    const validated = validateContentPackage(pkg)
    const base = `${this.root}/${validated.manifest.id}/${validated.manifest.version}`
    await this.store.ensureDir(base)
    const installed: InstalledContentPackage = { ...validated, enabled, installedAt: Date.now() }
    await this.store.writeText(`${base}/package.json`, JSON.stringify(installed, null, 2))
    await this.store.writeText(`${base}/manifest.json`, JSON.stringify(validated.manifest, null, 2))
    for (const file of validated.files) await this.store.writeText(`${base}/${file.path}`, file.content)
    await this.store.writeText(`${base}/state.json`, JSON.stringify({ enabled }))
    return installed
  }

  async get(id: string, version: string): Promise<InstalledContentPackage | null> {
    const text = await this.store.readText(`${this.root}/${id}/${version}/package.json`)
    if (!text) return null
    try { return this.readInstalled(JSON.parse(text)) } catch { return null }
  }

  async list(options: { enabledOnly?: boolean } = {}): Promise<InstalledContentPackage[]> {
    const result: InstalledContentPackage[] = []
    for (const id of await this.store.listDirs(this.root)) {
      for (const version of await this.store.listDirs(`${this.root}/${id}`)) {
        const item = await this.get(id, version)
        if (item && (!options.enabledOnly || item.enabled)) result.push(item)
      }
    }
    return result.sort((a, b) => `${a.manifest.id}@${a.manifest.version}`.localeCompare(`${b.manifest.id}@${b.manifest.version}`))
  }

  async setEnabled(id: string, version: string, enabled: boolean): Promise<InstalledContentPackage> {
    const item = await this.get(id, version)
    if (!item) throw new Error('找不到内容包版本')
    const next = { ...item, enabled }
    await this.store.writeText(`${this.root}/${id}/${version}/package.json`, JSON.stringify(next, null, 2))
    await this.store.writeText(`${this.root}/${id}/${version}/state.json`, JSON.stringify({ enabled }))
    return next
  }

  async uninstall(id: string, version: string): Promise<void> {
    if (!(await this.get(id, version))) throw new Error('找不到内容包版本')
    await this.store.remove(`${this.root}/${id}/${version}`)
  }

  private readInstalled(value: unknown): InstalledContentPackage {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('内容包记录无效')
    const raw = value as Partial<InstalledContentPackage>
    const validated = validateContentPackage({ manifest: raw.manifest, files: raw.files ?? [] })
    if (typeof raw.enabled !== 'boolean' || typeof raw.installedAt !== 'number') throw new Error('内容包状态无效')
    return { ...validated, enabled: raw.enabled, installedAt: raw.installedAt }
  }
}
