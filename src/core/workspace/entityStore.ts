import type {
  ChapterDoc,
  ChapterMeta,
  ChapterStatus,
  CharacterTier,
  CharacterDoc,
  ChapterBox,
  OutlineDoc,
  OutlineKind,
  Relationship,
  SearchHit,
  SettingCategory,
  SettingDoc,
  SettingMeta,
  StoryEvent,
  TrashEntry,
  NoteDoc,
  NoteMeta,
  TermAnnotation
} from '../../shared/types'
import type { FileStore } from '../storage/fileStore'
import { recordChapterWriting } from '../usage/writingStats'
import { makeTrashEntry, moveToTrash } from './trash'
import { invalidateProjectIndex } from '../retrieval/projectIndex'
import { searchIndex } from '../retrieval/projectIndex'
import { parseFrontMatter, stringifyFrontMatter } from './frontMatter'
import { normalizeChapterContent } from './chapterFormatting'
import { removeEventFromGraph } from './eventGraph'
import { commitTextChanges, type JournalTextChange } from './mutationJournal'
import { normalizeChapterStatus, resolveChapterPlacement } from '../../shared/chapterPlacement'

export function genId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8)
  const uuid = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : rand
  return `${prefix}_${uuid}${rand}`
}

export function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim().replace(/[.\s]+$/, '')
  return cleaned.slice(0, 60) || '未命名'
}

function padOrder(n: number): string {
  return String(Math.max(0, Math.floor(n))).padStart(4, '0')
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}

function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

export function countWords(text: string): number {
  return text.replace(/\s/g, '').length
}

async function readMd(store: FileStore, path: string): Promise<{ data: Record<string, unknown>; content: string } | null> {
  const raw = await store.readText(path)
  if (raw === null) return null
  try {
    return parseFrontMatter(raw)
  } catch {
    return null
  }
}

async function listMd(store: FileStore, dir: string): Promise<string[]> {
  const files = (await store.listFiles(dir, '.md')).map((f) => dir ? `${dir}/${f}` : f)
  const dirs = await store.listDirs(dir)
  for (const child of dirs) files.push(...await listMd(store, dir ? `${dir}/${child}` : child))
  return files
}

interface Stored<T> {
  doc: T
  fileName: string
}

