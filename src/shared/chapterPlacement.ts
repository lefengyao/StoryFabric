import type { ChapterBox, ChapterStatus } from './types'

type ActiveBox = Exclude<ChapterBox, 'trash'>

export function boxForChapterStatus(status: ChapterStatus): ActiveBox {
  return status === 'draft' || status === 'revised' ? 'draft' : 'main'
}

export function statusForChapterBox(box: ActiveBox): ChapterStatus {
  return box === 'draft' ? 'draft' : 'body'
}

export function normalizeChapterStatus(value: unknown, box: ActiveBox): ChapterStatus {
  const aliases: Record<string, ChapterStatus> = { 草稿: 'draft', 修订: 'revised', 修订稿: 'revised', 正文: 'body', 定稿: 'final' }
  if (typeof value === 'string') {
    if (value in aliases) return aliases[value]
    if (value === 'draft' || value === 'revised' || value === 'body' || value === 'final') return value
  }
  return statusForChapterBox(box)
}

/** Explicit status wins, while a box-only move chooses a valid status for its destination. */
export function resolveChapterPlacement(
  existing: { box?: ChapterBox; status?: ChapterStatus } | null,
  patch: { box?: ChapterBox; status?: ChapterStatus }
): { box: ActiveBox; status: ChapterStatus } {
  if (patch.box !== undefined && patch.box !== 'draft' && patch.box !== 'main') throw new Error('章节箱位无效')
  if (patch.status !== undefined && !['draft', 'revised', 'body', 'final'].includes(patch.status)) throw new Error('章节状态无效')
  if (patch.box && patch.status && boxForChapterStatus(patch.status) !== patch.box) throw new Error('章节状态与箱位不一致：草稿/修订属于草稿箱，正文/定稿属于正文箱')
  if (patch.status) return { status: patch.status, box: boxForChapterStatus(patch.status) }
  if (patch.box) {
    const status = existing?.status && boxForChapterStatus(existing.status) === patch.box ? existing.status : statusForChapterBox(patch.box)
    return { box: patch.box, status }
  }
  const status = existing?.status ?? statusForChapterBox(existing?.box === 'draft' ? 'draft' : 'main')
  return { status, box: boxForChapterStatus(status) }
}
