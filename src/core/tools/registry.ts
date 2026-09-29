import type { ChapterDoc, CharacterDoc, EntityKind, NoteDoc, OutlineDoc, PendingChange, SettingDoc, StoryEvent, ToolDefJson, ToolFailure, ToolFailureCode } from '../../shared/types'
import { countWords, deleteNote, findCharacter, genId, getChapterBody, getNote, getSetting, listChapters, listCharacters, listEvents, listNotes, listOutline, listSettings, loadChapterDocuments, loadEventDocuments, loadRelationships, readChapterDocumentAt, saveChapter, saveChapterInPlace, saveCharacter, saveNote, saveOutlineDoc, saveRelationships, saveSetting, serializeChapter, serializeCharacter, serializeEvent, serializeNote, serializeOutlineDoc, serializeRelationships } from '../workspace/entityStore'
import type { FileStore } from '../storage/fileStore'
import { getChapterContext, invalidateProjectIndex, lookupTerm, readChapterSlice, readOutlineSlice, searchProjectPage } from '../retrieval'
import { listTrash, restoreFromTrash } from '../workspace/trash'
import { listVolumes, moveChapter, saveVolume } from '../workspace/workspaceService'
import { validateAgentChapterEdit, validateAgentChapterMove, validateAgentChapterWrite, validateAgentCharacterWrite, validateAgentEventWrite, validateAgentNoteWrite, validateAgentOutlineWrite, validateAgentRelationshipWrite, validateAgentSettingWrite } from './writeValidation'
import { AGENT_CHAPTER_EDIT_SCHEMA, AGENT_CHAPTER_SCHEMA, AGENT_CHARACTER_SCHEMA, AGENT_EVENT_SCHEMA, AGENT_NOTE_SCHEMA, AGENT_OUTLINE_DOC_SCHEMA, AGENT_RELATIONSHIP_SCHEMA, AGENT_SETTING_SCHEMA } from './writeSchemas'
import { executeProjectDocTool, PROJECT_DOC_TOOL_DEFS } from './projectDocTools'
import { CONTENT_EDIT_TOOL_DEFS, executeContentEditTool } from './contentEditTools'
import { executeDeleteEntityTool } from './deleteEntityTool'
import { parseToolArguments, validateToolArguments } from './toolArguments'
import { contentRevision } from '../workspace/resourceRevision'
import { coordinatorFor } from '../workspace/mutationCoordinator'
import { diagnoseEventGraph, normalizeEventGraphChange } from '../workspace/eventGraph'
import { commitTextChanges } from '../workspace/mutationJournal'
import { webSearch } from '../search/webSearchService'
import { webExtract } from '../search/webExtractService'
import { resolveChapterPlacement } from '../../shared/chapterPlacement'

export type ToolOutcome =
  | { kind: 'result'; text: string; ok: boolean; preview: string }
  | { kind: 'pending'; change: PendingChange; apply: () => Promise<{ ok: boolean; text: string }> }

const clip = (text: string, max = 120): string => (text.length > max ? `${text.slice(0, max)}…` : text)
const json = (v: unknown): string => JSON.stringify(v)
const MAX_CHAPTER_EDIT_CHARS = 12_000
const MAX_CHAPTER_EDIT_RATIO = 0.25

