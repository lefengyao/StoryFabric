import { describe, expect, it, vi } from 'vitest'
import { loadDocumentIntoEditor } from '../documentRead'

describe('asynchronous editor reload', () => {
  it('keeps the latest local draft when the user types while the current file is loading', async () => {
    let generation = 1
    let editor = '原文'
    let resolve!: (content: string) => void
    const onApply = vi.fn((content: string) => { editor = content })
    const pending = loadDocumentIntoEditor({ read: () => new Promise<string>((finish) => { resolve = finish }), generation: () => generation, isCurrent: () => true, apply: onApply })
    editor = '加载期间的新草稿'
    generation++
    resolve('智能体写入后的正文')
    expect(await pending).toBe('edited')
    expect(editor).toBe('加载期间的新草稿')
    expect(onApply).not.toHaveBeenCalled()
  })
  it('ignores a result from the previous document or workspace after a switch', async () => {
    let current = true
    let resolve!: (content: string) => void
    const apply = vi.fn()
    const pending = loadDocumentIntoEditor({ read: () => new Promise<string>((finish) => { resolve = finish }), generation: () => 1, isCurrent: () => current, apply })
    current = false
    resolve('旧工作区正文')
    expect(await pending).toBe('superseded')
    expect(apply).not.toHaveBeenCalled()
  })
  it('synchronizes a clean editor after the file read completes', async () => {
    let editor = '原文'
    expect(await loadDocumentIntoEditor({ read: async () => '当前文件', generation: () => 1, isCurrent: () => true, apply: (content) => { editor = content } })).toBe('applied')
    expect(editor).toBe('当前文件')
  })
})
