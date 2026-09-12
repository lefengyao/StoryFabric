import type { EntityKind, PendingChange } from '../../shared/types'
import type { FileStore } from '../storage/fileStore'
import {
  deleteChapter,
  deleteCharacter,
  deleteEvent,
  deleteNote,
  deleteOutlineDoc,
  deleteSetting,
  findCharacter,
  getChapterBody,
  getNote,
  getSetting,
  genId,
  listChapters,
  listEvents,
  listOutline,
  serializeChapter,
  serializeCharacter,
  serializeEvent,
  serializeNote,
  serializeOutlineDoc,
  serializeSetting
} from '../workspace/entityStore'
import { normalizeProjectDocPath } from '../workspace/projectDocs'
import type { ToolOutcome } from './registry'

export type DeleteEntityKind = Exclude<EntityKind, 'projectDoc'> | 'projectDoc'

const TRASH_KINDS = new Set<Exclude<EntityKind, 'projectDoc'>>([
  'character',
  'outline',
  'event',
  'chapter',
  'setting',
  'note'
])

const LABELS: Record<DeleteEntityKind, string> = {
  character: '人物卡',
  outline: '大纲',
  event: '事件',
  chapter: '章节',
  setting: '设定',
  note: '便签',
  projectDoc: '项目文档'
}

function fail(message: string): never {
  throw new Error(message)
}

function isDeleteKind(value: unknown): value is DeleteEntityKind {
  return typeof value === 'string' && value in LABELS
}

function validateArgs(args: Record<string, unknown>): { kind: DeleteEntityKind; id: string } {
  if (!isDeleteKind(args.kind)) fail('delete_entity 的 kind 必须是 character、outline、event、chapter、setting、note 或 projectDoc')
  if (typeof args.id !== 'string' || !args.id.trim()) fail('delete_entity 必须提供有效 id')
  return { kind: args.kind, id: args.id.trim() }
}

interface Target {
  id: string
  title: string
  beforeText: string
  kind: DeleteEntityKind
  commit: () => Promise<{ ok: boolean; text: string }>
}

async function resolveTarget(store: FileStore, kind: DeleteEntityKind, id: string): Promise<Target> {
  if (kind === 'character') {
    const value = await findCharacter(store, { id })
    if (!value) fail(`未找到人物：${id}`)
    return { id: value.id, kind, title: value.name, beforeText: serializeCharacter(value), commit: async () => { await deleteCharacter(store, value.id); return { ok: true, text: `已将人物卡「${value.name}」移入回收站` } } }
  }
  if (kind === 'outline') {
    const value = (await listOutline(store)).find((item) => item.id === id)
    if (!value) fail(`未找到大纲：${id}`)
    return { id: value.id, kind, title: value.title, beforeText: serializeOutlineDoc(value), commit: async () => { await deleteOutlineDoc(store, value.id); return { ok: true, text: `已将大纲「${value.title}」移入回收站` } } }
  }
  if (kind === 'event') {
    const value = (await listEvents(store)).find((item) => item.id === id)
    if (!value) fail(`未找到事件：${id}`)
    return { id: value.id, kind, title: value.title, beforeText: serializeEvent(value), commit: async () => { await deleteEvent(store, value.id); return { ok: true, text: `已将事件「${value.title}」移入回收站` } } }
  }
  if (kind === 'chapter') {
    const meta = (await listChapters(store)).find((item) => item.id === id)
    if (!meta) fail(`未找到章节：${id}`)
    const value = { ...meta, content: (await getChapterBody(store, meta.id)) ?? '' }
    return { id: value.id, kind, title: value.title, beforeText: serializeChapter(value), commit: async () => { await deleteChapter(store, value.id); return { ok: true, text: `已将章节「${value.title}」移入回收站` } } }
  }
  if (kind === 'setting') {
    const value = await getSetting(store, id)
    if (!value) fail(`未找到设定：${id}`)
    return { id: value.id, kind, title: value.title, beforeText: serializeSetting(value), commit: async () => { await deleteSetting(store, value.id); return { ok: true, text: `已将设定「${value.title}」移入回收站` } } }
  }
  if (kind === 'note') {
    const value = await getNote(store, id)
    if (!value) fail(`未找到便签：${id}`)
    return { id: value.id, kind, title: value.title, beforeText: serializeNote(value), commit: async () => { await deleteNote(store, value.id); return { ok: true, text: `已将便签「${value.title}」移入回收站` } } }
  }

  const path = normalizeProjectDocPath(id)
  const current = await store.readText(`docs/${path}`)
  if (current === null) fail(`未找到项目文档：${path}`)
  return {
    id: path,
    kind,
    title: path,
    beforeText: current,
    commit: async () => {
      const latest = await store.readText(`docs/${path}`)
      if (latest !== current) return { ok: false, text: `项目文档已被修改，未删除：${path}` }
      await store.remove(`docs/${path}`)
      return { ok: true, text: `已直接删除项目文档「${path}」（该类型没有回收站）` }
    }
  }
}

export async function executeDeleteEntityTool(store: FileStore, rawArgs: Record<string, unknown>): Promise<ToolOutcome> {
  const { kind, id } = validateArgs(rawArgs)
  const target = await resolveTarget(store, kind, id)
  const trashBacked = TRASH_KINDS.has(kind as Exclude<EntityKind, 'projectDoc'>)
  const change: PendingChange = {
    id: genId('chg'),
    toolName: 'delete_entity',
    entityKind: kind,
    entityId: target.id,
    title: `删除${LABELS[kind]}：${target.title}`,
    beforeText: target.beforeText,
    afterText: trashBacked ? '确认后移入回收站' : '确认后直接删除（此类型没有回收站）'
  }
  return { kind: 'pending', change, apply: target.commit }
}
