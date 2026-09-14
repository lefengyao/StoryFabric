import type { ChapterDoc, VolumeMeta } from '../../shared/types'
import type { FileStore } from '../storage/fileStore'
import { loadChapterDocuments } from '../workspace/entityStore'
import { contentRevision } from '../workspace/resourceRevision'

export interface ChapterContextNeighbor {
  id: string
  title: string
  volume: string
  box: string
  order: number
  wordCount: number
  snippet: string
  revision: string
  offset: number
  nextOffset?: number
  truncated: boolean
}

export interface ChapterContext {
  target: {
    id: string
    title: string
    volume: string
    box: string
    order: number
    wordCount: number
    content: string
    revision: string
    offset: number
    nextOffset?: number
  }
  previous: ChapterContextNeighbor[]
  next: ChapterContextNeighbor[]
  sourceIds: string[]
  truncated: boolean
  targetTruncated: boolean
  omittedNeighbors: Array<{ id: string; reason: 'budget' }>
  returnedChars: number
}

const MAX_CONTEXT_CHARS = 20000
const DEFAULT_CONTEXT_CHARS = 12000
const NEIGHBOR_BUDGET = 480

function integer(value: number | undefined, fallback: number, label: string, min: number, max: number): number {
  if (value === undefined) return fallback
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${label} 必须是 ${min}–${max} 的整数`)
  return value
}

function compact(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

async function volumeOrder(store: FileStore): Promise<Map<string, number>> {
  const raw = await store.readText('chapters/volumes.json')
  if (!raw) return new Map()
  try {
    const value = JSON.parse(raw)
    if (!Array.isArray(value)) return new Map()
    return new Map(value.filter((item): item is VolumeMeta => typeof item?.id === 'string' && typeof item?.order === 'number').map((item) => [item.id, item.order]))
  } catch {
    return new Map()
  }
}

export async function getChapterContext(store: FileStore, chapterId: string, options: { radius?: number; maxChars?: number } = {}): Promise<ChapterContext> {
  const radius = integer(options.radius, 2, 'radius', 0, 2)
  const maxChars = integer(options.maxChars, DEFAULT_CONTEXT_CHARS, 'maxChars', 1000, MAX_CONTEXT_CHARS)
  const documents = await loadChapterDocuments(store)
  const targetDocument = documents.find(({ doc }) => doc.id === chapterId)
  if (!targetDocument) throw new Error(`未找到章节：${chapterId}`)
  const targetMeta = targetDocument.doc
  const orders = await volumeOrder(store)
  const sameBox = documents
    .map(({ doc }) => doc)
    .filter((chapter) => chapter.box === targetMeta.box)
    .sort((a, b) => {
      if (a.box === 'draft') return a.order - b.order || a.id.localeCompare(b.id)
      return (orders.get(a.volumeId ?? 'vol_default') ?? Number.MAX_SAFE_INTEGER) - (orders.get(b.volumeId ?? 'vol_default') ?? Number.MAX_SAFE_INTEGER) ||
        a.order - b.order ||
        a.id.localeCompare(b.id)
    })
  const index = sameBox.findIndex((chapter) => chapter.id === chapterId)
  const actualNeighbors = Array.from({ length: radius * 2 }, (_, neighborIndex) => {
    const distance = neighborIndex + 1
    const before = sameBox[index - distance]
    const after = sameBox[index + distance]
    return [before, after].filter((chapter): chapter is ChapterDoc => Boolean(chapter))
  }).flat()
  const reserved = actualNeighbors.length * Math.min(NEIGHBOR_BUDGET, Math.floor(maxChars / Math.max(1, actualNeighbors.length)))
  const targetBudget = Math.max(0, maxChars - reserved)
  const targetContent = targetMeta.content.slice(0, targetBudget)
  let used = targetContent.length
  const omittedNeighbors: Array<{ id: string; reason: 'budget' }> = []
  const previous: ChapterContextNeighbor[] = []
  const next: ChapterContextNeighbor[] = []

  const addNeighbor = (chapter: ChapterDoc, into: ChapterContextNeighbor[]): void => {
    const remaining = maxChars - used
    if (remaining <= 0) {
      omittedNeighbors.push({ id: chapter.id, reason: 'budget' })
      return
    }
    const compacted = compact(chapter.content)
    const length = Math.min(remaining, NEIGHBOR_BUDGET)
    const snippet = compacted.slice(0, length)
    const truncated = snippet.length < compacted.length
    const nextOffset = truncated ? snippet.length : undefined
    used += snippet.length
    into.push({
      id: chapter.id,
      title: chapter.title,
      volume: chapter.volume,
      box: chapter.box ?? 'main',
      order: chapter.order,
      wordCount: chapter.wordCount,
      snippet,
      revision: contentRevision(chapter.content),
      offset: 0,
      ...(nextOffset === undefined ? {} : { nextOffset }),
      truncated
    })
  }

  for (let distance = radius; distance >= 1; distance -= 1) {
    const chapter = sameBox[index - distance]
    if (chapter) addNeighbor(chapter, previous)
  }
  for (let distance = 1; distance <= radius; distance += 1) {
    const chapter = sameBox[index + distance]
    if (chapter) addNeighbor(chapter, next)
  }

  const targetTruncated = targetContent.length < targetMeta.content.length
  return {
    target: {
      id: targetMeta.id,
      title: targetMeta.title,
      volume: targetMeta.volume,
      box: targetMeta.box ?? 'main',
      order: targetMeta.order,
      wordCount: targetMeta.wordCount,
      content: targetContent,
      revision: contentRevision(targetMeta.content),
      offset: 0,
      ...(targetTruncated ? { nextOffset: targetContent.length } : {})
    },
    previous,
    next,
    sourceIds: [targetMeta.id, ...previous.map((item) => item.id), ...next.map((item) => item.id)],
    truncated: targetTruncated || previous.some((item) => item.truncated) || next.some((item) => item.truncated),
    targetTruncated,
    omittedNeighbors,
    returnedChars: used
  }
}
