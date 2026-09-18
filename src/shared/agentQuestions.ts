import type { ContentPackage, RuleSetManifestEntry, SkillManifestEntry, SkillPackageManifest, SupportedPlatform } from './skillPackage'

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

function parsePackageEntry(value: unknown, name: string): SkillManifestEntry | RuleSetManifestEntry {
  if (!isRecord(value)) throw new Error(`${name} 必须是对象`)
  const id = requiredString(value.id, `${name}.id`)
  const path = requiredString(value.path, `${name}.path`)
  if (!/^[A-Za-z0-9._/-]+$/.test(path) || path.startsWith('/') || path.includes('..') || path.split('/').some((part) => !part || part === '.')) throw new Error(`${name}.path 路径无效`)
  return { id, path }
}

function validatePackageVersion(value: unknown, name: string): string {
  const version = requiredString(value, name)
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) throw new Error(`${name} 版本格式无效`)
  return version
}

function parseContentPackage(value: unknown): ContentPackage {
  if (!isRecord(value)) throw new Error('候选 package 必须是对象')
  if (!isRecord(value.manifest)) throw new Error('候选 package.manifest 必须是对象')
  const rawManifest = value.manifest
  if (rawManifest.schemaVersion !== 1) throw new Error('候选 package.manifest.schemaVersion 无效')
  if (!Array.isArray(rawManifest.platforms) || rawManifest.platforms.length === 0 || rawManifest.platforms.some((platform) => platform !== 'windows' && platform !== 'web' && platform !== 'android')) {
    throw new Error('候选 package.manifest.platforms 无效')
  }
  if (!Array.isArray(rawManifest.skills) || !Array.isArray(rawManifest.ruleSets)) throw new Error('候选 package.manifest 的 skills/ruleSets 必须是数组')
  if (!Array.isArray(value.files)) throw new Error('候选 package.files 必须是数组')

  const skills = rawManifest.skills.map((entry, index) => parsePackageEntry(entry, `候选 package.manifest.skills[${index}]`)) as SkillManifestEntry[]
  const ruleSets = rawManifest.ruleSets.map((entry, index) => parsePackageEntry(entry, `候选 package.manifest.ruleSets[${index}]`)) as RuleSetManifestEntry[]
  if (new Set(skills.map((entry) => entry.id)).size !== skills.length) throw new Error('候选 Skill id 重复')
  if (new Set(ruleSets.map((entry) => entry.id)).size !== ruleSets.length) throw new Error('候选规则集 id 重复')

  const manifest: SkillPackageManifest = {
    schemaVersion: 1,
    id: requiredString(rawManifest.id, '候选 package.manifest.id'),
    version: validatePackageVersion(rawManifest.version, '候选 package.manifest.version'),
    name: requiredString(rawManifest.name, '候选 package.manifest.name'),
    description: requiredString(rawManifest.description, '候选 package.manifest.description'),
    author: requiredString(rawManifest.author, '候选 package.manifest.author'),
    license: requiredString(rawManifest.license, '候选 package.manifest.license'),
    minAppVersion: validatePackageVersion(rawManifest.minAppVersion, '候选 package.manifest.minAppVersion'),
    platforms: rawManifest.platforms as SupportedPlatform[],
    skills,
    ruleSets
  }
  const files = value.files.map((file, index) => {
    if (!isRecord(file)) throw new Error(`候选 package.files[${index}] 必须是对象`)
    const path = requiredString(file.path, `候选 package.files[${index}].path`)
    if (!/^[A-Za-z0-9._/-]+$/.test(path) || path.startsWith('/') || path.includes('..') || path.split('/').some((part) => !part || part === '.')) throw new Error(`候选 package.files[${index}].path 路径无效`)
    return {
      path,
      content: typeof file.content === 'string' ? file.content : (() => { throw new Error(`候选 package.files[${index}].content 必须是字符串`) })()
    }
  })
  const filePaths = new Set<string>()
  for (const file of files) {
    if (filePaths.has(file.path)) throw new Error(`候选 package.files 路径重复：${file.path}`)
    filePaths.add(file.path)
  }
  for (const entry of [...skills, ...ruleSets]) if (!filePaths.has(entry.path)) throw new Error(`候选 package.manifest 引用文件不存在：${entry.path}`)
  return { manifest, files }
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

/** Parses the complete candidate identity and the basic ContentPackage shape. */
export function parseSkillCandidate(value: unknown): SkillCandidate {
  if (!isRecord(value)) throw new Error('技能候选必须是对象')
  const candidateId = requiredString(value.candidateId, '候选 candidateId')
  const runId = requiredString(value.runId, '候选 runId')
  const sessionId = requiredString(value.sessionId, '候选 sessionId')
  const agentId = requiredString(value.agentId, '候选 agentId')
  const reason = requiredString(value.reason, '候选 reason')
  const status = value.status
  if (status !== undefined && status !== 'pending' && status !== 'accepted' && status !== 'rejected') throw new Error('候选 status 无效')
  return {
    candidateId,
    runId,
    sessionId,
    agentId,
    package: parseContentPackage(value.package),
    reason,
    ...(status !== undefined ? { status } : {})
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
