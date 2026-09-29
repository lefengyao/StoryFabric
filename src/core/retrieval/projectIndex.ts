import type { SearchHit } from '../../shared/types'
import type { FileStore } from '../storage/fileStore'
import { resourceRevision } from '../workspace/resourceRevision'
import { loadProjectCorpus, type CorpusEntry, type CorpusFailure, type CorpusKind, type ProjectCorpus } from './projectCorpus'

export interface SearchProjectArgs {
  query: string
  kinds?: CorpusKind[]
  includeProjectDocs?: boolean
  caseSensitive?: boolean
  limit?: number
  cursor?: string
}

export interface SearchPageHit {
  kind: CorpusKind
  id: string
  title: string
  sourcePath: string
  sourceRevision: string
  writeRevision: string
  field: string
  offset: number
  length: number
  line?: number
  snippet: string
}

export interface SearchPage {
  schemaVersion: 2
  projectRevision: string
  hits: SearchPageHit[]
  totalMatches: number
  matchedSources: number
  nextCursor?: string
  scanComplete: boolean
  coverage: {
    kinds: CorpusKind[]
    includeProjectDocs: boolean
    includesTrash: false
    scannedSources: number
    failedSources: CorpusFailure[]
  }
}

export class SearchProjectError extends Error {
  constructor(readonly code: 'INVALID_CURSOR' | 'PROJECT_CHANGED', message: string) {
    super(message)
    this.name = 'SearchProjectError'
  }
}

interface CursorPayload {
  v: 1
  projectRevision: string
  query: string
  kinds: CorpusKind[]
  includeProjectDocs: boolean
  caseSensitive: boolean
  offset: number
  signature: string
}

const INDEX_PATH = '.storyfabric/index.json'
const DEFAULT_LIMIT = 40
const MAX_LIMIT = 100
const KIND_ORDER: CorpusKind[] = ['character', 'relationship', 'outline', 'event', 'chapter', 'setting', 'note', 'projectDoc']

function normalizedScope(kinds: CorpusKind[] | undefined, includeProjectDocs: boolean): CorpusKind[] {
  const selected = new Set(kinds?.length ? kinds : KIND_ORDER.filter((kind) => kind !== 'projectDoc'))
  if (includeProjectDocs) selected.add('projectDoc')
  return KIND_ORDER.filter((kind) => selected.has(kind))
}

function lowerWithOffsets(text: string): { lower: string; offsets: number[]; lengths: number[] } {
  let lower = ''
  const offsets: number[] = []
  const lengths: number[] = []
  let originalOffset = 0
  for (const character of text) {
    const folded = character.toLocaleLowerCase()
    for (let index = 0; index < folded.length; index += 1) {
      lower += folded[index]
      offsets.push(originalOffset)
      lengths.push(character.length)
    }
    originalOffset += character.length
  }
  return { lower, offsets, lengths }
}

function matchOffsets(text: string, query: string, caseSensitive: boolean): Array<{ offset: number; length: number }> {
  if (!query) return []
  const matches: Array<{ offset: number; length: number }> = []
  if (caseSensitive) {
    let from = 0
    while (from <= text.length - query.length) {
      const offset = text.indexOf(query, from)
      if (offset < 0) break
      matches.push({ offset, length: query.length })
      from = offset + Math.max(1, query.length)
    }
    return matches
  }

  const source = lowerWithOffsets(text)
  const lowerQuery = query.toLocaleLowerCase()
  let from = 0
  while (from <= source.lower.length - lowerQuery.length) {
    const lowerOffset = source.lower.indexOf(lowerQuery, from)
    if (lowerOffset < 0) break
    const originalOffset = source.offsets[lowerOffset]
    const endIndex = lowerOffset + lowerQuery.length - 1
    const originalLength = endIndex >= 0 ? source.offsets[endIndex] - originalOffset + source.lengths[endIndex] : lowerQuery.length
    matches.push({ offset: originalOffset, length: originalLength })
    from = lowerOffset + Math.max(1, lowerQuery.length)
  }
  return matches
}

function lineNumber(text: string, offset: number): number {
  let line = 1
  for (let index = 0; index < offset; index += 1) if (text.charCodeAt(index) === 10) line += 1
  return line
}

