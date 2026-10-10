import postcss, { type AtRule } from 'postcss'

/** Preserve selectors while removing cascade layers unsupported by older WebViews. */
export function flattenCssLayers(css: string): string {
  try {
    const root = postcss.parse(css)
    const layers: AtRule[] = []
    root.walkAtRules('layer', (rule) => { layers.push(rule) })
    // Unwrap descendants first so replacing a parent cannot skip nested layers.
    for (const rule of layers.reverse()) {
      if (rule.nodes) rule.replaceWith(...rule.nodes)
      else rule.remove()
    }
    return root.toString()
  } catch {
    return css
  }
}
