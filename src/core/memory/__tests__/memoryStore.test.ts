import { describe, expect, it } from 'vitest'
import { MemoryFileStore } from '../../storage/fileStore'
import { MemoryStore } from '../memoryStore'
import { executeMemoryTool } from '../memoryTool'

describe('two-scope user memory', () => {
  it('starts disabled and keeps global and project Markdown isolated', async () => {
    const global = new MemoryFileStore()
    const projectA = new MemoryFileStore()
    const projectB = new MemoryFileStore()
    const a = new MemoryStore(global, projectA)
    const b = new MemoryStore(global, projectB)
    expect(await a.prompt()).toBe('')
    expect(await a.remember('global', '喜欢简洁回答')).toBe(false)
    const globalSnapshot = await a.read('global')
    await a.update('global', { baseRevision: globalSnapshot.revision, enabled: true, content: '- 喜欢简洁回答\n' })
    const projectSnapshot = await a.read('project')
    await a.update('project', { baseRevision: projectSnapshot.revision, enabled: true, content: '- 本项目用第三人称\n' })
    expect(await a.prompt()).toContain('本项目用第三人称')
    expect(await b.prompt()).toContain('喜欢简洁回答')
    expect(await b.prompt()).not.toContain('本项目用第三人称')
    expect(await global.readText('memory/global.md')).toContain('enabled: true')
    expect(await projectA.readText('.storyfabric/memory.md')).toContain('本项目用第三人称')
    expect(await projectB.readText('.storyfabric/memory.md')).toBeNull()
  })

  it('remembers once when enabled, stops when disabled, and rejects stale edits', async () => {
    const memory = new MemoryStore(new MemoryFileStore(), new MemoryFileStore())
    const initial = await memory.read('project')
    const enabled = await memory.update('project', { baseRevision: initial.revision, enabled: true })
    expect(await memory.remember('project', '请使用短句')).toBe(true)
    expect(await memory.remember('project', '请使用短句')).toBe(true)
    expect((await memory.read('project')).content).toBe('- 请使用短句\n')
    await expect(memory.update('project', { baseRevision: enabled.revision, content: '旧内容' })).rejects.toThrow('已被其他操作更新')
    const current = await memory.read('project')
    await memory.update('project', { baseRevision: current.revision, enabled: false })
    expect(await memory.remember('project', '不要记录')).toBe(false)
    expect(await memory.prompt()).toBe('')
    expect((await memory.read('project')).content).toContain('请使用短句')
  })

  it('agent tool respects the toggle and validates scope', async () => {
    const memory = new MemoryStore(new MemoryFileStore(), new MemoryFileStore())
    expect(await executeMemoryTool(memory, '{"scope":"global","preference":"偏好克制叙事","evidence":"偏好克制叙事"}', '我偏好克制叙事')).toMatchObject({ kind: 'result', ok: false })
    const before = await memory.read('global')
    await memory.update('global', { baseRevision: before.revision, enabled: true })
    expect(await executeMemoryTool(memory, '{"scope":"global","preference":"偏好克制叙事","evidence":"偏好克制叙事"}', '我偏好克制叙事')).toMatchObject({ kind: 'result', ok: true })
    expect((await memory.read('global')).content).toContain('偏好克制叙事')
    expect(await executeMemoryTool(memory, '{"scope":"other","preference":"x","evidence":"偏好克制叙事"}', '我偏好克制叙事')).toMatchObject({ kind: 'result', ok: false })
    expect(await executeMemoryTool(memory, '{"scope":"global","preference":"无依据","evidence":"不存在的原话"}', '我偏好克制叙事')).toMatchObject({ kind: 'result', ok: false })
  })

  it('serializes competing writes across memory service instances', async () => {
    const global = new MemoryFileStore()
    const project = new MemoryFileStore()
    const first = new MemoryStore(global, project)
    const second = new MemoryStore(global, project)
    const revision = (await first.read('global')).revision
    const results = await Promise.allSettled([
      first.update('global', { baseRevision: revision, content: '- 第一条\n' }),
      second.update('global', { baseRevision: revision, content: '- 第二条\n' })
    ])
    expect(results.filter((item) => item.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((item) => item.status === 'rejected')).toHaveLength(1)
  })

  it('points to the memory page when a scope is full', async () => {
    const memory = new MemoryStore(new MemoryFileStore(), new MemoryFileStore())
    const initial = await memory.read('project')
    await memory.update('project', { baseRevision: initial.revision, enabled: true, content: 'x'.repeat(16_000) })

    await expect(memory.remember('project', '新的偏好')).rejects.toThrow('记忆已满，请先在记忆页整理')
  })
})
