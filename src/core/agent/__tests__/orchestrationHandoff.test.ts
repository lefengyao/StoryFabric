import { expect, it } from 'vitest'
import type { ChatSession } from '../../../shared/types'
import { executeOrchestrationHistoryTool, orchestrationHandoffPrompt, withoutOrchestrationStageMessages } from '../orchestrationHandoff'

function session(): ChatSession {
  return {
    id: 'current', title: '会话', createdAt: 1, updatedAt: 1, archived: false, messages: [],
    orchestrationRuns: [{
      runId: 'run_a', status: 'completed', sourceRevision: 'r1', originalText: '',
      stages: [{ stageId: 'plan', status: 'completed', artifactId: 'artifact_a' }],
      artifacts: [{
        id: 'artifact_a', runId: 'run_a', stageId: 'plan', agentId: 'plan', version: 1,
        kind: 'plan', status: 'candidate', inputArtifactIds: [], sourceRevisions: { source: 'r1' },
        text: '计划正文ABCDEF', contentHash: 'hash', createdAt: 1
      }],
      overlay: {}, businessText: '', updatedAt: 1
    }]
  }
}

it('lists and reads only artifacts in the current session, with paging', () => {
  const current = session()
  const listed = executeOrchestrationHistoryTool(current, 'list_orchestration_runs', '{}')
  expect(listed.ok).toBe(true)
  expect(listed.text).toContain('artifact_a')
  expect(listed.text).not.toContain('计划正文ABCDEF')

  const page = executeOrchestrationHistoryTool(current, 'read_orchestration_artifact', JSON.stringify({ runId: 'run_a', artifactId: 'artifact_a', maxChars: 4 }))
  expect(page.ok).toBe(true)
  expect(JSON.parse(page.text)).toMatchObject({ content: '计划正文', nextOffset: 4, complete: false })
  const missing = executeOrchestrationHistoryTool(current, 'read_orchestration_artifact', JSON.stringify({ runId: 'run_other', artifactId: 'artifact_a' }))
  expect(missing.ok).toBe(false)
  expect(executeOrchestrationHistoryTool(current, 'read_orchestration_artifact', '{broken').ok).toBe(false)
})

it('keeps stage content out of the system prompt and later model history', () => {
  const current = session()
  const prompt = orchestrationHandoffPrompt(current)
  expect(prompt).toContain('run_a')
  expect(prompt).toContain('artifact_a')
  expect(prompt).not.toContain('计划正文ABCDEF')
  expect(withoutOrchestrationStageMessages([
    { id: 'run_a_plan_assistant_1', role: 'assistant', toolCalls: [{ id: 'call', name: 'get_chapter', argsJson: '{}' }] },
    { id: 'run_a_plan_tool_2', role: 'tool', toolCallId: 'call', text: '内部工具结果' },
    { id: 'final', role: 'assistant', text: '最终答复' }
  ], current).map((message) => message.id)).toEqual(['final'])
})
