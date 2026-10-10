import { describe, expect, it } from 'vitest'
import postcss from 'postcss'
import { flattenCssLayers } from '../build/mobileCss'

describe('legacy mobile CSS layers', () => {
  it('removes layer ordering statements without losing selectors outside layers', () => {
    const output = flattenCssLayers('@layer theme, base, utilities; :root { --panel: white; } @layer utilities { .flex { display: flex; } }')
    const rules: string[] = []
    postcss.parse(output).walkRules((rule) => { rules.push(rule.selector) })
    expect(rules).toEqual([':root', '.flex'])
    expect(output).not.toContain('@layer')
  })

  it('preserves quoted braces and comments and unwraps nested layers', () => {
    const output = flattenCssLayers('@layer base { .text::after { content: "}"; } /* } */ @media (max-width: 500px) { @layer inner { .page { overflow: auto; } } } }')
    const root = postcss.parse(output)
    const rules: string[] = []
    root.walkRules((rule) => { rules.push(rule.selector) })
    expect(rules).toEqual(['.text::after', '.page'])
    expect(output).toContain('@media')
    expect(output).not.toContain('@layer')
  })

  it('preserves original malformed CSS rather than emitting truncated rules', () => {
    const css = '@layer broken { .page { color: red; }'
    expect(flattenCssLayers(css)).toBe(css)
  })
})
