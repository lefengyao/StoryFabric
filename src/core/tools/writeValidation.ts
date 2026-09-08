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
  if (chapter.box !== 'draft' && chapter.box !== 'main') {
    throw new Error('save_chapter 必须明确指定 box：draft（草稿箱）或 main（正文箱），不能省略')
  }
  if (chapter.box === 'main' && !nonEmptyString(chapter.volumeId)) {
    throw new Error('save_chapter 写入正文箱时必须明确指定有效的 volumeId；移动已有章节请使用 move_chapter')
  }
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

/**
 * Agent-only outline contract. `kind` is the physical/document destination
 * selector; a chapter outline is always tied to one concrete chapter.
 */
export function validateAgentOutlineWrite(value: unknown): void {
  const doc = asRecord(value, 'doc')
  if (doc.kind !== 'total' && doc.kind !== 'chapter') {
    throw new Error('save_outline_doc 必须明确指定 kind：total（总纲）或 chapter（章纲），不能省略')
  }
  if (doc.kind === 'chapter' && !nonEmptyString(doc.chapterId)) {
    throw new Error('章纲必须明确指定 chapterId；请先用 list_chapters 获取目标章节 id')
  }
  if (doc.kind === 'total' && doc.chapterId !== undefined) {
    throw new Error('总纲不能携带 chapterId；章纲请使用 kind: chapter')
  }
}
