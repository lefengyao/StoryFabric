/**
 * 智能体工具注册表：读取工具直接执行；写入工具只生成「待确认变更」，
 * 由用户在界面确认后才真正落盘（commit）。
 */
import type { ChapterDoc, CharacterDoc, NoteDoc, OutlineDoc, PendingChange, SettingDoc, StoryEvent, ToolDefJson } from '../../shared/types'
import {
  countWords,
  findCharacter,
  genId,
  getChapterBody,
  listCharacters,
  listChapters,
  listEvents,
  listOutline,
  listNotes,
  deleteNote,
  listSettings,
  getNote,
  getSetting,
  loadRelationships,
  saveChapter,
  saveCharacter,
  saveEvent,
  saveOutlineDoc,
  saveNote,
  saveSetting,
  saveRelationships,
  searchProject,
  serializeChapter,
  serializeCharacter,
  serializeEvent,
  serializeOutlineDoc,
  serializeRelationships
} from '../services/entityStore'
import { NodeFileStore } from '../../core/storage/nodeFileStore'
import { serializeNote } from '../../core/workspace/entityStore'
import { getChapterContext, lookupTerm } from '../../core/retrieval'
import { listTrash, listVolumes, moveChapter, restoreTrash } from '../services/workspaceService'
import { validateAgentChapterMove, validateAgentChapterWrite, validateAgentOutlineWrite } from '../../core/tools/writeValidation'
import { AGENT_CHAPTER_SCHEMA, AGENT_OUTLINE_DOC_SCHEMA } from '../../core/tools/writeSchemas'

/* eslint-disable @typescript-eslint/no-explicit-any */

export type ToolOutcome =
  | { kind: 'result'; text: string; ok: boolean; preview: string }
  | {
      kind: 'pending'
      change: PendingChange
      apply: () => Promise<{ ok: boolean; text: string }>
    }

const J = (v: unknown): string => JSON.stringify(v)

function argsOf(argsJson: string): Record<string, any> {
  try {
    const v = JSON.parse(argsJson || '{}')
    return typeof v === 'object' && v !== null ? v : {}
  } catch {
    return {}
  }
}

function clip(text: string, max = 120): string {
  return text.length > max ? text.slice(0, max) + '…' : text
}

/* ---------------- 工具 Schema ---------------- */