function snippet(text: string, offset: number, length: number): string {
  const start = Math.max(0, offset - 80)
  const end = Math.min(text.length, offset + length + 80)
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`
}

function collectHits(corpus: ProjectCorpus, query: string, caseSensitive: boolean): SearchPageHit[] {
  const hits: SearchPageHit[] = []
  for (const entry of corpus.entries) {
    for (const field of entry.fields) {
      for (const match of matchOffsets(field.text, query, caseSensitive)) {
        hits.push({
          kind: entry.kind,
          id: entry.id,
          title: entry.title,
          sourcePath: entry.sourcePath,
          sourceRevision: entry.sourceRevision,
          writeRevision: entry.writeRevision,
          field: field.name,
          offset: match.offset,
          length: match.length,
          line: field.name === 'content' ? lineNumber(field.text, match.offset) : undefined,
          snippet: snippet(field.text, match.offset, match.length)
        })
      }
    }
  }
  return hits.sort((a, b) =>
    KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
    a.sourcePath.localeCompare(b.sourcePath) ||
    a.field.localeCompare(b.field) ||
    a.offset - b.offset
  )
}

function cursorSignature(payload: Omit<CursorPayload, 'signature'>): string {
  return resourceRevision(
    payload.v,
    payload.projectRevision,
    payload.query,
    payload.kinds.join(','),
    payload.includeProjectDocs,
    payload.caseSensitive,
    payload.offset
  )
}

function encodeCursor(payload: Omit<CursorPayload, 'signature'>): string {
  return encodeURIComponent(JSON.stringify({ ...payload, signature: cursorSignature(payload) } satisfies CursorPayload))
}

function decodeCursor(cursor: string): CursorPayload {
  try {
    const value = JSON.parse(decodeURIComponent(cursor)) as CursorPayload
    if (
      value?.v !== 1 ||
      typeof value.projectRevision !== 'string' ||
      typeof value.query !== 'string' ||
      !Array.isArray(value.kinds) ||
      typeof value.includeProjectDocs !== 'boolean' ||
      typeof value.caseSensitive !== 'boolean' ||
      !Number.isInteger(value.offset) ||
      value.offset < 0
    ) throw new Error('invalid')
    const { signature: _signature, ...unsigned } = value
    if (cursorSignature(unsigned) !== value.signature) throw new Error('invalid')
    return value
  } catch {
    throw new SearchProjectError('INVALID_CURSOR', '分页游标无效或已被篡改')
  }
}

export async function searchProjectPage(store: FileStore, args: SearchProjectArgs): Promise<SearchPage> {
  const query = args.query.trim()
  if (!query) throw new Error('query 不能为空')
  const limit = args.limit === undefined ? DEFAULT_LIMIT : args.limit
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new Error(`limit 必须是 1–${MAX_LIMIT} 的整数`)
  const includeProjectDocs = Boolean(args.includeProjectDocs)
  const kinds = normalizedScope(args.kinds, includeProjectDocs)
  const caseSensitive = Boolean(args.caseSensitive)
  const corpus = await loadProjectCorpus(store, { kinds, includeProjectDocs })

  let offset = 0
  if (args.cursor) {
    const cursor = decodeCursor(args.cursor)
    if (cursor.projectRevision !== corpus.projectRevision) {
      throw new SearchProjectError('PROJECT_CHANGED', '项目内容已变化，请从第一页重新搜索')
    }
    if (
      cursor.query !== query ||
      cursor.caseSensitive !== caseSensitive ||
      cursor.includeProjectDocs !== includeProjectDocs ||
      cursor.kinds.join(',') !== kinds.join(',')
    ) {
      throw new SearchProjectError('INVALID_CURSOR', '分页游标与当前查询范围不匹配')
    }
    offset = cursor.offset
  }

  const allHits = collectHits(corpus, query, caseSensitive)
  const pageHits = allHits.slice(offset, offset + limit)
  const nextOffset = offset + pageHits.length
  const nextCursor = nextOffset < allHits.length
    ? encodeCursor({ v: 1, projectRevision: corpus.projectRevision, query, kinds, includeProjectDocs, caseSensitive, offset: nextOffset })
    : undefined

  return {
    schemaVersion: 2,
    projectRevision: corpus.projectRevision,
    hits: pageHits,
    totalMatches: allHits.length,
    matchedSources: new Set(allHits.map((hit) => `${hit.kind}:${hit.id}`)).size,
    ...(nextCursor ? { nextCursor } : {}),
    scanComplete: corpus.failedSources.length === 0,
    coverage: {
      kinds,
      includeProjectDocs,
      includesTrash: false,
      scannedSources: corpus.scannedSources,
      failedSources: corpus.failedSources
    }
  }
}

export function mayClaimNoMatches(page: SearchPage): boolean {
  return page.scanComplete && page.coverage.failedSources.length === 0 && page.totalMatches === 0 && page.nextCursor === undefined
}

/** Compatibility hook for workspace open. The v2 search path rebuilds from current sources per request. */
export async function buildProjectIndex(store: FileStore): Promise<void> {
  await loadProjectCorpus(store)
}

/** Compatibility adapter for the existing renderer clue index. */
export async function searchIndex(store: FileStore, query: string, limit = DEFAULT_LIMIT): Promise<SearchHit[]> {
  const page = await searchProjectPage(store, { query, limit: Math.min(MAX_LIMIT, Math.max(1, limit)) })
  return page.hits.map((hit) => ({ kind: hit.kind, id: hit.id, title: hit.title, snippet: hit.snippet }))
}

export async function lookupTerm(store: FileStore, term: string): Promise<SearchHit[]> {
  const query = term.trim()
  if (!query) return []
  const corpus = await loadProjectCorpus(store)
  const hits = collectHits(corpus, query, false)
  const score = (hit: SearchPageHit): number => {
    if (hit.kind === 'chapter' && hit.field.startsWith('terms.')) return 0
    if (hit.kind === 'setting' || hit.kind === 'outline') return 1
    if (hit.field === 'title') return 2
    return 3
  }
  return hits.sort((a, b) => score(a) - score(b) || a.sourcePath.localeCompare(b.sourcePath) || a.offset - b.offset)
    .slice(0, DEFAULT_LIMIT)
    .map((hit) => ({ kind: hit.kind, id: hit.id, title: hit.title, snippet: hit.snippet }))
}

/** Legacy compatibility. Search now reconstructs fresh data and does not trust this file. */
export async function invalidateProjectIndex(store: FileStore): Promise<void> {
  await store.remove(INDEX_PATH)
}

export type { CorpusEntry, CorpusFailure, CorpusKind, ProjectCorpus }
