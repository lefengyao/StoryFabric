import type { FileStore } from '../storage/fileStore'
import { validateContentPackage } from './packageValidator'
import type { ContentPackage, InstalledContentPackage } from './types'

export interface GlobalSkillPackage extends InstalledContentPackage {
  contentHash: string
}

function hashPackage(pkg: ContentPackage): string {
  const body = JSON.stringify({ manifest: pkg.manifest, files: [...pkg.files].sort((a, b) => a.path.localeCompare(b.path)) })
  let value = 2166136261
  for (let i = 0; i < body.length; i += 1) { value ^= body.charCodeAt(i); value = Math.imul(value, 16777619) }
  return (value >>> 0).toString(16).padStart(8, '0')
}

export class GlobalSkillLibrary {
  constructor(private readonly store: FileStore, private readonly root = 'creative/skills') {}

  async install(input: ContentPackage, enabled = true, expectedBaseHash?: string): Promise<GlobalSkillPackage> {
    const validated = validateContentPackage(input)
    const contentHash = hashPackage(validated)
    const existing = await this.get(validated.manifest.id, validated.manifest.version)
    if (expectedBaseHash && existing?.contentHash !== expectedBaseHash) throw new Error('Skill 基于的版本已变化，请重新预览')
    if (existing && existing.contentHash !== contentHash) throw new Error('同 ID 同版本的 Skill 内容不同，禁止静默覆盖')
    const base = `${this.root}/${validated.manifest.id}/${validated.manifest.version}`
    const installed: GlobalSkillPackage = { ...validated, enabled, installedAt: existing?.installedAt ?? Date.now(), contentHash }
    await this.store.ensureDir(base)
    await this.store.writeText(`${base}/package.json`, JSON.stringify(installed, null, 2))
    for (const file of validated.files) await this.store.writeText(`${base}/${file.path}`, file.content)
    await this.writeIndex()
    return structuredClone(installed)
  }

  async ensure(input: ContentPackage, enabled = true): Promise<GlobalSkillPackage> {
    const existing = await this.get(input.manifest.id, input.manifest.version)
    return existing ?? this.install(input, enabled)
  }

  async get(id: string, version: string): Promise<GlobalSkillPackage | null> {
    const raw = await this.store.readText(`${this.root}/${id}/${version}/package.json`)
    if (!raw) return null
    try {
      const value = JSON.parse(raw) as GlobalSkillPackage
      const validated = validateContentPackage({ manifest: value.manifest, files: value.files ?? [] })
      if (typeof value.enabled !== 'boolean' || typeof value.installedAt !== 'number' || typeof value.contentHash !== 'string') return null
      return { ...validated, enabled: value.enabled, installedAt: value.installedAt, contentHash: value.contentHash }
    } catch { return null }
  }

  async list(options: { enabledOnly?: boolean } = {}): Promise<GlobalSkillPackage[]> {
    const result: GlobalSkillPackage[] = []
    for (const id of await this.store.listDirs(this.root)) {
      for (const version of await this.store.listDirs(`${this.root}/${id}`)) {
        const item = await this.get(id, version)
        if (item && (!options.enabledOnly || item.enabled)) result.push(item)
      }
    }
    return result.sort((a, b) => `${a.manifest.id}@${a.manifest.version}`.localeCompare(`${b.manifest.id}@${b.manifest.version}`))
  }

  async setEnabled(id: string, version: string, enabled: boolean): Promise<GlobalSkillPackage> {
    const item = await this.get(id, version)
    if (!item) throw new Error('找不到全局 Skill 版本')
    return this.install({ manifest: item.manifest, files: item.files }, enabled)
  }

  private async writeIndex(): Promise<void> {
    const entries = (await this.list()).map((item) => ({ id: item.manifest.id, version: item.manifest.version, hash: item.contentHash, enabled: item.enabled }))
    await this.store.writeText(`${this.root}/index.json`, JSON.stringify({ schemaVersion: 1, entries }, null, 2))
  }
}
