import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AgentRunActivity } from '../AgentRunActivity'

describe('AgentRunActivity', () => {
  it('keeps many tool calls in one collapsed frame without mounting payloads', () => {
    const tools = Array.from({ length: 40 }, (_, index) => ({ callId: `call-${index}`, name: 'append_chapter', status: 'ok' as const, argsJson: '{"chapter":"private body"}', resultText: 'private result'.repeat(10000) }))
    const markup = renderToStaticMarkup(<AgentRunActivity tools={tools} />)
    expect(markup.match(/data-agent-run-activity/g)).toHaveLength(1)
    expect(markup).toContain('工具 40')
    expect(markup).toContain('aria-expanded="false"')
    expect(markup).toContain('展开运行详情')
    expect(markup).not.toContain('private body')
    expect(markup).not.toContain('private result')
    expect(markup).not.toContain('agent-tool-row')
    expect(markup.length).toBeLessThan(2000)
  })

  it('shows current tool and pending confirmation without expanding', () => {
    const markup = renderToStaticMarkup(<AgentRunActivity running timeline={[{ kind: 'tool', callId: 'write', name: 'append_chapter', argsJson: '{}', status: 'pending' }]} />)
    expect(markup).toContain('等待确认')
    expect(markup).toContain('append_chapter')
    expect(markup).not.toContain('data-agent-run-details')
  })

  it('shows failures and summary counts without double counting persisted tools', () => {
    const markup = renderToStaticMarkup(<AgentRunActivity tools={[{ callId: 'read', name: 'get_chapter', status: 'error', resultText: 'failed payload' }]} activity={{ tools: [{ name: 'get_chapter', count: 1, failed: 1 }], skills: [], rules: [] }} />)
    expect(markup).toContain('工具 1')
    expect(markup).toContain('失败 1')
    expect(markup).toContain('有失败')
    expect(markup).not.toContain('failed payload')
  })

  it('reports incomplete calls after a stopped run rather than claiming completion', () => {
    const markup = renderToStaticMarkup(<AgentRunActivity tools={[{ callId: 'read', name: 'get_chapter', status: 'pending' }]} />)
    expect(markup).toContain('未完成')
    expect(markup).not.toContain('已完成')
  })

  it('contains thinking and failed stages within the same activity frame', () => {
    const markup = renderToStaticMarkup(<AgentRunActivity running thinkingLabel="模型正在思考" timeline={[{ kind: 'stage', id: 'stage', stageId: 'review', status: 'failed' }]} />)
    expect(markup).toContain('进行中')
    expect(markup).toContain('border-danger/40')
    expect(markup).not.toContain('agent-thinking-row')
  })

  it('does not add empty activity frames to finished text-only replies', () => {
    expect(renderToStaticMarkup(<AgentRunActivity />)).toBe('')
  })

  it('does not claim success when the model failed after a successful tool', () => {
    const markup = renderToStaticMarkup(<AgentRunActivity failed tools={[{ callId: 'read', name: 'get_chapter', status: 'ok' }]} />)
    expect(markup).toContain('有失败')
    expect(markup).not.toContain('已完成')
  })

  it('does not claim completion for an interrupted stage', () => {
    const markup = renderToStaticMarkup(<AgentRunActivity timeline={[{ kind: 'stage', id: 'stage', stageId: 'write', status: 'running' }]} />)
    expect(markup).toContain('未完成')
    expect(markup).not.toContain('已完成')
  })
})
