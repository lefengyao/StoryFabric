import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { ModelJsonEditor } from '../ModelJsonEditor'

it('shows one model’s full editable JSON and the apply action in its expanded panel', () => {
  const markup = renderToStaticMarkup(
    <ModelJsonEditor model="gpt-4o" protocol="openai" settings={{ vision: false }} onApply={() => {}} />
  )
  expect(markup).toContain('aria-label="gpt-4o JSON 配置内容"')
  expect(markup).toContain('&quot;schemaVersion&quot;: 1')
  expect(markup).toContain('&quot;vision&quot;: false')
  expect(markup).toContain('应用 JSON')
})
