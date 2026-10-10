import { describe, expect, it } from 'vitest'
import { builtinPackages } from '../builtin'
import { GlobalSkillLibrary } from '../globalSkillLibrary'
import { MemoryFileStore } from '../../storage/fileStore'

describe('global skill library', () => {
  it('shares enabled packages between project contexts without writing workspace packages', async () => {
    const store = new MemoryFileStore()
    const projectA = new GlobalSkillLibrary(store, 'creative/skills')
    const projectB = new GlobalSkillLibrary(store, 'creative/skills')
    const pkg = builtinPackages[0]

    await projectA.install(pkg, true)
    expect((await projectB.list({ enabledOnly: true })).map((item) => item.manifest.id)).toContain(pkg.manifest.id)
    expect(await store.listFiles('.storyfabric/creative/packages')).toEqual([])
    expect(await store.readText('creative/skills/index.json')).toContain(pkg.manifest.id)

    await projectB.setEnabled(pkg.manifest.id, pkg.manifest.version, false)
    expect((await projectA.list({ enabledOnly: true })).some((item) => item.manifest.id === pkg.manifest.id)).toBe(false)
  })

  it('rejects same-version content replacement and supports an explicit base hash', async () => {
    const store = new MemoryFileStore()
    const library = new GlobalSkillLibrary(store)
    const pkg = builtinPackages[1]
    const installed = await library.install(pkg, true)
    const changed = structuredClone(pkg)
    changed.files[0].content += '\n新增限制'

    await expect(library.install(changed, true)).rejects.toThrow('禁止静默覆盖')
    await expect(library.install(pkg, true, 'different-hash')).rejects.toThrow('版本已变化')
    expect((await library.get(pkg.manifest.id, pkg.manifest.version))?.contentHash).toBe(installed.contentHash)
  })
})