export const TOOL_DEFS: ToolDefJson[] = [
  {
    name: 'list_characters',
    description: '列出工作区全部人物的摘要（id/姓名/别名/身份/标签/简介）。需要某人的完整设定时再用 get_character。',
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'get_character',
    description: '按 id 或姓名（含别名模糊匹配）获取一位人物的完整人物卡，包括外貌性格背景等自由描述。',
    parameters: {
      type: 'object',
      properties: {
        characterId: { type: 'string', description: '人物 id（与 name 二选一）' },
        name: { type: 'string', description: '人物姓名或别名' }
      }
    }
  },
  {
    name: 'search_project',
    description: '全文检索整个项目（人物/关系/大纲/事件/章节），返回命中片段。用于查找关键词出现在哪里。',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: '检索关键词' } },
      required: ['query']
    }
  },
  {
    name: 'get_outline',
    description: '读取全部故事大纲文档（Markdown）。',
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'list_events',
    description: '列出事件脉络中全部事件的摘要（id/标题/故事时间/关联人物）。',
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'get_event',
    description: '按 id 或标题获取单个事件的完整内容（含因果链与关联人物）。',
    parameters: {
      type: 'object',
      properties: {
        eventId: { type: 'string', description: '事件 id（与 title 二选一）' },
        title: { type: 'string', description: '事件标题' }
      }
    }
  },
  {
    name: 'get_relations',
    description: '查询人物关系边；可传 characterId 过滤与某人相关的关系，不传则返回全部。',
    parameters: {
      type: 'object',
      properties: { characterId: { type: 'string', description: '可选：按人物 id 过滤' } }
    }
  },
  {
    name: 'list_chapters',
    description: '列出章节目录（id/标题/卷/状态/字数），不含正文。',
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'get_chapter',
    description: '按 id 或标题读取某一章正文（超长时截断返回）。',
    parameters: {
      type: 'object',
      properties: {
        chapterId: { type: 'string', description: '章节 id（与 title 二选一）' },
        title: { type: 'string', description: '章节标题' }
      }
    }
  },
  {
    name: 'get_chapter_context',
    description: '读取目标章节与前后各两章的受限上下文，修改章节前优先使用。',
    parameters: { type: 'object', properties: { chapterId: { type: 'string' }, radius: { type: 'number' }, maxChars: { type: 'number' } }, required: ['chapterId'] }
  },
  {
    name: 'lookup_term',
    description: '查询术语标注、设定和大纲中的相关来源。',
    parameters: { type: 'object', properties: { term: { type: 'string' } }, required: ['term'] }
  },
  {
    name: 'list_settings',
    description: '列出背景设定和其他设定摘要。',
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'get_setting',
    description: '读取一条完整设定。',
    parameters: { type: 'object', properties: { settingId: { type: 'string' } }, required: ['settingId'] }
  },
  {
    name: 'list_notes',
    description: '列出便签摘要。',
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'get_note',
    description: '读取一条完整便签。',
    parameters: { type: 'object', properties: { noteId: { type: 'string' } }, required: ['noteId'] }
  },
  {
    name: 'list_chapter_outlines',
    description: '按章节列出章纲摘要，不读取全部正文。传 chapterId 可只列出指定章节的章纲。',
    parameters: { type: 'object', properties: { chapterId: { type: 'string', description: '目标章节 id；不传则列出所有章纲摘要' } } }
  },
  {
    name: 'get_chapter_outline',
    description: '读取一篇章纲。必须提供 outlineId 或 chapterId，不能无条件返回第一篇章纲。',
    parameters: { type: 'object', properties: { outlineId: { type: 'string', description: '章纲文档 id' }, chapterId: { type: 'string', description: '目标章节 id；与 outlineId 至少提供一个' } }, anyOf: [{ required: ['outlineId'] }, { required: ['chapterId'] }] }
  },
  {
    name: 'save_character',
    description: '新建或更新人物卡。更新时只需提供要修改的字段；用户确认后才会写入。',
    parameters: {
      type: 'object',
      properties: {
        character: {
          type: 'object',
          description: '人物数据对象',
          properties: {
            id: { type: 'string', description: '更新已有人物时必填' },
            name: { type: 'string' },
            aliases: { type: 'array', items: { type: 'string' } },
            role: { type: 'string', description: '如 主角/反派/配角' },
            faction: { type: 'string', description: '所属阵营/组织/势力' },
            gender: { type: 'string' },
            age: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } },
            summary: { type: 'string', description: '一句话简介' },
            content: { type: 'string', description: '完整人物卡 Markdown 正文' }
          },
          required: ['name']
        }
      },
      required: ['character']
    }
  },
  {
    name: 'save_relationship',
    description: '新建一条人物关系边。fromCharacterId/toCharacterId 必须是已存在的人物 id。',
    parameters: {
      type: 'object',
      properties: {
        relationship: {
          type: 'object',
          properties: {
            fromCharacterId: { type: 'string' },
            toCharacterId: { type: 'string' },
            type: { type: 'string', description: '关系类别：亲属/恋人/朋友/敌对/师徒等' },
            label: { type: 'string', description: '关系短语，如 青梅竹马' },
            description: { type: 'string' },
            directed: { type: 'boolean', description: '是否有方向性，默认否' }
          },
          required: ['fromCharacterId', 'toCharacterId', 'type']
        }
      },
      required: ['relationship']
    }
  },
  {
    name: 'save_event',
    description: '新建或更新事件脉络条目。prevIds/nextIds 表达因果顺序（前置/后续事件 id）。',
    parameters: {
      type: 'object',
      properties: {
        event: {
          type: 'object',
          properties: {
            id: { type: 'string', description: '更新已有事件时必填' },
            title: { type: 'string' },
            storyTime: { type: 'string', description: '故事内时间文案，如 第三年·春' },
            location: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } },
            characterIds: { type: 'array', items: { type: 'string' }, description: '关联人物 id' },
            prevIds: { type: 'array', items: { type: 'string' }, description: '前置事件 id' },
            nextIds: { type: 'array', items: { type: 'string' }, description: '后续事件 id' },
            content: { type: 'string', description: '事件经过的 Markdown 描述' }
          },
          required: ['title']
        }
      },
      required: ['event']
    }
  },
  {
    name: 'save_outline_doc',
    description: '新建或更新一篇大纲文档（Markdown）。必须显式指定 kind：total 为总纲，chapter 为章纲；章纲必须同时指定 chapterId。',
    parameters: {
      type: 'object',
      properties: {
        doc: AGENT_OUTLINE_DOC_SCHEMA
      },
      required: ['doc']
    }
  },
  {
    name: 'save_chapter',
    description: '新建或更新章节正文。必须显式指定 box：draft=草稿箱，main=正文箱；正文箱还必须指定 volumeId。续写时应先 get_chapter 读原文。',
    parameters: {
      type: 'object',
      properties: {
        chapter: AGENT_CHAPTER_SCHEMA
      },
      required: ['chapter']
    }
  },
  {
    name: 'save_setting',
    description: '新建或更新设定；用户确认后才会写入。',
    parameters: { type: 'object', properties: { setting: { type: 'object' } }, required: ['setting'] }
  },
  {
    name: 'save_note',
    description: '新建或更新便签；用户确认后才会写入。',
    parameters: { type: 'object', properties: { note: { type: 'object' } }, required: ['note'] }
  },
  {
    name: 'delete_note',
    description: '只有用户明确同意删除已完成便签后才能调用；将便签移入回收站，需要用户确认。',
    parameters: { type: 'object', properties: { noteId: { type: 'string', description: '要删除的便签 id' } }, required: ['noteId'] }
  },
  {
    name: 'move_chapter',
    description: '将章节移动到草稿箱或指定正文卷；需要用户确认。',
    parameters: { type: 'object', properties: { chapterId: { type: 'string' }, box: { type: 'string', enum: ['draft', 'main'] }, volumeId: { type: 'string' } }, required: ['chapterId', 'box'] }
  },
  {
    name: 'restore_from_trash',
    description: '从回收站恢复一条资料；需要用户确认。',
    parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }
  }
]

