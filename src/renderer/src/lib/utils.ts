import type { ChapterStatus } from '../../../shared/types'

/** className 合并 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

export function countWords(text: string): number {
  return text.replace(/\s/g, '').length
}

export const CHAPTER_STATUS_LABEL: Record<ChapterStatus, string> = {
  draft: '草稿',
  revised: '修订',
  final: '定稿'
}

export const PROTOCOL_LABEL: Record<string, string> = {
  openai: 'OpenAI 兼容',
  anthropic: 'Anthropic 原生',
  gemini: 'Gemini 原生'
}

export const ENTITY_KIND_LABEL: Record<string, string> = {
  character: '人物',
  relationship: '关系',
  outline: '大纲',
  event: '事件',
  chapter: '章节',
  note: '便签',
  setting: '设定',
  projectDoc: '项目文档'
}

export function formatTime(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  if (sameDay) return hm
  return `${d.getMonth() + 1}/${d.getDate()} ${hm}`
}

/** 阵营配色：同一阵营名稳定映射到同一颜色（用于分组标识与关系图谱着色） */
const FACTION_PALETTE = ['#6366f1', '#10b981', '#f59e0b', '#f43f5e', '#0ea5e9', '#8b5cf6', '#14b8a6', '#f97316']

export function factionColor(name: string | undefined | null): string {
  if (!name || !name.trim()) return '#a1a1aa'
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0
  return FACTION_PALETTE[Math.abs(hash) % FACTION_PALETTE.length]
}
