import { expect, it } from 'vitest'
import { MemoryFileStore } from '../../storage/fileStore'
import { builtinPackages } from '../builtin'
import { ContentPackageStore } from '../packageStore'

it('persists packages and restores enabled state across a new store instance', async () => {
  const files = new MemoryFileStore()
  const first = new ContentPackageStore(files)
  await first.save(builtinPackages[0], true)
  expect((await first.list()).map((item) => `${item.manifest.id}:${item.enabled}`)).toEqual(['storyfabric.natural-prose:true'])

  const second = new ContentPackageStore(files)
  expect(await second.get('storyfabric.natural-prose', '1.0.0')).toMatchObject({ enabled: true, manifest: { name: '自然叙述' } })
  await second.setEnabled('storyfabric.natural-prose', '1.0.0', false)
  expect((await second.list({ enabledOnly: true })).length).toBe(0)
})

it('uninstalls only the selected package version', async () => {
  const files = new MemoryFileStore()
  const store = new ContentPackageStore(files)
  await store.save(builtinPackages[0])
  await store.save({ ...builtinPackages[0], manifest: { ...builtinPackages[0].manifest, version: '1.1.0' } })
  await store.uninstall('storyfabric.natural-prose', '1.0.0')
  expect((await store.list()).map((item) => item.manifest.version)).toEqual(['1.1.0'])
})
