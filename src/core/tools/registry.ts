import type { ChapterDoc, CharacterDoc, EntityKind, NoteDoc, OutlineDoc, PendingChange, SettingDoc, StoryEvent, ToolDefJson } from '../../shared/types'
import { countWords, deleteNote, findCharacter, genId, getChapterBody, getNote, getSetting, listChapters, listCharacters, listEvents, listNotes, listOutline, listSettings, loadRelationships, saveChapter, saveCharacter, saveEvent, saveNote, saveOutlineDoc, saveRelationships, saveSetting, searchProject, serializeChapter, serializeCharacter, serializeEvent, serializeNote, serializeOutlineDoc, serializeRelationships } from '../workspace/entityStore'
import type { FileStore } from '../storage/fileStore'
import { getChapterContext, lookupTerm } from '../retrieval'
import { listTrash, restoreFromTrash } from '../workspace/trash'
import { listVolumes, moveChapter } from '../workspace/workspaceService'
import { validateAgentChapterMove, validateAgentChapterWrite, validateAgentOutlineWrite } from './writeValidation'
import { AGENT_CHAPTER_SCHEMA, AGENT_OUTLINE_DOC_SCHEMA } from './writeSchemas'

export type ToolOutcome =
  | { kind: 'result'; text: string; ok: boolean; preview: string }
  | { kind: 'pending'; change: PendingChange; apply: () => Promise<{ ok: boolean; text: string }> }

const clip = (text: string, max = 120): string => (text.length > max ? `${text.slice(0, max)}…` : text)
const json = (v: unknown): string => JSON.stringify(v)
const argsOf = (s: string): Record<string, any> => {
  try { const v = JSON.parse(s || '{}'); return v && typeof v === 'object' ? v : {} } catch { return {} }
}

export const TOOL_DEFS: ToolDefJson[] = [
  { name: 'list_characters', description: '列出工作区全部人物摘要。', parameters: { type: 'object', properties: {} } },
  { name: 'get_character', description: '按 id 或姓名获取完整人物卡。', parameters: { type: 'object', properties: { characterId: { type: 'string' }, name: { type: 'string' } } } },
  { name: 'search_project', description: '全文检索人物、关系、大纲、事件和章节。', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'get_outline', description: '读取全部故事大纲。', parameters: { type: 'object', properties: {} } },
  { name: 'list_events', description: '列出事件摘要。', parameters: { type: 'object', properties: {} } },
  { name: 'get_event', description: '按 id 或标题获取事件。', parameters: { type: 'object', properties: { eventId: { type: 'string' }, title: { type: 'string' } } } },
  { name: 'get_relations', description: '查询人物关系。', parameters: { type: 'object', properties: { characterId: { type: 'string' } } } },
  { name: 'list_chapters', description: '列出章节目录。', parameters: { type: 'object', properties: {} } },
  { name: 'get_chapter', description: '按 id 或标题读取章节正文。', parameters: { type: 'object', properties: { chapterId: { type: 'string' }, title: { type: 'string' } } } },
  { name: 'get_chapter_context', description: '读取目标章及前后各两章的受限上下文。', parameters: { type: 'object', properties: { chapterId: { type: 'string' }, radius: { type: 'number' }, maxChars: { type: 'number' } }, required: ['chapterId'] } },
  { name: 'lookup_term', description: '查询术语标注、设定和大纲来源。', parameters: { type: 'object', properties: { term: { type: 'string' } }, required: ['term'] } },
  { name: 'list_settings', description: '列出设定摘要。', parameters: { type: 'object', properties: {} } },
  { name: 'get_setting', description: '读取完整设定。', parameters: { type: 'object', properties: { settingId: { type: 'string' } }, required: ['settingId'] } },
  { name: 'list_notes', description: '列出便签摘要。', parameters: { type: 'object', properties: {} } },
  { name: 'get_note', description: '读取完整便签。', parameters: { type: 'object', properties: { noteId: { type: 'string' } }, required: ['noteId'] } },
  { name: 'list_chapter_outlines', description: '列出章纲摘要；传 chapterId 可限定到一章。', parameters: { type: 'object', properties: { chapterId: { type: 'string', description: '目标章节 id；不传则列出全部章纲' } } } },
  { name: 'get_chapter_outline', description: '读取一篇章纲；必须提供 outlineId 或 chapterId。', parameters: { type: 'object', properties: { outlineId: { type: 'string' }, chapterId: { type: 'string' } }, anyOf: [{ required: ['outlineId'] }, { required: ['chapterId'] }] } },
  { name: 'save_character', description: '新建或更新人物卡；需要用户确认。', parameters: { type: 'object', properties: { character: { type: 'object' } }, required: ['character'] } },
  { name: 'save_relationship', description: '新建人物关系；需要用户确认。', parameters: { type: 'object', properties: { relationship: { type: 'object' } }, required: ['relationship'] } },
  { name: 'save_event', description: '新建或更新事件；需要用户确认。', parameters: { type: 'object', properties: { event: { type: 'object' } }, required: ['event'] } },
  { name: 'save_outline_doc', description: '新建或更新大纲；必须显式指定 kind：total=总纲，chapter=章纲；章纲还必须指定 chapterId；需要用户确认。', parameters: { type: 'object', properties: { doc: AGENT_OUTLINE_DOC_SCHEMA }, required: ['doc'] } },
  { name: 'save_chapter', description: '新建或更新章节正文；必须显式指定 box：draft=草稿箱，main=正文箱；正文箱还必须指定 volumeId；需要用户确认。', parameters: { type: 'object', properties: { chapter: AGENT_CHAPTER_SCHEMA }, required: ['chapter'] } },
  { name: 'save_setting', description: '新建或更新设定；需要用户确认。', parameters: { type: 'object', properties: { setting: { type: 'object' } }, required: ['setting'] } },
  { name: 'save_note', description: '新建或更新便签；需要用户确认。', parameters: { type: 'object', properties: { note: { type: 'object' } }, required: ['note'] } },
  { name: 'delete_note', description: '只有用户明确同意删除已完成便签后才能调用；将便签移入回收站，需要用户确认。', parameters: { type: 'object', properties: { noteId: { type: 'string', description: '要删除的便签 id' } }, required: ['noteId'] } }
  ,{ name: 'move_chapter', description: '移动章节到草稿箱或正文卷；需要用户确认。', parameters: { type: 'object', properties: { chapterId: { type: 'string' }, box: { type: 'string', enum: ['draft', 'main'] }, volumeId: { type: 'string' } }, required: ['chapterId', 'box'] } }
  ,{ name: 'restore_from_trash', description: '从回收站恢复资料；需要用户确认。', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } }
]

