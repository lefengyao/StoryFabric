/**
 * 实体存储层：工作区内人物 / 关系 / 大纲 / 事件 / 章节的文件读写。
 * 全部函数以 rootDir 为首参，不依赖 electron，可在 vitest 中直接测试。
 *
 * 磁盘格式：
 *   characters/<名称>.md      YAML frontmatter + 自由 Markdown 正文
 *   events/<标题>.md          同上
 *   chapters/<序号>-<标题>.md  同上（正文即章节内容）
 *   outline/<序号>-<标题>.md   同上
 *   relationships.json        关系边列表
 */
import { promises as fs } from 'fs'
import { join } from 'path'
import matter from 'gray-matter'
import type {
  ChapterDoc,
  ChapterMeta,
  ChapterStatus,
  CharacterDoc,
  OutlineDoc,
  Relationship,
  SearchHit,
  StoryEvent
} from '../../shared/types'

/* ---------------- 基础工具 ---------------- */

export function genId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8)
  const uuid = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : rand
  return `${prefix}_${uuid}${rand}`
}

/** Windows/Linux 非法文件名字符清理 */
export function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim().replace(/[.\s]+$/, '')
  return cleaned.slice(0, 60)
}

function padOrder(n: number): string {
  return String(Math.max(0, Math.floor(n))).padStart(4, '0')
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true })
}

async function readMd(filePath: string): Promise<{ data: Record<string, unknown>; content: string } | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8')
    const parsed = matter(raw)
    return { data: parsed.data as Record<string, unknown>, content: parsed.content }
  } catch {
    return null
  }
}

async function listMdFiles(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir)
    return entries.filter((f) => f.toLowerCase().endsWith('.md')).sort()
  } catch {
    return []
  }
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

/* ---------------- 人物 ---------------- */

async function loadCharacters(root: string): Promise<{ doc: CharacterDoc; fileName: string }[]> {
  const dir = join(root, 'characters')
  const out: { doc: CharacterDoc; fileName: string }[] = []
  for (const f of await listMdFiles(dir)) {
    const parsed = await readMd(join(dir, f))
    if (!parsed || typeof parsed.data.id !== 'string') continue
    out.push({
      fileName: f,
      doc: {
        id: parsed.data.id,
        name: str(parsed.data.name, f.replace(/\.md$/i, '')),
        aliases: strArr(parsed.data.aliases),
        role: str(parsed.data.role),
        faction: str(parsed.data.faction),
        gender: str(parsed.data.gender),
        age: str(parsed.data.age),
        tags: strArr(parsed.data.tags),
        summary: str(parsed.data.summary),
        content: parsed.content.replace(/^\n+/, '')
      }
    })
  }
  return out
}

export async function listCharacters(root: string): Promise<CharacterDoc[]> {
  return (await loadCharacters(root)).map((x) => x.doc)
}

function characterFrontmatter(c: CharacterDoc): Record<string, unknown> {
  return {
    id: c.id,
    name: c.name,
    aliases: c.aliases,
    role: c.role,
    faction: c.faction,
    gender: c.gender,
    age: c.age,
    tags: c.tags,
    summary: c.summary
  }
}

export function serializeCharacter(c: CharacterDoc): string {
  return matter.stringify(c.content ?? '', characterFrontmatter(c))
}

/** 保存人物（按 id upsert）。提供部分字段时与既有内容合并。 */
export async function saveCharacter(root: string, input: Partial<CharacterDoc> & { id?: string }): Promise<CharacterDoc> {
  const dir = join(root, 'characters')
  await ensureDir(dir)
  const all = await loadCharacters(root)
  const existing = input.id ? all.find((x) => x.doc.id === input.id) : undefined

  let doc: CharacterDoc
  if (existing) {
    doc = {
      ...existing.doc,
      ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined))
    } as CharacterDoc
    doc.id = existing.doc.id
  } else {
    doc = {
      id: input.id ?? genId('char'),
      name: input.name?.trim() || '未命名人物',
      aliases: input.aliases ?? [],
      role: input.role ?? '',
      faction: input.faction ?? '',
      gender: input.gender ?? '',
      age: input.age ?? '',
      tags: input.tags ?? [],
      summary: input.summary ?? '',
      content: input.content ?? ''
    }
  }
  if (!doc.name.trim()) doc.name = '未命名人物'

  // 目标文件名；被其他文档占用时追加 id 后缀
  let fileName = `${sanitizeFileName(doc.name)}.md`
  const occupant = all.find((x) => x.fileName === fileName && x.doc.id !== doc.id)
  if (occupant) fileName = `${sanitizeFileName(doc.name)}_${doc.id.split('_')[1] ?? doc.id}.md`

  const targetPath = join(dir, fileName)
  const tempPath = targetPath + '.tmp'
  await fs.writeFile(tempPath, serializeCharacter(doc), 'utf-8')
  await fs.rename(tempPath, targetPath)

  if (existing && existing.fileName !== fileName) {
    await fs.rm(join(dir, existing.fileName), { force: true })
  }
  return doc
}

