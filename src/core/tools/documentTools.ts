import type { FileStore } from '../storage/fileStore'
import type { ToolDefJson } from '../../shared/types'
import type { ToolOutcome } from './registry'
import { indexedProjectDoc } from '../workspace/projectDocs'
import { SourceCatalog } from '../inspiration/sourceCatalog'
import { listDocumentSections, readDocumentSection, searchDocument } from '../inspiration/documentIndex'

const reference = { path: { type: 'string', description: 'docs 下的相对路径；与 sourceId 二选一' }, sourceId: { type: 'string', description: '灵感资料或长附件的 sourceId；与 path 二选一' }, revision: { type: 'string', description: '目录或搜索返回的 revision，用于防止读取期间混用版本' } }
const offset = { type: 'integer', minimum: 0 }
export const DOCUMENT_TOOL_DEFS: ToolDefJson[] = [
  { name: 'list_document_sections', description: '查询长资料章节/片段目录，不返回正文。用 path 读取 docs，或用 sourceId 读取灵感资料和长附件。用 nextOffset 翻页；保存 revision 供后续读取。', parameters: { type: 'object', additionalProperties: false, properties: { ...reference, offset, limit: { type: 'integer', minimum: 1, maximum: 100 } } } },
  { name: 'read_document_section', description: '按需读取一个章节片段，默认 4000、最多 20000 字符；返回 nextOffset 时可继续读取本片段。offset 是片段内偏移，sectionId 来自目录或搜索。', parameters: { type: 'object', additionalProperties: false, properties: { ...reference, sectionId: { type: 'string' }, offset, maxChars: { type: 'integer', minimum: 1, maximum: 20000 } }, required: ['sectionId'] } },
  { name: 'search_document', description: '在完整资料中按字面关键词搜索，返回定位片段和短摘要，支持 nextOffset 翻页。根据 sectionId 和 sectionOffset 读取上下文。查询不执行正则表达式。', parameters: { type: 'object', additionalProperties: false, properties: { ...reference, query: { type: 'string', minLength: 1, maxLength: 200 }, offset, limit: { type: 'integer', minimum: 1, maximum: 20 } }, required: ['query'] } }
]

export async function executeDocumentTool(store: FileStore, name: string, args: Record<string, unknown>): Promise<ToolOutcome> {
  const def = DOCUMENT_TOOL_DEFS.find((item) => item.name === name)
  if (!def) throw new Error('未知资料工具')
  const properties = def.parameters.properties as Record<string, unknown>
  if (Object.keys(args).some((key) => !Object.prototype.hasOwnProperty.call(properties, key))) throw new Error('资料工具包含未知参数')
  if ((args.path === undefined) === (args.sourceId === undefined)) throw new Error('必须指定 path 或 sourceId，且只能指定一个')
  if (args.sourceId !== undefined && (typeof args.sourceId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(args.sourceId))) throw new Error('无效的 sourceId')
  if (args.revision !== undefined && typeof args.revision !== 'string') throw new Error('revision 必须为字符串')
  const doc = args.sourceId === undefined
    ? await indexedProjectDoc(store, args.path, args.revision)
    : await new SourceCatalog(store).document(args.sourceId as string, args.revision)
  const result = name === 'list_document_sections'
    ? listDocumentSections(doc, args.offset as number | undefined, args.limit as number | undefined)
    : name === 'read_document_section'
      ? readDocumentSection(doc, args.sectionId, args.offset as number | undefined, args.maxChars as number | undefined)
      : searchDocument(doc, args.query, args.offset as number | undefined, args.limit as number | undefined)
  return { kind: 'result', ok: true, text: JSON.stringify(result), preview: name === 'list_document_sections' ? `资料目录：${doc.sections.length} 个片段` : name === 'search_document' ? `资料搜索：${args.query}` : `读取资料片段：${args.sectionId}` }
}
