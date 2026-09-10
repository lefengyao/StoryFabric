import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import flatLogoUrl from '../../../../../../storyfabric-logo-flat.svg'
import monoLogoUrl from '../../../../../../storyfabric-logo-mono.svg'
import { BrandMark } from '../BrandMark'

const serializedAttribute = (value: string) => value.replaceAll("'", '&#x27;')

describe('BrandMark', () => {
  it('renders the flat brand asset at the requested size with its accessible label', () => {
    const markup = renderToStaticMarkup(
      React.createElement(BrandMark, { variant: 'flat', size: 48, className: 'brand-mark' })
    )

    expect(markup).toContain(`src="${serializedAttribute(flatLogoUrl)}"`)
    expect(markup).toContain('width="48"')
    expect(markup).toContain('height="48"')
    expect(markup).toContain('class="brand-mark"')
    expect(markup).toContain('aria-label="织章 StoryFabric"')
  })

  it('renders a mono mask while preserving caller color and opacity', () => {
    const markup = renderToStaticMarkup(
      React.createElement(BrandMark, {
        variant: 'mono',
        size: 24,
        style: { color: '#efc97b', opacity: 0.6 },
        'aria-label': 'StoryFabric mark'
      })
    )

    expect(markup).toContain('aria-label="StoryFabric mark"')
    expect(markup).toContain('width:24px')
    expect(markup).toContain('height:24px')
    expect(markup).toContain(`mask-image:url(${serializedAttribute(monoLogoUrl)})`)
    expect(markup).toContain(`-webkit-mask-image:url(${serializedAttribute(monoLogoUrl)})`)
    expect(markup).toContain('background-color:currentColor')
    expect(markup).toContain('color:#efc97b')
    expect(markup).toContain('opacity:0.6')
  })
})
