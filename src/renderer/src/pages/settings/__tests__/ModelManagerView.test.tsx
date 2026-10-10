import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ModelManagerView } from '../ModelManagerView'

const provider = {
  id: 'provider-1',
  name: 'Large catalog',
  protocol: 'openai' as const,
  baseUrl: 'https://example.invalid/v1',
  models: Array.from({ length: 500 }, (_, index) => `model-${index + 1}`),
  hasKey: true,
  modelSettings: {}
}

describe('ModelManagerView', () => {
  it('owns a bounded primary scroll region for large model catalogs', () => {
    const markup = renderToStaticMarkup(
      <ModelManagerView provider={provider} onClose={() => {}} onSaved={async () => {}} />
    )

    expect(markup).toContain('data-scroll-region="model-manager-content"')
    expect(markup).toContain('min-h-0 flex-1 overflow-y-auto')
  })
})
