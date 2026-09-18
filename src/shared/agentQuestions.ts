import type { ContentPackage } from '../core/skills/types'

export type AgentQuestionFieldType = 'single' | 'multi' | 'text'

export interface AgentQuestionOption {
  id: string
  label: string
  description?: string
}

export interface AgentQuestionField {
  id: string
  label: string
  type: AgentQuestionFieldType
  required?: boolean
  options?: AgentQuestionOption[]
  defaultValue?: string | string[]
  placeholder?: string
}

export interface AgentQuestion {
  questionId: string
  runId: string
  sessionId: string
  stageId?: string
  agentId: string
  title: string
  description: string
  fields: AgentQuestionField[]
}

export interface AgentQuestionAnswer {
  questionId: string
  answers: Record<string, string | string[]>
}

export type SkillCandidateAction = 'install-enable' | 'install' | 'reject'
export type SkillCandidateStatus = 'pending' | 'accepted' | 'rejected'

/** A model-proposed package, kept as the canonical ContentPackage schema. */
export interface SkillCandidate {
  candidateId: string
  runId: string
  sessionId: string
  agentId: string
  package: ContentPackage
  reason: string
  status?: SkillCandidateStatus
}

export type PlanningGateStatus = 'pending' | 'approved' | 'rejected'

export interface PlanningGate {
  status: PlanningGateStatus
  reason?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${name} 必须是非空字符串`)
  return value.trim()
}

function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined
  return requiredString(value, name)
}

function parseOptions(fieldId: string, value: unknown): AgentQuestionOption[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error(`问题字段 ${fieldId} 的 options 必须是数组`)
  const ids = new Set<string>()
  return value.map((option, index) => {
    if (!isRecord(option)) throw new Error(`问题字段 ${fieldId} 的选项 ${index + 1} 必须是对象`)
    const id = requiredString(option.id, `问题字段 ${fieldId} 的选项 id`)
    if (ids.has(id)) throw new Error(`问题字段 ${fieldId} 的选项 id 重复：${id}`)
    ids.add(id)
    const result: AgentQuestionOption = {
      id,
      label: requiredString(option.label, `问题字段 ${fieldId} 的选项 ${id} label`)
    }
    const description = optionalString(option.description, `问题字段 ${fieldId} 的选项 ${id} description`)
    if (description !== undefined) result.description = description
    return result
  })
}

function parseDefaultValue(fieldId: string, type: AgentQuestionFieldType, value: unknown): string | string[] | undefined {
  if (value === undefined) return undefined
  if (type === 'multi') {
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new Error(`问题字段 ${fieldId} 的 defaultValue 必须是字符串数组`)
    return value
  }
  if (typeof value !== 'string') throw new Error(`问题字段 ${fieldId} 的 defaultValue 必须是字符串`)
  return value
}

/** Parses and validates the structured question contract received from an agent. */
export function parseAgentQuestion(value: unknown): AgentQuestion {
  if (!isRecord(value)) throw new Error('问题必须是对象')
  const questionId = requiredString(value.questionId, '问题 questionId')
  const runId = requiredString(value.runId, '问题 runId')
  const sessionId = requiredString(value.sessionId, '问题 sessionId')
  const stageId = optionalString(value.stageId, '问题 stageId')
  const agentId = requiredString(value.agentId, '问题 agentId')
  const title = requiredString(value.title, '问题 title')
  const description = requiredString(value.description, '问题 description')
  if (!Array.isArray(value.fields) || value.fields.length === 0) throw new Error('问题 fields 至少需要一个字段')

  const fieldIds = new Set<string>()
  const fields = value.fields.map((fieldValue, index): AgentQuestionField => {
    if (!isRecord(fieldValue)) throw new Error(`问题字段 ${index + 1} 必须是对象`)
    const id = requiredString(fieldValue.id, `问题字段 ${index + 1} id`)
    if (fieldIds.has(id)) throw new Error(`问题字段 id 重复：${id}`)
    fieldIds.add(id)
    const label = requiredString(fieldValue.label, `问题字段 ${id} label`)
    const type = fieldValue.type
    if (type !== 'single' && type !== 'multi' && type !== 'text') throw new Error(`问题字段 ${id} 的 type 无效：${String(type)}`)
    if (fieldValue.required !== undefined && typeof fieldValue.required !== 'boolean') throw new Error(`问题字段 ${id} 的 required 必须是布尔值`)
    const options = parseOptions(id, fieldValue.options)
    if ((type === 'single' || type === 'multi') && (!options || options.length === 0)) throw new Error(`问题字段 ${id} 必须提供选项`)
    const defaultValue = parseDefaultValue(id, type, fieldValue.defaultValue)
    const placeholder = fieldValue.placeholder === undefined ? undefined : typeof fieldValue.placeholder === 'string' ? fieldValue.placeholder : (() => { throw new Error(`问题字段 ${id} 的 placeholder 必须是字符串`) })()
    return {
      id,
      label,
      type,
      ...(fieldValue.required !== undefined ? { required: fieldValue.required } : {}),
      ...(options !== undefined ? { options } : {}),
      ...(defaultValue !== undefined ? { defaultValue } : {}),
      ...(placeholder !== undefined ? { placeholder } : {})
    }
  })

  return {
    questionId,
    runId,
    sessionId,
    ...(stageId !== undefined ? { stageId } : {}),
    agentId,
    title,
    description,
    fields
  }
}

function optionIds(field: AgentQuestionField): Set<string> {
  return new Set((field.options ?? []).map((option) => option.id))
}

function validateRequiredAnswer(field: AgentQuestionField, value: string | string[] | undefined): void {
  if (!field.required) return
  const empty = value === undefined || (Array.isArray(value) ? value.length === 0 || value.every((item) => item.trim().length === 0) : value.trim().length === 0)
  if (empty) throw new Error(`问题字段 ${field.id} 的答案不能为空`)
}

/** Validates a user's answer against the parsed question without returning a transformed value. */
export function validateAgentQuestionAnswer(question: AgentQuestion, answer: AgentQuestionAnswer): void {
  const parsedQuestion = parseAgentQuestion(question)
  if (!isRecord(answer)) throw new Error('答案必须是对象')
  const questionId = requiredString(answer.questionId, '答案 questionId')
  if (questionId !== parsedQuestion.questionId) throw new Error('答案 questionId 与问题不匹配')
  if (!isRecord(answer.answers)) throw new Error('答案 answers 必须是对象')

  const fields = new Map(parsedQuestion.fields.map((field) => [field.id, field]))
  for (const key of Object.keys(answer.answers)) {
    if (!fields.has(key)) throw new Error(`答案包含未知字段：${key}`)
  }

  for (const field of parsedQuestion.fields) {
    const rawValue = answer.answers[field.id]
    if (field.type === 'multi') {
      if (rawValue !== undefined && (!Array.isArray(rawValue) || rawValue.some((item) => typeof item !== 'string'))) throw new Error(`问题字段 ${field.id} 的答案必须是字符串数组`)
      const value = rawValue as string[] | undefined
      validateRequiredAnswer(field, value)
      if (value !== undefined) {
        const ids = optionIds(field)
        const invalid = value.find((item) => !ids.has(item))
        if (invalid !== undefined) throw new Error(`问题字段 ${field.id} 的答案不是有效选项：${invalid}`)
      }
      continue
    }

    if (rawValue !== undefined && typeof rawValue !== 'string') throw new Error(`问题字段 ${field.id} 的答案必须是字符串`)
    const value = rawValue as string | undefined
    validateRequiredAnswer(field, value)
    if (field.type === 'single' && value !== undefined && !optionIds(field).has(value)) throw new Error(`问题字段 ${field.id} 的答案不是有效选项：${value}`)
  }
}
