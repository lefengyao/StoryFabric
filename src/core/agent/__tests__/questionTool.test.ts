import { describe, expect, it } from 'vitest'
import { parseAskUserArguments, QUESTION_TOOL_DEFS } from '../questionTool'

describe('ask_user tool contract', () => {
  it('fills runtime identity while accepting only the structured question fields', () => {
    const question = parseAskUserArguments(JSON.stringify({
      title: '选择视角',
      description: '请确认本章的叙事视角。',
      fields: [{
        id: 'perspective',
        label: '视角',
        type: 'single',
        required: true,
        options: [{ id: 'first', label: '第一人称' }, { id: 'third', label: '第三人称' }]
      }]
    }), {
      questionId: 'question-1',
      runId: 'run-1',
      sessionId: 'session-1',
      stageId: 'write',
      agentId: 'write'
    })

    expect(question).toEqual({
      questionId: 'question-1',
      runId: 'run-1',
      sessionId: 'session-1',
      stageId: 'write',
      agentId: 'write',
      title: '选择视角',
      description: '请确认本章的叙事视角。',
      fields: [{
        id: 'perspective',
        label: '视角',
        type: 'single',
        required: true,
        options: [{ id: 'first', label: '第一人称' }, { id: 'third', label: '第三人称' }]
      }]
    })
    expect(QUESTION_TOOL_DEFS).toHaveLength(1)
    expect(QUESTION_TOOL_DEFS[0]).toMatchObject({ name: 'ask_user' })
    expect(QUESTION_TOOL_DEFS[0].parameters).toMatchObject({
      type: 'object',
      required: ['title', 'description', 'fields'],
      additionalProperties: false
    })
  })

  it('rejects runtime-only identity fields in model arguments', () => {
    expect(() => parseAskUserArguments(JSON.stringify({
      title: '确认',
      description: '请确认',
      fields: [{ id: 'answer', label: '答案', type: 'text' }],
      runId: 'spoofed'
    }), {
      runId: 'run-1',
      sessionId: 'session-1',
      agentId: 'basic'
    })).toThrow(/只允许|未知|runId|参数/)
  })
})
