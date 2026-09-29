import { expect, it, vi } from 'vitest'
import type { AgentEventEnvelope } from '../../shared/api'
import { AgentEventBridge } from '../agentEventBridge'

function envelope(event: AgentEventEnvelope['event']): AgentEventEnvelope {
  return { sessionId: 'session-1', runId: 'run-1', event }
}

it('coalesces chapter argument and preview fragments before a terminal event', () => {
  const delivered: AgentEventEnvelope[] = []
  const bridge = new AgentEventBridge((item) => delivered.push(item))
  bridge.push(envelope({ type: 'tool-start', callId: 'call-1', name: 'save_chapter', argsJson: '' }))
  for (let index = 0; index < 5000; index += 1) {
    bridge.push(envelope({ type: 'tool-args-delta', callId: 'call-1', delta: '字' }))
    bridge.push(envelope({ type: 'tool-preview', callId: 'call-1', preview: `正文${index}` }))
  }
  bridge.push(envelope({ type: 'tool-done', callId: 'call-1', ok: true, resultPreview: '已保存' }))
  expect(delivered.map((item) => item.event.type)).toEqual(['tool-start', 'tool-args-delta', 'tool-preview', 'tool-done'])
  expect(delivered[1].event).toMatchObject({ type: 'tool-args-delta', delta: '字'.repeat(5000) })
  expect(delivered[2].event).toMatchObject({ type: 'tool-preview', preview: '正文4999' })
})

it('keeps different runs and message identities separate', () => {
  const delivered: AgentEventEnvelope[] = []
  const bridge = new AgentEventBridge((item) => delivered.push(item))
  bridge.push(envelope({ type: 'text-delta', messageId: 'first', delta: '甲' }))
  bridge.push(envelope({ type: 'text-delta', messageId: 'second', delta: '乙' }))
  bridge.push({ sessionId: 'session-2', runId: 'run-2', event: { type: 'text-delta', messageId: 'first', delta: '丙' } })
  bridge.flush()
  expect(delivered.map((item) => [item.sessionId, item.event.type === 'text-delta' ? item.event.messageId : ''])).toEqual([
    ['session-1', 'first'], ['session-1', 'second'], ['session-2', 'first']
  ])
})

it('delivers an ongoing text stream on the next frame without waiting for a terminal event', () => {
  vi.useFakeTimers()
  try {
    const delivered: AgentEventEnvelope[] = []
    const bridge = new AgentEventBridge((item) => delivered.push(item))
    bridge.push(envelope({ type: 'text-delta', messageId: 'reply', delta: '你好' }))
    bridge.push(envelope({ type: 'text-delta', messageId: 'reply', delta: '，世界' }))
    expect(delivered).toEqual([])
    vi.advanceTimersByTime(16)
    expect(delivered).toHaveLength(1)
    expect(delivered[0].event).toMatchObject({ type: 'text-delta', delta: '你好，世界' })
  } finally {
    vi.useRealTimers()
  }
})
