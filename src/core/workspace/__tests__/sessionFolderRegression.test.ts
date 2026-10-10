import { describe, expect, it } from 'vitest'
import { MemoryFileStore } from '../../storage/fileStore'
import { CoreSessionStore } from '../sessionStore'

describe('session folder regression', () => {
  it('stores session.json and tmp under a dated session directory, archives metadata only, and deletes one directory', async () => {
    const store = new MemoryFileStore()
    const sessions = new CoreSessionStore(store)
    const first = await sessions.create()
    first.title = '测试会话'
    await sessions.save(first)
    const second = await sessions.create()
    second.title = '另一个会话'
    await sessions.save(second)

    const dirs = await store.listDirs('.storyfabric/sessions')
    expect(dirs).toHaveLength(2)
    expect(dirs.every((dir) => /^\d{4}-\d{2}-\d{2}-.+-sess_/.test(dir))).toBe(true)
    const firstDir = dirs.find((dir) => dir.endsWith(first.id))
    const secondDir = dirs.find((dir) => dir.endsWith(second.id))
    if (!firstDir || !secondDir) throw new Error('会话目录未按会话 id 创建')
    expect(await store.listFiles(`.storyfabric/sessions/${firstDir}`)).toContain('session.json')
    await store.ensureDir(`.storyfabric/sessions/${firstDir}/tmp/run_test`)

    expect(await sessions.updateMeta(first.id, { archived: true })).toBe(true)
    const archived = await sessions.load(first.id)
    expect(archived?.archived).toBe(true)
    expect(await store.exists(`.storyfabric/sessions/${firstDir}/tmp/run_test`)).toBe(true)

    await sessions.delete(first.id)
    expect(await store.exists(`.storyfabric/sessions/${firstDir}`)).toBe(false)
    expect(await store.exists(`.storyfabric/sessions/${secondDir}/session.json`)).toBe(true)
  })

  it('repairs a legacy orphaned tool call when loading an existing session and persists it once', async () => {
    const store = new MemoryFileStore()
    const sessions = new CoreSessionStore(store)
    const session = await sessions.create()
    session.title = '旧工具历史'
    session.messages = [{
      id: 'assistant-1',
      role: 'assistant',
      text: '',
      toolCalls: [{ id: 'call-1', name: 'save_chapter', argsJson: '{}' }]
    }]
    await sessions.save(session)

    const loaded = await sessions.load(session.id)
    expect(loaded?.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'tool', toolCallId: 'call-1', isError: true })
    ]))
    const dir = (await store.listDirs('.storyfabric/sessions')).find((item) => item.endsWith(session.id))
    if (!dir) throw new Error('会话目录未创建')
    const persisted = JSON.parse((await store.readText(`.storyfabric/sessions/${dir}/session.json`)) ?? '{}') as { messages?: Array<{ role?: string; toolCallId?: string }> }
    expect(persisted.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'tool', toolCallId: 'call-1' })
    ]))
  })
})
