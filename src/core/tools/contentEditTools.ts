import type { EntityKind, PendingChange, ToolDefJson } from '../../shared/types'
import { saveDocument } from '../workspace/documentWrites'
import { parseFrontMatter } from '../workspace/frontMatter'
import type { FileStore } from '../storage/fileStore'
import { isPlainTextDocument } from '../inspiration/documentFormats'
import { invalidateProjectIndex } from '../retrieval'
import { loadCharacterDocuments, loadEventDocuments, loadNoteDocuments, loadOutlineDocuments, loadSettingDocuments } from '../workspace/entityStore'
import { commitTextChanges } from '../workspace/mutationJournal'
import { coordinatorFor } from '../workspace/mutationCoordinator'
import { normalizeProjectDocPath } from '../workspace/projectDocs'
import { contentRevision } from '../workspace/resourceRevision'
import type { ToolOutcome } from './registry'
import { assertDocumentReadSourceUnchanged, checkDocumentReadRevision } from '../retrieval/documentReadRevision'
import { DOCUMENT_READ_BASELINE_SCHEMA } from './writeSchemas'

type EditableKind = Exclude<EntityKind, 'chapter'>
const MAX_SOURCE_BYTES = 5 * 1024 * 1024
const FRONT_MATTER = /^(?:\uFEFF)?---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/
const KINDS: EditableKind[] = ['character', 'event', 'outline', 'setting', 'note', 'projectDoc']

export const CONTENT_EDIT_TOOL_DEFS: ToolDefJson[] = [
  {
    name: 'read_content_lines',
    description: '按行读取人物、事件、大纲、设定、便签正文或纯文本 docs；返回行号、局部编辑用 writeRevision 和分页用 readRevision。后续页将 readRevision 作为 expectedRevision 防止混读。章节使用 get_chapter/edit_chapter。id 为实体 id，projectDoc 的 id 为 docs 内相对路径。',
    parameters: { type: 'object', additionalProperties: false, properties: {
      kind: { type: 'string', enum: KINDS }, id: { type: 'string', minLength: 1 },
      lineStart: { type: 'integer', minimum: 1 }, maxLines: { type: 'integer', minimum: 1, maximum: 200 },
      expectedRevision: { type: 'string', minLength: 1 }
    }, required: ['kind', 'id'] }
  },
  {
    name: 'edit_content',
    description: '只修改指定资料的正文或纯文本 docs 中的唯一片段/精确行范围，保留元数据和其他正文。baseRevision 必须来自刚调用的 read_content_lines；replacement 为空时删除。需要用户确认。',
    parameters: { type: 'object', additionalProperties: false, properties: {
      kind: { type: 'string', enum: KINDS }, id: { type: 'string', minLength: 1 },
      baseRevision: { type: 'string', minLength: 1 }, expectedText: { type: 'string', minLength: 1 },
      baseReadRevision: DOCUMENT_READ_BASELINE_SCHEMA,
      lineStart: { type: 'integer', minimum: 1 }, lineEnd: { type: 'integer', minimum: 1 },
      replacement: { type: 'string' }
    }, required: ['kind', 'id', 'baseRevision', 'replacement'] }
  }
]

function assertKind(value: unknown): EditableKind {
  if (typeof value !== 'string' || !KINDS.includes(value as EditableKind)) throw new Error('不支持的正文类型')
  return value as EditableKind
}

async function sourcePath(store: FileStore, kind: EditableKind, id: string): Promise<string> {
  if (!id.trim() || id !== id.trim()) throw new Error('id 不能为空或带首尾空格')
  if (kind === 'projectDoc') {
    const path = normalizeProjectDocPath(id)
    if (!isPlainTextDocument(path)) throw new Error('只有纯文本项目文档可以按行编辑')
    return `docs/${path}`
  }
  const loaders = {
    character: loadCharacterDocuments, event: loadEventDocuments, outline: loadOutlineDocuments,
    setting: loadSettingDocuments, note: loadNoteDocuments
  }
  const entry = (await loaders[kind](store)).find((item) => item.doc.id === id)
  if (!entry) throw new Error(`未找到${kind}：${id}`)
  const folders = { character: 'characters', event: 'events', outline: 'outline', setting: 'settings', note: 'notes' }
  return `${folders[kind]}/${entry.fileName}`
}

