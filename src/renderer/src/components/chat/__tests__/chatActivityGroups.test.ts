import { describe, expect, it } from 'vitest'
import type { ChatMessage, RunActivitySummary } from '../../../../../shared/types'
import type { LiveTurnItem } from '../../../stores/chatStore'
import { buildChatActivityGroups, mergeLiveActivityTools, type ActivityTool } from '../chatActivityGroups'

const summary: RunActivitySummary = {
  skills: [{ packageId: 'fiction', skillId: 'check', version: '1', stages: ['plan'] }],
  tools: [{ name: 'read_chapter', count: 2, failed: 1 }],
  rules: [{ id: 'style', source: 'workspace', target: 'chapter', key: 'tone' }]
}

describe('buildChatActivityGroups', () => {
  it('groups interleaved tools at the first call while keeping prose and attachments in order', () => {
    const user: ChatMessage = { id: 'user-1', role: 'user', text: 'Edit the chapter' }
    const before: ChatMessage = { id: 'before', role: 'assistant', text: 'Reading it now.', toolCalls: [{ id: 'read-1', name: 'read_chapter', argsJson: '{"id":"chapter"}' }] }
    const between: ChatMessage = { id: 'between', role: 'assistant', text: 'Checking the draft.' }
    const final: ChatMessage = {
      id: 'final', role: 'assistant', text: 'Done.', agentIdentity: { id: 'polish', label: 'Editor', model: 'model' },
      files: [{ kind: 'text', id: 'attachment', name: 'notes.txt', mimeType: 'text/plain', size: 5, text: 'notes' }], runActivity: summary
    }
    const messages: ChatMessage[] = [
      user, before,
      { id: 'result-1', role: 'tool', toolCallId: 'read-1', text: 'First chapter' },
      between,
      { id: 'call-2', role: 'assistant', toolCalls: [{ id: 'read-2', name: 'read_chapter', argsJson: '{"id":"draft"}' }] },
      { id: 'result-2', role: 'tool', toolCallId: 'read-2', toolName: 'read_chapter', text: 'Read failed', isError: true }, final
    ]

    const groups = buildChatActivityGroups(messages)
    expect(groups).toEqual([
      { kind: 'message', message: user }, { kind: 'message', message: before },
      { kind: 'activity', id: 'activity:user-1', tools: [
        { callId: 'read-1', name: 'read_chapter', argsJson: '{"id":"chapter"}', status: 'ok', resultText: 'First chapter' },
        { callId: 'read-2', name: 'read_chapter', argsJson: '{"id":"draft"}', status: 'error', resultText: 'Read failed' }
      ], activity: summary },
      { kind: 'message', message: between }, { kind: 'message', message: final }
    ])
    expect(groups[4]).toMatchObject({ message: { files: final.files, agentIdentity: final.agentIdentity } })
    expect(messages[1]).toBe(before)
    expect(before.toolCalls).toHaveLength(1)
  })

  it('keeps summaries in one frame and deduplicates cumulative skill, tool and rule evidence', () => {
    const expanded: RunActivitySummary = {
      skills: [{ ...summary.skills[0], stages: ['plan', 'write'] }],
      tools: [{ name: 'read_chapter', count: 3, failed: 1 }, { name: 'save_chapter', count: 1, failed: 0 }],
      rules: [...summary.rules]
    }
    const groups = buildChatActivityGroups([
      { id: 'user', role: 'user', text: 'Write' },
      { id: 'assistant-1', role: 'assistant', text: 'Planning', runActivity: summary },
      { id: 'assistant-2', role: 'assistant', text: 'Writing', runActivity: expanded },
      { id: 'assistant-3', role: 'assistant', text: 'Done', runActivity: expanded }
    ])
    const activities = groups.filter((group) => group.kind === 'activity')
    expect(activities).toHaveLength(1)
    expect(activities[0]).toEqual({ kind: 'activity', id: 'activity:user', tools: [], activity: expanded })
    expect(summary.skills[0].stages).toEqual(['plan'])
  })

  it('does not match tool call IDs or summaries across user turns', () => {
    const groups = buildChatActivityGroups([
      { id: 'user-1', role: 'user', text: 'First task' },
      { id: 'assistant-1', role: 'assistant', toolCalls: [{ id: 'reused', name: 'first_tool', argsJson: '{}' }] },
      { id: 'result-1', role: 'tool', toolCallId: 'reused', text: 'First result' },
      { id: 'reply-1', role: 'assistant', text: 'First done', runActivity: summary },
      { id: 'user-2', role: 'user', text: 'Second task' },
      { id: 'assistant-2', role: 'assistant', toolCalls: [{ id: 'reused', name: 'second_tool', argsJson: '{"second":true}' }] }
    ])
    const activities = groups.filter((group) => group.kind === 'activity')
    expect(activities).toHaveLength(2)
    expect(activities[0]).toMatchObject({ id: 'activity:user-1', tools: [{ name: 'first_tool', resultText: 'First result', status: 'ok' }], activity: summary })
    expect(activities[1]).toEqual({ kind: 'activity', id: 'activity:user-2', tools: [{ callId: 'reused', name: 'second_tool', argsJson: '{"second":true}', status: 'pending' }] })
  })

  it('shows orphan results, including unnamed legacy tool messages and missing IDs', () => {
    const groups = buildChatActivityGroups([
      { id: 'legacy-result', role: 'tool', toolCallId: 'lost-call', toolName: 'legacy_tool', text: 'Legacy result' },
      { id: 'unnamed-result', role: 'tool', text: 'Unknown result', isError: true }
    ])
    expect(groups).toEqual([{ kind: 'activity', id: 'activity:legacy-result', tools: [
      { callId: 'lost-call', name: 'legacy_tool', status: 'ok', resultText: 'Legacy result' },
      { callId: 'unnamed-result', name: 'tool', status: 'error', resultText: 'Unknown result' }
    ] }])
  })

  it('preserves a pending status when a recorded call has no result', () => {
    expect(buildChatActivityGroups([
      { id: 'user', role: 'user', text: 'Read it' },
      { id: 'assistant', role: 'assistant', toolCalls: [{ id: 'pending', name: 'read_chapter', argsJson: '{}' }] },
      { id: 'interrupted', role: 'assistant', text: 'Interrupted', isError: true }
    ])).toContainEqual({ kind: 'activity', id: 'activity:user', tools: [{ callId: 'pending', name: 'read_chapter', argsJson: '{}', status: 'pending' }], failed: true })
  })

  it('marks a turn failed when the model reply fails after successful tools', () => {
    const failure: ChatMessage = { id: 'model-error', role: 'assistant', text: 'Provider request failed', isError: true }
    const groups = buildChatActivityGroups([
      { id: 'user', role: 'user', text: 'Continue' },
      { id: 'assistant', role: 'assistant', toolCalls: [{ id: 'call', name: 'read_chapter', argsJson: '{}' }] },
      { id: 'result', role: 'tool', toolCallId: 'call', text: 'Read completed' },
      failure
    ])
    expect(groups[1]).toEqual({ kind: 'activity', id: 'activity:user', tools: [{ callId: 'call', name: 'read_chapter', argsJson: '{}', status: 'ok', resultText: 'Read completed' }], failed: true })
    expect(groups[2]).toEqual({ kind: 'message', message: failure })
  })

  it('does not propagate a failed turn into the following turn or create activity for a plain error reply', () => {
    const plainFailure: ChatMessage = { id: 'plain-error', role: 'assistant', text: 'Connection failed', isError: true }
    const groups = buildChatActivityGroups([
      { id: 'user-1', role: 'user', text: 'First request' },
      { id: 'assistant-1', role: 'assistant', runActivity: summary, text: 'Partial result', isError: true },
      { id: 'user-2', role: 'user', text: 'Try again' },
      { id: 'assistant-2', role: 'assistant', runActivity: summary, text: 'Completed' },
      { id: 'user-3', role: 'user', text: 'Another request' }, plainFailure
    ])
    const activities = groups.filter((group) => group.kind === 'activity')
    expect(activities).toHaveLength(2)
    expect(activities[0]).toMatchObject({ id: 'activity:user-1', failed: true })
    expect(activities[1]).not.toHaveProperty('failed')
    expect(groups[groups.length - 1]).toEqual({ kind: 'message', message: plainFailure })
  })

  it('pairs repeated call IDs within a turn without losing either invocation', () => {
    const groups = buildChatActivityGroups([
      { id: 'user', role: 'user', text: 'Check each stage' },
      { id: 'assistant-1', role: 'assistant', toolCalls: [{ id: 'stage-call', name: 'read_chapter', argsJson: '{"stage":"plan"}' }] },
      { id: 'result-1', role: 'tool', toolCallId: 'stage-call', text: 'Plan input' },
      { id: 'assistant-2', role: 'assistant', toolCalls: [{ id: 'stage-call', name: 'read_chapter', argsJson: '{"stage":"write"}' }] },
      { id: 'result-2', role: 'tool', toolCallId: 'stage-call', text: 'Write input', isError: true }
    ])
    expect(groups[1]).toEqual({ kind: 'activity', id: 'activity:user', tools: [
      { callId: 'stage-call', name: 'read_chapter', argsJson: '{"stage":"plan"}', status: 'ok', resultText: 'Plan input' },
      { callId: 'stage-call', name: 'read_chapter', argsJson: '{"stage":"write"}', status: 'error', resultText: 'Write input' }
    ] })
  })

  it('leaves a late result unmatched after a new user turn instead of completing the old call', () => {
    const groups = buildChatActivityGroups([
      { id: 'first-user', role: 'user', text: 'First request' },
      { id: 'first-call', role: 'assistant', toolCalls: [{ id: 'late-call', name: 'read_chapter', argsJson: '{"private":"old args"}' }] },
      { id: 'second-user', role: 'user', text: 'Second request' },
      { id: 'late-result', role: 'tool', toolCallId: 'late-call', text: 'Late output' }
    ])
    expect(groups[1]).toEqual({ kind: 'activity', id: 'activity:first-user', tools: [
      { callId: 'late-call', name: 'read_chapter', argsJson: '{"private":"old args"}', status: 'pending' }
    ] })
    expect(groups[3]).toEqual({ kind: 'activity', id: 'activity:second-user', tools: [
      { callId: 'late-call', name: 'tool', status: 'ok', resultText: 'Late output' }
    ] })
  })

  it('retains an assistant file attachment even when its text is empty and it calls a tool', () => {
    const attachment: ChatMessage = {
      id: 'assistant-file', role: 'assistant', toolCalls: [{ id: 'call', name: 'save_chapter', argsJson: '{}' }],
      files: [{ kind: 'text', id: 'file', name: 'draft.md', mimeType: 'text/markdown', size: 5, text: 'Draft' }]
    }
    const groups = buildChatActivityGroups([attachment])
    expect(groups[0]).toEqual({ kind: 'message', message: attachment })
    expect(groups[0].kind === 'message' && groups[0].message).toBe(attachment)
    expect(groups[1]).toMatchObject({ kind: 'activity', tools: [{ callId: 'call', status: 'pending' }] })
  })

  it('renders summary-only history without an empty assistant bubble', () => {
    const user: ChatMessage = { id: 'user', role: 'user', text: 'Check rules' }
    expect(buildChatActivityGroups([
      user,
      { id: 'assistant-summary', role: 'assistant', runActivity: summary }
    ])).toEqual([{ kind: 'message', message: user }, { kind: 'activity', id: 'activity:user', tools: [], activity: summary }])
  })

  it('keeps ordinary messages unchanged when there is no activity', () => {
    const messages: ChatMessage[] = [{ id: 'system', role: 'system', text: 'System' }, { id: 'user', role: 'user', text: 'Hello' }, { id: 'assistant', role: 'assistant', text: 'Hello back' }]
    expect(buildChatActivityGroups(messages)).toEqual(messages.map((message) => ({ kind: 'message', message })))
  })
})

