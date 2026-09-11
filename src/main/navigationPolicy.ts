export function isAllowedRendererNavigation(targetUrl: string, rendererUrl: string): boolean {
  try {
    const target = new URL(targetUrl)
    const renderer = new URL(rendererUrl)
    if (target.protocol !== renderer.protocol) return false
    if (target.protocol === 'file:') return target.pathname === renderer.pathname
    return target.origin === renderer.origin
  } catch {
    return false
  }
}

export function isAllowedExternalUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}
