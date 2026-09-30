import { describe, expect, it } from 'vitest'
import { MemoryFileStore } from '../../storage/fileStore'
import { getSetting } from '../../workspace/entityStore'
import { initializeWorkspace } from '../../workspace/workspaceService'
import { SYSTEM_PROMPT } from '../../agent/prompts'
import { executeTool, TOOL_DEFS } from '../registry'

describe('agent setting hierarchy contract', () => {
  it('advertises and saves nested tags and setting parents', async () => {
    const schema = (TOOL_DEFS.find((tool) => tool.name === 'save_setting')?.parameters as { properties?: { setting?: { properties?: Record<string, unknown> } } })?.properties?.setting
    expect(schema?.properties).toHaveProperty('parentId')
    expect(schema?.properties).toHaveProperty('tagParents')
    expect(schema?.properties).toHaveProperty('summary')
    expect(schema?.properties).toHaveProperty('tagDetails')
    expect(SYSTEM_PROMPT).toContain('tagParents')

    const store = new MemoryFileStore()
    await initializeWorkspace(store, '设定树')
    const outcome = await executeTool(store, 'save_setting', JSON.stringify({ setting: {
      title: '世界观', summary: '总览', tags: ['势力', '哈夫克'], tagParents: { 哈夫克: '势力' }, tagDetails: { 势力: { summary: '各方组织', content: '组织详情' } }
    } }))
    expect(outcome.kind).toBe('pending')
    if (outcome.kind !== 'pending') return
    await outcome.apply()
    expect((await getSetting(store, outcome.change.entityId))?.tagParents).toEqual({ 哈夫克: '势力' })
    expect(await getSetting(store, outcome.change.entityId)).toMatchObject({ summary: '总览', tagDetails: { 势力: { summary: '各方组织', content: '组织详情' } } })

    const child = await executeTool(store, 'save_setting', JSON.stringify({ setting: {
      title: '三方博弈', parentId: outcome.change.entityId, tags: ['哈夫克']
    } }))
    expect(child.kind).toBe('pending')
    if (child.kind !== 'pending') return
    await child.apply()
    expect((await getSetting(store, child.change.entityId))?.parentId).toBe(outcome.change.entityId)
  })
})
