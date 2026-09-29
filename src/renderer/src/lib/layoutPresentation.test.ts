import { describe, expect, it } from 'vitest'
import {
  compactMetaClass,
  contextRingClass,
  singleLineTextClass,
  workbenchColumnsClass,
  workbenchShellClass,
  workbenchTopbarClass
} from './layoutPresentation'

describe('layoutPresentation', () => {
  it('keeps compact metadata on one line when its flex row is narrow', () => {
    expect(compactMetaClass()).toContain('shrink-0')
    expect(compactMetaClass()).toContain('whitespace-nowrap')
  })

  it('truncates long labels instead of allowing character-by-character wrapping', () => {
    expect(singleLineTextClass()).toContain('min-w-0')
    expect(singleLineTextClass()).toContain('overflow-hidden')
    expect(singleLineTextClass()).toContain('whitespace-nowrap')
  })

  it('defines a vertical workbench shell with a top chrome row above the columns', () => {
    expect(workbenchShellClass()).toContain('flex-col')
    expect(workbenchTopbarClass()).toContain('shrink-0')
    expect(workbenchColumnsClass()).toContain('min-h-0')
  })

  it('defines a context ring without a standalone container', () => {
    expect(contextRingClass()).toContain('rounded-full')
    expect(contextRingClass()).not.toContain('context-meter')
  })
})