export const WRITE_TOOLS = new Set(['save_character', 'save_relationship', 'save_event', 'save_outline_doc', 'save_chapter', 'save_setting', 'save_note', 'delete_note', 'move_chapter', 'restore_from_trash'])

/* ---------------- 读取工具执行 ---------------- */

async function runReadTool(root: string, name: string, a: Record<string, any>): Promise<ToolOutcome> {
  const fail = (msg: string): ToolOutcome => ({ kind: 'result', ok: false, text: msg, preview: clip(msg) })
  switch (name) {
    case 'list_characters': {
      const chars = await listCharacters(root)
      return ok(J(chars.map(({ id, name, aliases, role, faction, tags, summary }) => ({ id, name, aliases, role, faction, tags, summary }))))
    }
    case 'get_character': {
      const c = await findCharacter(root, { id: a.characterId, name: a.name })
      return c ? ok(J(c)) : fail(`未找到人物：${a.name ?? a.characterId}。可先调用 list_characters 核对。`)
    }
    case 'search_project': {
      if (!a.query) return fail('query 不能为空')
      return ok(J(await searchProject(root, String(a.query))))
    }
    case 'get_outline': {
      const docs = (await listOutline(root)).filter((doc) => (doc.kind ?? 'total') === 'total')
      return ok(docs.length ? J(docs.map((d) => ({ id: d.id, title: d.title, order: d.order, summary: clip(d.content, 400) }))) : '大纲为空')
    }
    case 'list_events': {
      const events = await listEvents(root)
      const chars = await listCharacters(root)
      const nameOf = (id: string) => chars.find((c) => c.id === id)?.name ?? id
      return ok(
        events.length
          ? J(events.map((e) => ({ id: e.id, title: e.title, storyTime: e.storyTime, characters: e.characterIds.map(nameOf), summary: clip(e.content, 80) })))
          : '事件脉络为空'
      )
    }
    case 'get_event': {
      const events = await listEvents(root)
      const hit =
        (a.eventId ? events.find((e) => e.id === a.eventId) : undefined) ??
        (a.title ? events.find((e) => e.title.includes(String(a.title))) : undefined)
      return hit ? ok(J(hit)) : fail(`未找到事件：${a.title ?? a.eventId}`)
    }
    case 'get_relations': {
      const rels = await loadRelationships(root)
      const chars = await listCharacters(root)
      const nameOf = (id: string) => chars.find((c) => c.id === id)?.name ?? id
      const filtered = a.characterId ? rels.filter((r) => r.fromId === a.characterId || r.toId === a.characterId) : rels
      return ok(filtered.length ? J(filtered.map((r) => ({ ...r, fromName: nameOf(r.fromId), toName: nameOf(r.toId) }))) : '暂无关系数据')
    }
    case 'list_chapters': {
      return ok(J(await listChapters(root)))
    }
    case 'get_chapter': {
      const metas = await listChapters(root)
      const meta =
        (a.chapterId ? metas.find((c) => c.id === a.chapterId) : undefined) ??
        (a.title ? metas.find((c) => c.title.includes(String(a.title))) : undefined)
      if (!meta) return fail(`未找到章节：${a.title ?? a.chapterId}`)
      let content = (await getChapterBody(root, meta.id)) ?? ''
      if (content.length > 8000) content = content.slice(0, 8000) + `\n…（正文过长已截断，共 ${meta.wordCount} 字）`
      return ok(J({ ...meta, content }))
    }
    case 'get_chapter_context': {
      if (!a.chapterId) return fail('chapterId 不能为空')
      return ok(J(await getChapterContext(new NodeFileStore(root), String(a.chapterId), { radius: a.radius, maxChars: a.maxChars })))
    }
    case 'lookup_term': {
      if (!a.term) return fail('term 不能为空')
      return ok(J(await lookupTerm(new NodeFileStore(root), String(a.term))))
    }
    case 'list_settings': return ok(J(await listSettings(root)))
    case 'get_setting': {
      const value = a.settingId ? await getSetting(root, String(a.settingId)) : null
      return value ? ok(J(value)) : fail(`未找到设定：${a.settingId}`)
    }
    case 'list_notes': return ok(J(await listNotes(root)))
    case 'get_note': {
      const value = a.noteId ? await getNote(root, String(a.noteId)) : null
      return value ? ok(J(value)) : fail(`未找到便签：${a.noteId}`)
    }
    case 'list_chapter_outlines': {
      const docs = (await listOutline(root)).filter((doc) => doc.kind === 'chapter' && (!a.chapterId || doc.chapterId === a.chapterId))
      return ok(J(docs.map(({ content: _content, ...meta }) => meta)))
    }
    case 'get_chapter_outline': {
      if (!a.outlineId && !a.chapterId) return fail('get_chapter_outline 必须提供 outlineId 或 chapterId，不能猜测目标章纲')
      const docs = (await listOutline(root)).filter((doc) => doc.kind === 'chapter' && (!a.chapterId || doc.chapterId === a.chapterId))
      const value = a.outlineId ? docs.find((doc) => doc.id === a.outlineId) : docs[0]
      return value ? ok(J(value)) : fail('未找到章纲')
    }
    default:
      return fail(`未知工具：${name}`)
  }

  function ok(text: string): ToolOutcome {
    return { kind: 'result', ok: true, text, preview: clip(text) }
  }
}