export async function deleteCharacter(root: string, id: string): Promise<void> {
  const dir = join(root, 'characters')
  const all = await loadCharacters(root)
  const hit = all.find((x) => x.doc.id === id)
  if (hit) await fs.rm(join(dir, hit.fileName), { force: true })
  // 级联清理关系边与事件引用
  const rels = (await loadRelationships(root)).filter((r) => r.fromId !== id && r.toId !== id)
  await saveRelationships(root, rels)
}

export async function findCharacter(root: string, ref: { id?: string; name?: string }): Promise<CharacterDoc | null> {
  const all = await listCharacters(root)
  if (ref.id) return all.find((c) => c.id === ref.id) ?? null
  if (ref.name) {
    const q = ref.name.trim().toLowerCase()
    return (
      all.find((c) => c.name.toLowerCase() === q) ??
      all.find((c) => c.aliases.some((a) => a.toLowerCase() === q)) ??
      all.find((c) => c.name.toLowerCase().includes(q)) ??
      null
    )
  }
  return null
}

/* ---------------- 人物关系 ---------------- */

export async function loadRelationships(root: string): Promise<Relationship[]> {
  try {
    const raw = await fs.readFile(join(root, 'relationships.json'), 'utf-8')
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr.filter(isRelationship)
  } catch {
    return []
  }
}

function isRelationship(v: unknown): v is Relationship {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return typeof r.fromId === 'string' && typeof r.toId === 'string'
}

export async function saveRelationships(root: string, list: Relationship[]): Promise<void> {
  await ensureDir(root)
  const seen = new Set<string>()
  const clean = list.map((r) => {
    let id = typeof r.id === 'string' && r.id && !seen.has(r.id) ? r.id : genId('rel')
    while (seen.has(id)) id = genId('rel')
    seen.add(id)
    return {
      id,
      fromId: r.fromId,
      toId: r.toId,
      type: r.type ?? '',
      label: r.label ?? '',
      description: r.description ?? '',
      directed: Boolean(r.directed)
    } satisfies Relationship
  })
  await fs.writeFile(join(root, 'relationships.json'), JSON.stringify(clean, null, 2), 'utf-8')
}

export function serializeRelationships(list: Relationship[], nameOf: (id: string) => string): string {
  return list
    .map((r) => {
      const arrow = r.directed ? '→' : '⇄'
      const parts = [`${nameOf(r.fromId)} ${arrow} ${nameOf(r.toId)}`]
      if (r.type) parts.push(`【${r.type}】`)
      if (r.label) parts.push(r.label)
      if (r.description) parts.push(`— ${r.description}`)
      return parts.join(' ')
    })
    .join('\n')
}

/* ---------------- 大纲 ---------------- */

async function loadOutlineDocs(root: string): Promise<{ doc: OutlineDoc; fileName: string }[]> {
  const dir = join(root, 'outline')
  const out: { doc: OutlineDoc; fileName: string }[] = []
  for (const f of await listMdFiles(dir)) {
    const parsed = await readMd(join(dir, f))
    if (!parsed || typeof parsed.data.id !== 'string') continue
    out.push({
      fileName: f,
      doc: {
        id: parsed.data.id,
        title: str(parsed.data.title, f.replace(/\.md$/i, '')),
        order: num(parsed.data.order),
        content: parsed.content.replace(/^\n+/, '')
      }
    })
  }
  return out.sort((a, b) => a.doc.order - b.doc.order)
}

export async function listOutline(root: string): Promise<OutlineDoc[]> {
  return (await loadOutlineDocs(root)).map((x) => x.doc)
}

export function serializeOutlineDoc(d: OutlineDoc): string {
  return matter.stringify(d.content ?? '', { id: d.id, title: d.title, order: d.order })
}

export async function saveOutlineDoc(
  root: string,
  input: Partial<OutlineDoc> & { id?: string }
): Promise<OutlineDoc> {
  const dir = join(root, 'outline')
  await ensureDir(dir)
  const all = await loadOutlineDocs(root)
  const existing = input.id ? all.find((x) => x.doc.id === input.id) : undefined
  let doc: OutlineDoc
  if (existing) {
    doc = { ...existing.doc, ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) } as OutlineDoc
    doc.id = existing.doc.id
  } else {
    doc = {
      id: input.id ?? genId('out'),
      title: input.title?.trim() || '未命名大纲',
      order: input.order ?? (all.length ? Math.max(...all.map((x) => x.doc.order)) + 1 : 1),
      content: input.content ?? ''
    }
  }
  let fileName = `${padOrder(doc.order)}-${sanitizeFileName(doc.title)}.md`
  if (all.some((x) => x.fileName === fileName && x.doc.id !== doc.id)) {
    fileName = `${padOrder(doc.order)}-${sanitizeFileName(doc.title)}_${doc.id.split('_')[1]}.md`
  }
  const targetPath = join(dir, fileName)
  const tempPath = targetPath + '.tmp'
  await fs.writeFile(tempPath, serializeOutlineDoc(doc), 'utf-8')
  await fs.rename(tempPath, targetPath)
  if (existing && existing.fileName !== fileName) {
    await fs.rm(join(dir, existing.fileName), { force: true })
  }
  return doc
}

