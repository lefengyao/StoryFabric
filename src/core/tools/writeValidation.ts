import { resolveChapterPlacement } from '../../shared/chapterPlacement'
import type { ChapterBox, ChapterStatus } from '../../shared/types'

type RecordValue = Record<string, unknown>

function asRecord(value: unknown, label: string): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} 必须是对象`)
  }
  return value as RecordValue
}

function nonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Agent-only write contract. The storage layer keeps its historical defaults
 * for direct UI callers, but agent writes must never rely on an implicit box.
 */
export function validateAgentChapterWrite(value: unknown): void {
  const chapter = asRecord(value, 'chapter')
  if (!nonEmptyString(chapter.id) && !nonEmptyString(chapter.title)) {
    throw new Error('新建章节必须提供 title；更新章节必须提供有效 id')
  }
  if (chapter.box !== 'draft' && chapter.box !== 'main') {
    throw new Error('save_chapter 必须明确指定 box：draft（草稿箱）或 main（正文箱），不能省略')
  }
  if (chapter.box === 'main' && !nonEmptyString(chapter.volumeId)) {
    throw new Error('save_chapter 写入正文箱时必须明确指定有效的 volumeId；移动已有章节请使用 move_chapter')
  }
  resolveChapterPlacement(null, { box: chapter.box as ChapterBox, status: chapter.status as ChapterStatus | undefined })
}

export function validateAgentChapterMove(value: unknown): void {
  const target = asRecord(value, 'move_chapter')
  if (target.box !== 'draft' && target.box !== 'main') {
    throw new Error('move_chapter 必须指定 box：draft 或 main')
  }
  if (target.box === 'main' && !nonEmptyString(target.volumeId)) {
    throw new Error('move_chapter 移入正文箱时必须指定 volumeId')
  }
}

export function validateAgentChapterEdit(value: unknown): void {
  const edit = asRecord(value, 'edit_chapter')
  if (!nonEmptyString(edit.chapterId)) throw new Error('edit_chapter 必须提供有效 chapterId')
  if (!nonEmptyString(edit.baseRevision)) throw new Error('edit_chapter 必须提供 baseRevision；请先读取章节')
  if (typeof edit.replacement !== 'string') throw new Error('edit_chapter 必须提供 replacement 字符串')
  const hasExpected = typeof edit.expectedText === 'string'
  const hasLines = Number.isInteger(edit.lineStart) || Number.isInteger(edit.lineEnd)
  if (hasExpected === hasLines) throw new Error('edit_chapter 必须在 expectedText 或 lineStart+lineEnd 中二选一')
  if (hasLines && (!Number.isInteger(edit.lineStart) || !Number.isInteger(edit.lineEnd) || Number(edit.lineStart) < 1 || Number(edit.lineEnd) < Number(edit.lineStart))) {
    throw new Error('edit_chapter 的 lineStart/lineEnd 必须是有效的 1 起始行范围')
  }
  if (hasExpected && !String(edit.expectedText).length) throw new Error('edit_chapter 的 expectedText 不能为空')
}

export function validateAgentCharacterWrite(value: unknown): void {
  const character = asRecord(value, 'character')
  if (!nonEmptyString(character.id) && !nonEmptyString(character.name)) {
    throw new Error('新建人物必须提供 name；更新人物必须提供有效 id')
  }
}

export function validateAgentEventWrite(value: unknown): void {
  const event = asRecord(value, 'event')
  if (!nonEmptyString(event.id) && !nonEmptyString(event.title)) {
    throw new Error('新建事件必须提供 title；更新事件必须提供有效 id')
  }
  if (!nonEmptyString(event.id) && !nonEmptyString(event.volumeId)) {
    throw new Error('新建事件必须明确指定有效的 volumeId；请先用 list_volumes 获取卷 id')
  }
  if (Array.isArray(event.nextIds) && event.nextIds.length > 1) {
    throw new Error('同一主线或分支最多只能有一个后续事件，分支不允许合流')
  }
  if (Array.isArray(event.prevIds) && event.prevIds.length > 1) {
    throw new Error('同一事件最多只能有一个前置事件，分支不允许合流')
  }
}

export function validateAgentRelationshipWrite(value: unknown): void {
  const relationship = asRecord(value, 'relationship')
  if (!nonEmptyString(relationship.fromCharacterId) || !nonEmptyString(relationship.toCharacterId)) {
    throw new Error('relationship 必须提供 fromCharacterId 和 toCharacterId')
  }
}

export function validateAgentSettingWrite(value: unknown): void {
  const setting = asRecord(value, 'setting')
  if (!nonEmptyString(setting.id) && !nonEmptyString(setting.title)) {
    throw new Error('新建设定必须提供 title；更新设定必须提供有效 id')
  }
}

export function validateAgentNoteWrite(value: unknown): void {
  const note = asRecord(value, 'note')
  if (!nonEmptyString(note.id) && !nonEmptyString(note.title)) {
    throw new Error('新建便签必须提供 title；更新便签必须提供有效 id')
  }
}

/**
 * Agent-only outline contract. `kind` is the physical/document destination
 * selector; a chapter outline is always tied to one concrete chapter.
 */
export function validateAgentOutlineWrite(value: unknown): void {
  const doc = asRecord(value, 'doc')
  if (!nonEmptyString(doc.id) && !nonEmptyString(doc.title)) {
    throw new Error('新建大纲必须提供 title；更新大纲必须提供有效 id')
  }
  if (doc.kind !== 'total' && doc.kind !== 'chapter') {
    throw new Error('save_outline_doc 必须明确指定 kind：total（总纲）或 chapter（章纲），不能省略')
  }
  if (doc.kind === 'chapter' && doc.chapterId !== undefined && typeof doc.chapterId !== 'string') {
    throw new Error('章纲的 chapterId 必须是字符串；省略或留空表示尚未关联章节')
  }
  if (doc.kind === 'total' && doc.chapterId !== undefined) {
    throw new Error('总纲不能携带 chapterId；章纲请使用 kind: chapter')
  }
}