export const WRITE_TOOLS = new Set(['save_character', 'save_relationship', 'save_event', 'save_outline_doc', 'save_chapter', 'save_setting', 'save_note', 'delete_note', 'move_chapter', 'restore_from_trash'])

async function readTool(store: FileStore, name: string, a: Record<string, any>): Promise<ToolOutcome> {
  const ok = (text: string): ToolOutcome => ({ kind: 'result', ok: true, text, preview: clip(text) })
  const fail = (text: string): ToolOutcome => ({ kind: 'result', ok: false, text, preview: clip(text) })
  switch (name) {
    case 'list_characters': return ok(json((await listCharacters(store)).map(({ id, name, aliases, role, faction, tags, summary }) => ({ id, name, aliases, role, faction, tags, summary }))))
    case 'get_character': { const c = await findCharacter(store, { id: a.characterId, name: a.name }); return c ? ok(json(c)) : fail(`未找到人物：${a.name ?? a.characterId}`) }
    case 'search_project': return a.query ? ok(json(await searchProject(store, String(a.query)))) : fail('query 不能为空')
    case 'get_outline': return ok(json((await listOutline(store)).filter((doc) => (doc.kind ?? 'total') === 'total').map((doc) => ({ id: doc.id, title: doc.title, order: doc.order, summary: clip(doc.content, 400) }))))
    case 'list_events': { const chars = await listCharacters(store); const nameOf = (id: string) => chars.find((c) => c.id === id)?.name ?? id; return ok(json((await listEvents(store)).map((e) => ({ id: e.id, title: e.title, storyTime: e.storyTime, characters: e.characterIds.map(nameOf), summary: clip(e.content, 80) })))) }
    case 'get_event': { const events = await listEvents(store); const e = (a.eventId ? events.find((x) => x.id === a.eventId) : undefined) ?? (a.title ? events.find((x) => x.title.includes(String(a.title))) : undefined); return e ? ok(json(e)) : fail(`未找到事件：${a.title ?? a.eventId}`) }
    case 'get_relations': { const rels = await loadRelationships(store); const chars = await listCharacters(store); const nameOf = (id: string) => chars.find((c) => c.id === id)?.name ?? id; const filtered = a.characterId ? rels.filter((r) => r.fromId === a.characterId || r.toId === a.characterId) : rels; return ok(json(filtered.map((r) => ({ ...r, fromName: nameOf(r.fromId), toName: nameOf(r.toId) })))) }
    case 'list_chapters': return ok(json(await listChapters(store)))
    case 'get_chapter': { const metas = await listChapters(store); const m = (a.chapterId ? metas.find((x) => x.id === a.chapterId) : undefined) ?? (a.title ? metas.find((x) => x.title.includes(String(a.title))) : undefined); if (!m) return fail(`未找到章节：${a.title ?? a.chapterId}`); let content = (await getChapterBody(store, m.id)) ?? ''; if (content.length > 8000) content = `${content.slice(0, 8000)}\n…（正文过长已截断，共 ${m.wordCount} 字）`; return ok(json({ ...m, content })) }
    case 'get_chapter_context': return a.chapterId ? ok(json(await getChapterContext(store, String(a.chapterId), { radius: a.radius, maxChars: a.maxChars }))) : fail('chapterId 不能为空')
    case 'lookup_term': return a.term ? ok(json(await lookupTerm(store, String(a.term)))) : fail('term 不能为空')
    case 'list_settings': return ok(json(await listSettings(store)))
    case 'get_setting': { const value = a.settingId ? await getSetting(store, String(a.settingId)) : null; return value ? ok(json(value)) : fail(`未找到设定：${a.settingId}`) }
    case 'list_notes': return ok(json(await listNotes(store)))
    case 'get_note': { const value = a.noteId ? await getNote(store, String(a.noteId)) : null; return value ? ok(json(value)) : fail(`未找到便签：${a.noteId}`) }
    case 'list_chapter_outlines': return ok(json((await listOutline(store)).filter((doc) => doc.kind === 'chapter' && (!a.chapterId || doc.chapterId === a.chapterId)).map(({ content: _content, ...meta }) => meta)))
    case 'get_chapter_outline': { if (!a.outlineId && !a.chapterId) return fail('get_chapter_outline 必须提供 outlineId 或 chapterId，不能猜测目标章纲'); const value = (await listOutline(store)).find((doc) => doc.kind === 'chapter' && (!a.chapterId || doc.chapterId === a.chapterId) && (!a.outlineId || doc.id === a.outlineId)); return value ? ok(json(value)) : fail('未找到章纲') }
    default: return fail(`未知工具：${name}`)
  }
}

