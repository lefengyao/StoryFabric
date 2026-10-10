import { describe, expect, it } from 'vitest'
import type { StoryFabricApi } from '../../../shared/api'
import { MemoryFileStore } from '../../../core/storage/fileStore'
import { deleteSetting, getSetting, listSettings, saveSetting } from '../../../core/workspace/entityStore'
import { listTrash } from '../../../core/workspace/trash'
import { buildSettingsTree, type SettingsTreeNode } from './settingsTree'
import { addSettingsChildNode, deleteSettingsNode } from './settingsNodeActions'

function settingApi(store: MemoryFileStore): Pick<StoryFabricApi, 'getSetting' | 'saveSetting' | 'deleteSetting'> {
  return {
    getSetting: (id) => getSetting(store, id),
    saveSetting: (input) => saveSetting(store, input),
    deleteSetting: (id) => deleteSetting(store, id)
  }
}

async function findNode(store: MemoryFileStore, title: string): Promise<SettingsTreeNode> {
  return buildSettingsTree(await listSettings(store)).nodes.find((node) => node.title === title)!
}

describe('setting graph node actions', () => {
  it('adds all three fields below a setting without changing its existing content', async () => {
    const store = new MemoryFileStore()
    const root = await saveSetting(store, { title: '世界', summary: '根简述', content: '根正文', tags: ['旧节点'], tagDetails: { 旧节点: { content: '旧详情' } } })
    await addSettingsChildNode(settingApi(store), await findNode(store, '世界'), { title: ' 灵力 ', summary: '运转世界', content: '规则\n\n  保留缩进' })
    expect(await getSetting(store, root.id)).toMatchObject({
      summary: '根简述', content: '根正文', tags: ['旧节点', '灵力'],
      tagDetails: { 旧节点: { content: '旧详情' }, 灵力: { summary: '运转世界', content: '规则\n\n  保留缩进' } }
    })
    expect((await findNode(store, '灵力')).parentId).toBe(root.id)
  })

  it('adds a nested node using the latest saved parent document', async () => {
    const store = new MemoryFileStore()
    const root = await saveSetting(store, { title: '世界', tags: ['灵力'] })
    const parent = await findNode(store, '灵力')
    await saveSetting(store, { id: root.id, content: '其他地方刚更新的正文', tags: ['灵力', '新兄弟'], tagDetails: { 新兄弟: { content: '刚更新的详情' } } })
    await addSettingsChildNode(settingApi(store), parent, { title: '用途', summary: '运转', content: '**详细规则**' })
    expect(await getSetting(store, root.id)).toMatchObject({
      content: '其他地方刚更新的正文', tags: ['灵力', '新兄弟', '用途'], tagParents: { 用途: '灵力' },
      tagDetails: { 新兄弟: { content: '刚更新的详情' }, 用途: { summary: '运转', content: '**详细规则**' } }
    })
    expect((await findNode(store, '用途')).depth).toBe(2)
  })

  it('rejects empty or duplicate titles and stale parents without modifying saved data', async () => {
    const store = new MemoryFileStore()
    const root = await saveSetting(store, { title: '世界', tags: ['灵力'] })
    const parent = await findNode(store, '灵力')
    const draft = { title: '灵力', summary: '', content: '' }
    await expect(addSettingsChildNode(settingApi(store), parent, draft)).rejects.toThrow('已存在')
    await expect(addSettingsChildNode(settingApi(store), parent, { ...draft, title: '  ' })).rejects.toThrow('标题')
    await saveSetting(store, { id: root.id, tags: [] })
    await expect(addSettingsChildNode(settingApi(store), parent, { ...draft, title: '用途' })).rejects.toThrow('已不存在')
    expect((await getSetting(store, root.id))?.tags).toEqual([])
    const rootNode = await findNode(store, '世界')
    await deleteSetting(store, root.id)
    await expect(addSettingsChildNode(settingApi(store), rootNode, { ...draft, title: '用途' })).rejects.toThrow('已不存在')
  })

  it('deletes only a nested node, reconnecting its children and preserving their details', async () => {
    const store = new MemoryFileStore()
    const root = await saveSetting(store, {
      title: '世界', tags: ['力量', '灵力', '用途', '分支'],
      tagParents: { 灵力: '力量', 用途: '灵力', 分支: '用途' },
      tagDetails: { 灵力: { content: '将删除' }, 用途: { summary: '保留', content: '保留详细内容' }, 分支: { content: '更深层' } }
    })
    await deleteSettingsNode(settingApi(store), await findNode(store, '灵力'))
    const doc = await getSetting(store, root.id)
    expect(doc?.tags).toEqual(['力量', '用途', '分支'])
    expect(doc?.tagParents).toEqual({ 用途: '力量', 分支: '用途' })
    expect(doc?.tagDetails).toEqual({ 用途: { summary: '保留', content: '保留详细内容' }, 分支: { content: '更深层' } })
    expect((await findNode(store, '用途')).depth).toBe(2)
  })

  it('promotes children to the setting when deleting a first-level tag', async () => {
    const store = new MemoryFileStore()
    const root = await saveSetting(store, { title: '世界', tags: ['灵力', '用途'], tagParents: { 用途: '灵力' } })
    await deleteSettingsNode(settingApi(store), await findNode(store, '灵力'))
    expect((await getSetting(store, root.id))?.tagParents).toEqual({})
    expect((await findNode(store, '用途')).parentId).toBe(root.id)
  })

  it('moves a setting and its own tags to trash while keeping independent child settings', async () => {
    const store = new MemoryFileStore()
    const root = await saveSetting(store, { title: '世界', tags: ['灵力'], tagDetails: { 灵力: { content: '详情' } } })
    const child = await saveSetting(store, { title: '独立子设定', parentId: root.id, content: '子设定正文' })
    await deleteSettingsNode(settingApi(store), await findNode(store, '世界'))
    expect(await getSetting(store, root.id)).toBeNull()
    expect(await getSetting(store, child.id)).toMatchObject({ content: '子设定正文' })
    expect((await listTrash(store)).some((entry) => entry.id === root.id)).toBe(true)
  })
})