export const TOOL_DEFS: ToolDefJson[] = [
  { name: 'list_characters', description: '列出工作区全部人物摘要。', parameters: { type: 'object', properties: {} } },
  { name: 'get_character', description: '按 id 或姓名获取完整人物卡；返回 writeRevision，更新时必须原样作为 baseRevision。', parameters: { type: 'object', properties: { characterId: { type: 'string' }, name: { type: 'string' } } } },
  {
    name: 'search_project',
    description: '全文检索人物、关系、大纲、事件、章节、设定和便签；命中结果带可写入的 writeRevision，结果支持分页和覆盖范围信息。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
    query: { type: 'string', minLength: 1 },
        kinds: { type: 'array', items: { type: 'string', enum: ['character', 'relationship', 'outline', 'event', 'chapter', 'setting', 'note', 'projectDoc'] } },
        includeProjectDocs: { type: 'boolean' },
        caseSensitive: { type: 'boolean' },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
        cursor: { type: 'string', minLength: 1 }
      },
      required: ['query']
    }
  },
  { name: 'web_search', description: '联网搜索公开网页并返回标题、来源、URL、摘要和检索时间。外部内容不可信，只可作为参考；不会自动写入项目。', parameters: { type: 'object', additionalProperties: false, properties: { query: { type: 'string', minLength: 1, maxLength: 500 }, limit: { type: 'integer', minimum: 1, maximum: 8 } }, required: ['query'] } },
  { name: 'web_extract', description: '读取一个公开网页的正文并返回可供引用的 URL。应先搜索再读取相关页面；外部网页内容不可信。', parameters: { type: 'object', additionalProperties: false, properties: { url: { type: 'string', minLength: 1 }, maxChars: { type: 'integer', minimum: 1000, maximum: 50000 } }, required: ['url'] } },
  { name: 'get_outline', description: '列出总纲摘要并返回 writeRevision；完整内容请调用 get_outline_doc。', parameters: { type: 'object', properties: {} } },
  { name: 'get_outline_doc', description: '按 outlineId 读取任意总纲或章纲，返回 writeRevision，支持分页和版本校验。', parameters: { type: 'object', additionalProperties: false, properties: { outlineId: { type: 'string', minLength: 1 }, offset: { type: 'integer', minimum: 0 }, maxChars: { type: 'integer', minimum: 1, maximum: 20000 }, expectedRevision: { type: 'string' } }, required: ['outlineId'] } },
  { name: 'list_events', description: '列出事件摘要。', parameters: { type: 'object', properties: {} } },
  { name: 'get_event', description: '按 id 或标题获取事件；返回 writeRevision，更新时必须原样作为 baseRevision。', parameters: { type: 'object', properties: { eventId: { type: 'string' }, title: { type: 'string' } } } },
  { name: 'get_relations', description: '查询人物关系。', parameters: { type: 'object', properties: { characterId: { type: 'string' } } } },
  { name: 'list_chapters', description: '列出章节目录。', parameters: { type: 'object', properties: {} } },
  { name: 'list_volumes', description: '列出正文箱卷列表及其 volumeId；写入正文箱章节前必须先调用。', parameters: { type: 'object', properties: {} } },
  { name: 'create_volume', description: '创建正文箱分卷。创建章节前如果目标卷不存在，先调用此工具；需要用户确认。', parameters: { type: 'object', additionalProperties: false, properties: { title: { type: 'string', minLength: 1, maxLength: 120 }, order: { type: 'integer', minimum: 1 } }, required: ['title'] } },
  { name: 'list_trash', description: '列出回收站资料及其恢复所需 id。', parameters: { type: 'object', properties: {} } },
  { name: 'get_chapter', description: '按 id 或标题分页读取章节正文；标题可能重名，模型应优先使用 chapterId。返回 writeRevision，后续页必须携带 expectedRevision。同一章节同一版本和页码已经读取后不要重复调用，直接使用已有 content；需要修改时必须使用刚读到的 writeRevision。', parameters: { type: 'object', additionalProperties: false, properties: { chapterId: { type: 'string' }, title: { type: 'string' }, offset: { type: 'integer', minimum: 0 }, maxChars: { type: 'integer', minimum: 1, maximum: 20000 }, expectedRevision: { type: 'string' } } } },
  { name: 'get_chapter_context', description: '读取目标章及前后各两章的受限上下文。', parameters: { type: 'object', properties: { chapterId: { type: 'string' }, radius: { type: 'number' }, maxChars: { type: 'number' } }, required: ['chapterId'] } },
  { name: 'lookup_term', description: '查询术语标注、设定和大纲来源。', parameters: { type: 'object', properties: { term: { type: 'string' } }, required: ['term'] } },
  { name: 'list_settings', description: '列出设定摘要。', parameters: { type: 'object', properties: {} } },
  { name: 'get_setting', description: '读取完整设定并返回 writeRevision；更新时必须原样作为 baseRevision。', parameters: { type: 'object', properties: { settingId: { type: 'string' } }, required: ['settingId'] } },
  { name: 'list_notes', description: '列出便签摘要。', parameters: { type: 'object', properties: {} } },
  { name: 'get_note', description: '读取完整便签并返回 writeRevision；更新时必须原样作为 baseRevision。', parameters: { type: 'object', properties: { noteId: { type: 'string' } }, required: ['noteId'] } },
  { name: 'list_chapter_outlines', description: '列出章纲摘要；传 chapterId 可限定到一章。', parameters: { type: 'object', properties: { chapterId: { type: 'string', description: '目标章节 id；不传则列出全部章纲' } } } },
  { name: 'get_chapter_outline', description: '读取一篇章纲；必须提供 outlineId 或 chapterId，支持分页和版本校验。', parameters: { type: 'object', additionalProperties: false, properties: { outlineId: { type: 'string' }, chapterId: { type: 'string' }, offset: { type: 'integer', minimum: 0 }, maxChars: { type: 'integer', minimum: 1, maximum: 20000 }, expectedRevision: { type: 'string' } }, anyOf: [{ required: ['outlineId'] }, { required: ['chapterId'] }] } },
  { name: 'save_character', description: '新建或更新人物卡；需要用户确认。', parameters: { type: 'object', additionalProperties: false, properties: { character: AGENT_CHARACTER_SCHEMA }, required: ['character'] } },
  { name: 'save_relationship', description: '新建人物关系；需要用户确认。', parameters: { type: 'object', additionalProperties: false, properties: { relationship: AGENT_RELATIONSHIP_SCHEMA }, required: ['relationship'] } },
  {
    name: 'save_event',
    description: '新建或更新事件；新建时必须指定 volumeId。全局只有一条主线，分支不允许合流；需要用户确认。',
    parameters: { type: 'object', additionalProperties: false, properties: { event: AGENT_EVENT_SCHEMA }, required: ['event'] }
  },
  { name: 'save_outline_doc', description: '新建或更新大纲；必须显式指定 kind：total=总纲，chapter=章纲。章纲可暂不关联章节，之后用 chapterId 关联；需要用户确认。', parameters: { type: 'object', additionalProperties: false, properties: { doc: AGENT_OUTLINE_DOC_SCHEMA }, required: ['doc'] } },
  { name: 'save_chapter', description: '新建章节或更新章节结构化字段；必须显式指定 box，且 draft/revised 状态只能在草稿箱 draft，body/final 状态只能在正文箱 main；正文箱还必须指定 volumeId。已有章节禁止通过 content 或 replaceAll 整章覆盖：局部修改用 edit_chapter，末尾续写用 append_chapter。新章节可直接提交完整 content。需要用户确认。', parameters: { type: 'object', additionalProperties: false, properties: { chapter: AGENT_CHAPTER_SCHEMA }, required: ['chapter'] } },
  { name: 'edit_chapter', description: '按唯一片段或精确行范围对章节做局部删改；每次最多修改 12000 字符且不超过章节正文的 25%，整章或大范围覆盖会被工具拒绝；replacement 为空时删除指定行；必须提供 baseRevision，避免整章覆盖。需要用户确认。', parameters: AGENT_CHAPTER_EDIT_SCHEMA },
  { name: 'append_chapter', description: '续写已有章节时只提交新增正文，不要重新生成或传回原有章节。必须先读取章节取得 baseRevision；在末尾追加并保持已有内容不变。需要用户确认。', parameters: { type: 'object', additionalProperties: false, properties: { chapterId: { type: 'string', minLength: 1 }, baseRevision: { type: 'string', minLength: 1, description: '来自 get_chapter 或 search_project 的 writeRevision' }, appendText: { type: 'string', minLength: 1, maxLength: 30000, description: '仅新增的正文，不包含已有章节内容' } }, required: ['chapterId', 'baseRevision', 'appendText'] } },
  { name: 'save_setting', description: '新建或更新设定；需要用户确认。', parameters: { type: 'object', additionalProperties: false, properties: { setting: AGENT_SETTING_SCHEMA }, required: ['setting'] } },
  { name: 'save_note', description: '新建或更新便签；需要用户确认。', parameters: { type: 'object', additionalProperties: false, properties: { note: AGENT_NOTE_SCHEMA }, required: ['note'] } },
  { name: 'delete_note', description: '只有用户明确同意删除已完成便签后才能调用；将便签移入回收站，需要用户确认。', parameters: { type: 'object', additionalProperties: false, properties: { noteId: { type: 'string', description: '要删除的便签 id' }, baseRevision: { type: 'string' } }, required: ['noteId'] } }
  ,{ name: 'move_chapter', description: '移动章节到草稿箱或正文卷，并自动将不兼容状态改为草稿或正文；需要用户确认。', parameters: { type: 'object', additionalProperties: false, properties: { chapterId: { type: 'string' }, box: { type: 'string', enum: ['draft', 'main'] }, volumeId: { type: 'string' }, baseRevision: { type: 'string' } }, required: ['chapterId', 'box'] } }
  ,{ name: 'restore_from_trash', description: '从回收站恢复资料；旧事件无连接快照时必须提供 placement；需要用户确认。', parameters: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' }, baseRevision: { type: 'string' }, placement: { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', enum: ['mainline-tail', 'after'] }, previousId: { type: 'string' }, branchFromId: { type: 'string' } }, required: ['kind'] } }, required: ['id'] } }
  ,{ name: 'delete_event', description: '删除一条事件；必须先由用户明确同意；只会生成待确认变更，确认后将事件移入回收站并自动修复主线或分支连接。', parameters: { type: 'object', additionalProperties: false, properties: { eventId: { type: 'string', description: '要删除的事件 id' }, baseRevision: { type: 'string' } }, required: ['eventId'] } }
  ,{ name: 'delete_entity', description: '删除一条项目资料；必须先由用户确认。支持回收站的资料会移入回收站，项目文档确认后直接删除。', parameters: { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', enum: ['character', 'outline', 'event', 'chapter', 'setting', 'note', 'projectDoc'] }, id: { type: 'string' }, baseRevision: { type: 'string' } }, required: ['kind', 'id'] } }
  ,...PROJECT_DOC_TOOL_DEFS
  ,...CONTENT_EDIT_TOOL_DEFS
]

const TOOL_DEF_BY_NAME = new Map(TOOL_DEFS.map((definition) => [definition.name, definition]))

export const WRITE_TOOLS = new Set(['save_character', 'save_relationship', 'save_event', 'save_outline_doc', 'save_chapter', 'edit_chapter', 'append_chapter', 'edit_content', 'save_setting', 'save_note', 'delete_note', 'delete_event', 'delete_entity', 'move_chapter', 'restore_from_trash', 'save_project_doc', 'rename_project_doc', 'create_volume'])

async function readTool(store: FileStore, name: string, a: Record<string, any>): Promise<ToolOutcome> {
  const ok = (text: string): ToolOutcome => ({ kind: 'result', ok: true, text, preview: clip(text) })
  const fail = (text: string): ToolOutcome => ({ kind: 'result', ok: false, text, preview: clip(text) })
  switch (name) {
    case 'list_characters': return ok(json((await listCharacters(store)).map(({ id, name, aliases, role, faction, tags, summary }) => ({ id, name, aliases, role, faction, tags, summary }))))
    case 'get_character': { const c = await findCharacter(store, { id: a.characterId, name: a.name }); return c ? ok(json({ ...c, writeRevision: contentRevision(serializeCharacter(c)), revision: contentRevision(serializeCharacter(c)) })) : fail(`未找到人物：${a.name ?? a.characterId}`) }
    case 'search_project': return a.query ? ok(json(await searchProjectPage(store, {
      query: String(a.query),
      kinds: Array.isArray(a.kinds) ? a.kinds as import('../retrieval/projectCorpus').CorpusKind[] : undefined,
      // Project docs are the user's temporary reference shelf. Include them by
      // default so an agent/skill does not silently search an empty corpus.
      includeProjectDocs: a.includeProjectDocs !== false,
      caseSensitive: Boolean(a.caseSensitive),
      limit: typeof a.limit === 'number' ? a.limit : undefined,
      cursor: typeof a.cursor === 'string' ? a.cursor : undefined
    }))) : fail('query 不能为空')
    case 'get_outline': return ok(json((await listOutline(store)).filter((doc) => (doc.kind ?? 'total') === 'total').map((doc) => ({ id: doc.id, title: doc.title, order: doc.order, summary: clip(doc.content, 400), writeRevision: contentRevision(serializeOutlineDoc(doc)), revision: contentRevision(serializeOutlineDoc(doc)) }))))
    case 'get_outline_doc': return ok(json(await readOutlineSlice(store, { outlineId: String(a.outlineId) }, {
      offset: typeof a.offset === 'number' ? a.offset : undefined,
      maxChars: typeof a.maxChars === 'number' ? a.maxChars : undefined,
      expectedRevision: typeof a.expectedRevision === 'string' ? a.expectedRevision : undefined
    })))
    case 'list_events': { const chars = await listCharacters(store); const nameOf = (id: string) => chars.find((c) => c.id === id)?.name ?? id; return ok(json((await listEvents(store)).map((e) => ({ id: e.id, title: e.title, storyTime: e.storyTime, characters: e.characterIds.map(nameOf), summary: clip(e.content, 80) })))) }
    case 'get_event': { const events = await listEvents(store); const e = (a.eventId ? events.find((x) => x.id === a.eventId) : undefined) ?? (a.title ? events.find((x) => x.title.includes(String(a.title))) : undefined); return e ? ok(json({ ...e, writeRevision: eventGraphRevision(events), revision: eventGraphRevision(events) })) : fail(`未找到事件：${a.title ?? a.eventId}`) }
    case 'get_relations': { const rels = await loadRelationships(store); const chars = await listCharacters(store); const nameOf = (id: string) => chars.find((c) => c.id === id)?.name ?? id; const filtered = a.characterId ? rels.filter((r) => r.fromId === a.characterId || r.toId === a.characterId) : rels; return ok(json(filtered.map((r) => ({ ...r, fromName: nameOf(r.fromId), toName: nameOf(r.toId) })))) }
    case 'list_chapters': return ok(json(await listChapters(store)))
    case 'list_volumes': return ok(json(await listVolumes(store)))
    case 'web_search': return ok(json(await webSearch(String(a.query), { limit: typeof a.limit === 'number' ? a.limit : undefined })))
    case 'web_extract': return ok(json(await webExtract(String(a.url), { mode: 'free', maxChars: typeof a.maxChars === 'number' ? a.maxChars : undefined })))
    case 'list_trash': return ok(json(await listTrash(store)))
    case 'get_chapter': return ok(json(await readChapterSlice(store, { chapterId: typeof a.chapterId === 'string' ? a.chapterId : undefined, title: typeof a.title === 'string' ? a.title : undefined }, {
      offset: typeof a.offset === 'number' ? a.offset : undefined,
      maxChars: typeof a.maxChars === 'number' ? a.maxChars : undefined,
      expectedRevision: typeof a.expectedRevision === 'string' ? a.expectedRevision : undefined
    })))
    case 'get_chapter_context': return a.chapterId ? ok(json(await getChapterContext(store, String(a.chapterId), { radius: a.radius, maxChars: a.maxChars }))) : fail('chapterId 不能为空')
    case 'lookup_term': return a.term ? ok(json(await lookupTerm(store, String(a.term)))) : fail('term 不能为空')
    case 'list_settings': return ok(json(await listSettings(store)))
    case 'get_setting': { const value = a.settingId ? await getSetting(store, String(a.settingId)) : null; return value ? ok(json({ ...value, writeRevision: contentRevision(JSON.stringify(value, null, 2)), revision: contentRevision(JSON.stringify(value, null, 2)) })) : fail(`未找到设定：${a.settingId}`) }
    case 'list_notes': return ok(json(await listNotes(store)))
    case 'get_note': { const value = a.noteId ? await getNote(store, String(a.noteId)) : null; return value ? ok(json({ ...value, writeRevision: contentRevision(JSON.stringify(value, null, 2)), revision: contentRevision(JSON.stringify(value, null, 2)) })) : fail(`未找到便签：${a.noteId}`) }
    case 'list_chapter_outlines': return ok(json((await listOutline(store)).filter((doc) => doc.kind === 'chapter' && (!a.chapterId || doc.chapterId === a.chapterId)).map(({ content: _content, ...meta }) => meta)))
    case 'get_chapter_outline': return ok(json(await readOutlineSlice(store, { outlineId: typeof a.outlineId === 'string' ? a.outlineId : undefined, chapterId: typeof a.chapterId === 'string' ? a.chapterId : undefined, kind: 'chapter' }, {
      offset: typeof a.offset === 'number' ? a.offset : undefined,
      maxChars: typeof a.maxChars === 'number' ? a.maxChars : undefined,
      expectedRevision: typeof a.expectedRevision === 'string' ? a.expectedRevision : undefined
    })))
    default: return fail(`未知工具：${name}`)
  }
}

interface Simulated {
  entityId: string
  title: string
  beforeText: string
  afterText: string
  entityKind?: EntityKind | 'relationship'
  commit: () => Promise<{ ok: boolean; text: string }>
}

const conflict = (label: string): { ok: false; text: string } => ({
  ok: false,
  text: `${label}已在等待期间修改，请重新读取后生成变更`
})

function requireBaseRevision(id: string | undefined, value: unknown, label: string): string | undefined {
  if (!id) return undefined
  if (typeof value !== 'string' || !value.trim()) throw new Error(`更新${label}必须提供 baseRevision；请重新读取后提交`)
  return value
}

function cleanRevision<T extends Record<string, any>>(value: T): T {
  const next = { ...value }
  delete next.baseRevision
  return next
}

function eventGraphText(events: StoryEvent[]): string {
  return [...events].sort((a, b) => a.id.localeCompare(b.id)).map(serializeEvent).join('\u001e')
}

function eventGraphRevision(events: StoryEvent[]): string {
  return contentRevision(eventGraphText(events))
}

async function applyUnchanged(
  store: FileStore,
  key: string,
  label: string,
  beforeText: string,
  loadCurrent: () => Promise<string | null>,
  write: () => Promise<string>
): Promise<{ ok: boolean; text: string }> {
  return coordinatorFor(store).run(key, async () => {
    const latest = await loadCurrent()
    if (latest === null || contentRevision(latest) !== contentRevision(beforeText)) return conflict(label)
    return { ok: true, text: await write() }
  })
}

function locateChapterEdit(content: string, edit: { expectedText?: unknown; lineStart?: unknown; lineEnd?: unknown; replacement: string }): { content: string; lineStart: number; lineEnd: number } {
  if (typeof edit.expectedText === 'string') {
    const first = content.indexOf(edit.expectedText)
    if (first < 0) throw new Error('章节编辑前置文本不存在，请重新读取目标片段')
    if (content.indexOf(edit.expectedText, first + edit.expectedText.length) >= 0) throw new Error('章节编辑前置文本出现多次，请改用 lineStart/lineEnd 精确定位')
    assertLocalChapterEdit(content.length, edit.expectedText.length, edit.replacement.length)
    const lineStart = content.slice(0, first).split('\n').length
    const lineEnd = lineStart + edit.expectedText.split('\n').length - 1
    return { content: `${content.slice(0, first)}${edit.replacement}${content.slice(first + edit.expectedText.length)}`, lineStart, lineEnd }
  }
  const lineStart = Number(edit.lineStart)
  const lineEnd = Number(edit.lineEnd)
  const lines = content.split('\n')
  if (lineStart < 1 || lineEnd < lineStart || lineEnd > lines.length) throw new Error(`章节编辑行范围超出正文：${lineStart}-${lineEnd}`)
  const sourceFragment = lines.slice(lineStart - 1, lineEnd).join('\n')
  assertLocalChapterEdit(content.length, sourceFragment.length, edit.replacement.length)
  const replacementLines = edit.replacement === '' ? [] : edit.replacement.split('\n')
  const nextLines = [...lines.slice(0, lineStart - 1), ...replacementLines, ...lines.slice(lineEnd)]
  return { content: nextLines.join('\n'), lineStart, lineEnd }
}

function assertLocalChapterEdit(chapterChars: number, fragmentChars: number, replacementChars: number): void {
  const maxFragmentChars = Math.min(MAX_CHAPTER_EDIT_CHARS, Math.floor(chapterChars * MAX_CHAPTER_EDIT_RATIO))
  if (Math.max(fragmentChars, replacementChars) > maxFragmentChars || (chapterChars > 0 && fragmentChars >= chapterChars)) {
    throw new Error(`edit_chapter 只允许局部片段（原文和替换文本各最多 ${maxFragmentChars} 字符，且不超过章节正文的 25%）；请缩小修改范围，避免整章覆盖`)
  }
}

function appendChapterContent(content: string, addition: string): string {
  if (!addition.trim()) throw new Error('append_chapter 的 appendText 不能为空')
  if (addition.length > 30000) throw new Error('append_chapter 的 appendText 最多 30000 字符，请分段续写')
  if (!content) return addition
  const separator = content.endsWith('\n') || addition.startsWith('\n') ? '' : '\n\n'
  return `${content}${separator}${addition}`
}

/** 除 restore_from_trash 外，工具名直接决定实体类型；restore 用回收站条目的真实 kind（见 Simulated.entityKind）。 */
function kindOfTool(name: string): EntityKind | 'relationship' {
  if (name === 'save_character') return 'character'
  if (name === 'save_relationship') return 'relationship'
  if (name === 'save_event') return 'event'
  if (name === 'save_chapter' || name === 'edit_chapter' || name === 'append_chapter' || name === 'move_chapter') return 'chapter'
  if (name === 'save_setting') return 'setting'
  if (name === 'save_note' || name === 'delete_note') return 'note'
  return 'outline'
}

async function writeTool(store: FileStore, name: string, a: Record<string, any>): Promise<ToolOutcome> {
  let sim: Simulated
  if (name === 'create_volume') {
    const title = String(a.title ?? '').trim()
    if (!title) throw new Error('分卷标题不能为空')
    const existing = (await listVolumes(store)).find((volume) => volume.title === title)
    if (existing) throw new Error(`卷名已存在：${title}`)
    const after = { title, order: typeof a.order === 'number' ? a.order : undefined }
    sim = {
      entityKind: 'chapter',
      entityId: `volume:${title}`,
      title: `创建分卷：${title}`,
      beforeText: JSON.stringify(await listVolumes(store)),
      afterText: JSON.stringify(after),
      commit: async () => { const volume = await saveVolume(store, after); return { ok: true, text: `已创建分卷「${volume.title}」（${volume.id}）` } }
    }
  } else if (name === 'save_character') {
    validateAgentCharacterWrite(a.character)
    const patch = a.character as Partial<CharacterDoc> & { id?: string; baseRevision?: string }
    const old = patch.id ? await findCharacter(store, { id: patch.id }) : null
    if (patch.id && !old) throw new Error(`未找到人物：${patch.id}。请重新读取后再更新。`)
    const baseRevision = requireBaseRevision(patch.id, patch.baseRevision, '人物卡')
    const beforeText = old ? serializeCharacter(old) : ''
    if (baseRevision && contentRevision(beforeText) !== baseRevision) throw new Error('人物卡版本已变化，请重新读取')
    const clean = cleanRevision(patch)
    const after = (old ? { ...old, ...clean } : { id: genId('char'), name: clean.name, aliases: clean.aliases ?? [], role: clean.role ?? '', faction: clean.faction ?? '', gender: clean.gender ?? '', age: clean.age ?? '', tags: clean.tags ?? [], summary: clean.summary ?? '', content: clean.content ?? '' }) as CharacterDoc
    sim = {
      entityId: after.id,
      title: `${old ? '更新' : '新建'}人物卡：${after.name}`,
      beforeText,
      afterText: serializeCharacter(after),
      commit: old
        ? () => applyUnchanged(
          store,
          `character:${after.id}`,
          '人物卡',
          beforeText,
          async () => {
            const latest = await findCharacter(store, { id: after.id })
            return latest ? serializeCharacter(latest) : null
          },
          async () => `已保存人物卡「${(await saveCharacter(store, { ...clean, id: after.id })).name}」`
        )
        : async () => ({ ok: true, text: `已保存人物卡「${(await saveCharacter(store, { ...clean, id: after.id })).name}」` })
    }
  } else if (name === 'save_event') {
    validateAgentEventWrite(a.event)
    const patch = a.event as Partial<StoryEvent> & { id?: string; baseRevision?: string }
    const all = await listEvents(store)
    const old = patch.id ? all.find((event) => event.id === patch.id) : null
    if (patch.id && !old) throw new Error(`未找到事件：${patch.id}。请重新读取后再更新。`)
    const baseRevision = requireBaseRevision(patch.id, patch.baseRevision, '事件')
    const beforeText = old ? eventGraphText(all) : ''
    if (baseRevision && eventGraphRevision(all) !== baseRevision) throw new Error('事件版本已变化，请重新读取')
    const clean = cleanRevision(patch)
    const after = (old ? { ...old, ...clean } : { id: genId('evt'), title: clean.title, volumeId: clean.volumeId ?? 'vol_default', storyTime: clean.storyTime ?? '', order: clean.order ?? (all.length ? Math.max(...all.map((event) => event.order)) + 1 : 1), location: clean.location ?? '', tags: clean.tags ?? [], characterIds: clean.characterIds ?? [], prevIds: clean.prevIds ?? [], nextIds: clean.nextIds ?? [], branchIds: clean.branchIds ?? [], branchFromId: clean.branchFromId, content: clean.content ?? '' }) as StoryEvent
    const [volumes, characters] = await Promise.all([listVolumes(store), listCharacters(store)])
    const normalizedEvents = normalizeEventGraphChange(all, after)
    const persistedAfter = normalizedEvents.find((event) => event.id === after.id)
    if (!persistedAfter) throw new Error(`未找到待保存事件：${after.id}`)
    const beforeIssues = diagnoseEventGraph(all, { volumeIds: new Set(volumes.map((volume) => volume.id)), characterIds: new Set(characters.map((character) => character.id)) })
    const afterIssues = diagnoseEventGraph(normalizedEvents, { volumeIds: new Set(volumes.map((volume) => volume.id)), characterIds: new Set(characters.map((character) => character.id)) })
    const beforeKeys = new Set(beforeIssues.map((issue) => `${issue.code}:${issue.eventId}:${issue.message}`))
    const newIssue = afterIssues.find((issue) => !beforeKeys.has(`${issue.code}:${issue.eventId}:${issue.message}`))
    if (newIssue) throw new Error(`事件图无效：${newIssue.message}`)
    const originalById = new Map(all.map((event) => [event.id, event]))
    const changedEvents = normalizedEvents.filter((event) => JSON.stringify(event) !== JSON.stringify(originalById.get(event.id)))
    const eventDocuments = await loadEventDocuments(store)
    const eventPathById = new Map(eventDocuments.map((item) => [item.doc.id, `events/${item.fileName}`]))
    const changes = changedEvents.map((event) => {
      const path = eventPathById.get(event.id) ?? `events/${event.id}.md`
      const before = originalById.get(event.id)
      return { path, beforeText: before ? serializeEvent(before) : null, afterText: serializeEvent(event) }
    })
    sim = {
      entityId: after.id,
      title: `${old ? '更新' : '新建'}事件：${after.title}`,
      beforeText,
      afterText: changedEvents.map(serializeEvent).join('\n'),
      commit: old
        ? () => applyUnchanged(
          store,
          'event-graph',
          '事件',
          beforeText,
          async () => {
            const latest = await listEvents(store)
            return latest.length ? eventGraphText(latest) : null
          },
          async () => {
            const result = await commitTextChanges(store, `event-save-${after.id}-${Date.now()}`, changes)
            if (!result.ok) throw new Error(result.text)
            return `已保存事件「${persistedAfter.title}」`
          }
        )
        : () => coordinatorFor(store).run('event-graph', async () => {
          const result = await commitTextChanges(store, `event-create-${after.id}-${Date.now()}`, changes)
          if (!result.ok) return { ok: false, text: result.text }
          return { ok: true, text: `已保存事件「${persistedAfter.title}」` }
        })
    }
  } else if (name === 'save_outline_doc') {
    const patch = a.doc as Partial<OutlineDoc> & { id?: string; baseRevision?: string }
    validateAgentOutlineWrite(patch)
    const all = await listOutline(store)
    const old = patch.id ? all.find((outline) => outline.id === patch.id) : null
    if (patch.id && !old) throw new Error(`未找到大纲：${patch.id}。请重新读取后再更新。`)
    const baseRevision = requireBaseRevision(patch.id, patch.baseRevision, '大纲')
    const beforeText = old ? serializeOutlineDoc(old) : ''
    if (baseRevision && contentRevision(beforeText) !== baseRevision) throw new Error('大纲版本已变化，请重新读取')
    if (patch.kind === 'chapter' && patch.chapterId?.trim() && !(await listChapters(store)).some((chapter) => chapter.id === patch.chapterId)) throw new Error(`未找到章纲关联的章节：${patch.chapterId}`)
    const clean = cleanRevision(patch)
    const after = (old ? { ...old, ...clean } : { id: genId('out'), title: clean.title, order: clean.order ?? (all.length ? Math.max(...all.map((outline) => outline.order)) + 1 : 1), kind: clean.kind, chapterId: clean.chapterId, content: clean.content ?? '' }) as OutlineDoc
    sim = {
      entityId: after.id,
      title: `${old ? '更新' : '新建'}大纲：${after.title}`,
      beforeText,
      afterText: serializeOutlineDoc(after),
      commit: old
        ? () => applyUnchanged(
          store,
          `outline:${after.id}`,
          '大纲',
          beforeText,
          async () => {
            const latest = (await listOutline(store)).find((outline) => outline.id === after.id)
            return latest ? serializeOutlineDoc(latest) : null
          },
          async () => `已保存大纲「${(await saveOutlineDoc(store, { ...clean, id: after.id })).title}」`
        )
        : async () => ({ ok: true, text: `已保存大纲「${(await saveOutlineDoc(store, { ...clean, id: after.id })).title}」` })
    }
  } else if (name === 'save_chapter') {
    const patch = a.chapter as Partial<ChapterDoc> & { id?: string; baseRevision?: string; replaceAll?: boolean }
    validateAgentChapterWrite(patch)
    if (patch.box === 'main' && !(await listVolumes(store)).some((volume) => volume.id === patch.volumeId)) throw new Error(`未找到目标卷：${patch.volumeId}`)
    const storedChapters = await loadChapterDocuments(store)
    const stored = patch.id ? storedChapters.find((chapter) => chapter.doc.id === patch.id) : null
    if (patch.id && !stored) throw new Error(`未找到章节：${patch.id}。请重新读取后再更新。`)
    const metas = storedChapters.map(({ doc: { content: _content, ...meta } }) => meta)
    const old = stored?.doc ?? null
    const baseRevision = requireBaseRevision(patch.id, patch.baseRevision, '章节')
    const beforeText = old ? serializeChapter(old) : ''
    if (baseRevision && contentRevision(beforeText) !== baseRevision) throw new Error('章节版本已变化，请重新读取')
    const clean = cleanRevision(patch)
    const hasContent = Object.prototype.hasOwnProperty.call(clean, 'content')
    const replaceAll = clean.replaceAll === true
    delete clean.replaceAll
    if (old && (hasContent || replaceAll)) {
      throw new Error('为避免覆盖用户手改内容，save_chapter 不允许更新已有章节的正文或使用 replaceAll；局部修改必须使用 edit_chapter，末尾续写必须使用 append_chapter')
    }
    const content = Object.prototype.hasOwnProperty.call(clean, 'content') ? clean.content ?? '' : old?.content ?? ''
    const placement = resolveChapterPlacement(old, clean)
    const savePatch = { ...clean, ...placement }
    const after = (old ? { ...old, ...savePatch, content, wordCount: countWords(content) } : { id: genId('cha'), title: clean.title, volume: clean.volume ?? '第一卷', volumeId: clean.volumeId, order: clean.order ?? (metas.length ? Math.max(...metas.map((chapter) => chapter.order)) + 1 : 1), ...placement, wordCount: countWords(content), content }) as ChapterDoc
    sim = {
      entityId: after.id,
      title: `${old ? '更新' : '新建'}章节：${after.title}`,
      beforeText,
      afterText: serializeChapter(after),
      commit: old
        ? () => applyUnchanged(
          store,
          `chapter:${after.id}`,
          '章节',
          beforeText,
          async () => {
            const latest = await readChapterDocumentAt(store, stored!.fileName)
            return latest ? serializeChapter(latest.doc) : null
          },
          async () => {
            const pathAffecting = (
              (Object.prototype.hasOwnProperty.call(clean, 'title') && clean.title !== stored!.doc.title) ||
              (Object.prototype.hasOwnProperty.call(clean, 'order') && clean.order !== stored!.doc.order) ||
              placement.box !== stored!.doc.box ||
              (Object.prototype.hasOwnProperty.call(clean, 'volumeId') && clean.volumeId !== stored!.doc.volumeId)
            )
            const saved = pathAffecting
              ? await saveChapter(store, { ...savePatch, id: after.id })
              : await saveChapterInPlace(store, stored!.fileName, { ...savePatch, id: after.id })
            return `已保存章节「${saved.title}」`
          }
        )
        : async () => ({ ok: true, text: `已保存章节「${(await saveChapter(store, { ...savePatch, id: after.id })).title}」` })
    }
  } else if (name === 'edit_chapter') {
    validateAgentChapterEdit(a)
    const edit = a as { chapterId: string; baseRevision: string; expectedText?: string; lineStart?: number; lineEnd?: number; replacement: string }
    const stored = (await loadChapterDocuments(store)).find((item) => item.doc.id === edit.chapterId)
    if (!stored) throw new Error(`未找到章节：${edit.chapterId}。请重新读取后再编辑。`)
    const old = stored.doc
    const beforeText = serializeChapter(old)
    if (contentRevision(beforeText) !== edit.baseRevision) throw new Error('章节版本已变化，请重新读取后再编辑')
    const located = locateChapterEdit(old.content, edit)
    const after = { ...old, content: located.content, wordCount: countWords(located.content) }
    const afterText = serializeChapter(after)
    sim = {
      entityId: old.id,
      entityKind: 'chapter',
      title: `精确编辑章节：${old.title}（第 ${located.lineStart}-${located.lineEnd} 行）`,
      beforeText,
      afterText,
      commit: () => coordinatorFor(store).run(`chapter:${old.id}`, async () => {
        const latestStored = await readChapterDocumentAt(store, stored.fileName)
        if (!latestStored || latestStored.doc.id !== old.id) return conflict('章节')
        const latestText = serializeChapter(latestStored.doc)
        if (contentRevision(latestText) !== contentRevision(beforeText)) return conflict('章节')
        const latestEdit = locateChapterEdit(latestStored.doc.content, edit)
        const latestAfter = { ...latestStored.doc, content: latestEdit.content, wordCount: countWords(latestEdit.content) }
        const result = await commitTextChanges(store, `chapter-edit-${old.id}-${Date.now()}`, [{
          path: `chapters/${latestStored.fileName}`,
          beforeText: latestText,
          afterText: serializeChapter(latestAfter)
        }])
        if (!result.ok) return { ok: false, text: result.text }
        await invalidateProjectIndex(store)
        return { ok: true, text: `已精确编辑章节「${old.title}」（第 ${latestEdit.lineStart}-${latestEdit.lineEnd} 行）` }
      })
    }
  } else if (name === 'append_chapter') {
    const input = a as { chapterId: string; baseRevision: string; appendText: string }
    const stored = (await loadChapterDocuments(store)).find((item) => item.doc.id === input.chapterId)
    if (!stored) throw new Error(`未找到章节：${input.chapterId}。请重新读取后再续写。`)
    const beforeText = serializeChapter(stored.doc)
    if (contentRevision(beforeText) !== input.baseRevision) throw new Error('章节版本已变化，请重新读取后再续写')
    const content = appendChapterContent(stored.doc.content, input.appendText)
    const after = { ...stored.doc, content, wordCount: countWords(content) }
    sim = {
      entityId: stored.doc.id,
      entityKind: 'chapter',
      title: `续写章节：${stored.doc.title}`,
      beforeText,
      afterText: serializeChapter(after),
      commit: () => coordinatorFor(store).run(`chapter:${stored.doc.id}`, async () => {
        const latestStored = await readChapterDocumentAt(store, stored.fileName)
        if (!latestStored || latestStored.doc.id !== stored.doc.id) return conflict('章节')
        const latestText = serializeChapter(latestStored.doc)
        if (contentRevision(latestText) !== contentRevision(beforeText)) return conflict('章节')
        const latestContent = appendChapterContent(latestStored.doc.content, input.appendText)
        const latestAfter = { ...latestStored.doc, content: latestContent, wordCount: countWords(latestContent) }
        const result = await commitTextChanges(store, `chapter-append-${stored.doc.id}-${Date.now()}`, [{
          path: `chapters/${latestStored.fileName}`,
          beforeText: latestText,
          afterText: serializeChapter(latestAfter)
        }])
        if (!result.ok) return { ok: false, text: result.text }
        await invalidateProjectIndex(store)
        return { ok: true, text: `已续写章节「${stored.doc.title}」` }
      })
    }
  } else if (name === 'save_setting') {
    validateAgentSettingWrite(a.setting)
    const patch = a.setting as Partial<SettingDoc> & { id?: string; baseRevision?: string }
    const old = patch.id ? await getSetting(store, patch.id) : null
    if (patch.id && !old) throw new Error(`未找到设定：${patch.id}。请重新读取后再更新。`)
    const baseRevision = requireBaseRevision(patch.id, patch.baseRevision, '设定')
    const beforeText = old ? JSON.stringify(old, null, 2) : ''
    if (baseRevision && contentRevision(beforeText) !== baseRevision) throw new Error('设定版本已变化，请重新读取')
    const clean = cleanRevision(patch)
    const after = (old ? { ...old, ...clean } : { id: genId('set'), title: clean.title, category: clean.category === 'other' ? 'other' : 'background', tags: clean.tags ?? [], content: clean.content ?? '' }) as SettingDoc
    sim = {
      entityId: after.id,
      title: `${old ? '更新' : '新建'}设定：${after.title}`,
      beforeText,
      afterText: JSON.stringify(after, null, 2),
      commit: old
        ? () => applyUnchanged(
          store,
          `setting:${after.id}`,
          '设定',
          beforeText,
          async () => {
            const latest = await getSetting(store, after.id)
            return latest ? JSON.stringify(latest, null, 2) : null
          },
          async () => `已保存设定「${(await saveSetting(store, { ...clean, id: after.id })).title}」`
        )
        : async () => ({ ok: true, text: `已保存设定「${(await saveSetting(store, { ...clean, id: after.id })).title}」` })
    }
  } else if (name === 'save_note') {
    validateAgentNoteWrite(a.note)
    const patch = a.note as Partial<NoteDoc> & { id?: string; baseRevision?: string }
    const old = patch.id ? await getNote(store, patch.id) : null
    if (patch.id && !old) throw new Error(`未找到便签：${patch.id}。请重新读取后再更新。`)
    const baseRevision = requireBaseRevision(patch.id, patch.baseRevision, '便签')
    const beforeText = old ? JSON.stringify(old, null, 2) : ''
    if (baseRevision && contentRevision(beforeText) !== baseRevision) throw new Error('便签版本已变化，请重新读取')
    const clean = cleanRevision(patch)
    const now = Date.now()
    const after = (old ? { ...old, ...clean, updatedAt: now } : { id: genId('note'), title: clean.title, tags: clean.tags ?? [], pinned: Boolean(clean.pinned), createdAt: clean.createdAt ?? now, updatedAt: now, content: clean.content ?? '' }) as NoteDoc
    sim = {
      entityId: after.id,
      title: `${old ? '更新' : '新建'}便签：${after.title}`,
      beforeText,
      afterText: JSON.stringify(after, null, 2),
      commit: old
        ? () => applyUnchanged(
          store,
          `note:${after.id}`,
          '便签',
          beforeText,
          async () => {
            const latest = await getNote(store, after.id)
            return latest ? JSON.stringify(latest, null, 2) : null
          },
          async () => `已保存便签「${(await saveNote(store, { ...clean, id: after.id })).title}」`
        )
        : async () => ({ ok: true, text: `已保存便签「${(await saveNote(store, { ...clean, id: after.id })).title}」` })
    }
  } else if (name === 'delete_note') {
    const noteId = typeof a.noteId === 'string' ? a.noteId.trim() : ''
    if (!noteId) throw new Error('delete_note 必须提供有效 noteId')
    const note = await getNote(store, noteId)
    if (!note) throw new Error(`未找到便签：${noteId}`)
    const beforeText = serializeNote(note)
    if (typeof a.baseRevision === 'string' && contentRevision(beforeText) !== a.baseRevision) throw new Error('便签版本已变化，请重新读取')
    sim = {
      entityId: note.id,
      title: `删除便签：${note.title}`,
      beforeText,
      afterText: '移入回收站',
      commit: () => applyUnchanged(
        store,
        `note:${note.id}`,
        '便签',
        beforeText,
        async () => {
          const latest = await getNote(store, note.id)
          return latest ? serializeNote(latest) : null
        },
        async () => {
          await deleteNote(store, note.id)
          return `已将便签「${note.title}」移入回收站`
        }
      )
    }
  } else if (name === 'move_chapter') {
    const chapterId = String(a.chapterId ?? ''); const box = a.box === 'draft' ? 'draft' : a.box === 'main' ? 'main' : ''; if (!chapterId || !box) throw new Error('chapterId 或 box 无效')
    validateAgentChapterMove({ box, volumeId: a.volumeId })
    const current = (await listChapters(store)).find((chapter) => chapter.id === chapterId); if (!current) throw new Error(`未找到章节：${chapterId}`)
    const target = { box, ...(a.volumeId ? { volumeId: String(a.volumeId) } : {}) } as { box: 'draft' | 'main'; volumeId?: string }
    if (target.box === 'main' && target.volumeId && !(await listVolumes(store)).some((volume) => volume.id === target.volumeId)) throw new Error(`未找到目标卷：${target.volumeId}`)
    const currentWithBody = { ...current, content: (await getChapterBody(store, chapterId)) ?? '' }
    const beforeText = serializeChapter(currentWithBody)
    if (typeof a.baseRevision === 'string' && contentRevision(beforeText) !== a.baseRevision) throw new Error('章节版本已变化，请重新读取')
    sim = {
      entityId: chapterId,
      title: `移动章节：${current.title}`,
      beforeText,
      afterText: JSON.stringify({ ...current, ...target, ...resolveChapterPlacement(current, { box: target.box }) }, null, 2),
      commit: () => applyUnchanged(
        store,
        `chapter:${chapterId}`,
        '章节',
        beforeText,
        async () => {
          const latestMeta = (await listChapters(store)).find((chapter) => chapter.id === chapterId)
          const latest = latestMeta ? { ...latestMeta, content: (await getChapterBody(store, chapterId)) ?? '' } : null
          return latest ? serializeChapter(latest) : null
        },
        async () => {
          await moveChapter(store, chapterId, target)
          return `已移动章节「${current.title}」`
        }
      )
    }
  } else if (name === 'restore_from_trash') {
    const id = String(a.id ?? ''); const entry = (await listTrash(store)).find((item) => item.id === id); if (!entry) throw new Error(`回收站中未找到实体：${id}`)
    const beforeText = JSON.stringify(entry, null, 2)
    if (typeof a.baseRevision === 'string' && contentRevision(beforeText) !== a.baseRevision) throw new Error('回收站条目版本已变化，请重新读取')
    sim = {
      entityId: id,
      title: `恢复：${entry.title}`,
      beforeText,
      afterText: `恢复到 ${entry.originalPath}`,
      entityKind: entry.kind,
      commit: () => applyUnchanged(
        store,
        `trash:${id}`,
        '回收站条目',
        beforeText,
        async () => {
          const latest = (await listTrash(store)).find((item) => item.id === id)
          return latest ? JSON.stringify(latest, null, 2) : null
        },
        async () => {
          await restoreFromTrash(store, id, typeof a.placement === 'object' && a.placement ? a.placement : undefined)
          return `已恢复「${entry.title}」`
        }
      )
    }
  } else {
    validateAgentRelationshipWrite(a.relationship)
    const r = a.relationship as { fromCharacterId: string; toCharacterId: string; type: string; label?: string; description?: string; directed?: boolean; baseRevision?: string }
    const chars = await listCharacters(store)
    const from = chars.find((c) => c.id === r.fromCharacterId)
    const to = chars.find((c) => c.id === r.toCharacterId)
    if (!from || !to) throw new Error(`人物不存在：${!from ? r.fromCharacterId : r.toCharacterId}。请先用 list_characters 获取有效 id。`)
    const old = await loadRelationships(store)
    const relationship = { id: genId('rel'), fromId: r.fromCharacterId, toId: r.toCharacterId, type: r.type ?? '', label: r.label ?? '', description: r.description ?? '', directed: Boolean(r.directed) }
    const next = [...old, relationship]
    const nameOf = (id: string) => chars.find((c) => c.id === id)?.name ?? id
    const beforeText = serializeRelationships(old, nameOf)
    if (r.baseRevision && contentRevision(beforeText) !== r.baseRevision) throw new Error('关系集合版本已变化，请重新读取')
    sim = {
      entityId: 'relationships',
      title: `新增关系：${from.name} → ${to.name}${r.type ? `【${r.type}】` : ''}`,
      beforeText,
      afterText: serializeRelationships(next, nameOf),
      commit: () => coordinatorFor(store).run('relationships', async () => {
        const latest = await loadRelationships(store)
        const latestChars = await listCharacters(store)
        if (!latestChars.some((character) => character.id === from.id) || !latestChars.some((character) => character.id === to.id)) return conflict('人物端点')
        await saveRelationships(store, latest.some((item) => item.id === relationship.id) ? latest : [...latest, relationship])
        return { ok: true, text: `已保存关系：${from.name} ⇄ ${to.name}` }
      })
    }
  }
  const change: PendingChange = { id: genId('chg'), toolName: name, entityKind: sim.entityKind ?? kindOfTool(name), entityId: sim.entityId, title: sim.title, beforeText: sim.beforeText, afterText: sim.afterText }
  return { kind: 'pending', change, apply: sim.commit }
}

export async function executeTool(store: FileStore, name: string, argsJson: string): Promise<ToolOutcome> {
  try {
    const definition = TOOL_DEF_BY_NAME.get(name)
    if (!definition) throw new Error(`未知工具：${name}`)
    const args = parseToolArguments(argsJson)
    validateToolArguments(definition, args)
    if (name === 'delete_event') {
      const outcome = await executeDeleteEntityTool(store, { kind: 'event', id: args.eventId, baseRevision: args.baseRevision })
      return outcome.kind === 'pending'
        ? { ...outcome, change: { ...outcome.change, toolName: 'delete_event' } }
        : outcome
    }
    if (name === 'delete_entity') return await executeDeleteEntityTool(store, args)
    if (name === 'read_content_lines' || name === 'edit_content') return await executeContentEditTool(store, name, args)
    if (name === 'list_project_docs' || name === 'read_project_doc' || name === 'save_project_doc' || name === 'rename_project_doc') return await executeProjectDocTool(store, name, args)
    return WRITE_TOOLS.has(name) ? await writeTool(store, name, args) : await readTool(store, name, args)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const explicitCode = typeof (err as { code?: unknown })?.code === 'string' ? (err as { code: string }).code : ''
    const prefixedCode = message.match(/^([A-Z_]+)：/)?.[1] ?? ''
    const mappedCode: ToolFailureCode = message.includes('INVALID_CURSOR') ? 'INVALID_CURSOR' :
      message.includes('PROJECT_CHANGED') ? 'PROJECT_CHANGED' :
      message.includes('SOURCE_CHANGED') ? 'SOURCE_CHANGED' :
      message.includes('AMBIGUOUS') ? 'AMBIGUOUS_TARGET' :
      message.includes('事件图') ? 'INVALID_EVENT_GRAPH' :
      message.includes('直属分支') ? 'HAS_BRANCHES' :
      message.includes('RESTORE_CONFLICT') ? 'RESTORE_CONFLICT' :
      message.includes('RESTORE_REQUIRES_PLACEMENT') ? 'RESTORE_REQUIRES_PLACEMENT' :
      message.includes('RECOVERY_REQUIRED') ? 'RECOVERY_REQUIRED' :
      message.includes('等待期间') ? 'CONFLICT' :
      message.includes('未找到') ? 'NOT_FOUND' :
      'INVALID_ARGUMENT'
    const code = (explicitCode || prefixedCode || mappedCode) as ToolFailureCode
    const retryable = code === 'PROJECT_CHANGED' || code === 'SOURCE_CHANGED' || code === 'CONFLICT' || code === 'INVALID_ARGUMENT'
    const details = message.includes('maxChars')
      ? { parameter: 'maxChars', minimum: 1, maximum: 20000, correction: '将 maxChars 调整为不超过 20000，并使用 nextOffset/expectedRevision 分页读取' }
      : undefined
    const failure: ToolFailure = { schemaVersion: 2, error: { code, message, retryable, ...(details ? { details } : {}) } }
    const text = JSON.stringify(failure)
    return { kind: 'result', ok: false, text, preview: clip(message) }
  }
}
