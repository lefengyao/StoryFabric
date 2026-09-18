import { describe, expect, it } from 'vitest'
import {
  parseAgentQuestion,
  validateAgentQuestionAnswer,
  type AgentQuestion
} from '../agentQuestions'

function questionWithFields(fields: unknown[]): unknown {
  return {
    questionId: 'question-1',
    runId: 'run-1',
    sessionId: 'session-1',
    stageId: 'plan',
    agentId: 'planner',
    title: '需要你的选择',
    description: '请选择后继续运行。',
    fields
  }
}

describe('agent question protocol', () => {
  it('parses and validates single, multi, and text fields', () => {
    const question = parseAgentQuestion(questionWithFields([
      {
        id: 'direction',
        label: '方向',
        type: 'single',
        required: true,
        options: [{ id: 'north', label: '向北' }, { id: 'south', label: '向南' }]
      },
      {
        id: 'audiences',
        label: '读者',
        type: 'multi',
        options: [{ id: 'new', label: '新读者' }, { id: 'old', label: '老读者' }]
      },
      { id: 'note', label: '补充说明', type: 'text' }
    ]))

    expect(question.fields.map((field) => field.type)).toEqual(['single', 'multi', 'text'])
    expect(() => validateAgentQuestionAnswer(question, {
      questionId: question.questionId,
      answers: { direction: 'north', audiences: ['new', 'old'], note: '保留原主题' }
    })).not.toThrow()
  })

  it('rejects duplicate field and option ids', () => {
    expect(() => parseAgentQuestion(questionWithFields([
      { id: 'same', label: '第一个', type: 'text' },
      { id: 'same', label: '第二个', type: 'text' }
    ]))).toThrow('问题字段 id 重复：same')

    expect(() => parseAgentQuestion(questionWithFields([{
      id: 'choice',
      label: '选项',
      type: 'single',
      options: [{ id: 'same', label: '第一个' }, { id: 'same', label: '第二个' }]
    }]))).toThrow('问题字段 choice 的选项 id 重复：same')
  })

  it('requires options for choice fields', () => {
    expect(() => parseAgentQuestion(questionWithFields([
      { id: 'choice', label: '选项', type: 'single' }
    ]))).toThrow('问题字段 choice 必须提供选项')
  })

  it('rejects empty answers for required fields', () => {
    const question = parseAgentQuestion(questionWithFields([{
      id: 'choice',
      label: '选项',
      type: 'single',
      required: true,
      options: [{ id: 'yes', label: '是' }]
    }]))

    expect(() => validateAgentQuestionAnswer(question, {
      questionId: question.questionId,
      answers: { choice: '' }
    })).toThrow('问题字段 choice 的答案不能为空')
  })

  it('rejects answers whose value type does not match the field type', () => {
    const question = parseAgentQuestion(questionWithFields([
      { id: 'choices', label: '多选', type: 'multi', options: [{ id: 'a', label: 'A' }] },
      { id: 'choice', label: '单选', type: 'single', options: [{ id: 'a', label: 'A' }] }
    ]))

    expect(() => validateAgentQuestionAnswer(question, {
      questionId: question.questionId,
      answers: { choices: 'a' }
    })).toThrow('问题字段 choices 的答案必须是字符串数组')

    expect(() => validateAgentQuestionAnswer(question, {
      questionId: question.questionId,
      answers: { choice: ['a'] }
    })).toThrow('问题字段 choice 的答案必须是字符串')
  })

  it('rejects unknown field types and malformed option arrays', () => {
    expect(() => parseAgentQuestion(questionWithFields([
      { id: 'unknown', label: '未知', type: 'date' }
    ]))).toThrow('问题字段 unknown 的 type 无效：date')

    expect(() => parseAgentQuestion(questionWithFields([
      { id: 'choice', label: '选项', type: 'multi', options: 'not-an-option-array' }
    ]))).toThrow('问题字段 choice 的 options 必须是数组')
  })

  it('does not accept an answer for a different question', () => {
    const question = parseAgentQuestion(questionWithFields([
      { id: 'note', label: '补充说明', type: 'text' }
    ])) as AgentQuestion

    expect(() => validateAgentQuestionAnswer(question, {
      questionId: 'another-question',
      answers: { note: '内容' }
    })).toThrow('答案 questionId 与问题不匹配')
  })
})
