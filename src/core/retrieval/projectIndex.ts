import type { EntityKind, SearchHit } from '../../shared/types'
import type { FileStore } from '../storage/fileStore'
import { getChapterBody, getNote, getSetting, listChapters, listCharacters, listEvents, listNotes, listOutline, listSettings, loadRelationships } from '../workspace/entityStore'

export interface ProjectIndexEntry {
  kind: EntityKind | 'relationship'
  id: string
  title: string
  category?: string
  order?: number
  volumeId?: string
  terms?: string[]
  text: string
}

export interface ProjectIndex {
  version: 1
  builtAt: number
  entries: ProjectIndexEntry[]
}

const INDEX_PATH = '.storyfabric/index.json'
const MAX_ENTRY_TEXT = 500

function clip(text: string, max = MAX_ENTRY_TEXT): string {
  const compact = text.replace(/\s+/g, ' ').trim()
  return compact.length > max ? `${compact.slice(0, max)}…` : compact
}

export async function buildProjectIndex(store: FileStore): Promise<ProjectIndex> {
  const entries: ProjectIndexEntry[] = []
  for (const character of await listCharacters(store)) entries.push({ kind: 'character', id: character.id, title: character.name, category: character.tier, terms: character.aliases, text: clip([character.name, ...character.aliases, character.summary, ...character.tags, character.content].join(' ')) })
  for (const outline of await listOutline(store)) entries.push({ kind: 'outline', id: outline.id, title: outline.title, category: outline.kind, order: outline.order, text: clip([outline.title, outline.content].join(' ')) })
  for (const event of await listEvents(store)) entries.push({ kind: 'event', id: event.id, title: event.title, order: event.order, text: clip([event.title, event.storyTime, event.location, ...event.tags, event.content].join(' ')) })
  for (const chapter of await listChapters(store)) {
    const body = await getChapterBody(store, chapter.id)
    entries.push({ kind: 'chapter', id: chapter.id, title: chapter.title, category: chapter.box, order: chapter.order, volumeId: chapter.volumeId, terms: (chapter.terms ?? []).map((term) => term.term), text: clip([chapter.title, chapter.volume, ...(chapter.terms ?? []).map((term) => `${term.term} ${term.note ?? ''}`), body ?? ''].join(' ')) })
  }
  for (const setting of await listSettings(store)) {
    const full = await getSetting(store, setting.id)
    entries.push({ kind: 'setting', id: setting.id, title: setting.title, category: setting.category, terms: setting.tags, text: clip([setting.title, ...setting.tags, full?.content ?? ''].join(' ')) })
  }
  for (const note of await listNotes(store)) {
    const full = await getNote(store, note.id)
    entries.push({ kind: 'note', id: note.id, title: note.title, terms: note.tags, text: clip([note.title, ...note.tags, full?.content ?? ''].join(' ')) })
  }
  const relationships = await loadRelationships(store)
  if (relationships.length) entries.push({ kind: 'relationship', id: 'relationships', title: '人物关系', text: clip(JSON.stringify(relationships)) })
  const index: ProjectIndex = { version: 1, builtAt: Date.now(), entries }
  await store.ensureDir('.storyfabric')
  await store.writeText(INDEX_PATH, JSON.stringify(index, null, 2))
  return index
}

async function readOrBuild(store: FileStore): Promise<ProjectIndex> {
  const raw = await store.readText(INDEX_PATH)
  if (raw) {
    try {
      const index = JSON.parse(raw) as ProjectIndex
      if (index?.version === 1 && Array.isArray(index.entries)) return index
    } catch {
      /* 损坏索引自动重建 */
    }
  }
  return buildProjectIndex(store)
}

function matches(entry: ProjectIndexEntry, query: string): boolean {
  const q = query.toLocaleLowerCase()
  return [entry.title, entry.category ?? '', entry.text, ...(entry.terms ?? [])].join(' ').toLocaleLowerCase().includes(q)
}

export async function searchIndex(store: FileStore, query: string, limit = 40): Promise<SearchHit[]> {
  const q = query.trim()
  if (!q) return []
  const index = await readOrBuild(store)
  return index.entries.filter((entry) => matches(entry, q)).slice(0, Math.min(40, Math.max(1, limit))).map((entry) => {
    const text = [entry.title, entry.category ?? '', entry.text].join(' ')
    const at = text.toLocaleLowerCase().indexOf(q.toLocaleLowerCase())
    const start = Math.max(0, at - 36)
    const end = Math.min(text.length, at + q.length + 80)
    return { kind: entry.kind, id: entry.id, title: entry.title, snippet: `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}` }
  })
}

export async function lookupTerm(store: FileStore, term: string): Promise<SearchHit[]> {
  const q = term.trim()
  if (!q) return []
  const index = await readOrBuild(store)
  const lower = q.toLocaleLowerCase()
  const score = (entry: ProjectIndexEntry): number => {
    if ((entry.terms ?? []).some((value) => value.toLocaleLowerCase().includes(lower))) return 0
    if (entry.title.toLocaleLowerCase().includes(lower)) return 1
    if (entry.category?.toLocaleLowerCase().includes(lower)) return 2
    return 3
  }
  return index.entries.filter((entry) => matches(entry, q)).sort((a, b) => score(a) - score(b)).slice(0, 40).map((entry) => ({ kind: entry.kind, id: entry.id, title: entry.title, snippet: clip(entry.text, 240) }))
}

export async function invalidateProjectIndex(store: FileStore): Promise<void> {
  await store.remove(INDEX_PATH)
}
