/**
 * 智能体工具注册表：读取工具直接执行；写入工具只生成「待确认变更」，
 * 由用户在界面确认后才真正落盘（commit）。
 */
import type { ChapterDoc, CharacterDoc, OutlineDoc, PendingChange, StoryEvent, ToolDefJson } from '../../shared/types'
import {
  countWords,
  findCharacter,
  genId,
  getChapterBody,
  listCharacters,
  listChapters,
  listEvents,
  listOutline,
  loadRelationships,
  saveChapter,
  saveCharacter,
  saveEvent,
  saveOutlineDoc,
  saveRelationships,
  searchProject,
  serializeChapter,
  serializeCharacter,
  serializeEvent,
  serializeOutlineDoc,
  serializeRelationships
} from '../services/entityStore'

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
    description: '新建或更新一篇大纲文档（Markdown）。',
    parameters: {
      type: 'object',
      properties: {
        doc: {
          type: 'object',
          properties: {
            id: { type: 'string', description: '更新已有文档时必填' },
            title: { type: 'string' },
            order: { type: 'number' },
            content: { type: 'string' }
          },
          required: ['title']
        }
      },
      required: ['doc']
    }
  },
  {
    name: 'save_chapter',
    description: '新建或更新章节正文。续写时应先 get_chapter 读原文，再提交包含衔接处的完整正文。',
    parameters: {
      type: 'object',
      properties: {
        chapter: {
          type: 'object',
          properties: {
            id: { type: 'string', description: '更新已有章节时必填' },
            title: { type: 'string' },
            volume: { type: 'string' },
            order: { type: 'number' },
            status: { type: 'string', enum: ['draft', 'revised', 'final'] },
            content: { type: 'string', description: '章节完整正文' }
          },
          required: ['title']
        }
      },
      required: ['chapter']
    }
  }
]

export const WRITE_TOOLS = new Set(['save_character', 'save_relationship', 'save_event', 'save_outline_doc', 'save_chapter'])

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
      const docs = await listOutline(root)
      return ok(docs.length ? J(docs.map((d) => ({ id: d.id, title: d.title, order: d.order, content: d.content }))) : '大纲为空')
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
        order: effPatch.order ?? (all.length ? Math.max(...all.map((c) => c.order)) + 1 : 1),
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
  const existing = patch.id ? all.find((o) => o.id === patch.id) : null
  const effPatch: Partial<OutlineDoc> & { id?: string } = existing ? { ...patch } : { ...patch, id: patch.id ?? genId('out') }
  const afterDoc: OutlineDoc = existing
    ? ({ ...existing, ...Object.fromEntries(Object.entries(effPatch).filter(([, v]) => v !== undefined)) } as OutlineDoc)
    : {
        id: effPatch.id!,
        title: effPatch.title ?? '未命名大纲',
        order: effPatch.order ?? (all.length ? Math.max(...all.map((o) => o.order)) + 1 : 1),
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
        sim = await simulateOutline(root, a.doc)
        break
      case 'save_chapter':
        if (!a.chapter?.title && !a.chapter?.id) throw new Error('chapter 必须包含 title 或 id')
        sim = await simulateChapter(root, a.chapter)
        break
      default:
        throw new Error(`未知工具：${name}`)
    }

    const change: PendingChange = {
      id: genId('chg'),
      toolName: name,
      entityKind: name === 'save_character' ? 'character' : name === 'save_relationship' ? 'relationship' : name === 'save_event' ? 'event' : name === 'save_chapter' ? 'chapter' : 'outline',
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