export async function deleteOutlineDoc(root: string, id: string): Promise<void> {
  const dir = join(root, 'outline')
  const all = await loadOutlineDocs(root)
  const hit = all.find((x) => x.doc.id === id)
  if (hit) await fs.rm(join(dir, hit.fileName), { force: true })
}

/* ---------------- 事件脉络 ---------------- */

interface StoredEvent {
  doc: StoryEvent
  fileName: string
}

async function loadEvents(root: string): Promise<StoredEvent[]> {
  const dir = join(root, 'events')
  const out: StoredEvent[] = []
  for (const f of await listMdFiles(dir)) {
    const parsed = await readMd(join(dir, f))
    if (!parsed || typeof parsed.data.id !== 'string') continue
    out.push({
      fileName: f,
      doc: {
        id: parsed.data.id,
        title: str(parsed.data.title, f.replace(/\.md$/i, '')),
        storyTime: str(parsed.data.storyTime),
        order: num(parsed.data.order),
        location: str(parsed.data.location),
        tags: strArr(parsed.data.tags),
        characterIds: strArr(parsed.data.characterIds),
        prevIds: strArr(parsed.data.prevIds),
        nextIds: strArr(parsed.data.nextIds),
        content: parsed.content.replace(/^\n+/, '')
      }
    })
  }
  return out.sort((a, b) => a.doc.order - b.doc.order)
}

export async function listEvents(root: string): Promise<StoryEvent[]> {
  return (await loadEvents(root)).map((x) => x.doc)
}

export function serializeEvent(e: StoryEvent): string {
  return matter.stringify(e.content ?? '', {
    id: e.id,
    title: e.title,
    storyTime: e.storyTime,
    order: e.order,
    location: e.location,
    tags: e.tags,
    characterIds: e.characterIds,
    prevIds: e.prevIds,
    nextIds: e.nextIds
  })
}

export async function saveEvent(root: string, input: Partial<StoryEvent> & { id?: string }): Promise<StoryEvent> {
  const dir = join(root, 'events')
  await ensureDir(dir)
  const all = await loadEvents(root)
  const existing = input.id ? all.find((x) => x.doc.id === input.id) : undefined
  let doc: StoryEvent
  if (existing) {
    doc = { ...existing.doc, ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) } as StoryEvent
    doc.id = existing.doc.id
  } else {
    doc = {
      id: input.id ?? genId('evt'),
      title: input.title?.trim() || '未命名事件',
      storyTime: input.storyTime ?? '',
      order: input.order ?? (all.length ? Math.max(...all.map((x) => x.doc.order)) + 1 : 1),
      location: input.location ?? '',
      tags: input.tags ?? [],
      characterIds: input.characterIds ?? [],
      prevIds: input.prevIds ?? [],
      nextIds: input.nextIds ?? [],
      content: input.content ?? ''
    }
  }
  let fileName = `${sanitizeFileName(doc.title)}.md`
  if (all.some((x) => x.fileName === fileName && x.doc.id !== doc.id)) {
    fileName = `${sanitizeFileName(doc.title)}_${doc.id.split('_')[1]}.md`
  }
  const targetPath = join(dir, fileName)
  const tempPath = targetPath + '.tmp'
  await fs.writeFile(tempPath, serializeEvent(doc), 'utf-8')
  await fs.rename(tempPath, targetPath)
  if (existing && existing.fileName !== fileName) {
    await fs.rm(join(dir, existing.fileName), { force: true })
  }
  return doc
}

export async function deleteEvent(root: string, id: string): Promise<void> {
  const dir = join(root, 'events')
  const all = await loadEvents(root)
  const hit = all.find((x) => x.doc.id === id)
  if (hit) await fs.rm(join(dir, hit.fileName), { force: true })
}

/* ---------------- 章节 ---------------- */

