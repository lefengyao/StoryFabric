import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionStore } from '../sessionStore'

let root: string

beforeEach(async () => {
  root = join(tmpdir(), `sf-sess-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)
  await fs.mkdir(root, { recursive: true })
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('SessionStore', () => {
  it('保存、读取、列表统计', async () => {
    const store = new SessionStore(root)
    const s = await store.create()
    s.messages.push(
      { id: 'm1', role: 'user', text: '你好' },
      { id: 'm2', role: 'assistant', text: '你好！' },
      { id: 'm3', role: 'tool', toolCallId: 't1', toolName: 'f', text: '{}' }
    )
    await store.save(s)

    const loaded = await store.load(s.id)
    expect(loaded?.messages).toHaveLength(3)
    expect(loaded?.archived).toBe(false)

    const metas = await store.list()
    expect(metas[0]).toMatchObject({ id: s.id, title: '新会话', messageCount: 2, archived: false })
  })

  it('updateMeta 重命名与归档；目标不存在返回 false', async () => {
    const store = new SessionStore(root)
    const s = await store.create()
    await store.save(s)

    expect(await store.updateMeta(s.id, { title: '  改名会话  ', archived: true })).toBe(true)
    const loaded = await store.load(s.id)
    expect(loaded?.title).toBe('改名会话')
    expect(loaded?.archived).toBe(true)
    expect((await store.list())[0].archived).toBe(true)

    expect(await store.updateMeta('sess_nope', { title: 'x' })).toBe(false)
  })

  it('空标题重命名被忽略', async () => {
    const store = new SessionStore(root)
    const s = await store.create()
    await store.save(s)
    await store.updateMeta(s.id, { title: '原名' })
    await store.updateMeta(s.id, { title: '   ' })
    expect((await store.load(s.id))?.title).toBe('原名')
  })
})
