import { describe, expect, it } from 'vitest'
import { MemoryFileStore } from '../../storage/fileStore'
import { GlobalSkillLibrary } from '../globalSkillLibrary'
import { migrateLegacySkills, previewLegacySkillMigration } from '../legacyMigration'
import { ContentPackageStore } from '../packageStore'
import type { ContentPackage } from '../types'

const pkg: ContentPackage = {
  manifest: { schemaVersion: 1, id: 'legacy-pack', version: '1.0.0', name: '旧 Skill', description: '迁移测试', author: 'test', license: 'MIT', minAppVersion: '0.1.0', platforms: ['windows'], skills: [{ id: 'legacy', path: 'skills/legacy/SKILL.md' }], ruleSets: [] },
  files: [{ path: 'skills/legacy/SKILL.md', content: '---\nid: legacy\nname: 旧 Skill\nstages: [write]\n---\n保留旧内容。' }]
}

describe('legacy skill migration', () => {
  it('previews and copies without deleting workspace packages', async () => {
    const workspace = new MemoryFileStore()
    const global = new GlobalSkillLibrary(new MemoryFileStore())
    await new ContentPackageStore(workspace).save(pkg, false)
    expect((await previewLegacySkillMigration(workspace, global))[0].status).toBe('ready')
    const result = await migrateLegacySkills(workspace, global)
    expect(result.migrated).toHaveLength(1)
    expect(await new ContentPackageStore(workspace).get('legacy-pack', '1.0.0')).not.toBeNull()
    expect((await previewLegacySkillMigration(workspace, global))[0].status).toBe('already-installed')
  })
})

