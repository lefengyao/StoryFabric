import { describe, expect, it } from 'vitest'
import { MemoryFileStore } from '../../storage/fileStore'
import { getSetting, listSettings, saveSetting } from '../entityStore'

describe('setting tag hierarchy', () => {
  it('round trips setting summary and per-tag summary and detail, while leaving legacy fields empty', async () => {
    const store = new MemoryFileStore()
    const saved = await saveSetting(store, { title: '能量体系', summary: '世界的基础', content: '根节点详细设定', tags: ['灵力'], tagDetails: { 灵力: { summary: '运转世界', content: '详细规则\n第二行' } } })
    expect(await getSetting(store, saved.id)).toMatchObject({ summary: '世界的基础', content: '根节点详细设定', tagDetails: { 灵力: { summary: '运转世界', content: '详细规则\n第二行' } } })
    expect((await listSettings(store))[0]).toMatchObject({ summary: '世界的基础', tagDetails: { 灵力: { summary: '运转世界', content: '详细规则\n第二行' } } })
    const legacy = await saveSetting(store, { title: '旧设定', tags: ['旧标签'] })
    expect((await getSetting(store, legacy.id))?.tagDetails).toBeUndefined()
  })

  it('rejects tag details for unknown tags or non-string content', async () => {
    const store = new MemoryFileStore()
    await expect(saveSetting(store, { title: '错误', tags: ['灵力'], tagDetails: { 其他: { content: '内容' } } })).rejects.toThrow('标签详情')
    await expect(saveSetting(store, { title: '错误', tags: ['灵力'], tagDetails: { 灵力: { content: 42 as unknown as string } } })).rejects.toThrow('标签详情')
  })
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