/* ---------------- 写入工具：生成待确认变更 ---------------- */

interface SimulatedChange {
  entityId: string
  beforeText: string
  afterText: string
  title: string
  commit: () => Promise<string>
}

async function simulateCharacter(root: string, patch: Partial<CharacterDoc> & { id?: string }): Promise<SimulatedChange> {
  const existing = patch.id ? await findCharacter(root, { id: patch.id }) : null
  const newPatch: Partial<CharacterDoc> & { id?: string } = existing ? { ...patch } : { ...patch, id: patch.id ?? genId('char') }
  const afterDoc: CharacterDoc = existing
    ? ({ ...existing, ...Object.fromEntries(Object.entries(newPatch).filter(([, v]) => v !== undefined)) } as CharacterDoc)
    : {
        id: newPatch.id!,
        name: newPatch.name ?? '未命名人物',
        aliases: newPatch.aliases ?? [],
        role: newPatch.role ?? '',
        faction: newPatch.faction ?? '',
        gender: newPatch.gender ?? '',
        age: newPatch.age ?? '',
        tags: newPatch.tags ?? [],
        summary: newPatch.summary ?? '',
        content: newPatch.content ?? ''
      }
  return {
    entityId: afterDoc.id,
    beforeText: existing ? serializeCharacter(existing) : '',
    afterText: serializeCharacter(afterDoc),
    title: `${existing ? '更新' : '新建'}人物卡：${afterDoc.name}`,
    commit: async () => {
      const saved = await saveCharacter(root, newPatch)
      return `已保存人物卡「${saved.name}」（${saved.id}）`
    }
  }
}

