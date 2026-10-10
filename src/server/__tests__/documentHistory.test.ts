import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import type { AddressInfo } from 'node:net'
import { expect, it } from 'vitest'
import { createStoryFabricServer } from '../server'
import type { StoryFabricApi } from '../../shared/api'
import { NodeFileStore } from '../../core/storage/nodeFileStore'
import { loadChapterDocuments } from '../../core/workspace/entityStore'

it('routes protected saves, history management and rollback through authenticated HTTP', async () => {
  const root = await mkdtemp(join(tmpdir(), 'storyfabric-history-http-'))
  const server = createStoryFabricServer({ accessKey: 'history-http-test', dataDir: root })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  try {
    const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'history-http-test' }) })
    const cookie = login.headers.get('set-cookie')!.split(';', 1)[0]
    const api = new Proxy({} as StoryFabricApi, { get: (_target, method: string) => async (...args: unknown[]) => {
      const response = await fetch(`${base}/api/rpc`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ method, args }) })
      const payload = await response.json() as { result?: unknown; error?: string }
      if (!response.ok || payload.error) throw new Error(payload.error || `HTTP ${response.status}`)
      return payload.result
    } })
    const workspacePath = await api.createWorkspace('', '历史验证')
    const original = await api.saveChapter({ title: '草稿', box: 'draft', status: 'draft', content: '原始内容' })
    const first = await api.getDocumentSnapshot('chapter', original.id)
    expect(first.writeRevision).toMatch(/^wr_/)
    const saved = await api.saveChapter({ id: original.id, content: '第二稿' }, { baseRevision: first.writeRevision, baseText: first.sourceText, history: { source: 'manual' } })
    expect(saved.writeRevision).not.toBe(first.writeRevision)
    const history = await api.listHistoryVersions('chapter', original.id)
    expect(history.map((item) => item.source)).toEqual(['baseline', 'manual'])
    await expect(api.saveChapter({ id: original.id, content: '旧基线覆盖' }, { baseRevision: first.writeRevision })).rejects.toThrow(/SOURCE_CHANGED/)
    await expect(api.saveChapter({ id: original.id, content: '历史号覆盖' }, { baseRevision: history[0].historyVersionId })).rejects.toThrow(/SOURCE_CHANGED/)
    await api.updateHistoryVersion('chapter', original.id, history[0].historyVersionId, { pinned: true, note: '回味第一稿' })
    await expect(api.deleteHistoryVersion('chapter', original.id, history[0].historyVersionId)).rejects.toThrow(/保留/)
    const before = await api.getDocumentSnapshot('chapter', original.id)
    const restored = await api.restoreHistoryVersion('chapter', original.id, history[0].historyVersionId, before.writeRevision)
    expect(restored.document.content).toContain('原始内容')
    expect(restored.writeRevision).not.toBe(before.writeRevision)
    const readHistory = await api.getHistoryVersion('chapter', original.id, history[0].historyVersionId)
    expect(readHistory.document).not.toHaveProperty('writeRevision')
    expect(readHistory.note).toBe('回味第一稿')
    const latest = await api.getDocumentSnapshot('chapter', original.id)
    const store = new NodeFileStore(join(root, 'workspaces', workspacePath))
    const stored = (await loadChapterDocuments(store)).find((entry) => entry.doc.id === original.id)!
    await store.writeText(`chapters/${stored.fileName}`, latest.sourceText.replace('原始内容', '外部改动'))
    await expect(api.saveChapter({ id: original.id, content: '覆盖外部' }, { baseRevision: latest.writeRevision, baseText: latest.sourceText })).rejects.toThrow(/SOURCE_CHANGED/)
    expect((await api.getDocumentSnapshot('chapter', original.id)).document.content).toContain('外部改动')
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    if (dirname(root).toLowerCase() !== tmpdir().toLowerCase()) throw new Error('unexpected test directory')
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})