describe('mergeLiveActivityTools', () => {
  it('deduplicates completed checkpoint tools and appends new live calls', () => {
    const persisted: ActivityTool = { callId: 'saved', name: 'read_chapter', argsJson: '{"chapter":"one"}', status: 'ok', resultText: 'Full output' }
    const timeline: LiveTurnItem[] = [
      { kind: 'text', id: 'text', text: 'Continuing' },
      { kind: 'tool', callId: 'saved', name: 'read_chapter', argsJson: '{"chapter":"one"}', status: 'ok', preview: 'Read' },
      { kind: 'stage', id: 'stage', stageId: 'write', status: 'running' },
      { kind: 'tool', callId: 'new', name: 'save_chapter', argsJson: '{}', status: 'running' }
    ]
    expect(mergeLiveActivityTools([persisted], timeline)).toEqual([
      { ...persisted, preview: 'Read' }, { callId: 'new', name: 'save_chapter', argsJson: '{}', status: 'running' }
    ])
    expect(persisted).not.toHaveProperty('preview')
  })

  it('does not replace saved full arguments and results with a clipped live preview', () => {
    const argsJson = JSON.stringify({ content: 'full chapter '.repeat(3000) })
    const persisted: ActivityTool = { callId: 'call', name: 'append_chapter', argsJson, status: 'ok', resultText: 'Complete stored result' }
    const merged = mergeLiveActivityTools([persisted], [
      { kind: 'tool', callId: 'call', name: 'append_chapter', argsJson: argsJson.slice(0, 12000), status: 'running', preview: 'Append started' }
    ])
    expect(merged).toEqual([{ ...persisted, preview: 'Append started' }])
    expect(merged[0].argsJson).toHaveLength(argsJson.length)
    expect(merged[0].status).toBe('ok')
  })

  it('matches the exact live argument truncation marker to the saved complete payload', () => {
    const argsJson = JSON.stringify({ content: 'long chapter '.repeat(3000) })
    const marker = '\n…工具参数过长，已省略…'
    const clipped = `${argsJson.slice(0, 12000 - marker.length)}${marker}`
    const persisted: ActivityTool = { callId: 'call', name: 'append_chapter', argsJson, status: 'ok', resultText: 'Saved complete result' }
    const merged = mergeLiveActivityTools([persisted], [
      { kind: 'tool', callId: 'call', name: 'append_chapter', argsJson: clipped, status: 'running' }
    ])
    expect(clipped).toHaveLength(12000)
    expect(merged).toHaveLength(1)
    expect(merged[0].argsJson).toBe(argsJson)
    expect(merged[0].resultText).toBe(persisted.resultText)
    expect(merged[0].status).toBe('ok')
  })

  it('does not treat a generic ellipsis as a live truncation marker', () => {
    const persisted: ActivityTool = { callId: 'call', name: 'append_chapter', argsJson: '{"content":"long chapter"}', status: 'ok' }
    const argsJson = '{"content":"long…'
    expect(mergeLiveActivityTools([persisted], [
      { kind: 'tool', callId: 'call', name: 'append_chapter', argsJson, status: 'running' }
    ])).toEqual([persisted, { callId: 'call', name: 'append_chapter', argsJson, status: 'running' }])
  })

  it('updates pending stored calls from live state without rolling back terminal errors', () => {
    const merged = mergeLiveActivityTools([
      { callId: 'pending', name: 'read_chapter', status: 'pending' },
      { callId: 'failed', name: 'save_chapter', status: 'error', resultText: 'Saved failure' }
    ], [
      { kind: 'tool', callId: 'pending', name: 'read_chapter', argsJson: '{"chapter":"one"}', status: 'running' },
      { kind: 'tool', callId: 'failed', name: 'save_chapter', argsJson: '{}', status: 'ok' }
    ])
    expect(merged).toEqual([
      { callId: 'pending', name: 'read_chapter', argsJson: '{"chapter":"one"}', status: 'running' },
      { callId: 'failed', name: 'save_chapter', argsJson: '{}', status: 'error', resultText: 'Saved failure' }
    ])
  })

  it('matches the last saved occurrence when orchestration stages reuse a call ID', () => {
    const first: ActivityTool = { callId: 'reused', name: 'read_chapter', argsJson: '{"stage":"plan"}', status: 'ok', resultText: 'Plan output' }
    const last: ActivityTool = { callId: 'reused', name: 'read_chapter', argsJson: '{"stage":"write"}', status: 'pending' }
    expect(mergeLiveActivityTools([first, last], [
      { kind: 'tool', callId: 'reused', name: 'read_chapter', argsJson: '', status: 'running', preview: 'Write started' }
    ])).toEqual([first, { ...last, status: 'running', preview: 'Write started' }])
  })

  it('keeps only one new live call and applies its latest state', () => {
    expect(mergeLiveActivityTools([], [
      { kind: 'tool', callId: 'call', name: 'read_chapter', argsJson: '', status: 'pending' },
      { kind: 'tool', callId: 'call', name: 'read_chapter', argsJson: '{}', status: 'ok', preview: 'Completed' }
    ])).toEqual([{ callId: 'call', name: 'read_chapter', argsJson: '{}', status: 'ok', preview: 'Completed' }])
  })

  it('preserves a new invocation when a provider reuses a completed call ID for another tool', () => {
    const persisted: ActivityTool = { callId: 'call_0', name: 'read_chapter', argsJson: '{"chapter":"one"}', status: 'ok', resultText: 'Read complete' }
    expect(mergeLiveActivityTools([persisted], [
      { kind: 'tool', callId: 'call_0', name: 'append_chapter', argsJson: '{"chapter":"one","content":"More"}', status: 'running' }
    ])).toEqual([persisted, { callId: 'call_0', name: 'append_chapter', argsJson: '{"chapter":"one","content":"More"}', status: 'running' }])
  })

  it('preserves a new invocation when its name matches but complete parameters differ', () => {
    const persisted: ActivityTool = { callId: 'call_0', name: 'read_chapter', argsJson: '{"chapter":"one"}', status: 'ok', resultText: 'First chapter' }
    expect(mergeLiveActivityTools([persisted], [
      { kind: 'tool', callId: 'call_0', name: 'read_chapter', argsJson: '{"chapter":"two"}', status: 'pending' }
    ])).toEqual([persisted, { callId: 'call_0', name: 'read_chapter', argsJson: '{"chapter":"two"}', status: 'pending' }])
  })

  it('pairs two stored and live occurrences in chronological order even when IDs are reused', () => {
    const first: ActivityTool = { callId: 'call_0', name: 'read_chapter', argsJson: '{"chapter":"one"}', status: 'ok', resultText: 'First result' }
    const second: ActivityTool = { callId: 'call_0', name: 'read_chapter', argsJson: '{"chapter":"two"}', status: 'ok', resultText: 'Second result' }
    expect(mergeLiveActivityTools([first, second], [
      { kind: 'tool', callId: 'call_0', name: 'read_chapter', argsJson: '{"chapter":"one"}', status: 'ok', preview: 'First preview' },
      { kind: 'tool', callId: 'call_0', name: 'read_chapter', argsJson: '{"chapter":"two"}', status: 'ok', preview: 'Second preview' }
    ])).toEqual([{ ...first, preview: 'First preview' }, { ...second, preview: 'Second preview' }])
  })

  it('preserves an extra live invocation with the same ID, name and arguments', () => {
    const persisted: ActivityTool = { callId: 'call_0', name: 'read_chapter', argsJson: '{}', status: 'ok', resultText: 'Stored first result' }
    expect(mergeLiveActivityTools([persisted], [
      { kind: 'tool', callId: 'call_0', name: 'read_chapter', argsJson: '{}', status: 'ok', preview: 'First preview' },
      { kind: 'tool', callId: 'call_0', name: 'read_chapter', argsJson: '{}', status: 'running', preview: 'Second preview' }
    ])).toEqual([{ ...persisted, preview: 'First preview' }, { callId: 'call_0', name: 'read_chapter', argsJson: '{}', status: 'running', preview: 'Second preview' }])
  })
})
