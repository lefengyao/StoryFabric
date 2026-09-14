import { describe, expect, it } from 'vitest'
import { sidebarLabelClass, sidebarWidthClass } from '../sidebarPresentation'

describe('sidebarPresentation', () => {
  it('hides navigation labels in the thumbnail state', () => {
    expect(sidebarLabelClass(false)).toContain('hidden')
    expect(sidebarLabelClass(false)).not.toContain('sm:inline')
  })

  it('shows navigation labels when the sidebar is expanded', () => {
    expect(sidebarLabelClass(true)).toContain('sm:inline')
  })

  it('uses only the compact width in the thumbnail state', () => {
    expect(sidebarWidthClass(false)).toBe('w-[68px]')
    expect(sidebarWidthClass(false)).not.toContain('w-[204px]')
  })
})