async function loadCharacters(store: FileStore): Promise<Stored<CharacterDoc>[]> {
  const out: Stored<CharacterDoc>[] = []
  for (const filePath of await listMd(store, 'characters')) {
    const parsed = await readMd(store, filePath)
    if (!parsed || typeof parsed.data.id !== 'string') continue
    out.push({
      fileName: filePath.replace(/^characters\//, ''),
      doc: {
        ...parsed.data,
        id: parsed.data.id,
        name: str(parsed.data.name, filePath.replace(/^.*\//, '').replace(/\.md$/i, '')),
        aliases: strArr(parsed.data.aliases),
        role: str(parsed.data.role),
        faction: str(parsed.data.faction),
        gender: str(parsed.data.gender),
        age: str(parsed.data.age),
        tags: strArr(parsed.data.tags),
        summary: str(parsed.data.summary),
        content: parsed.content.replace(/^\n+/, ''),
        tier: parsed.data.tier === 'primary' ? 'primary' : 'secondary'
      }
    })
  }
  return out
}

export async function listCharacters(store: FileStore): Promise<CharacterDoc[]> {
  return (await loadCharacters(store)).map((x) => x.doc)
}

export async function loadCharacterDocuments(store: FileStore): Promise<Array<{ doc: CharacterDoc; fileName: string }>> {
  return loadCharacters(store)
}

function characterFrontmatter(c: CharacterDoc): Record<string, unknown> {
  const { content: _content, ...metadata } = c as CharacterDoc & Record<string, unknown>
  return { ...metadata, id: c.id, name: c.name, aliases: c.aliases, tier: c.tier ?? 'secondary', role: c.role, faction: c.faction, gender: c.gender, age: c.age, tags: c.tags, summary: c.summary }
}

export function serializeCharacter(c: CharacterDoc): string {
  return stringifyFrontMatter(c.content ?? '', characterFrontmatter(c))
}

export async function saveCharacter(store: FileStore, input: Partial<CharacterDoc> & { id?: string }): Promise<CharacterDoc> {
  await store.ensureDir('characters')
  const all = await loadCharacters(store)
  const existing = input.id ? all.find((x) => x.doc.id === input.id) : undefined
  const doc = existing
    ? ({ ...existing.doc, ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)), id: existing.doc.id } as CharacterDoc)
    : ({ id: input.id ?? genId('char'), name: input.name?.trim() || '未命名人物', aliases: input.aliases ?? [], tier: input.tier === 'primary' ? 'primary' : 'secondary', role: input.role ?? '', faction: input.faction ?? '', gender: input.gender ?? '', age: input.age ?? '', tags: input.tags ?? [], summary: input.summary ?? '', content: input.content ?? '' } satisfies CharacterDoc)
  const tier: CharacterTier = doc.tier === 'primary' ? 'primary' : 'secondary'
  const fileNameBase = `${sanitizeFileName(doc.name)}.md`
  const targetName = all.some((x) => x.fileName === `${tier}/${fileNameBase}` && x.doc.id !== doc.id) ? `${sanitizeFileName(doc.name)}_${doc.id.split('_')[1] ?? doc.id}.md` : fileNameBase
  const filePath = `characters/${tier}/${targetName}`
  await store.writeText(filePath, serializeCharacter(doc))
  if (existing && existing.fileName !== `${tier}/${targetName}`) await store.remove(`characters/${existing.fileName}`)
  await invalidateProjectIndex(store)
  return doc
}

export async function findCharacter(store: FileStore, ref: { id?: string; name?: string }): Promise<CharacterDoc | null> {
  const all = await listCharacters(store)
  if (ref.id) return all.find((c) => c.id === ref.id) ?? null
  const q = ref.name?.trim().toLowerCase()
  if (!q) return null
  return all.find((c) => c.name.toLowerCase() === q) ?? all.find((c) => c.aliases.some((a) => a.toLowerCase() === q)) ?? all.find((c) => c.name.toLowerCase().includes(q)) ?? null
}

export async function deleteCharacter(store: FileStore, id: string): Promise<void> {
  const hit = (await loadCharacters(store)).find((x) => x.doc.id === id)
  const relationships = await loadRelationships(store)
  if (hit) await moveToTrash(store, makeTrashEntry({ id, kind: 'character', originalPath: `characters/${hit.fileName}`, title: hit.doc.name, relatedRelationships: relationships.filter((r) => r.fromId === id || r.toId === id) }))
  await saveRelationships(store, relationships.filter((r) => r.fromId !== id && r.toId !== id))
}

export async function loadRelationships(store: FileStore): Promise<Relationship[]> {
  const raw = await store.readText('relationships.json')
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter((v): v is Relationship => typeof v?.fromId === 'string' && typeof v?.toId === 'string') : []
  } catch {
    return []
  }
}

export async function loadRelationshipDocuments(store: FileStore): Promise<{ doc: Relationship[]; fileName: string } | null> {
  if (!(await store.exists('relationships.json'))) return null
  return { doc: await loadRelationships(store), fileName: 'relationships.json' }
}

export async function saveRelationships(store: FileStore, list: Relationship[]): Promise<void> {
  await store.ensureDir('')
  const seen = new Set<string>()
  const clean = list.map((r) => {
    let id = typeof r.id === 'string' && r.id && !seen.has(r.id) ? r.id : genId('rel')
    while (seen.has(id)) id = genId('rel')
    seen.add(id)
    return { id, fromId: r.fromId, toId: r.toId, type: r.type ?? '', label: r.label ?? '', description: r.description ?? '', directed: Boolean(r.directed) } satisfies Relationship
  })
  await store.writeText('relationships.json', JSON.stringify(clean, null, 2))
  await invalidateProjectIndex(store)
}

export function serializeRelationships(list: Relationship[], nameOf: (id: string) => string): string {
  return list.map((r) => `${nameOf(r.fromId)} ${r.directed ? '→' : '⇄'} ${nameOf(r.toId)}${r.type ? ` 【${r.type}】` : ''}${r.label ? ` ${r.label}` : ''}${r.description ? ` — ${r.description}` : ''}`).join('\n')
}