async function simulateEvent(root: string, patch: Partial<StoryEvent> & { id?: string }): Promise<SimulatedChange> {
  const all = await listEvents(root)
  const existing = patch.id ? all.find((e) => e.id === patch.id) : null
  const effPatch: Partial<StoryEvent> & { id?: string } = existing ? { ...patch } : { ...patch, id: patch.id ?? genId('evt') }
  const afterDoc: StoryEvent = existing
    ? ({ ...existing, ...Object.fromEntries(Object.entries(effPatch).filter(([, v]) => v !== undefined)) } as StoryEvent)
    : {
        id: effPatch.id!,
        title: effPatch.title ?? '未命名事件',
        storyTime: effPatch.storyTime ?? '',
        order: effPatch.order ?? (all.length ? Math.max(...all.map((x) => x.order)) + 1 : 1),
        location: effPatch.location ?? '',
        tags: effPatch.tags ?? [],
        characterIds: effPatch.characterIds ?? [],
        prevIds: effPatch.prevIds ?? [],
        nextIds: effPatch.nextIds ?? [],
        content: effPatch.content ?? ''
      }
  return {
    entityId: afterDoc.id,
    beforeText: existing ? serializeEvent(existing) : '',
    afterText: serializeEvent(afterDoc),
    title: `${existing ? '更新' : '新建'}事件：${afterDoc.title}`,
    commit: async () => {
      const saved = await saveEvent(root, effPatch)
      return `已保存事件「${saved.title}」（${saved.id}）`
    }
  }
}

async function simulateChapter(root: string, patch: Partial<ChapterDoc> & { id?: string }): Promise<SimulatedChange> {
  const all = await listChapters(root)
  if (patch.box === 'main' && patch.volumeId && !(await listVolumes(root)).some((volume) => volume.id === patch.volumeId)) {
    throw new Error(`未找到目标卷：${patch.volumeId}。请先用工作区卷列表确认有效的 volumeId`)
  }
  const existingMeta = patch.id ? all.find((c) => c.id === patch.id) : null
  const existing = existingMeta
    ? { ...(existingMeta as ChapterDoc), content: (await getChapterBody(root, existingMeta.id)) ?? '' }
    : null
  const effPatch: Partial<ChapterDoc> & { id?: string } = existing ? { ...patch } : { ...patch, id: patch.id ?? genId('cha') }
  const mergedContent = Object.prototype.hasOwnProperty.call(effPatch, 'content')
    ? (effPatch.content ?? '')
    : (existing?.content ?? '')
  const afterDoc: ChapterDoc = existing
    ? ({ ...existing, ...Object.fromEntries(Object.entries(effPatch).filter(([, v]) => v !== undefined)), content: mergedContent } as ChapterDoc)
    : {
        id: effPatch.id!,
        title: effPatch.title ?? '未命名章节',
        volume: effPatch.volume ?? '第一卷',
        volumeId: effPatch.volumeId,
        order: effPatch.order ?? (all.length ? Math.max(...all.map((c) => c.order)) + 1 : 1),
        box: effPatch.box!,
        status: effPatch.status ?? 'draft',
        wordCount: countWords(mergedContent),
        content: mergedContent
      }
  afterDoc.wordCount = countWords(afterDoc.content)
  return {
    entityId: afterDoc.id,
    beforeText: existing ? serializeChapter(existing) : '',
    afterText: serializeChapter(afterDoc),
    title: `${existing ? '更新' : '新建'}章节：${afterDoc.title}`,
    commit: async () => {
      const saved = await saveChapter(root, effPatch)
      return `已保存章节「${saved.title}」（${saved.wordCount} 字）`
    }
  }
}

