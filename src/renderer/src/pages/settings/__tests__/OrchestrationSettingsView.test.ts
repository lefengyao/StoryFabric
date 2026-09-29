import { expect, it } from 'vitest'
import { toggleOrchestrationStage } from '../OrchestrationSettingsView'

it('includes dependencies when a stage is enabled and removes descendants when its prerequisite is disabled', () => {
  expect(toggleOrchestrationStage([], 'polish', true)).toEqual(['plan', 'write', 'polish'])
  expect(toggleOrchestrationStage(['plan', 'write', 'polish', 'review'], 'plan', false)).toEqual([])
})
