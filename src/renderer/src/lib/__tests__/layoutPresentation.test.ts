import { describe, expect, it } from 'vitest'
import { shouldShowGlobalModelSelector } from '../layoutPresentation'

describe('global model selector visibility', () => {
  it('hides the shell selector on the chat page where the agent selector is richer', () => {
    expect(shouldShowGlobalModelSelector('chat')).toBe(false)
  })

  it('keeps the shell selector on other workspace pages', () => {
    expect(shouldShowGlobalModelSelector('chapters')).toBe(true)
  })
})