async function loadSource(store: FileStore, kind: EditableKind, id: string): Promise<{ path: string; raw: string; prefix: string; body: string }> {
  const path = await sourcePath(store, kind, id)
  const size = await store.fileSize(path)
  if (size === null) throw new Error(`未找到文件：${path}`)
  if (size > MAX_SOURCE_BYTES) throw new Error(`文件超过局部编辑上限 ${MAX_SOURCE_BYTES} 字节：${path}`)
  const result = await store.readTextStrict(path)
  if (!result.ok) throw new Error(result.code === 'TEXT_DECODE_ERROR' ? `文件不是纯文本：${path}` : `无法读取文件：${path}`)
  const raw = result.text
  if (kind === 'projectDoc') return { path, raw, prefix: '', body: raw }
  const match = FRONT_MATTER.exec(raw)
  if (!match) throw new Error(`资料文件缺少有效元数据：${path}`)
  let prefix = match[0]
  if (raw.slice(prefix.length).startsWith('\r\n')) prefix += '\r\n'
  else if (raw.slice(prefix.length).startsWith('\n')) prefix += '\n'
  return { path, raw, prefix, body: raw.slice(prefix.length) }
}

function lineStarts(body: string): number[] {
  const starts = [0]
  for (const match of body.matchAll(/\r\n|\n/g)) starts.push(match.index + match[0].length)
  return starts
}

function lineText(body: string, starts: number[], line: number): string {
  const start = starts[line - 1]
  const end = line < starts.length ? starts[line] : body.length
  return body.slice(start, end).replace(/\r?\n$/, '')
}

function patchBody(body: string, args: Record<string, unknown>): { after: string; lineStart: number; lineEnd: number; start: number; end: number } {
  const expected = args.expectedText
  const hasLines = args.lineStart !== undefined || args.lineEnd !== undefined
  if ((expected !== undefined) === hasLines) throw new Error('必须且只能提供 expectedText 或 lineStart/lineEnd')
  const replacement = args.replacement as string
  if (typeof expected === 'string') {
    const start = body.indexOf(expected)
    if (start < 0) throw new Error('前置文本不存在，请重新读取')
    if (body.indexOf(expected, start + 1) >= 0) throw new Error('AMBIGUOUS_TARGET：前置文本出现多次，请改用行号')
    const lineStart = lineStarts(body.slice(0, start)).length
    const lineEnd = lineStarts(body.slice(0, start + expected.length)).length
    const eol = body.includes('\r\n') ? '\r\n' : '\n'
    const inserted = replacement.replace(/\r\n|\n/g, eol)
    return { after: body.slice(0, start) + inserted + body.slice(start + expected.length), lineStart, lineEnd, start, end: start + expected.length }
  }
  const lineStart = args.lineStart
  const lineEnd = args.lineEnd
  const starts = lineStarts(body)
  if (!Number.isInteger(lineStart) || !Number.isInteger(lineEnd) || (lineStart as number) < 1 || (lineEnd as number) < (lineStart as number) || (lineEnd as number) > starts.length) {
    throw new Error(`正文行范围无效：${lineStart}-${lineEnd}，共 ${starts.length} 行`)
  }
  const first = lineStart as number
  const last = lineEnd as number
  const start = starts[first - 1]
  const end = last < starts.length ? starts[last] : body.length
  const eol = body.includes('\r\n') ? '\r\n' : '\n'
  const normalized = replacement.replace(/\r\n|\n/g, eol)
  const inserted = normalized ? normalized + (last < starts.length ? eol : '') : ''
  return { after: body.slice(0, start) + inserted + body.slice(end), lineStart: first, lineEnd: last, start, end }
}

