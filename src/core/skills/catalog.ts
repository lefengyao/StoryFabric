import type { ContentPackage, InstalledContentPackage } from './types'

export class SkillCatalog {
  private readonly packages = new Map<string, InstalledContentPackage>()

  install(pkg: ContentPackage, enabled = false): InstalledContentPackage {
    const item: InstalledContentPackage = { ...pkg, files: pkg.files.map((file) => ({ ...file })), enabled, installedAt: Date.now() }
    this.packages.set(`${pkg.manifest.id}@${pkg.manifest.version}`, item)
    return { ...item, files: item.files.map((file) => ({ ...file })) }
  }

  setEnabled(id: string, version: string, enabled: boolean): void {
    const item = this.packages.get(`${id}@${version}`)
    if (!item) throw new Error('找不到内容包版本')
    item.enabled = enabled
  }

  list(options: { enabledOnly?: boolean } = {}): InstalledContentPackage[] {
    return [...this.packages.values()].filter((item) => !options.enabledOnly || item.enabled).map((item) => ({ ...item, files: item.files.map((file) => ({ ...file })) }))
  }

  get(id: string, version: string): InstalledContentPackage | null {
    const item = this.packages.get(`${id}@${version}`)
    return item ? { ...item, files: item.files.map((file) => ({ ...file })) } : null
  }
}
