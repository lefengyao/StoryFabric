import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { UsageBarChart, UsageTokenPie } from '../UsageCharts'

it('renders an input/output pie with values and proportions', () => {
  const markup = renderToStaticMarkup(<UsageTokenPie promptTokens={75} completionTokens={25} />)
  expect(markup).toContain('conic-gradient(var(--accent) 0 75%')
  expect(markup).toContain('75.0%')
  expect(markup).toContain('25.0%')
  expect(markup).toContain('输入 75 token')
})

it('makes each daily column selectable and exposes its exact token counts', () => {
  const markup = renderToStaticMarkup(
    <UsageBarChart
      minWidth={620}
      selectedKey="2026-09-09"
      onSelect={() => {}}
      items={[
        { key: '2026-09-08', label: '09-08', description: '2026-09-08', calls: 0, promptTokens: 0, completionTokens: 0 },
        { key: '2026-09-09', label: '09-09', description: '2026-09-09', calls: 2, promptTokens: 80, completionTokens: 20 }
      ]}
    />
  )
  expect(markup.match(/<button/g)).toHaveLength(2)
  expect(markup).toContain('aria-pressed="true"')
  expect(markup).toContain('输入 80 token，输出 20 token')
})