async function simulateOutline(root: string, patch: Partial<OutlineDoc> & { id?: string }): Promise<SimulatedChange> {
  const all = await listOutline(root)
  if (patch.kind === 'chapter' && patch.chapterId && !(await listChapters(root)).some((chapter) => chapter.id === patch.chapterId)) {
    throw new Error(`未找到章纲关联的章节：${patch.chapterId}。请先用 list_chapters 获取有效 id`)
  }
  const existing = patch.id ? all.find((o) => o.id === patch.id) : null
  const effPatch: Partial<OutlineDoc> & { id?: string } = existing ? { ...patch } : { ...patch, id: patch.id ?? genId('out') }
  const afterDoc: OutlineDoc = existing
    ? ({ ...existing, ...Object.fromEntries(Object.entries(effPatch).filter(([, v]) => v !== undefined)) } as OutlineDoc)
    : {
        id: effPatch.id!,
        title: effPatch.title ?? '未命名大纲',
        order: effPatch.order ?? (all.length ? Math.max(...all.map((o) => o.order)) + 1 : 1),
        kind: effPatch.kind!,
        chapterId: effPatch.chapterId,
        content: effPatch.content ?? ''
      }
  return {
    entityId: afterDoc.id,
    beforeText: existing ? serializeOutlineDoc(existing) : '',
    afterText: serializeOutlineDoc(afterDoc),
    title: `${existing ? '更新' : '新建'}大纲：${afterDoc.title}`,
    commit: async () => {
      const saved = await saveOutlineDoc(root, effPatch)
      return `已保存大纲「${saved.title}」`
    }
  }
}

async function simulateSetting(root: string, patch: Partial<SettingDoc> & { id?: string }): Promise<SimulatedChange> {
  const old = patch.id ? await getSetting(root, patch.id) : null
  const after = (old ? { ...old, ...patch } : { id: patch.id ?? genId('set'), title: patch.title ?? '未命名设定', category: patch.category === 'other' ? 'other' : 'background', tags: patch.tags ?? [], content: patch.content ?? '' }) as SettingDoc
  return { entityId: after.id, beforeText: old ? JSON.stringify(old, null, 2) : '', afterText: JSON.stringify(after, null, 2), title: `${old ? '更新' : '新建'}设定：${after.title}`, commit: async () => `已保存设定「${(await saveSetting(root, patch)).title}」` }
}

async function simulateNote(root: string, patch: Partial<NoteDoc> & { id?: string }): Promise<SimulatedChange> {
  const old = patch.id ? await getNote(root, patch.id) : null
  const now = Date.now()
  const after = (old ? { ...old, ...patch } : { id: patch.id ?? genId('note'), title: patch.title ?? '未命名便签', tags: patch.tags ?? [], pinned: Boolean(patch.pinned), createdAt: patch.createdAt ?? now, updatedAt: now, content: patch.content ?? '' }) as NoteDoc
  return { entityId: after.id, beforeText: old ? JSON.stringify(old, null, 2) : '', afterText: JSON.stringify(after, null, 2), title: `${old ? '更新' : '新建'}便签：${after.title}`, commit: async () => `已保存便签「${(await saveNote(root, patch)).title}」` }
}

async function simulateDeleteNote(root: string, noteId: unknown): Promise<SimulatedChange> {
  const normalizedId = typeof noteId === 'string' ? noteId.trim() : ''
  if (!normalizedId) throw new Error('delete_note 必须提供有效 noteId')
  const note = await getNote(root, normalizedId)
  if (!note) throw new Error(`未找到便签：${normalizedId}`)
  return {
    entityId: note.id,
    beforeText: serializeNote(note),
    afterText: '移入回收站',
    title: `删除便签：${note.title}`,
    commit: async () => {
      await deleteNote(root, normalizedId)
      return `已将便签「${note.title}」移入回收站`
    }
  }
}

async function simulateRelationship(
  root: string,
  input: { fromCharacterId: string; toCharacterId: string; type: string; label?: string; description?: string; directed?: boolean }
): Promise<SimulatedChange> {
  const chars = await listCharacters(root)
  const from = chars.find((c) => c.id === input.fromCharacterId)
  const to = chars.find((c) => c.id === input.toCharacterId)
  if (!from || !to) throw new Error(`人物不存在：${!from ? input.fromCharacterId : input.toCharacterId}。请先用 list_characters 获取有效 id。`)
  const oldList = await loadRelationships(root)
  const newList = [
    ...oldList,
    {
      id: genId('rel'),
      fromId: input.fromCharacterId,
      toId: input.toCharacterId,
      type: input.type ?? '',
      label: input.label ?? '',
      description: input.description ?? '',
      directed: Boolean(input.directed)
    }
  ]
  const nameOf = (id: string) => chars.find((c) => c.id === id)?.name ?? id
  return {
    entityId: 'relationships',
    beforeText: oldList.length ? serializeRelationships(oldList, nameOf) : '（当前无关系数据）',
    afterText: serializeRelationships(newList, nameOf),
    title: `新增关系：${from.name} → ${to.name}【${input.type}】`,
    commit: async () => {
      await saveRelationships(root, newList)
      return `已保存关系：${from.name} ⇄ ${to.name}`
    }
  }
}

