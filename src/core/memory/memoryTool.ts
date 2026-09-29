import type { ToolDefJson } from '../../shared/types'
import type { MemoryScope } from '../../shared/memory'
import type { ToolOutcome } from '../tools/registry'
import { MemoryStore } from './memoryStore'

export const MEMORY_TOOL_NAME = 'remember_user_preference'

export const MEMORY_TOOL_DEFS: ToolDefJson[] = [{
  name: MEMORY_TOOL_NAME,
  description: '仅当用户在本次对话明确表达长期偏好或要求记住信息时，记录一条简短记忆。必须提供本轮用户原话的连续引用 evidence。global 适用于所有项目，project 仅适用于当前项目。记忆开关关闭时不会写入。不要记录小说情节、工具结果或推测。',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      scope: { type: 'string', enum: ['global', 'project'] },
      preference: { type: 'string', minLength: 1, maxLength: 300 },
      evidence: { type: 'string', minLength: 2, maxLength: 300 }
    },
    required: ['scope', 'preference', 'evidence']
  }
}]

export async function executeMemoryTool(memory: MemoryStore | undefined, argsJson: string, userMessage: string): Promise<ToolOutcome> {
  const result = (ok: boolean, text: string): ToolOutcome => ({ kind: 'result', ok, text, preview: text.slice(0, 120) })
  if (!memory) return result(false, '记忆功能不可用')
  try {
    const args: unknown = JSON.parse(argsJson)
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('参数无效')
    const input = args as Record<string, unknown>
    if (input.scope !== 'global' && input.scope !== 'project') throw new Error('记忆范围无效')
    if (typeof input.preference !== 'string') throw new Error('记忆内容无效')
    if (typeof input.evidence !== 'string' || input.evidence.trim().length < 2 || !userMessage.includes(input.evidence)) throw new Error('记忆依据必须来自本轮用户原话')
    const saved = await memory.remember(input.scope as MemoryScope, input.preference)
    return saved ? result(true, `已记录到${input.scope === 'global' ? '跨项目' : '当前项目'}记忆`) : result(false, '该层记忆尚未开启')
  } catch (error) {
    return result(false, error instanceof Error ? error.message : String(error))
  }
}
