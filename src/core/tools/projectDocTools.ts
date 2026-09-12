import type { FileStore } from '../storage/fileStore'
import type { EntityKind, PendingChange, ToolDefJson } from '../../shared/types'
import { applyProjectDocSnapshot, listProjectDocs, readProjectDoc, snapshotProjectDoc } from '../workspace/projectDocs'
import type { ToolOutcome } from './registry'

export const PROJECT_DOC_TOOL_DEFS: ToolDefJson[] = [
  { name: 'list_project_docs', description: '列出 docs 中的项目规划和临时参考文档，不返回正文。', parameters: { type: 'object', additionalProperties: false, properties: { offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 100 } } } },
  { name: 'read_project_doc', description: '按需读取 docs 中的一篇 Markdown 或 TXT 文档，支持分段读取。', parameters: { type: 'object', additionalProperties: false, properties: { path: { type: 'string' }, offset: { type: 'integer', minimum: 0 }, maxChars: { type: 'integer', minimum: 1, maximum: 50000 } }, required: ['path'] } },
  { name: 'save_project_doc', description: '保存 docs 中的一篇 Markdown 或 TXT 文档；需要用户确认。', parameters: { type: 'object', additionalProperties: false, properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } }
]

const known: Record<string, string[]> = {
  list_project_docs: ['offset', 'limit'],
  read_project_doc: ['path', 'offset', 'maxChars'],
  save_project_doc: ['path', 'content']
}

function clip(text: string, max = 160): string { return text.length > max ? `${text.slice(0, max)}…` : text }
function validateArgs(name: string, args: Record<string, unknown>): void {
  const allowed = known[name] ?? []
  const extra = Object.keys(args).find((key) => !allowed.includes(key))
  if (extra) throw new Error(`${name} 不接受参数：${extra}`)
}

export async function executeProjectDocTool(store: FileStore, name: string, args: Record<string, unknown>): Promise<ToolOutcome> {
  validateArgs(name, args)
  if (name === 'list_project_docs') return { kind: 'result', ok: true, text: JSON.stringify(await listProjectDocs(store, args.offset as number | undefined, args.limit as number | undefined)), preview: '项目文档列表' }
  if (name === 'read_project_doc') {
    const result = await readProjectDoc(store, args.path, args.offset as number | undefined, args.maxChars as number | undefined)
    return { kind: 'result', ok: true, text: JSON.stringify(result), preview: clip(result.content) }
  }
  if (name !== 'save_project_doc') throw new Error(`未知项目文档工具：${name}`)
  const snapshot = await snapshotProjectDoc(store, args.path, args.content)
  const change: PendingChange = {
    id: `chg_${Date.now().toString(36)}`,
    toolName: name,
    entityKind: 'projectDoc' as EntityKind,
    entityId: snapshot.path,
    title: `${snapshot.existed ? '更新' : '新建'}项目文档：${snapshot.path}`,
    beforeText: snapshot.beforeText,
    afterText: snapshot.afterText
  }
  return { kind: 'pending', change, apply: () => applyProjectDocSnapshot(store, snapshot) }
}
