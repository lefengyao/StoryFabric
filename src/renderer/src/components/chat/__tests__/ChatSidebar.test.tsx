import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatSidebar } from '../ChatSidebar'
import { useChat } from '../../../stores/chatStore'

vi.mock('../../../stores/chatStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../stores/chatStore')>()
  // Static rendering otherwise reads Zustand's initial server snapshot.
  const useChat = Object.assign(<T,>(selector?: (state: ReturnType<typeof actual.useChat.getState>) => T) => selector ? selector(actual.useChat.getState()) : actual.useChat.getState(), actual.useChat)
  return { ...actual, useChat }
})

afterEach(() => useChat.getState().resetWorkspace())

describe('ChatSidebar', () => {
  it('combines historical tool calls and their results into one collapsed activity panel', () => {
    useChat.setState({
      activeId: 's',
      messages: [
        { id: 'u', role: 'user', text: '继续章节' },
        { id: 'a1', role: 'assistant', toolCalls: [{ id: 'read', name: 'read_chapter', argsJson: '{"id":"ch1"}' }] },
        { id: 't1', role: 'tool', toolCallId: 'read', toolName: 'read_chapter', text: '完整章节正文' },
        { id: 'a2', role: 'assistant', toolCalls: [{ id: 'write', name: 'append_chapter', argsJson: '{"content":"新章节正文"}' }] },
        { id: 't2', role: 'tool', toolCallId: 'write', toolName: 'append_chapter', text: '写入错误详情', isError: true },
        { id: 'a3', role: 'assistant', text: '章节尚未写入', runActivity: { skills: [], rules: [], tools: [{ name: 'read_chapter', count: 1, failed: 0 }, { name: 'append_chapter', count: 1, failed: 1 }] } }
      ]
    })
    const markup = renderToStaticMarkup(<MemoryRouter><ChatSidebar open /></MemoryRouter>)
    expect(markup.match(/data-agent-run-activity/g)).toHaveLength(1)
    expect(markup).toContain('工具 2')
    expect(markup).toContain('失败 1')
    expect(markup).toContain('章节尚未写入')
    expect(markup).toContain('aria-label="展开运行详情"')
    expect(markup).not.toContain('完整章节正文')
    expect(markup).not.toContain('写入错误详情')
    expect(markup).not.toContain('新章节正文')
  })

  it('keeps live tools, stages, skills, and rules in one panel while showing reply text', () => {
    useChat.setState({
      activeId: 's', streaming: true, runningSessionId: 's',
      messages: [{ id: 'u', role: 'user', text: '继续章节' }],
      liveTimeline: [
        { kind: 'text', id: 'text', text: '正在核对前文' },
        { kind: 'stage', id: 'stage', stageId: 'chapter', status: 'running' },
        { kind: 'tool', callId: 'read', name: 'read_chapter', argsJson: '{"id":"ch1"}', status: 'ok', preview: '隐藏的读取结果' },
        { kind: 'tool', callId: 'write', name: 'append_chapter', argsJson: '{"content":"隐藏的写入正文"}', status: 'running' }
      ],
      liveSkillEvents: [{ runId: 'r', agentId: 'a', status: 'applied', skills: [{ libraryId: 'l', packageId: 'p', skillId: 's', version: '1', contentHash: 'h', reason: '匹配章节' }] }],
      liveRuleEvents: [{ runId: 'r', agentId: 'a', status: 'applied', rules: [{ id: 'rule', source: 'project', target: 'chapter', key: 'tone', severity: 'must', reason: '项目规则' }], conflicts: 0, overridden: 0 }]
    })
    const markup = renderToStaticMarkup(<MemoryRouter><ChatSidebar open /></MemoryRouter>)
    expect(markup.match(/data-agent-run-activity/g)).toHaveLength(1)
    expect(markup).toContain('工具 2')
    expect(markup).toContain('技能 1')
    expect(markup).toContain('规则 1')
    expect(markup).toContain('append_chapter')
    expect(markup).toContain('正在核对前文')
    expect(markup).not.toContain('隐藏的读取结果')
    expect(markup).not.toContain('隐藏的写入正文')
    expect(markup).not.toContain('匹配章节')
    expect(markup).not.toContain('项目规则')
  })

  it('shows a collapsed activity panel for a summary without tool messages', () => {
    useChat.setState({
      activeId: 's',
      messages: [{ id: 'a', role: 'assistant', text: '已核对资料', runActivity: { tools: [], skills: [{ packageId: 'p', skillId: 's', version: '1', stages: ['chapter'] }], rules: [] } }]
    })
    const markup = renderToStaticMarkup(<MemoryRouter><ChatSidebar open /></MemoryRouter>)
    expect(markup.match(/data-agent-run-activity/g)).toHaveLength(1)
    expect(markup).toContain('技能 1')
    expect(markup).toContain('已核对资料')
  })

  it('merges checkpoint history and live activity from the current turn without repeating calls', () => {
    useChat.setState({
      activeId: 's', streaming: true, runningSessionId: 's',
      messages: [
        { id: 'u', role: 'user', text: '继续章节' },
        { id: 'a', role: 'assistant', toolCalls: [{ id: 'read', name: 'read_chapter', argsJson: '{"id":"ch1"}' }] },
        { id: 't', role: 'tool', toolCallId: 'read', toolName: 'read_chapter', text: 'checkpoint章节正文' }
      ],
      liveTimeline: [
        { kind: 'tool', callId: 'read', name: 'read_chapter', argsJson: '{"id":"ch1"}', status: 'ok', preview: '重复的读取预览' },
        { kind: 'tool', callId: 'write', name: 'append_chapter', argsJson: '{"content":"新章节正文"}', status: 'running' }
      ]
    })
    const markup = renderToStaticMarkup(<MemoryRouter><ChatSidebar open /></MemoryRouter>)
    expect(markup.match(/data-agent-run-activity/g)).toHaveLength(1)
    expect(markup).toContain('工具 2')
    expect(markup).toContain('append_chapter')
    expect(markup).not.toContain('checkpoint章节正文')
    expect(markup).not.toContain('重复的读取预览')
  })

  it('keeps older turn activity separate when the new turn has only live activity', () => {
    useChat.setState({
      activeId: 's', streaming: true, runningSessionId: 's',
      messages: [
        { id: 'old-u', role: 'user', text: '核对前文' },
        { id: 'old-a', role: 'assistant', toolCalls: [{ id: 'old-read', name: 'read_chapter', argsJson: '{}' }] },
        { id: 'old-t', role: 'tool', toolCallId: 'old-read', toolName: 'read_chapter', text: '旧读取结果' },
        { id: 'new-u', role: 'user', text: '继续章节' }
      ],
      liveTimeline: [{ kind: 'tool', callId: 'write', name: 'append_chapter', argsJson: '{}', status: 'running' }]
    })
    const markup = renderToStaticMarkup(<MemoryRouter><ChatSidebar open /></MemoryRouter>)
    expect(markup.match(/data-agent-run-activity/g)).toHaveLength(2)
    expect(markup.match(/工具 1/g)).toHaveLength(2)
    expect(markup).not.toContain('工具 2')
    expect(markup).toContain('append_chapter')
  })

  it('does not render historical messages or live tool details while closed', () => {
    useChat.setState({
      messages: [{ id: 'long-reply', role: 'assistant', text: '隐藏的长章节正文'.repeat(2000) }],
      liveTimeline: [{ kind: 'tool', callId: 'write', name: 'append_chapter', argsJson: '{"content":"隐藏的工具正文"}', status: 'running' }]
    })
    const markup = renderToStaticMarkup(<MemoryRouter><ChatSidebar open={false} /></MemoryRouter>)
    expect(markup).not.toContain('隐藏的长章节正文')
    expect(markup).not.toContain('隐藏的工具正文')
    expect(markup).not.toContain('append_chapter')
    expect(markup).toBe('')
  })

  it('exposes an answer entry for a pending structured question', () => {
    useChat.setState({ activeId: 's', pendingQuestion: { questionId: 'q', sessionId: 's', runId: 'r', agentId: 'agent', title: '需求方向', description: '请选择', fields: [{ id: 'f', type: 'text', label: '方向', required: true }] } })
    const markup = renderToStaticMarkup(<MemoryRouter><ChatSidebar open /></MemoryRouter>)
    expect(markup).toContain('智能体正在等待你的回答')
    expect(markup).toContain('继续回答')
  })
  it('keeps session, model, and context details collapsed by default', () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <ChatSidebar open />
      </MemoryRouter>
    )

    expect(markup).toContain('智能体')
    expect(markup).toContain('aria-label="会话、模型与上下文"')
    expect(markup).toContain('aria-expanded="false"')
    expect(markup).not.toContain('创作会话')
    expect(markup).not.toContain('选择模型')
  })
})