async function loadChapters(root: string): Promise<{ doc: ChapterDoc; fileName: string }[]> {
  const dir = join(root, 'chapters')
  const out: { doc: ChapterDoc; fileName: string }[] = []
  for (const f of await listMdFiles(dir)) {
    const parsed = await readMd(join(dir, f))
    if (!parsed || typeof parsed.data.id !== 'string') continue
    const status = ['draft', 'revised', 'final'].includes(str(parsed.data.status)) ? (parsed.data.status as ChapterStatus) : 'draft'
    out.push({
      fileName: f,
      doc: {
        id: parsed.data.id,
        title: str(parsed.data.title, f.replace(/\.md$/i, '')),
        volume: str(parsed.data.volume, '第一卷'),
        order: num(parsed.data.order),
        status,
        wordCount: countWords(parsed.content),
        content: parsed.content.replace(/^\n+/, '')
      }
    })
  }
  return out.sort((a, b) => a.doc.order - b.doc.order)
}

export async function listChapters(root: string): Promise<ChapterMeta[]> {
  return (await loadChapters(root)).map(({ doc: { content: _content, ...meta } }) => meta)
}

export async function getChapterBody(root: string, id: string): Promise<string | null> {
  const all = await loadChapters(root)
  return all.find((x) => x.doc.id === id)?.doc.content ?? null
}

export function serializeChapter(c: ChapterDoc): string {
  return matter.stringify(c.content ?? '', {
    id: c.id,
    title: c.title,
    volume: c.volume,
    order: c.order,
    status: c.status
  })
}

export async function saveChapter(root: string, input: Partial<ChapterDoc> & { id?: string }): Promise<ChapterDoc> {
  const dir = join(root, 'chapters')
  await ensureDir(dir)
  const all = await loadChapters(root)
  const existing = input.id ? all.find((x) => x.doc.id === input.id) : undefined
  let doc: ChapterDoc
  if (existing) {
    doc = { ...existing.doc, ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) } as ChapterDoc
    doc.id = existing.doc.id
  } else {
    doc = {
      id: input.id ?? genId('cha'),
      title: input.title?.trim() || '未命名章节',
      volume: input.volume ?? '第一卷',
      order: input.order ?? (all.length ? Math.max(...all.map((x) => x.doc.order)) + 1 : 1),
      status: input.status ?? 'draft',
      wordCount: countWords(input.content ?? ''),
      content: input.content ?? ''
    }
  }
  doc.wordCount = countWords(doc.content)
  let fileName = `${padOrder(doc.order)}-${sanitizeFileName(doc.title)}.md`
  if (all.some((x) => x.fileName === fileName && x.doc.id !== doc.id)) {
    fileName = `${padOrder(doc.order)}-${sanitizeFileName(doc.title)}_${doc.id.split('_')[1]}.md`
  }
  const targetPath = join(dir, fileName)
  const tempPath = targetPath + '.tmp'
  await fs.writeFile(tempPath, serializeChapter(doc), 'utf-8')
  await fs.rename(tempPath, targetPath)
  if (existing && existing.fileName !== fileName) {
    await fs.rm(join(dir, existing.fileName), { force: true })
  }
  return doc
}

export async function deleteChapter(root: string, id: string): Promise<void> {
  const dir = join(root, 'chapters')
  const all = await loadChapters(root)
  const hit = all.find((x) => x.doc.id === id)
  if (hit) await fs.rm(join(dir, hit.fileName), { force: true })
}

/* ---------------- 全文检索 ---------------- */

export async function searchProject(root: string, query: string): Promise<SearchHit[]> {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const hits: SearchHit[] = []

  const pushHit = (kind: SearchHit['kind'], id: string, title: string, text: string) => {
    if (hits.length >= 40) return
    const idx = text.toLowerCase().indexOf(q)
    if (idx === -1) return
    const start = Math.max(0, idx - 30)
    const end = Math.min(text.length, idx + q.length + 50)
    hits.push({ kind, id, title, snippet: (start > 0 ? '…' : '') + text.slice(start, end).replace(/\s+/g, ' ') + (end < text.length ? '…' : '') })
  }

  for (const c of await listCharacters(root)) pushHit('character', c.id, c.name, [c.name, ...c.aliases, c.summary, c.content].join('\n'))
  const rels = await loadRelationships(root)
  if (rels.length) {
    const chars = await listCharacters(root)
    const nameOf = (id: string) => chars.find((c) => c.id === id)?.name ?? id
    pushHit('relationship', 'relationships', '人物关系', serializeRelationships(rels, nameOf))
  }
  for (const o of await listOutline(root)) pushHit('outline', o.id, o.title, `${o.title}\n${o.content}`)
  for (const e of await listEvents(root)) pushHit('event', e.id, e.title, `${e.title}\n${e.storyTime}\n${e.content}`)
  for (const ch of await loadChapters(root)) pushHit('chapter', ch.doc.id, ch.doc.title, `${ch.doc.title}\n${ch.doc.content}`)

  return hits.slice(0, 40)
}