export async function executeContentEditTool(store: FileStore, name: string, args: Record<string, unknown>): Promise<ToolOutcome> {
  const kind = assertKind(args.kind)
  const id = args.id as string
  const source = await loadSource(store, kind, id)
  if (name === 'read_content_lines') {
    const revision = contentRevision(source.raw)
    const sourceRevision = checkDocumentReadRevision(store, kind, id, source.raw, revision, args.expectedRevision as string | undefined)
    if (!sourceRevision.matches) throw new Error('SOURCE_CHANGED：分页期间正文版本已变化，请从首行重新读取')
    const starts = lineStarts(source.body)
    const first = (args.lineStart as number | undefined) ?? 1
    if (first > starts.length) throw new Error(`起始行超出正文：共 ${starts.length} 行`)
    const last = Math.min(starts.length, first + ((args.maxLines as number | undefined) ?? 80) - 1)
    const lines = Array.from({ length: last - first + 1 }, (_, index) => ({ number: first + index, text: lineText(source.body, starts, first + index) }))
    const offset = source.prefix.length + starts[first - 1]
    const end = last < starts.length ? source.prefix.length + starts[last] : source.raw.length
    const payload = { kind, id, sourcePath: source.path, offset, length: end - offset, complete: first === 1 && last === starts.length, lines, totalLines: starts.length, ...(last < starts.length ? { nextLine: last + 1 } : {}), writeRevision: revision, readRevision: sourceRevision.readRevision }
    return { kind: 'result', ok: true, text: JSON.stringify(payload), preview: `${kind} ${id} 第 ${first}-${last} 行` }
  }
  if (name !== 'edit_content') throw new Error(`未知正文工具：${name}`)
  if (contentRevision(source.raw) !== args.baseRevision) throw new Error('SOURCE_CHANGED：正文版本已变化，请重新读取行号')
  if (kind === 'outline' || args.baseReadRevision !== undefined) assertDocumentReadSourceUnchanged(store, kind, id, source.raw, args.baseRevision as string, args.baseReadRevision as string | undefined)
  const edit = patchBody(source.body, args)
  if (edit.after === source.body) throw new Error('正文没有变化')
  const afterRaw = source.prefix + edit.after
  if (new TextEncoder().encode(afterRaw).byteLength > MAX_SOURCE_BYTES) throw new Error('修改后文件超过局部编辑上限')
  const contextStart = Math.max(0, edit.start - 800)
  const contextEnd = Math.min(source.body.length, edit.end + 800)
  const beforePreview = source.body.slice(contextStart, contextEnd)
  const afterPreview = edit.after.slice(contextStart, contextEnd + edit.after.length - source.body.length)
  const change: PendingChange = {
    id: `chg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    toolName: name, entityKind: kind, entityId: id,
    title: `修改${kind === 'projectDoc' ? '项目文档' : '资料'}正文：${id} 第 ${edit.lineStart}-${edit.lineEnd} 行`,
    beforeText: beforePreview, afterText: afterPreview
  }
  if (kind === 'outline') {
    change.historyEligible = true
    return { kind: 'pending', change, apply: async (decision) => {
      if (typeof decision?.saveHistory !== 'boolean') throw new Error('请选择是否保存为长期历史版本')
      const parsed = parseFrontMatter(afterRaw)
      try {
      const saved = await saveDocument(store, 'outline', { ...parsed.data, id, content: parsed.content.replace(/^\n+/, '') }, {
        baseRevision: contentRevision(source.raw), baseText: source.raw, sourcePath: source.path,
        ...(decision.saveHistory ? { history: { source: 'agent' as const } } : {})
      })
      return { ok: true, text: `已修改大纲「${saved.title}」${decision.saveHistory ? '并保存为新版本' : ''}` }
      } catch (error) {
        return { ok: false, text: `正文提交失败，请重新读取：${error instanceof Error ? error.message : String(error)}` }
      }
    } }
  }
  return { kind: 'pending', change, apply: () => coordinatorFor(store).run(kind === 'event' ? 'event-graph' : `${kind}:${id}`, async () => {
    const current = await store.readText(source.path)
    if (current !== source.raw) return { ok: false, text: `正文已在等待期间修改，请重新读取：${id}` }
    const result = await commitTextChanges(store, `content-${Date.now()}-${Math.random().toString(36).slice(2)}`, [{ path: source.path, beforeText: source.raw, afterText: afterRaw }], () => invalidateProjectIndex(store))
    return result.ok ? { ok: true, text: `已修改正文：${id} 第 ${edit.lineStart}-${edit.lineEnd} 行` } : result
  }) }
}
