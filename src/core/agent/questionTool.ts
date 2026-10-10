import type { AgentQuestion, AgentQuestionField } from '../../shared/agentQuestions'
import { parseAgentQuestion } from '../../shared/agentQuestions'
import type { ToolDefJson } from '../../shared/types'

export interface AskUserRuntimeIdentity {
  questionId?: string
  runId: string
  sessionId: string
  stageId?: string
  agentId: string
}

const questionFieldProperties = {
  id: { type: 'string', minLength: 1 },
  label: { type: 'string', minLength: 1 },
  type: { type: 'string', enum: ['single', 'multi', 'text'] },
  required: { type: 'boolean' },
  options: {
    type: 'array',
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'label'],
      properties: {
        id: { type: 'string', minLength: 1 },
        label: { type: 'string', minLength: 1 },
        description: { type: 'string' }
      }
    }
  },
  defaultValue: {
    anyOf: [
      { type: 'string' },
      { type: 'array', items: { type: 'string' } }
    ]
  },
  placeholder: { type: 'string' }
}

export const QUESTION_TOOL_DEFS: ToolDefJson[] = [{
  name: 'ask_user',
  description: '向用户提出一个结构化问题；运行会暂停，直到用户回答。只提交 title、description 和 fields，不要伪造运行身份字段。',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'description', 'fields'],
    properties: {
      title: { type: 'string', minLength: 1 },
      description: { type: 'string', minLength: 1 },
      fields: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'label', 'type'],
          properties: questionFieldProperties
        }
      }
    }
  }
}]

let questionSequence = 0

function defaultQuestionId(): string {
  questionSequence += 1
  return `question_${Date.now().toString(36)}_${questionSequence.toString(36)}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseJson(value: string | unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    throw new Error('ask_user 参数不是有效 JSON')
  }
}

/** Adds trusted runtime identity to the model-authored question and validates the shared contract. */
export function parseAskUserArguments(value: string | unknown, identity: AskUserRuntimeIdentity): AgentQuestion {
  const parsed = parseJson(value)
  if (!isRecord(parsed)) throw new Error('ask_user 参数必须是对象')
  const allowed = new Set(['title', 'description', 'fields'])
  const unexpected = Object.keys(parsed).find((key) => !allowed.has(key))
  if (unexpected) throw new Error(`ask_user 参数只允许 title、description、fields，不接受：${unexpected}`)

  const candidate: AgentQuestion = {
    questionId: identity.questionId ?? defaultQuestionId(),
    runId: identity.runId,
    sessionId: identity.sessionId,
    ...(identity.stageId ? { stageId: identity.stageId } : {}),
    agentId: identity.agentId,
    title: parsed.title as string,
    description: parsed.description as string,
    fields: parsed.fields as AgentQuestionField[]
  }
  return parseAgentQuestion(candidate)
}
