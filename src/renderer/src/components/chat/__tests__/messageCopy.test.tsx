import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { ChatSidebar } from '../ChatSidebar'
import { ChatPage } from '../../../pages/chat/ChatPage'
import { CopyButton } from '../../ui/CopyButton'

const samples = vi.hoisted(() => ({
  user: '我的消息\n\n**保留原文**',
  assistant: 'AI 回复\n\n```text\n  可复制片段\n```',
  streaming: '正在回复\n\n第二段'
}))

vi.mock('../../ui/CopyButton', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../ui/CopyButton')>()
  return { ...actual, CopyButton: vi.fn(actual.CopyButton) }
})

vi.mock('../../../stores/chatStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../stores/chatStore')>()
  type State = ReturnType<typeof actual.useChat.getState>
  return {
    ...actual,
    useChat: (selector?: (state: State) => unknown) => {
      const state: State = {
        ...actual.useChat.getState(),
        messages: [{ id: 'user', role: 'user', text: samples.user }, { id: 'assistant', role: 'assistant', text: samples.assistant }],
        liveTimeline: [{ id: 'live', kind: 'text', text: samples.streaming }]
      }
      return selector ? selector(state) : state
    }
  }
})

vi.mock('../../../stores/workspaceStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../stores/workspaceStore')>()
  type State = ReturnType<typeof actual.useWorkspace.getState>
  return {
    ...actual,
    useWorkspace: (selector: (state: State) => unknown) => selector({
      ...actual.useWorkspace.getState(),
      summary: { name: '测试项目', path: 'test', characters: [], relationships: [], outline: [], events: [], chapters: [] }
    })
  }
})

describe.each([['main chat', ChatPage], ['chat sidebar', () => <ChatSidebar open />]] as const)('%s copy controls', (_name, Component) => {
  it('lets users copy their messages and both completed and streaming replies', () => {
    vi.mocked(CopyButton).mockClear()
    const html = renderToStaticMarkup(<MemoryRouter><Component /></MemoryRouter>)
    expect(html).toContain('我的消息')
    expect(html).toContain('aria-label="复制用户消息"')
    expect(html.match(/aria-label="复制AI回复"/g)).toHaveLength(2)
    expect(html).toContain('data-native-text-selection="true"')
    expect(html).toContain('chat-user-message-text')
    const messageCopies = vi.mocked(CopyButton).mock.calls
      .map(([props]) => props)
      .filter(({ label }) => label !== '复制代码块')
    expect(messageCopies.map(({ text }) => text)).toEqual([samples.user, samples.assistant, samples.streaming])
  })
})