interface Simulated { entityId: string; title: string; beforeText: string; afterText: string; entityKind?: EntityKind | 'relationship'; commit: () => Promise<string> }

async function writeTool(store: FileStore, name: string, a: Record<string, any>): Promise<ToolOutcome> {
  let sim: Simulated
  if (name === 'save_character') {
    const patch = a.character as Partial<CharacterDoc> & { id?: string }; const old = patch.id ? await findCharacter(store, { id: patch.id }) : null; const after = (old ? { ...old, ...patch } : { id: patch.id ?? genId('char'), name: patch.name ?? '未命名人物', aliases: patch.aliases ?? [], role: patch.role ?? '', faction: patch.faction ?? '', gender: patch.gender ?? '', age: patch.age ?? '', tags: patch.tags ?? [], summary: patch.summary ?? '', content: patch.content ?? '' }) as CharacterDoc
    sim = { entityId: after.id, title: `${old ? '更新' : '新建'}人物卡：${after.name}`, beforeText: old ? serializeCharacter(old) : '', afterText: serializeCharacter(after), commit: async () => `已保存人物卡「${(await saveCharacter(store, { ...patch, id: after.id })).name}」` }
  } else if (name === 'save_event') {
    const patch = a.event as Partial<StoryEvent> & { id?: string }; const all = await listEvents(store); const old = patch.id ? all.find((e) => e.id === patch.id) : null; const after = (old ? { ...old, ...patch } : { id: patch.id ?? genId('evt'), title: patch.title ?? '未命名事件', storyTime: patch.storyTime ?? '', order: patch.order ?? (all.length ? Math.max(...all.map((e) => e.order)) + 1 : 1), location: patch.location ?? '', tags: patch.tags ?? [], characterIds: patch.characterIds ?? [], prevIds: patch.prevIds ?? [], nextIds: patch.nextIds ?? [], content: patch.content ?? '' }) as StoryEvent
    sim = { entityId: after.id, title: `${old ? '更新' : '新建'}事件：${after.title}`, beforeText: old ? serializeEvent(old) : '', afterText: serializeEvent(after), commit: async () => `已保存事件「${(await saveEvent(store, { ...patch, id: after.id })).title}」` }
  } else if (name === 'save_outline_doc') {
    const patch = a.doc as Partial<OutlineDoc> & { id?: string }; validateAgentOutlineWrite(patch); const all = await listOutline(store); const old = patch.id ? all.find((o) => o.id === patch.id) : null; if (patch.kind === 'chapter' && !(await listChapters(store)).some((chapter) => chapter.id === patch.chapterId)) throw new Error(`未找到章纲关联的章节：${patch.chapterId}`); const after = (old ? { ...old, ...patch } : { id: patch.id ?? genId('out'), title: patch.title ?? '未命名大纲', order: patch.order ?? (all.length ? Math.max(...all.map((o) => o.order)) + 1 : 1), kind: patch.kind, chapterId: patch.chapterId, content: patch.content ?? '' }) as OutlineDoc
    sim = { entityId: after.id, title: `${old ? '更新' : '新建'}大纲：${after.title}`, beforeText: old ? serializeOutlineDoc(old) : '', afterText: serializeOutlineDoc(after), commit: async () => `已保存大纲「${(await saveOutlineDoc(store, { ...patch, id: after.id })).title}」` }
  } else if (name === 'save_chapter') {
    const patch = a.chapter as Partial<ChapterDoc> & { id?: string }; validateAgentChapterWrite(patch); if (patch.box === 'main' && !(await listVolumes(store)).some((volume) => volume.id === patch.volumeId)) throw new Error(`未找到目标卷：${patch.volumeId}`); const metas = await listChapters(store); const m = patch.id ? metas.find((c) => c.id === patch.id) : null; const old = m ? ({ ...m, content: (await getChapterBody(store, m.id)) ?? '' } as ChapterDoc) : null; const content = Object.prototype.hasOwnProperty.call(patch, 'content') ? patch.content ?? '' : old?.content ?? ''; const after = (old ? { ...old, ...patch, content, wordCount: countWords(content) } : { id: patch.id ?? genId('cha'), title: patch.title ?? '未命名章节', volume: patch.volume ?? '第一卷', volumeId: patch.volumeId, order: patch.order ?? (metas.length ? Math.max(...metas.map((c) => c.order)) + 1 : 1), box: patch.box, status: patch.status ?? 'draft', wordCount: countWords(content), content }) as ChapterDoc
    sim = { entityId: after.id, title: `${old ? '更新' : '新建'}章节：${after.title}`, beforeText: old ? serializeChapter(old) : '', afterText: serializeChapter(after), commit: async () => `已保存章节「${(await saveChapter(store, { ...patch, id: after.id })).title}」` }
  } else if (name === 'save_setting') {
    const patch = a.setting as Partial<SettingDoc> & { id?: string }; const old = patch.id ? await getSetting(store, patch.id) : null; const after = (old ? { ...old, ...patch } : { id: patch.id ?? genId('set'), title: patch.title ?? '未命名设定', category: patch.category === 'other' ? 'other' : 'background', tags: patch.tags ?? [], content: patch.content ?? '' }) as SettingDoc
    sim = { entityId: after.id, title: `${old ? '更新' : '新建'}设定：${after.title}`, beforeText: old ? JSON.stringify(old, null, 2) : '', afterText: JSON.stringify(after, null, 2), commit: async () => `已保存设定「${(await saveSetting(store, { ...patch, id: after.id })).title}」` }
  } else if (name === 'save_note') {
    const patch = a.note as Partial<NoteDoc> & { id?: string }; const old = patch.id ? await getNote(store, patch.id) : null; const now = Date.now(); const after = (old ? { ...old, ...patch } : { id: patch.id ?? genId('note'), title: patch.title ?? '未命名便签', tags: patch.tags ?? [], pinned: Boolean(patch.pinned), createdAt: patch.createdAt ?? now, updatedAt: now, content: patch.content ?? '' }) as NoteDoc
    sim = { entityId: after.id, title: `${old ? '更新' : '新建'}便签：${after.title}`, beforeText: old ? JSON.stringify(old, null, 2) : '', afterText: JSON.stringify(after, null, 2), commit: async () => `已保存便签「${(await saveNote(store, { ...patch, id: after.id })).title}」` }
  } else if (name === 'delete_note') {
    const noteId = typeof a.noteId === 'string' ? a.noteId.trim() : ''
    if (!noteId) throw new Error('delete_note 必须提供有效 noteId')
    const note = await getNote(store, noteId)
    if (!note) throw new Error(`未找到便签：${noteId}`)
    sim = { entityId: note.id, title: `删除便签：${note.title}`, beforeText: serializeNote(note), afterText: '移入回收站', commit: async () => { await deleteNote(store, note.id); return `已将便签「${note.title}」移入回收站` } }
  } else if (name === 'move_chapter') {
    const chapterId = String(a.chapterId ?? ''); const box = a.box === 'draft' ? 'draft' : a.box === 'main' ? 'main' : ''; if (!chapterId || !box) throw new Error('chapterId 或 box 无效')
    validateAgentChapterMove({ box, volumeId: a.volumeId })
    const current = (await listChapters(store)).find((chapter) => chapter.id === chapterId); if (!current) throw new Error(`未找到章节：${chapterId}`)
    const target = { box, ...(a.volumeId ? { volumeId: String(a.volumeId) } : {}) } as { box: 'draft' | 'main'; volumeId?: string }
    if (target.box === 'main' && target.volumeId && !(await listVolumes(store)).some((volume) => volume.id === target.volumeId)) throw new Error(`未找到目标卷：${target.volumeId}`)
    sim = { entityId: chapterId, title: `移动章节：${current.title}`, beforeText: JSON.stringify(current, null, 2), afterText: JSON.stringify({ ...current, ...target }, null, 2), commit: async () => { await moveChapter(store, chapterId, target); return `已移动章节「${current.title}」` } }
  } else if (name === 'restore_from_trash') {
    const id = String(a.id ?? ''); const entry = (await listTrash(store)).find((item) => item.id === id); if (!entry) throw new Error(`回收站中未找到实体：${id}`)
    sim = { entityId: id, title: `恢复：${entry.title}`, beforeText: JSON.stringify(entry, null, 2), afterText: `恢复到 ${entry.originalPath}`, entityKind: entry.kind, commit: async () => { await restoreFromTrash(store, id); return `已恢复「${entry.title}」` } }
  } else {
    const r = a.relationship as { fromCharacterId: string; toCharacterId: string; type: string; label?: string; description?: string; directed?: boolean }; const chars = await listCharacters(store); const from = chars.find((c) => c.id === r.fromCharacterId); const to = chars.find((c) => c.id === r.toCharacterId); if (!from || !to) throw new Error(`人物不存在：${!from ? r.fromCharacterId : r.toCharacterId}。请先用 list_characters 获取有效 id。`); const old = await loadRelationships(store); const next = [...old, { id: genId('rel'), fromId: r.fromCharacterId, toId: r.toCharacterId, type: r.type ?? '', label: r.label ?? '', description: r.description ?? '', directed: Boolean(r.directed) }]; const nameOf = (id: string) => chars.find((c) => c.id === id)?.name ?? id; sim = { entityId: 'relationships', title: `新增关系：${from.name} → ${to.name}${r.type ? `【${r.type}】` : ''}`, beforeText: serializeRelationships(old, nameOf), afterText: serializeRelationships(next, nameOf), commit: async () => { await saveRelationships(store, next); return `已保存关系：${from.name} ⇄ ${to.name}` } }
  }
  const change: PendingChange = { id: genId('chg'), toolName: name, entityKind: sim.entityKind ?? (name === 'save_character' ? 'character' : name === 'save_relationship' ? 'relationship' : name === 'save_event' ? 'event' : name === 'save_chapter' || name === 'move_chapter' ? 'chapter' : name === 'save_setting' ? 'setting' : name === 'save_note' || name === 'delete_note' ? 'note' : name === 'restore_from_trash' ? 'chapter' : 'outline'), entityId: sim.entityId, title: sim.title, beforeText: sim.beforeText, afterText: sim.afterText }
  return { kind: 'pending', change, apply: async () => ({ ok: true, text: await sim.commit() }) }
}

export async function executeTool(store: FileStore, name: string, argsJson: string): Promise<ToolOutcome> {
  try { return WRITE_TOOLS.has(name) ? await writeTool(store, name, argsOf(argsJson)) : await readTool(store, name, argsOf(argsJson)) } catch (err) { const text = `工具执行失败：${err instanceof Error ? err.message : String(err)}`; return { kind: 'result', ok: false, text, preview: clip(text) } }
}
