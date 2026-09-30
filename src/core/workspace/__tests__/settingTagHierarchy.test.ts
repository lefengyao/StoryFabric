import { describe, expect, it } from 'vitest'
import { MemoryFileStore } from '../../storage/fileStore'
import { getSetting, listSettings, saveSetting } from '../entityStore'

describe('setting tag hierarchy', () => {
  it('round trips explicit tag parents through front matter', async () => {
    const store = new MemoryFileStore()
    const saved = await saveSetting(store, {
      title: '世界观', tags: ['势力', '哈夫克', '安保部门'],
      tagParents: { 哈夫克: '势力', 安保部门: '哈夫克' }
    })

    expect((await getSetting(store, saved.id))?.tagParents).toEqual({ 哈夫克: '势力', 安保部门: '哈夫克' })
    expect((await listSettings(store))[0].tagParents).toEqual({ 哈夫克: '势力', 安保部门: '哈夫克' })
    expect(await store.readText('settings/background/世界观.md')).toContain('tagParents:')
  })

  it('rejects missing parents and cycles without changing the saved setting', async () => {
    const store = new MemoryFileStore()
    const saved = await saveSetting(store, { title: '世界观', tags: ['势力', '哈夫克'] })
    await expect(saveSetting(store, { id: saved.id, tagParents: { 哈夫克: '不存在' } })).rejects.toThrow('父标签')
    await expect(saveSetting(store, { id: saved.id, tagParents: { 哈夫克: '势力', 势力: '哈夫克' } })).rejects.toThrow('循环')
    expect((await getSetting(store, saved.id))?.tagParents).toBeUndefined()
  })
})