async function loadOutlines(store: FileStore): Promise<Stored<OutlineDoc>[]> {
  const out: Stored<OutlineDoc>[] = []
  for (const filePath of await listMd(store, 'outline')) {
    const parsed = await readMd(store, filePath)
    if (!parsed || typeof parsed.data.id !== 'string') continue
    out.push({ fileName: filePath.replace(/^outline\//, ''), doc: { ...parsed.data, id: parsed.data.id, title: str(parsed.data.title, filePath.replace(/.*\//, '').replace(/\.md$/i, '')), order: num(parsed.data.order), kind: parsed.data.kind === 'chapter' ? 'chapter' : 'total', chapterId: typeof parsed.data.chapterId === 'string' ? parsed.data.chapterId : undefined, content: parsed.content.replace(/^\n+/, '') } as OutlineDoc })
  }
  return out.sort((a, b) => a.doc.order - b.doc.order)
}

export async function listOutline(store: FileStore): Promise<OutlineDoc[]> { return (await loadOutlines(store)).map((x) => x.doc) }
export async function loadOutlineDocuments(store: FileStore): Promise<Array<{ doc: OutlineDoc; fileName: string }>> { return loadOutlines(store) }
export function serializeOutlineDoc(d: OutlineDoc): string { const { content: _content, ...metadata } = d as OutlineDoc & Record<string, unknown>; return stringifyFrontMatter(d.content ?? '', { ...metadata, id: d.id, title: d.title, order: d.order, kind: d.kind ?? 'total', ...(d.chapterId ? { chapterId: d.chapterId } : {}) }) }

export async function saveOutlineDoc(store: FileStore, input: Partial<OutlineDoc> & { id?: string }): Promise<OutlineDoc> {
  await store.ensureDir('outline')
  const all = await loadOutlines(store)
  const existing = input.id ? all.find((x) => x.doc.id === input.id) : undefined
  const doc = existing
    ? ({ ...existing.doc, ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)), id: existing.doc.id } as OutlineDoc)
    : ({ id: input.id ?? genId('out'), title: input.title?.trim() || '未命名大纲', order: input.order ?? (all.length ? Math.max(...all.map((x) => x.doc.order)) + 1 : 1), kind: input.kind === 'chapter' ? 'chapter' : 'total', chapterId: input.chapterId, content: input.content ?? '' } satisfies OutlineDoc)
  doc.chapterId = doc.kind === 'chapter' && typeof doc.chapterId === 'string' && doc.chapterId.trim()
    ? doc.chapterId.trim()
    : undefined
  const folder = doc.kind === 'chapter'
    ? doc.chapterId ? `outline/chapters/${doc.chapterId}` : 'outline/unassigned'
    : 'outline/total'
  await store.ensureDir(folder)
  const base = `${padOrder(doc.order)}-${sanitizeFileName(doc.title)}.md`
  const relative = `${folder.replace(/^outline\//, '')}/${base}`
  const fileName = all.some((x) => x.fileName === relative && x.doc.id !== doc.id) ? `${folder.replace(/^outline\//, '')}/${padOrder(doc.order)}-${sanitizeFileName(doc.title)}_${doc.id.split('_')[1] ?? doc.id}.md` : relative
  await store.writeText(`outline/${fileName}`, serializeOutlineDoc(doc))
  if (existing && existing.fileName !== fileName) await store.remove(`outline/${existing.fileName}`)
  await invalidateProjectIndex(store)
  return doc
}

export async function deleteOutlineDoc(store: FileStore, id: string): Promise<void> {
  const hit = (await loadOutlines(store)).find((x) => x.doc.id === id)
  if (hit) await moveToTrash(store, makeTrashEntry({ id, kind: 'outline', originalPath: `outline/${hit.fileName}`, title: hit.doc.title }))
  await invalidateProjectIndex(store)
}

async function loadEvents(store: FileStore): Promise<Stored<StoryEvent>[]> {
  const out: Stored<StoryEvent>[] = []
  for (const fileName of await listMd(store, 'events')) {
    const parsed = await readMd(store, fileName)
    if (!parsed || typeof parsed.data.id !== 'string') continue
    out.push({ fileName: fileName.replace(/^events\//, ''), doc: { ...parsed.data, id: parsed.data.id, title: str(parsed.data.title, fileName.replace(/.*\//, '').replace(/\.md$/i, '')), volumeId: typeof parsed.data.volumeId === 'string' && parsed.data.volumeId ? parsed.data.volumeId : 'vol_default', storyTime: str(parsed.data.storyTime), order: num(parsed.data.order), location: str(parsed.data.location), tags: strArr(parsed.data.tags), characterIds: strArr(parsed.data.characterIds), prevIds: strArr(parsed.data.prevIds), nextIds: strArr(parsed.data.nextIds), branchIds: strArr(parsed.data.branchIds), branchFromId: typeof parsed.data.branchFromId === 'string' && parsed.data.branchFromId ? parsed.data.branchFromId : undefined, content: parsed.content.replace(/^\n+/, '') } as StoryEvent })
  }
  return out.sort((a, b) => a.doc.order - b.doc.order)
}

export async function listEvents(store: FileStore): Promise<StoryEvent[]> { return (await loadEvents(store)).map((x) => x.doc) }
export async function loadEventDocuments(store: FileStore): Promise<Array<{ doc: StoryEvent; fileName: string }>> { return loadEvents(store) }
export function serializeEvent(e: StoryEvent): string { const { content: _content, ...metadata } = e as StoryEvent & Record<string, unknown>; return stringifyFrontMatter(e.content ?? '', { ...metadata, id: e.id, title: e.title, volumeId: e.volumeId ?? 'vol_default', storyTime: e.storyTime, order: e.order, location: e.location, tags: e.tags, characterIds: e.characterIds, prevIds: e.prevIds, nextIds: e.nextIds, branchIds: e.branchIds ?? [], ...(e.branchFromId ? { branchFromId: e.branchFromId } : {}) }) }

export async function saveEvent(store: FileStore, input: Partial<StoryEvent> & { id?: string }): Promise<StoryEvent> {
  await store.ensureDir('events')
  const all = await loadEvents(store)
  const existing = input.id ? all.find((x) => x.doc.id === input.id) : undefined
  const doc = existing
    ? ({ ...existing.doc, ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)), id: existing.doc.id } as StoryEvent)
    : ({ id: input.id ?? genId('evt'), title: input.title?.trim() || '未命名事件', volumeId: input.volumeId ?? 'vol_default', storyTime: input.storyTime ?? '', order: input.order ?? (all.length ? Math.max(...all.map((x) => x.doc.order)) + 1 : 1), location: input.location ?? '', tags: input.tags ?? [], characterIds: input.characterIds ?? [], prevIds: input.prevIds ?? [], nextIds: input.nextIds ?? [], branchIds: input.branchIds ?? [], branchFromId: input.branchFromId, content: input.content ?? '' } satisfies StoryEvent)
  doc.prevIds = Array.from(new Set(doc.prevIds.filter((id) => id && id !== doc.id))).slice(0, 1)
  doc.nextIds = Array.from(new Set(doc.nextIds.filter((id) => id && id !== doc.id))).slice(0, 1)
  doc.branchIds = Array.from(new Set((doc.branchIds ?? []).filter((id) => id && id !== doc.id)))
  const base = `${sanitizeFileName(doc.title)}.md`
  const fileName = all.some((x) => x.fileName === base && x.doc.id !== doc.id) ? `${sanitizeFileName(doc.title)}_${doc.id.split('_')[1] ?? doc.id}.md` : base
  await store.writeText(`events/${fileName}`, serializeEvent(doc))
  if (existing && existing.fileName !== fileName) await store.remove(`events/${existing.fileName}`)
  await invalidateProjectIndex(store)
  return doc
}

export async function deleteEvent(store: FileStore, id: string): Promise<void> {
  const all = await loadEvents(store)
  const hit = all.find((x) => x.doc.id === id)
  if (!hit) return
  const healed = removeEventFromGraph(all.map((item) => item.doc), id)
  const healedById = new Map(healed.map((event) => [event.id, event]))
  const neighbors: NonNullable<TrashEntry['eventConnections']>['neighbors'] = []
  const changes: JournalTextChange[] = []
  for (const item of all) {
    if (item.doc.id === id) continue
    const next = healedById.get(item.doc.id)
    if (next && JSON.stringify(next) !== JSON.stringify(item.doc)) {
      neighbors.push({
        id: item.doc.id,
        before: {
          prevIds: item.doc.prevIds,
          nextIds: item.doc.nextIds,
          branchIds: item.doc.branchIds ?? [],
          branchFromId: item.doc.branchFromId
        },
        after: {
          prevIds: next.prevIds,
          nextIds: next.nextIds,
          branchIds: next.branchIds ?? [],
          branchFromId: next.branchFromId
        }
      })
      changes.push({
        path: `events/${item.fileName}`,
        beforeText: serializeEvent(item.doc),
        afterText: serializeEvent(next)
      })
    }
  }
  const transaction = await commitTextChanges(store, `delete-event-${id}-${Date.now()}`, changes, () => moveToTrash(store, makeTrashEntry({
      id,
      kind: 'event',
      originalPath: `events/${hit.fileName}`,
      title: hit.doc.title,
      eventConnections: { event: hit.doc, neighbors }
    })))
  if (!transaction.ok) throw new Error(transaction.text)
  await invalidateProjectIndex(store)
}

export interface StoredSetting { fileName: string; doc: SettingDoc }

function settingParentId(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function validateSettingParent(all: StoredSetting[], id: string, parentId: string | undefined, previousParentId?: string): void {
  if (!parentId) return
  const byId = new Map(all.map(({ doc }) => [doc.id, doc]))
  if (!byId.has(parentId) && parentId !== id && parentId !== previousParentId) throw new Error('父级设定不存在')
  const visited = new Set<string>([id])
  let currentId: string | undefined = parentId
  while (currentId) {
    if (visited.has(currentId)) throw new Error('设定父级关系存在循环')
    visited.add(currentId)
    currentId = settingParentId(byId.get(currentId)?.parentId)
  }
}

export function validateSettingTagParents(tags: string[], tagParents: Record<string, string> | undefined): void {
  if (tagParents === undefined) return
  if (!tagParents || typeof tagParents !== 'object' || Array.isArray(tagParents)) throw new Error('标签父级关系必须是对象')
  const names = new Set(tags)
  const parents = new Map<string, string>()
  for (const [child, parent] of Object.entries(tagParents)) {
    if (!names.has(child) || typeof parent !== 'string' || !names.has(parent)) throw new Error(`父标签不存在或子标签无效：${child}`)
    parents.set(child, parent)
  }
  for (const child of parents.keys()) {
    const visited = new Set<string>()
    let current: string | undefined = child
    while (current && parents.has(current)) {
      if (visited.has(current)) throw new Error('标签父级关系存在循环')
      visited.add(current)
      current = parents.get(current)
    }
  }
}

export function validateSettingTagDetails(tags: string[], tagDetails: SettingDoc['tagDetails']): void {
  if (tagDetails === undefined) return
  if (!tagDetails || typeof tagDetails !== 'object' || Array.isArray(tagDetails)) throw new Error('标签详情必须是对象')
  const known = new Set(tags)
  for (const [name, detail] of Object.entries(tagDetails)) {
    if (!known.has(name) || !detail || typeof detail !== 'object' || Array.isArray(detail) ||
      (detail.summary !== undefined && typeof detail.summary !== 'string') ||
      (detail.content !== undefined && typeof detail.content !== 'string')) throw new Error(`标签详情无效：${name}`)
  }
}

async function loadSettings(store: FileStore): Promise<StoredSetting[]> {
  const out: StoredSetting[] = []
  for (const filePath of await listMd(store, 'settings')) {
    const parsed = await readMd(store, filePath)
    if (!parsed || typeof parsed.data.id !== 'string') continue
    const category: SettingCategory = parsed.data.category === 'other' || filePath.startsWith('settings/other/') ? 'other' : 'background'
    const { parentId: rawParentId, ...data } = parsed.data
    const parentId = settingParentId(rawParentId)
    out.push({
      fileName: filePath.replace(/^settings\//, ''),
      doc: { ...data, id: parsed.data.id, title: str(parsed.data.title, filePath.replace(/.*\//, '').replace(/\.md$/i, '')), category, tags: strArr(parsed.data.tags), ...(parentId ? { parentId } : {}), content: parsed.content.replace(/^\n+/, '') } as SettingDoc
    })
  }
  return out
}

export async function listSettings(store: FileStore): Promise<SettingMeta[]> {
  return (await loadSettings(store)).map(({ doc: { content: _content, ...meta } }) => meta)
}

export async function loadSettingDocuments(store: FileStore): Promise<StoredSetting[]> {
  return loadSettings(store)
}

export async function getSetting(store: FileStore, id: string): Promise<SettingDoc | null> {
  return (await loadSettings(store)).find((item) => item.doc.id === id)?.doc ?? null
}

export function serializeSetting(doc: SettingDoc): string {
  const { content: _content, parentId: _parentId, ...metadata } = doc as SettingDoc & Record<string, unknown>
  return stringifyFrontMatter(doc.content ?? '', { ...metadata, id: doc.id, title: doc.title, category: doc.category, tags: doc.tags, ...(doc.parentId ? { parentId: doc.parentId } : {}) })
}

export async function saveSetting(store: FileStore, input: Partial<SettingDoc> & { id?: string }): Promise<SettingDoc> {
  await store.ensureDir('settings')
  const all = await loadSettings(store)
  const existing = input.id ? all.find((item) => item.doc.id === input.id) : undefined
  const doc = existing
    ? ({ ...existing.doc, ...Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)), id: existing.doc.id } as SettingDoc)
    : ({ id: input.id ?? genId('set'), title: input.title?.trim() || '未命名设定', summary: input.summary, category: input.category === 'other' ? 'other' : 'background', tags: input.tags ?? [], tagParents: input.tagParents, tagDetails: input.tagDetails, parentId: input.parentId, content: input.content ?? '' } satisfies SettingDoc)
  const parentId = settingParentId(doc.parentId)
  if (parentId) doc.parentId = parentId
  else delete doc.parentId
  validateSettingTagParents(doc.tags, doc.tagParents)
  validateSettingTagDetails(doc.tags, doc.tagDetails)
  validateSettingParent(all, doc.id, doc.parentId, existing?.doc.parentId)
  const base = `${sanitizeFileName(doc.title)}.md`
  const relative = `${doc.category}/${base}`
  const fileName = all.some((item) => item.fileName === relative && item.doc.id !== doc.id) ? `${doc.category}/${sanitizeFileName(doc.title)}_${doc.id.split('_')[1] ?? doc.id}.md` : relative
  await store.writeText(`settings/${fileName}`, serializeSetting(doc))
  if (existing && existing.fileName !== fileName) await store.remove(`settings/${existing.fileName}`)
  await invalidateProjectIndex(store)
  return doc
}

export async function deleteSetting(store: FileStore, id: string): Promise<void> {
  const hit = (await loadSettings(store)).find((item) => item.doc.id === id)
  if (hit) await moveToTrash(store, makeTrashEntry({ id, kind: 'setting', originalPath: `settings/${hit.fileName}`, title: hit.doc.title }))
  await invalidateProjectIndex(store)
}

export interface StoredNote { fileName: string; doc: NoteDoc }

async function loadNotes(store: FileStore): Promise<StoredNote[]> {
  const out: StoredNote[] = []
  for (const filePath of await listMd(store, 'notes')) {
    const parsed = await readMd(store, filePath)
    if (!parsed || typeof parsed.data.id !== 'string') continue
    out.push({
      fileName: filePath.replace(/^notes\//, ''),
      doc: {
        ...parsed.data,
        id: parsed.data.id,
        title: str(parsed.data.title, filePath.replace(/.*\//, '').replace(/\.md$/i, '')),
        tags: strArr(parsed.data.tags),
        pinned: Boolean(parsed.data.pinned),
        createdAt: num(parsed.data.createdAt, Date.now()),
        updatedAt: num(parsed.data.updatedAt, Date.now()),
        content: parsed.content.replace(/^\n+/, '')
      }
    })
  }
  return out.sort((a, b) => Number(b.doc.pinned) - Number(a.doc.pinned) || b.doc.updatedAt - a.doc.updatedAt)
}

export async function listNotes(store: FileStore): Promise<NoteMeta[]> {
  return (await loadNotes(store)).map(({ doc: { content: _content, ...meta } }) => meta)
}

export async function loadNoteDocuments(store: FileStore): Promise<StoredNote[]> {
  return loadNotes(store)
}

export async function getNote(store: FileStore, id: string): Promise<NoteDoc | null> {
  return (await loadNotes(store)).find((item) => item.doc.id === id)?.doc ?? null
}

export function serializeNote(doc: NoteDoc): string {
  const { content: _content, ...metadata } = doc as NoteDoc & Record<string, unknown>
  return stringifyFrontMatter(doc.content ?? '', { ...metadata, id: doc.id, title: doc.title, tags: doc.tags, pinned: doc.pinned, createdAt: doc.createdAt, updatedAt: doc.updatedAt })
}

export async function saveNote(store: FileStore, input: Partial<NoteDoc> & { id?: string }): Promise<NoteDoc> {
  await store.ensureDir('notes')
  const all = await loadNotes(store)
  const existing = input.id ? all.find((item) => item.doc.id === input.id) : undefined
  const now = Date.now()
  const doc = existing
    ? ({ ...existing.doc, ...Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)), id: existing.doc.id, updatedAt: now } as NoteDoc)
    : ({ id: input.id ?? genId('note'), title: input.title?.trim() || '未命名便签', tags: input.tags ?? [], pinned: Boolean(input.pinned), createdAt: input.createdAt ?? now, updatedAt: now, content: input.content ?? '' } satisfies NoteDoc)
  const base = `${sanitizeFileName(doc.title)}.md`
  const fileName = all.some((item) => item.fileName === base && item.doc.id !== doc.id) ? `${sanitizeFileName(doc.title)}_${doc.id.split('_')[1] ?? doc.id}.md` : base
  await store.writeText(`notes/${fileName}`, serializeNote(doc))
  if (existing && existing.fileName !== fileName) await store.remove(`notes/${existing.fileName}`)
  await invalidateProjectIndex(store)
  return doc
}

export async function deleteNote(store: FileStore, id: string): Promise<void> {
  const hit = (await loadNotes(store)).find((item) => item.doc.id === id)
  if (hit) await moveToTrash(store, makeTrashEntry({ id, kind: 'note', originalPath: `notes/${hit.fileName}`, title: hit.doc.title }))
  await invalidateProjectIndex(store)
}

function parseChapterDocument(filePath: string, parsed: { data: Record<string, unknown>; content: string }): Stored<ChapterDoc> | null {
  if (typeof parsed.data.id !== 'string') return null
  const content = normalizeChapterContent(parsed.content.replace(/^\n+/, ''))
  const relative = filePath.replace(/^chapters\//, '')
  const parts = relative.split('/')
  const box: ChapterBox = parts[0] === 'draft' ? 'draft' : 'main'
  const status = normalizeChapterStatus(parsed.data.status, box === 'draft' ? 'draft' : 'main')
  const volumeId = typeof parsed.data.volumeId === 'string' ? parsed.data.volumeId : (box === 'main' ? (parts[1] && parts[1] !== 'main' ? parts[1] : 'vol_default') : 'vol_default')
  const terms: TermAnnotation[] = Array.isArray(parsed.data.terms) ? parsed.data.terms.filter((v): v is TermAnnotation => typeof v?.term === 'string') : []
  return {
    fileName: relative,
    doc: { ...parsed.data, id: parsed.data.id, title: str(parsed.data.title, filePath.replace(/.*\//, '').replace(/\.md$/i, '')), volume: str(parsed.data.volume, '第一卷'), volumeId, box, terms, order: num(parsed.data.order), status, wordCount: countWords(content), content } as ChapterDoc
  }
}

async function loadChapters(store: FileStore): Promise<Stored<ChapterDoc>[]> {
  const out: Stored<ChapterDoc>[] = []
  for (const filePath of await listMd(store, 'chapters')) {
    if (filePath === 'chapters/volumes.json' || filePath.includes('/trash/')) continue
    const parsed = await readMd(store, filePath)
    if (!parsed) continue
    const stored = parseChapterDocument(filePath, parsed)
    if (stored) out.push(stored)
  }
  return out.sort((a, b) => a.doc.order - b.doc.order)
}

export async function listChapters(store: FileStore): Promise<ChapterMeta[]> { return (await loadChapters(store)).map(({ doc: { content: _content, ...meta } }) => meta) }
export async function loadChapterDocuments(store: FileStore): Promise<Array<{ doc: ChapterDoc; fileName: string }>> { return loadChapters(store) }
export async function getChapterBody(store: FileStore, id: string): Promise<string | null> { return (await loadChapters(store)).find((x) => x.doc.id === id)?.doc.content ?? null }
export async function readChapterDocumentAt(store: FileStore, fileName: string): Promise<{ doc: ChapterDoc; fileName: string } | null> {
  const relative = fileName.replace(/^chapters\//, '')
  const parsed = await readMd(store, `chapters/${relative}`)
  return parsed ? parseChapterDocument(`chapters/${relative}`, parsed) : null
}

/**
 * Updates a chapter at a known path. The caller must ensure that path-affecting
 * fields (title/order/box/volumeId) are unchanged; this avoids a second full
 * chapter scan during an approval apply.
 */
export async function saveChapterInPlace(store: FileStore, fileName: string, input: Partial<ChapterDoc> & { id?: string }): Promise<ChapterDoc> {
  const existing = await readChapterDocumentAt(store, fileName)
  if (!existing) throw new Error(`未找到章节文件：${fileName}`)
  const needsBaseline = !(await store.exists('.storyfabric/writing-stats/current.json'))
  const doc = { ...existing.doc, ...Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)), id: existing.doc.id } as ChapterDoc
  const placement = resolveChapterPlacement(existing.doc, input)
  if (placement.box !== existing.doc.box) throw new Error('状态变更需要移动章节，请使用 saveChapter')
  doc.box = placement.box
  doc.status = placement.status
  doc.content = normalizeChapterContent(doc.content)
  doc.wordCount = countWords(doc.content)
  doc.box = doc.box === 'draft' ? 'draft' : 'main'
  doc.volumeId = doc.volumeId ?? 'vol_default'
  doc.terms = doc.terms ?? []
  await store.writeText(`chapters/${existing.fileName}`, serializeChapter(doc))
  const totalAfter = needsBaseline ? (await loadChapters(store)).reduce((sum, chapter) => sum + chapter.doc.wordCount, 0) : undefined
  await recordChapterWriting(store, existing.doc.content, doc.content, totalAfter)
  await invalidateProjectIndex(store)
  return doc
}
export function serializeChapter(c: ChapterDoc): string { const { content: _content, ...metadata } = c as ChapterDoc & Record<string, unknown>; return stringifyFrontMatter(normalizeChapterContent(c.content ?? ''), { ...metadata, id: c.id, title: c.title, volume: c.volume, volumeId: c.volumeId ?? 'vol_default', box: c.box ?? 'main', terms: c.terms ?? [], order: c.order, status: c.status }) }

export async function saveChapter(store: FileStore, input: Partial<ChapterDoc> & { id?: string }): Promise<ChapterDoc> {
  await store.ensureDir('chapters')
  const all = await loadChapters(store)
  const existing = input.id ? all.find((x) => x.doc.id === input.id) : undefined
  const doc = existing
    ? ({ ...existing.doc, ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)), id: existing.doc.id } as ChapterDoc)
    : ({ id: input.id ?? genId('cha'), title: input.title?.trim() || '未命名章节', volume: input.volume ?? '第一卷', volumeId: input.volumeId ?? 'vol_default', box: 'main', terms: input.terms ?? [], order: input.order ?? (all.length ? Math.max(...all.map((x) => x.doc.order)) + 1 : 1), status: 'body', wordCount: 0, content: input.content ?? '' } satisfies ChapterDoc)
  const placement = resolveChapterPlacement(existing?.doc ?? null, input)
  doc.box = placement.box
  doc.status = placement.status
  doc.content = normalizeChapterContent(doc.content)
  doc.wordCount = countWords(doc.content)
  doc.box = doc.box === 'draft' ? 'draft' : 'main'
  doc.volumeId = doc.volumeId ?? 'vol_default'
  doc.terms = doc.terms ?? []
  const base = `${padOrder(doc.order)}-${sanitizeFileName(doc.title)}.md`
  const folder = doc.box === 'draft' ? 'draft' : `main/${doc.volumeId}`
  const relativeBase = `${folder}/${base}`
  const fileName = all.some((x) => x.fileName === relativeBase && x.doc.id !== doc.id) ? `${folder}/${padOrder(doc.order)}-${sanitizeFileName(doc.title)}_${doc.id.split('_')[1] ?? doc.id}.md` : relativeBase
  await store.writeText(`chapters/${fileName}`, serializeChapter(doc))
  if (existing && existing.fileName !== fileName) await store.remove(`chapters/${existing.fileName}`)
  const totalAfter = all.reduce((sum, item) => sum + item.doc.wordCount, 0) - (existing?.doc.wordCount ?? 0) + doc.wordCount
  await recordChapterWriting(store, existing?.doc.content ?? '', doc.content, totalAfter)
  await invalidateProjectIndex(store)
  return doc
}

export async function deleteChapter(store: FileStore, id: string): Promise<void> {
  const chapters = await loadChapters(store)
  const hit = chapters.find((x) => x.doc.id === id)
  if (hit) {
    await moveToTrash(store, makeTrashEntry({ id, kind: 'chapter', originalPath: `chapters/${hit.fileName}`, title: hit.doc.title }))
    await recordChapterWriting(store, hit.doc.content, '', chapters.reduce((sum, chapter) => sum + chapter.doc.wordCount, 0) - hit.doc.wordCount)
  }
  await invalidateProjectIndex(store)
}

export async function searchProject(store: FileStore, query: string): Promise<SearchHit[]> {
  return searchIndex(store, query)
}
