import { describe, expect, it } from 'vitest'
import type { ChatMessage, ToolCallData } from '../../../shared/types'
import type { StreamResult } from '../../llm/types'
import { runToolLoop } from '../toolLoop'
import { executeTool } from '../../tools/registry'
import { MemoryFileStore } from '../../storage/fileStore'
import { initializeWorkspace } from '../../workspace/workspaceService'
import { saveChapter } from '../../workspace/entityStore'

const call = (id: string, args: Record<string, unknown>): StreamResult => ({
  text: '',
  toolCalls: [{ id, name: 'get_chapter', argsJson: JSON.stringify(args) } satisfies ToolCallData],
  stopReason: 'tool_calls'
})

describe('tool parameter recovery', () => {
  it('returns structured maxChars guidance and recovers with a paged read', async () => {
    const store = new MemoryFileStore()
    await initializeWorkspace(store, '分页测试')
    const chapter = await saveChapter(store, { title: '第二十章', content: '正文'.repeat(300) })
    const messages: ChatMessage[] = [{ id: 'input', role: 'user', text: '读取第二十章' }]
    const requests: ChatMessage[][] = []
    let modelCalls = 0
    const loop = await runToolLoop({
      getMessages: () => messages,
      appendMessage: (message) => messages.push(message),
      maxRounds: 6,
      callModel: async ({ messages: current }) => {
        requests.push(structuredClone(current))
        modelCalls += 1
        if (modelCalls === 1) return call('bad-read', { chapterId: chapter.id, maxChars: 30000 })
        if (modelCalls === 2) return call('good-read', { chapterId: chapter.id, offset: 0, maxChars: 20000 })
        return { text: '已完成分页读取。', toolCalls: [], stopReason: 'stop' }
      },
      executeTool: async (toolCall) => {
        const outcome = await executeTool(store, toolCall.name, toolCall.argsJson)
        return outcome.kind === 'result' ? { ok: outcome.ok, text: outcome.text, preview: outcome.preview } : { ok: false, text: '只读测试不允许写入', preview: '拒绝' }
      }
    })
    const failure = JSON.parse(messages.find((message) => message.role === 'tool' && message.toolCallId === 'bad-read')?.text ?? '{}') as { error?: { details?: { parameter?: string; maximum?: number } } }

    expect(failure.error?.details).toMatchObject({ parameter: 'maxChars', maximum: 20000 })
    expect(requests[1]?.some((message) => message.role === 'tool' && message.toolCallId === 'bad-read')).toBe(true)
    expect(messages.some((message) => message.role === 'tool' && message.toolCallId === 'good-read' && message.isError === false)).toBe(true)
    expect(loop.stoppedReason).toBe('completed')
  })

  it('stops after three identical tool failures and exposes a recoverable stop reason', async () => {
    const messages: ChatMessage[] = [{ id: 'input', role: 'user', text: '读取资料' }]
    let calls = 0
    const loop = await runToolLoop({
      getMessages: () => messages,
      appendMessage: (message) => messages.push(message),
      maxRounds: 8,
      callModel: async () => {
        calls += 1
        return call(`failure-${calls}`, { chapterId: 'missing', offset: calls })
      },
      executeTool: async () => ({ ok: false, text: JSON.stringify({ schemaVersion: 2, error: { code: 'NOT_FOUND', message: '未找到', retryable: true } }), preview: '未找到' })
    })

    expect(loop.stoppedReason).toBe('tool-failure')
    expect(calls).toBe(3)
    expect(messages.at(-1)?.text).toContain('连续参数或读取失败 3 次')
  })
})
