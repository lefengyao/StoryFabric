import { describe, expect, it } from 'vitest'
import { sidebarLabelClass } from '../sidebarPresentation'

describe('sidebarPresentation', () => {
  it('hides navigation labels in the thumbnail state', () => {
    expect(sidebarLabelClass(false)).toContain('hidden')
    expect(sidebarLabelClass(false)).not.toContain('sm:inline')
  })

  it('shows navigation labels when the sidebar is expanded', () => {
    expect(sidebarLabelClass(true)).toContain('sm:inline')
  })
})
