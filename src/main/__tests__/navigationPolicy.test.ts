import { describe, expect, it } from 'vitest'
import { isAllowedExternalUrl, isAllowedRendererNavigation } from '../navigationPolicy'

describe('Electron navigation policy', () => {
  it('allows only navigation within the renderer origin', () => {
    expect(isAllowedRendererNavigation('http://localhost:5173/settings', 'http://localhost:5173/')).toBe(true)
    expect(isAllowedRendererNavigation('https://evil.example/', 'http://localhost:5173/')).toBe(false)
    expect(isAllowedRendererNavigation('file:///app/other.html', 'file:///app/index.html')).toBe(false)
  })

  it('allows only HTTP(S) external links to be opened by the shell', () => {
    expect(isAllowedExternalUrl('https://example.com/docs')).toBe(true)
    expect(isAllowedExternalUrl('http://example.com')).toBe(true)
    expect(isAllowedExternalUrl('file:///etc/passwd')).toBe(false)
    expect(isAllowedExternalUrl('javascript:alert(1)')).toBe(false)
  })
})
