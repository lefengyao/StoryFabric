import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { ToolRunRow } from '../AgentActivity'
import { toolArgsPreview } from '../../../stores/chatStore'

it('marks truncated tool output and exposes argument details in the sidebar', () => {
  const markup = renderToStaticMarkup(<ToolRunRow compact name="read" status="ok" argsJson='{"path":"chapter.md"}' resultText={'x'.repeat(7000)} />)
  expect(markup).toContain('参数详情')
  expect(markup).not.toContain('chapter.md')
  expect(markup).not.toContain('<pre')
  expect(markup).toContain('已截断')
  expect(markup).not.toContain('查看完整结果')
})

it('keeps long result summaries bounded without parsing the whole chapter payload', () => {
  const resultText = JSON.stringify({ content: '长章节'.repeat(100000) })
  const parse = vi.spyOn(JSON, 'parse')
  try {
    const markup = renderToStaticMarkup(<ToolRunRow name="get_chapter" status="ok" resultText={resultText} />)
    expect(parse).not.toHaveBeenCalledWith(resultText)
    expect(markup.length).toBeLessThan(4000)
  } finally {
    parse.mockRestore()
  }
})

it('bounds explicit previews and JSON messages before putting them in the DOM', () => {
  const preview = '章节写入完成'.repeat(10000)
  const markup = renderToStaticMarkup(<ToolRunRow name="save_chapter" status="ok" preview={preview} />)
  expect(markup.length).toBeLessThan(4000)
  const messageMarkup = renderToStaticMarkup(<ToolRunRow name="read" status="ok" resultText={JSON.stringify({ message: '成功'.repeat(2000) })} />)
  expect(messageMarkup.length).toBeLessThan(4000)
})

it('exposes detailed results even when a compact JSON result is short', () => {
  const markup = renderToStaticMarkup(<ToolRunRow name="list" status="ok" resultText='{"count":1,"items":["chapter"]}' />)
  expect(markup).toContain('查看结果')
  expect(markup).not.toContain('<pre')
})

it('does not parse oversized historical tool arguments for the preview', () => {
  const args = JSON.stringify({ content: 'chapter'.repeat(100000) })
  const parse = vi.spyOn(JSON, 'parse')
  try {
    expect(toolArgsPreview(args, 96).length).toBeLessThan(100)
    expect(parse).not.toHaveBeenCalledWith(args)
  } finally { parse.mockRestore() }
})
