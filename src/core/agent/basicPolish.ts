import type { ContentPackage } from '../skills/types'

export interface BasicPolishInput {
  workspaceId: string
  entityId: string
  revision: string | number
  originalText: string
  intensity: 'light' | 'standard' | 'strong'
  skills: ContentPackage[]
  call: (input: { workspaceId: string; entityId: string; revision: string | number; prompt: string }) => Promise<{ text: string }>
}

export interface PendingPolishChange {
  status: 'pending' | 'applied' | 'rejected' | 'conflict'
  workspaceId?: string
  entityId?: string
  beforeText: string
  afterText: string
  baseRevision: string | number
}

export async function runBasicPolish(input: BasicPolishInput): Promise<PendingPolishChange> {
  if (!input.originalText.trim()) throw new Error('没有可润色的正文')
  if ((typeof input.revision !== 'string' && (typeof input.revision !== 'number' || !Number.isInteger(input.revision) || input.revision < 0)) || (typeof input.revision === 'string' && !input.revision.trim())) throw new Error('正文 revision 无效')
  const guidance = input.skills.flatMap((pkg) => pkg.files.filter((file) => file.path.toLowerCase().endsWith('skill.md')).map((file) => file.content)).join('\n\n')
  const result = await input.call({
    workspaceId: input.workspaceId,
    entityId: input.entityId,
    revision: input.revision,
    prompt: `请只润色下面的正文，不改变事实、人物关系、叙事视角或情节结局。力度：${input.intensity}。\n\n${guidance ? `已选择的创作技能：\n${guidance}\n\n` : ''}【原文】\n${input.originalText}`
  })
  if (!result.text.trim()) throw new Error('模型未返回润色正文')
  return { status: 'pending', workspaceId: input.workspaceId, entityId: input.entityId, beforeText: input.originalText, afterText: result.text, baseRevision: input.revision }
}

export function applyPolishDecision(change: PendingPolishChange, approved: boolean, currentRevision?: string | number): { status: 'applied' | 'rejected' | 'conflict'; text: string } {
  if (!approved) return { status: 'rejected', text: change.beforeText }
  if (currentRevision !== undefined && currentRevision !== change.baseRevision) return { status: 'conflict', text: change.beforeText }
  return { status: 'applied', text: change.afterText }
}
