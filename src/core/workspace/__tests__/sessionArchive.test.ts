import { describe, expect, it } from 'vitest'
import { decodeSessionArchive, exportSessionArchive } from '../sessionArchive'
import type { ChatSession } from '../../../shared/types'

describe('session archive', () => {
  it('round-trips files and per-session model preferences', () => {
    const session: ChatSession = {
      id: 'sess_1', title: '测试', createdAt: 1, updatedAt: 2, archived: false,
      modelPreferences: [{ providerId: 'p1', model: 'vision', reasoning: 'high' }],
      creativePreferences: { mode: 'basic', orchestrationEnabled: false, subagentsEnabled: false, intensity: 'light', selectedSkillIds: ['storyfabric.natural-prose'], selectedRuleSetIds: [] },
      messages: [{ id: 'm1', role: 'user', text: '看看', files: [{ kind: 'text', id: 'f1', name: '说明.txt', mimeType: 'text/plain', size: 6, text: '你好' }] }]
    }
    const decoded = decodeSessionArchive(exportSessionArchive(session).base64)
    expect(decoded.messages[0].files).toEqual(session.messages[0].files)
    expect(decoded.modelPreferences).toEqual(session.modelPreferences)
    expect(decoded.creativePreferences).toEqual(session.creativePreferences)
  })

  it('rejects invalid attachment archives', () => {
    const session: ChatSession = { id: 'sess_1', title: '坏', createdAt: 1, updatedAt: 1, archived: false, messages: [{ id: 'm', role: 'user', files: [{ kind: 'image', id: 'i', name: 'x.png', mimeType: 'image/png', size: 1, base64: 'AA==' }] }] }
    expect(() => decodeSessionArchive(exportSessionArchive(session).base64)).toThrow()
  })

  it('round-trips orchestration candidates without executing them on import', () => {
    const session: ChatSession = {
      id: 'sess_1', title: '编排', createdAt: 1, updatedAt: 2, archived: false, messages: [],
      orchestrationRuns: [{
        runId: 'run_1', status: 'cancelled', sourceRevision: 'rev_1', originalText: '原文',
        stages: [{ stageId: 'write', status: 'cancelled', artifactId: 'artifact_1' }],
        artifacts: [{ id: 'artifact_1', runId: 'run_1', stageId: 'write', agentId: 'write', version: 1, kind: 'draft', status: 'candidate', inputArtifactIds: [], sourceRevisions: { source: 'rev_1' }, text: 'partial', contentHash: 'hash', createdAt: 1 }],
        overlay: {}, businessText: '原文', updatedAt: 2
      }]
    }
    const decoded = decodeSessionArchive(exportSessionArchive(session).base64)
    expect(decoded.orchestrationRuns).toEqual(session.orchestrationRuns)
  })
})
