import type { FileStore } from '../storage/fileStore'
import type { EntityKind, PendingChange, ToolDefJson } from '../../shared/types'
import { applyProjectDocRename, applyProjectDocSnapshot, listProjectDocs, readProjectDoc, snapshotProjectDoc, snapshotProjectDocRename } from '../workspace/projectDocs'
import type { ToolOutcome } from './registry'
import { contentRevision } from '../workspace/resourceRevision'
import { coordinatorFor } from '../workspace/mutationCoordinator'

export const PROJECT_DOC_TOOL_DEFS: ToolDefJson[] = [
  { name: 'list_project_docs', description: '递归列出 docs 中的项目规划、临时参考资料和常见文本文件，不返回正文。', parameters: { type: 'object', additionalProperties: false, properties: { offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 100 } } } },
  { name: 'read_project_doc', description: '按需读取 docs 中的常见文本、DOCX 或 PDF 文件，支持子目录和分段读取。', parameters: { type: 'object', additionalProperties: false, properties: { path: { type: 'string' }, offset: { type: 'integer', minimum: 0 }, maxChars: { type: 'integer', minimum: 1, maximum: 50000 } }, required: ['path'] } },
  { name: 'save_project_doc', description: '保存 docs 中的一篇常见文本文件；需要用户确认。', parameters: { type: 'object', additionalProperties: false, properties: { path: { type: 'string' }, content: { type: 'string' }, baseRevision: { type: 'string' } }, required: ['path', 'content'] } },
  { name: 'rename_project_doc', description: '在 docs 内安全重命名项目文档；不会覆盖已有目标，确认前不会移动文件。baseRevision 来自 read_project_doc 的 fileRevision（纯文本也可使用 writeRevision）。', parameters: { type: 'object', additionalProperties: false, properties: { fromPath: { type: 'string' }, toPath: { type: 'string' }, baseRevision: { type: 'string' } }, required: ['fromPath', 'toPath', 'baseRevision'] } }
]

const known: Record<string, string[]> = {
  list_project_docs: ['offset', 'limit'],
  read_project_doc: ['path', 'offset', 'maxChars'],
  save_project_doc: ['path', 'content', 'baseRevision'],
  rename_project_doc: ['fromPath', 'toPath', 'baseRevision']
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
  if (name === 'rename_project_doc') {
    const snapshot = await snapshotProjectDocRename(store, args.fromPath, args.toPath, args.baseRevision)
    const change: PendingChange = {
      id: `chg_${Date.now().toString(36)}`,
      toolName: name,
      entityKind: 'projectDoc' as EntityKind,
      entityId: snapshot.fromPath,
      title: `重命名项目文档：${snapshot.fromPath} → ${snapshot.toPath}`,
      beforeText: snapshot.fromPath,
      afterText: snapshot.toPath,
      mutationKind: 'move'
    }
    return { kind: 'pending', change, apply: () => coordinatorFor(store).run('projectDocs:rename', () => applyProjectDocRename(store, snapshot)) }
  }
  if (name !== 'save_project_doc') throw new Error(`未知项目文档工具：${name}`)
  const snapshot = await snapshotProjectDoc(store, args.path, args.content)
  if (snapshot.existed && (typeof args.baseRevision !== 'string' || contentRevision(snapshot.beforeText) !== args.baseRevision)) {
    throw new Error('更新项目文档必须提供当前 baseRevision；请重新读取后提交')
  }
  if (!snapshot.existed && args.baseRevision !== undefined) throw new Error('新建项目文档不能提供 baseRevision')
  const change: PendingChange = {
    id: `chg_${Date.now().toString(36)}`,
    toolName: name,
    entityKind: 'projectDoc' as EntityKind,
    entityId: snapshot.path,
    title: `${snapshot.existed ? '更新' : '新建'}项目文档：${snapshot.path}`,
    beforeText: snapshot.beforeText,
    afterText: snapshot.afterText
  }
  return { kind: 'pending', change, apply: () => coordinatorFor(store).run(`projectDoc:${snapshot.path}`, () => applyProjectDocSnapshot(store, snapshot)) }
}
