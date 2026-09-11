import type { ChapterMeta } from '../../shared/types'
import type { FileStore } from '../storage/fileStore'
import { getChapterBody, listChapters } from '../workspace/entityStore'

export interface ChapterContextNeighbor {
  id: string
  title: string
  volume: string
  box: string
  order: number
  wordCount: number
  snippet: string
}

export interface ChapterContext {
  target: { id: string; title: string; volume: string; box: string; order: number; wordCount: number; content: string }
  previous: ChapterContextNeighbor[]
  next: ChapterContextNeighbor[]
  sourceIds: string[]
  truncated: boolean
  returnedChars: number
}

function compact(text: string): string { return text.replace(/\s+/g, ' ').trim() }

function boundedNumber(value: number | undefined, fallback: number, label: string, min: number, max?: number): number {
  if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value))) throw new Error(`${label} 必须是有限数字`)
  const number = value ?? fallback
  return Math.max(min, max === undefined ? number : Math.min(max, number))
}

export async function getChapterContext(store: FileStore, chapterId: string, options: { radius?: number; maxChars?: number } = {}): Promise<ChapterContext> {
  const radius = boundedNumber(options.radius, 2, 'radius', 0, 2)
  const maxChars = boundedNumber(options.maxChars, 12000, 'maxChars', 1000)
  const chapters = (await listChapters(store)).filter((chapter) => chapter.box !== 'trash').sort((a, b) => a.order - b.order)
  const index = chapters.findIndex((chapter) => chapter.id === chapterId)
  if (index < 0) throw new Error(`未找到章节：${chapterId}`)
  const meta = chapters[index]
  const body = (await getChapterBody(store, chapterId)) ?? ''
  let used = Math.min(body.length, maxChars)
  const target = { id: meta.id, title: meta.title, volume: meta.volume, box: meta.box ?? 'main', order: meta.order, wordCount: meta.wordCount, content: body.slice(0, maxChars) }
  const previous: ChapterContextNeighbor[] = []
  const next: ChapterContextNeighbor[] = []
  let truncated = body.length > maxChars
  const addNeighbor = async (chapter: ChapterMeta, list: ChapterContextNeighbor[]): Promise<void> => {
    if (used >= maxChars) { truncated = true; return }
    const text = compact((await getChapterBody(store, chapter.id)) ?? '')
    const remaining = maxChars - used
    const snippet = text.slice(0, Math.min(remaining, 480))
    if (snippet.length < text.length) truncated = true
    used += snippet.length
    list.push({ id: chapter.id, title: chapter.title, volume: chapter.volume, box: chapter.box ?? 'main', order: chapter.order, wordCount: chapter.wordCount, snippet })
  }
  for (let offset = radius; offset >= 1; offset--) { const chapter = chapters[index - offset]; if (chapter) await addNeighbor(chapter, previous) }
  for (let offset = 1; offset <= radius; offset++) { const chapter = chapters[index + offset]; if (chapter) await addNeighbor(chapter, next) }
  return { target, previous, next, sourceIds: [meta.id, ...previous.map((item) => item.id), ...next.map((item) => item.id)], truncated, returnedChars: used }
}
