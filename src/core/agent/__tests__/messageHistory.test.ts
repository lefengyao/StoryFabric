import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '../../../shared/types'
import { chapterReadMemoKey, compactChapterReadText, compactRepeatedReadResults, findChapterReadMemo, rememberChapterReadMemo, repairOrphanedToolCalls } from '../messageHistory'

describe('message history tool-call repair', () => {
  it('adds an error tool result when a persisted assistant tool call has no result', () => {
    const messages: ChatMessage[] = [
      { id: 'user-1', role: 'user', text: '继续' },
      { id: 'assistant-1', role: 'assistant', toolCalls: [{ id: 'call-1', name: 'ask_user', argsJson: '{}' }] },
      { id: 'error-1', role: 'assistant', text: '出错了：运行事件无效', isError: true }
    ]

    const repaired = repairOrphanedToolCalls(messages)

    expect(repaired[2]).toMatchObject({
      role: 'tool',
      toolCallId: 'call-1',
      toolName: 'ask_user',
      isError: true
    })
    expect(repaired[2]?.text).toContain('工具调用未完成')
    expect(repaired[3]).toEqual(messages[2])
  })

  it('keeps complete tool-call turns unchanged', () => {
    const messages: ChatMessage[] = [
      { id: 'assistant-1', role: 'assistant', toolCalls: [{ id: 'call-1', name: 'list_notes', argsJson: '{}' }] },
      { id: 'tool-1', role: 'tool', toolCallId: 'call-1', toolName: 'list_notes', text: '[]' }
    ]

    expect(repairOrphanedToolCalls(messages)).toEqual(messages)
  })

  it('orders multiple tool results by the assistant tool-call order', () => {
    const messages: ChatMessage[] = [
      { id: 'assistant-1', role: 'assistant', toolCalls: [
        { id: 'call-1', name: 'list_chapters', argsJson: '{}' },
        { id: 'call-2', name: 'list_characters', argsJson: '{}' }
      ] },
      { id: 'tool-2', role: 'tool', toolCallId: 'call-2', toolName: 'list_characters', text: '人物' },
      { id: 'tool-1', role: 'tool', toolCallId: 'call-1', toolName: 'list_chapters', text: '章节' },
      { id: 'assistant-2', role: 'assistant', text: '继续处理' }
    ]

    expect(repairOrphanedToolCalls(messages).map((message) => message.id)).toEqual(['assistant-1', 'tool-1', 'tool-2', 'assistant-2'])
  })

  it('isolates a tool result that appears after the failed turn has already ended', () => {
    const messages: ChatMessage[] = [
      { id: 'assistant-1', role: 'assistant', toolCalls: [{ id: 'call-1', name: 'list_notes', argsJson: '{}' }] },
      { id: 'error-1', role: 'assistant', text: '请求失败', isError: true },
      { id: 'tool-1', role: 'tool', toolCallId: 'call-1', toolName: 'list_notes', text: '迟到的结果' }
    ]

    const repaired = repairOrphanedToolCalls(messages)
    expect(repaired.map((message) => message.role)).toEqual(['assistant', 'tool', 'assistant', 'assistant'])
    expect(repaired.at(-1)?.text).toContain('脱离工具调用')
  })

  it('keeps the first chapter page and compacts repeated reads of the same revision', () => {
    const page = JSON.stringify({
      id: 'chapter-1',
      title: '第一章',
      sourcePath: 'chapters/draft/chapter-1.md',
      writeRevision: 'rev-1',
      revision: 'rev-1',
      offset: 0,
      content: '正文'.repeat(1000),
      returnedChars: 2000,
      totalChars: 2000,
      truncated: false
    })
    const messages: ChatMessage[] = [
      { id: 'assistant-1', role: 'assistant', toolCalls: [{ id: 'call-1', name: 'get_chapter', argsJson: '{"chapterId":"chapter-1"}' }] },
      { id: 'tool-1', role: 'tool', toolCallId: 'call-1', toolName: 'get_chapter', text: page },
      { id: 'assistant-2', role: 'assistant', toolCalls: [{ id: 'call-2', name: 'get_chapter', argsJson: '{"title":"第一章"}' }] },
      { id: 'tool-2', role: 'tool', toolCallId: 'call-2', toolName: 'get_chapter', text: page }
    ]

    const compacted = compactRepeatedReadResults(messages)
    expect(compacted[1]).toEqual(messages[1])
    expect(compacted[3]?.text).not.toContain('正文'.repeat(100))
    expect(JSON.parse(compacted[3]?.text ?? '{}')).toMatchObject({
      id: 'chapter-1',
      writeRevision: 'rev-1',
      deduplicated: true,
      reusedToolCallId: 'call-1'
    })
  })

  it('does not compact different pages or a changed chapter revision', () => {
    const makePage = (revision: string, offset: number) => JSON.stringify({
      id: 'chapter-1', title: '第一章', sourcePath: 'chapters/draft/chapter-1.md',
      writeRevision: revision, revision, offset, content: '正文'.repeat(1000), returnedChars: 2000, totalChars: 4000, truncated: true
    })
    const messages: ChatMessage[] = [
      { id: 'assistant-1', role: 'assistant', toolCalls: [{ id: 'call-1', name: 'get_chapter', argsJson: '{"chapterId":"chapter-1"}' }] },
      { id: 'tool-1', role: 'tool', toolCallId: 'call-1', toolName: 'get_chapter', text: makePage('rev-1', 0) },
      { id: 'assistant-2', role: 'assistant', toolCalls: [{ id: 'call-2', name: 'get_chapter', argsJson: '{"chapterId":"chapter-1","offset":2000}' }] },
      { id: 'tool-2', role: 'tool', toolCallId: 'call-2', toolName: 'get_chapter', text: makePage('rev-1', 2000) },
      { id: 'assistant-3', role: 'assistant', toolCalls: [{ id: 'call-3', name: 'get_chapter', argsJson: '{"chapterId":"chapter-1"}' }] },
      { id: 'tool-3', role: 'tool', toolCallId: 'call-3', toolName: 'get_chapter', text: makePage('rev-2', 0) }
    ]

    const compacted = compactRepeatedReadResults(messages)
    expect(compacted[3]).toEqual(messages[3])
    expect(compacted[5]).toEqual(messages[5])
  })

  it('does not reuse an id based read for a potentially ambiguous title query', () => {
    const memo = new Map<string, string>()
    const args = '{"chapterId":"chapter-1","offset":0,"maxChars":8000}'
    const text = JSON.stringify({
      id: 'chapter-1', title: '第一章', sourcePath: 'chapters/draft/chapter-1.md',
      writeRevision: 'rev-1', revision: 'rev-1', offset: 0, content: '正文', returnedChars: 2, totalChars: 2, truncated: false
    })
    const key = chapterReadMemoKey(args)
    const compacted = compactChapterReadText(text)
    expect(key).toBeTruthy()
    expect(compacted).toBeTruthy()
    if (!key || !compacted) return
    rememberChapterReadMemo(memo, key, compacted)

    expect(findChapterReadMemo(memo, '{"title":"第一章"}')).toBeUndefined()
    expect(findChapterReadMemo(memo, '{"title":"第一章","expectedRevision":"rev-other"}')).toBeUndefined()
    expect(findChapterReadMemo(memo, '{"chapterId":"chapter-1","expectedRevision":"rev-1"}')).toBe(compacted)
  })

  it('does not memoize title-only reads because titles may be ambiguous', () => {
    const args = '{"title":"第一章"}'
    expect(chapterReadMemoKey(args)).toBeNull()
    expect(findChapterReadMemo(new Map(), args)).toBeUndefined()
  })
})
