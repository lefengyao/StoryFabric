import { describe, expect, it } from 'vitest'
import { RunActivityRecorder } from '../runActivity'

describe('RunActivityRecorder', () => {
  it('records applied skills and rules, and counts each executed tool call once', () => {
    const recorder = new RunActivityRecorder()
    const skill = { libraryId: 'global', packageId: 'writing', skillId: 'outline', version: '1.0', contentHash: 'hash', reason: 'matched' }
    recorder.record({ type: 'skill-activity', activity: { runId: 'run-1', agentId: 'writer', status: 'matched', skills: [skill] } })
    recorder.record({ type: 'skill-activity', activity: { runId: 'run-1', agentId: 'writer', stageId: 'draft', status: 'applied', skills: [skill] } })
    recorder.record({ type: 'skill-activity', activity: { runId: 'run-1', agentId: 'editor', stageId: 'review', status: 'applied', skills: [skill] } })
    const rule = { id: 'voice', source: 'project', target: 'chapter', key: 'tone', severity: 'must' as const, reason: 'matched' }
    recorder.record({ type: 'rule-activity', activity: { runId: 'run-1', agentId: 'writer', status: 'matched', rules: [rule], conflicts: 0, overridden: 0 } })
    recorder.record({ type: 'rule-activity', activity: { runId: 'run-1', agentId: 'writer', status: 'applied', rules: [rule], conflicts: 0, overridden: 0 } })
    recorder.record({ type: 'tool-start', callId: 'call-1', name: 'list_notes', argsJson: '' })
    recorder.record({ type: 'tool-start', callId: 'call-1', name: 'list_notes', argsJson: '{}' })
    recorder.record({ type: 'tool-done', callId: 'call-1', ok: true, resultPreview: 'ok' })
    recorder.record({ type: 'tool-start', callId: 'call-2', name: 'list_notes', argsJson: '{}' })
    recorder.record({ type: 'tool-done', callId: 'call-2', ok: false, resultPreview: 'error' })

    expect(recorder.summary()).toEqual({
      skills: [{ packageId: 'writing', skillId: 'outline', version: '1.0', stages: ['draft', 'review'] }],
      tools: [{ name: 'list_notes', count: 2, failed: 1 }],
      rules: [{ id: 'voice', source: 'project', target: 'chapter', key: 'tone' }]
    })
  })
})
