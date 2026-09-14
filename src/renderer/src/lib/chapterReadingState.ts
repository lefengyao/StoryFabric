import type { ChapterBox, ChapterMeta } from '../../../shared/types'

export interface ChapterReadingState {
  version: 1
  activeBox: 'main' | 'draft' | 'trash'
  lastChapterByBox: { main?: string; draft?: string }
  updatedAt: number
}

export type ChapterTarget = { box: ChapterBox; chapterId: string | null }

type ChapterLike = Pick<ChapterMeta, 'id' | 'order'>

const boxes: Exclude<ChapterBox, 'trash'>[] = ['main', 'draft']

export function resolveChapterTarget(
  state: Pick<ChapterReadingState, 'activeBox' | 'lastChapterByBox'> | null | undefined,
  chapters: Record<'main' | 'draft', ChapterLike[]>
): ChapterTarget {
  const activeBox = state?.activeBox === 'draft' || state?.activeBox === 'trash' ? state.activeBox : 'main'
  if (activeBox === 'trash') return { box: 'trash', chapterId: null }

  const rememberedId = state?.lastChapterByBox?.[activeBox]
  if (rememberedId && chapters[activeBox].some((chapter) => chapter.id === rememberedId)) {
    return { box: activeBox, chapterId: rememberedId }
  }

  if (rememberedId) {
    const movedTo = boxes.find((box) => box !== activeBox && chapters[box].some((chapter) => chapter.id === rememberedId))
    if (movedTo) return { box: movedTo, chapterId: rememberedId }
  }

  const first = [...chapters[activeBox]].sort((a, b) => a.order - b.order)[0]
  return { box: activeBox, chapterId: first?.id ?? null }
}

export function readChapterReadingState(storage: Storage | null, key: string): ChapterReadingState | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(key)
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<ChapterReadingState>
    if (value.version !== 1 || (value.activeBox !== 'main' && value.activeBox !== 'draft' && value.activeBox !== 'trash')) return null
    const last = value.lastChapterByBox
    if (!last || typeof last !== 'object' || Array.isArray(last)) return null
    return {
      version: 1,
      activeBox: value.activeBox,
      lastChapterByBox: {
        ...(typeof last.main === 'string' ? { main: last.main } : {}),
        ...(typeof last.draft === 'string' ? { draft: last.draft } : {})
      },
      updatedAt: typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt) ? value.updatedAt : 0
    }
  } catch {
    return null
  }
}

export function writeChapterReadingState(storage: Storage | null, key: string, state: ChapterReadingState): void {
  if (!storage) return
  try { storage.setItem(key, JSON.stringify(state)) } catch { /* UI memory remains usable. */ }
}

export function chapterReadingStorageKey(workspaceKey: string): string {
  return `storyfabric.ui.chapter-reading.v1:${encodeURIComponent(workspaceKey)}`
}
