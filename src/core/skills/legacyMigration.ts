import type { FileStore } from '../storage/fileStore'
import { GlobalSkillLibrary, type GlobalSkillPackage } from './globalSkillLibrary'
import { ContentPackageStore } from './packageStore'

export interface SkillMigrationItem {
  id: string
  version: string
  status: 'ready' | 'already-installed' | 'conflict'
  reason?: string
}

export async function previewLegacySkillMigration(workspaceStore: FileStore, globalLibrary: GlobalSkillLibrary): Promise<SkillMigrationItem[]> {
  const legacy = await new ContentPackageStore(workspaceStore).list()
  const result: SkillMigrationItem[] = []
  for (const pkg of legacy) {
    const existing = await globalLibrary.get(pkg.manifest.id, pkg.manifest.version)
    if (!existing) {
      result.push({ id: pkg.manifest.id, version: pkg.manifest.version, status: 'ready' })
      continue
    }
    const same = JSON.stringify({ manifest: existing.manifest, files: existing.files }) === JSON.stringify({ manifest: pkg.manifest, files: pkg.files })
    result.push({ id: pkg.manifest.id, version: pkg.manifest.version, status: same ? 'already-installed' : 'conflict', reason: same ? undefined : '全局库已有同 ID 同版本的不同内容' })
  }
  return result
}

/** Copies legacy workspace packages to the global library. It never deletes legacy files. */
export async function migrateLegacySkills(workspaceStore: FileStore, globalLibrary: GlobalSkillLibrary): Promise<{ migrated: GlobalSkillPackage[]; skipped: SkillMigrationItem[] }> {
  const legacy = await new ContentPackageStore(workspaceStore).list()
  const migrated: GlobalSkillPackage[] = []
  const skipped: SkillMigrationItem[] = []
  for (const pkg of legacy) {
    try {
      const existing = await globalLibrary.get(pkg.manifest.id, pkg.manifest.version)
      if (existing) {
        const same = JSON.stringify({ manifest: existing.manifest, files: existing.files }) === JSON.stringify({ manifest: pkg.manifest, files: pkg.files })
        skipped.push({ id: pkg.manifest.id, version: pkg.manifest.version, status: same ? 'already-installed' : 'conflict', reason: same ? undefined : '全局库已有同 ID 同版本的不同内容' })
        continue
      }
      migrated.push(await globalLibrary.install({ manifest: pkg.manifest, files: pkg.files }, pkg.enabled))
    } catch (error) {
      skipped.push({ id: pkg.manifest.id, version: pkg.manifest.version, status: 'conflict', reason: error instanceof Error ? error.message : String(error) })
    }
  }
  return { migrated, skipped }
}

