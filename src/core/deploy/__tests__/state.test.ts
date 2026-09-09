import { describe, expect, it } from 'vitest'
import { DEPLOY_STEPS, nextStep, stepIndex } from '../state'

describe('部署步骤', () => {
  it('顺序固定', () => {
    expect(DEPLOY_STEPS).toEqual(['connect', 'probe', 'upload', 'build', 'run', 'healthcheck'])
    expect(stepIndex('build')).toBe(3)
  })

  it('成功则前进，失败停在原地（可重试），最后一步成功返回 null', () => {
    expect(nextStep('connect', true)).toBe('probe')
    expect(nextStep('connect', false)).toBe('connect')
    expect(nextStep('healthcheck', true)).toBeNull()
    expect(nextStep('healthcheck', false)).toBe('healthcheck')
  })
})