/* ---------------- 统一入口 ---------------- */

export async function executeTool(root: string, name: string, argsJson: string): Promise<ToolOutcome> {
  const a = argsOf(argsJson)
  try {
    if (!WRITE_TOOLS.has(name)) return await runReadTool(root, name, a)

    let sim: SimulatedChange
    switch (name) {
      case 'save_character':
        if (!a.character?.name && !a.character?.id) throw new Error('character 必须包含 name 或 id')
        sim = await simulateCharacter(root, a.character)
        break
      case 'save_relationship':
        if (!a.relationship?.fromCharacterId || !a.relationship?.toCharacterId) throw new Error('relationship 缺少 fromCharacterId / toCharacterId')
        sim = await simulateRelationship(root, a.relationship)
        break
      case 'save_event':
        if (!a.event?.title && !a.event?.id) throw new Error('event 必须包含 title 或 id')
        sim = await simulateEvent(root, a.event)
        break
      case 'save_outline_doc':
        if (!a.doc?.title && !a.doc?.id) throw new Error('doc 必须包含 title 或 id')
        validateAgentOutlineWrite(a.doc)
        sim = await simulateOutline(root, a.doc)
        break
      case 'save_chapter':
        if (!a.chapter?.title && !a.chapter?.id) throw new Error('chapter 必须包含 title 或 id')
        validateAgentChapterWrite(a.chapter)
        sim = await simulateChapter(root, a.chapter)
        break
      case 'save_setting':
        if (!a.setting?.title && !a.setting?.id) throw new Error('setting 必须包含 title 或 id')
        sim = await simulateSetting(root, a.setting)
        break
      case 'save_note':
        if (!a.note?.title && !a.note?.id) throw new Error('note 必须包含 title 或 id')
        sim = await simulateNote(root, a.note)
        break
      case 'delete_note':
        sim = await simulateDeleteNote(root, a.noteId)
        break
      case 'move_chapter': {
        const chapterId = String(a.chapterId ?? '')
        const targetBox = a.box === 'draft' ? 'draft' : a.box === 'main' ? 'main' : ''
        if (!chapterId || !targetBox) throw new Error('chapterId 或 box 无效')
        validateAgentChapterMove({ box: targetBox, volumeId: a.volumeId })
        const current = (await listChapters(root)).find((chapter) => chapter.id === chapterId)
        if (!current) throw new Error(`未找到章节：${chapterId}`)
        const target = { box: targetBox, ...(a.volumeId ? { volumeId: String(a.volumeId) } : {}) } as { box: 'draft' | 'main'; volumeId?: string }
        sim = { entityId: chapterId, title: `移动章节：${current.title}`, beforeText: JSON.stringify(current, null, 2), afterText: JSON.stringify({ ...current, ...target }, null, 2), commit: async () => { await moveChapter(root, chapterId, target); return `已移动章节「${current.title}」` } }
        break
      }
      case 'restore_from_trash': {
        const id = String(a.id ?? '')
        const entry = (await listTrash(root)).find((item) => item.id === id)
        if (!entry) throw new Error(`回收站中未找到实体：${id}`)
        sim = { entityId: id, title: `恢复：${entry.title}`, beforeText: JSON.stringify(entry, null, 2), afterText: `恢复到 ${entry.originalPath}`, commit: async () => { await restoreTrash(root, id); return `已恢复「${entry.title}」` } }
        break
      }
      default:
        throw new Error(`未知工具：${name}`)
    }

    const change: PendingChange = {
      id: genId('chg'),
      toolName: name,
      entityKind: name === 'save_character' ? 'character' : name === 'save_relationship' ? 'relationship' : name === 'save_event' ? 'event' : name === 'save_chapter' || name === 'move_chapter' ? 'chapter' : name === 'save_setting' ? 'setting' : name === 'save_note' || name === 'delete_note' ? 'note' : name === 'restore_from_trash' ? 'chapter' : 'outline',
      entityId: sim.entityId,
      title: sim.title,
      beforeText: sim.beforeText,
      afterText: sim.afterText
    }
    return {
      kind: 'pending',
      change,
      apply: async () => {
        const msg = await sim.commit()
        return { ok: true, text: msg }
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { kind: 'result', ok: false, text: `工具执行失败：${msg}`, preview: clip(msg) }
  }
}
