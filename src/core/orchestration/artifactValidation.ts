import type { ArtifactKind, StageId } from './types'

export interface ArtifactValidationResult { ok: boolean; reason?: string }

const FAKE_TOOL_MARKER = /<(?:tool_call|function)\b|\b(?:tool_call|function)\s*=/i
const PLACEHOLDER_ONLY = /^(?:我(?:将|先)|准备|稍后|正在).{0,80}(?:读取|查阅|检查|分析)/u

export function validateArtifactOutput(input: { stageId: StageId; kind: ArtifactKind; text?: string; toolCallsPending?: boolean; hasToolReceipt?: boolean }): ArtifactValidationResult {
  const text = input.text?.trim() ?? ''
  if (input.toolCallsPending) return { ok: false, reason: '仍有未完成的原生工具调用' }
  if (!text) return { ok: false, reason: `${input.stageId} 没有返回可用产物` }
  if (FAKE_TOOL_MARKER.test(text)) return { ok: false, reason: '模型返回了普通文本工具标记，未执行任何工具' }
  if (PLACEHOLDER_ONLY.test(text) && !input.hasToolReceipt) return { ok: false, reason: '仅表示准备读取资料，没有真实工具回执' }
  if ((input.kind === 'draft' || input.kind === 'polished') && text.length < 2) return { ok: false, reason: `${input.stageId} 正文候选为空` }
  return { ok: true }
}
