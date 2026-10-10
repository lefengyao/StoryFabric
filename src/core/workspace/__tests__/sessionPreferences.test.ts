import { describe, expect, it } from 'vitest'
import type { ChatSession } from '../../../shared/types'
import { getSessionApprovalPolicy, getSessionModelPreference, setSessionApprovalPolicy, setSessionModelPreference } from '../sessionPreferences'

const session: ChatSession = {
  id: 's1', title: '测试', createdAt: 1, updatedAt: 1, archived: false, messages: [],
  modelPreferences: [{ providerId: 'p1', model: 'm1', reasoning: 'high' }]
}

describe('session model preferences', () => {
  it('defaults approval to strict and stores it per session without mutating the source', () => {
    expect(getSessionApprovalPolicy(session)).toBe('strict')
    const next = setSessionApprovalPolicy(session, 'auto')
    expect(next.approvalPolicy).toBe('auto')
    expect(session.approvalPolicy).toBeUndefined()
  })

  it('defaults to inherit for a model without an override', () => {
    expect(getSessionModelPreference(session, 'p1', 'm2')).toBe('inherit')
  })

  it('updates only the selected provider/model preference', () => {
    const next = setSessionModelPreference(session, { providerId: 'p1', model: 'm2', reasoning: 'low' })
    expect(next.modelPreferences).toEqual([
      { providerId: 'p1', model: 'm1', reasoning: 'high' },
      { providerId: 'p1', model: 'm2', reasoning: 'low' }
    ])
    expect(session.modelPreferences).toEqual([{ providerId: 'p1', model: 'm1', reasoning: 'high' }])
  })
})
