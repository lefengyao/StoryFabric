import type { FileStore } from '../storage/fileStore'
import { validateContentPackage } from './packageValidator'
import type { ContentPackage, InstalledContentPackage } from './types'

export class ContentPackageStore {
  constructor(private readonly store: FileStore, private readonly root = '.storyfabric/creative/packages') {}

  async save(pkg: ContentPackage, enabled = false): Promise<InstalledContentPackage> {
    const validated = validateContentPackage(pkg)
    const base = `${this.root}/${validated.manifest.id}/${validated.manifest.version}`
    await this.store.ensureDir(base)
    await this.store.writeText(`${base}/manifest.json`, JSON.stringify(validated.manifest, null, 2))
    for (const file of validated.files) await this.store.writeText(`${base}/${file.path}`, file.content)
    await this.store.writeText(`${base}/state.json`, JSON.stringify({ enabled }))
    return { ...validated, enabled, installedAt: Date.now() }
  }
}
