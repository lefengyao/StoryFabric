import { normalizeRelativePath, type FileStore } from '../storage/fileStore'
import { parseFrontMatter, stringifyFrontMatter } from './frontMatter'
import { bytesContentRevision, isWriteRevision, newWriteRevision } from './resourceRevision'
import { boxForChapterStatus, normalizeChapterStatus } from '../../shared/chapterPlacement'
import type { ChapterStatus } from '../../shared/types'
import { commitTextChanges, pendingMutationJournals, type JournalTextChange } from './mutationJournal'
import { coordinatorFor } from './mutationCoordinator'

export interface WorkspaceMigrationOptions { upgradeLegacy?: boolean }

export const CURRENT_WORKSPACE_VERSION = 5
const WORKSPACE_DIRS = [
  'characters/primary', 'characters/secondary', 'outline/total', 'outline/chapters', 'outline/unassigned',
  'settings/background', 'settings/other', 'chapters/draft', 'chapters/main', 'events', 'notes', 'docs', 'inspiration',
  '.storyfabric/sessions', '.storyfabric/trash', '.storyfabric/inspiration', '.storyfabric/history/chapters', '.storyfabric/history/outlines'
]
const DEFAULT_VOLUMES = JSON.stringify([{ id: 'vol_default', title: '第一卷', order: 1 }], null, 2)

export function validateCurrentDocumentFormat(path: string, raw: string): void {
  let data: Record<string, unknown>
  try { data = parseFrontMatter(raw).data } catch { throw new Error(`文档 ${path} 需要按格式 5 重写：frontmatter 无效`) }
  if (typeof data.id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(data.id) || !isWriteRevision(data.writeRevision)
    || typeof data.updatedAt !== 'string' || !Number.isFinite(Date.parse(data.updatedAt)) || !data.updatedAt.endsWith('Z')
    || 'historyVersionId' in data || 'historySequence' in data) throw new Error(`文档 ${path} 需要按格式 5 重写：缺少有效的当前修订或更新时间`)
  if (path.startsWith('chapters/')) {
    if (!['draft', 'revised', 'body', 'final'].includes(String(data.status)) || !['draft', 'main'].includes(String(data.box))
      || boxForChapterStatus(data.status as ChapterStatus) !== data.box || !path.startsWith(`chapters/${data.box}/`)) throw new Error(`章节 ${path} 需要按格式 5 重写：状态与箱位不一致`)
  } else if (path.startsWith('outline/')) {
    if (data.kind !== 'total' && data.kind !== 'chapter') throw new Error(`大纲 ${path} 需要按格式 5 重写：缺少大纲类型`)
  }
}

async function validateDocumentTree(store: FileStore, directory: string): Promise<void> {
  for (const name of await store.listFiles(directory, '.md')) {
    const path = `${directory}/${name}`
    const raw = await store.readText(path)
    if (raw === null) throw new Error(`无法读取文档：${path}`)
    validateCurrentDocumentFormat(path, raw)
  }
  for (const child of await store.listDirs(directory)) await validateDocumentTree(store, `${directory}/${child}`)
}

interface UpgradeDocument { path: string; beforeText: string; afterText: string }

function convertLegacyDocument(path: string, raw: string, updatedAt: string, seenIds: Set<string>): string {
  let parsed: ReturnType<typeof parseFrontMatter>
  try { parsed = parseFrontMatter(raw) } catch { throw new Error(`升级前发现文档元数据无效：${path}；原文件已保留`) }
  const data = { ...parsed.data }
  if (typeof data.id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(data.id)) throw new Error(`升级前发现文档缺少有效元数据或 ID：${path}；原文件已保留`)
  const kind = path.startsWith('chapters/') ? 'chapter' : 'outline'
  const key = `${kind}:${data.id}`
  if (seenIds.has(key)) throw new Error(`升级前发现重复文档 ID：${data.id}；原文件已保留`)
  seenIds.add(key)
  if (kind === 'chapter') {
    const placement = /^chapters\/(draft|main)(?:\/([^/]+))?\//.exec(path)
    if (!placement) throw new Error(`章节 ${path} 不符合格式 4 箱位目录，无法自动升级；原文件已保留`)
    const box = placement[1] as 'draft' | 'main'
    if (box === 'main' && (!placement[2] || !/^[a-zA-Z0-9_-]+$/.test(placement[2]))) throw new Error(`章节 ${path} 缺少有效的卷目录，无法自动升级；原文件已保留`)
    if (box === 'main' && typeof data.volumeId === 'string' && data.volumeId && data.volumeId !== placement[2]) throw new Error(`章节 ${path} 的卷关联与所在目录冲突，请先调整后升级；原文件已保留`)
    const knownStatus = ['draft', 'revised', 'body', 'final'].includes(String(data.status))
    data.box = box
    if (!knownStatus) data.status = normalizeChapterStatus(data.status, box)
    // Format 4 could leave a deleted or active chapter with a stale status.
    // Keep its physical/restoration path and preserve the old metadata in backup.
    if (boxForChapterStatus(data.status as ChapterStatus) !== box) data.status = box === 'draft' ? 'draft' : 'body'
    if (typeof data.volumeId !== 'string' || !data.volumeId) data.volumeId = box === 'main' ? placement[2] : 'vol_default'
  } else {
    const total = path.startsWith('outline/total/')
    const chapter = /^outline\/chapters\/([a-zA-Z0-9_-]+)\//.exec(path)
    const unassigned = path.startsWith('outline/unassigned/')
    if (!total && !chapter && !unassigned) throw new Error(`大纲 ${path} 不符合格式 4 大纲目录，无法自动升级；原文件已保留`)
    if (data.kind !== 'total' && data.kind !== 'chapter') data.kind = total ? 'total' : 'chapter'
    if ((total && data.kind !== 'total') || ((chapter || unassigned) && data.kind !== 'chapter')) throw new Error(`大纲 ${path} 的有效类型与所在目录冲突，请先调整后升级；原文件已保留`)
    if (chapter && typeof data.chapterId === 'string' && data.chapterId && data.chapterId !== chapter[1]) throw new Error(`大纲 ${path} 的章节关联与所在目录冲突，请先调整后升级；原文件已保留`)
    if (chapter && (typeof data.chapterId !== 'string' || !data.chapterId)) data.chapterId = chapter[1]
  }
  data.writeRevision = newWriteRevision()
  data.updatedAt = updatedAt
  const eol = raw.match(/^(?:\uFEFF)?---[^\r\n]*(\r?\n)/)?.[1] ?? '\n'
  const header = stringifyFrontMatter('', data).slice(0, -1).replace(/\n/g, eol)
  const converted = `${raw.startsWith('\uFEFF') ? '\uFEFF' : ''}${header}${parsed.content}`
  validateCurrentDocumentFormat(path, converted)
  return converted
}

async function collectUpgradeDocuments(store: FileStore, directory: string, updatedAt: string, seenIds: Set<string>): Promise<UpgradeDocument[]> {
  const changes: UpgradeDocument[] = []
  for (const name of await store.listFiles(directory, '.md')) {
    const path = `${directory}/${name}`
    const raw = await store.readText(path)
    if (raw === null) throw new Error(`升级前无法读取文档：${path}；原文件已保留`)
    changes.push({ path, beforeText: raw, afterText: convertLegacyDocument(path, raw, updatedAt, seenIds) })
  }
  for (const child of await store.listDirs(directory)) changes.push(...await collectUpgradeDocuments(store, `${directory}/${child}`, updatedAt, seenIds))
  return changes
}

async function directoryContainsFiles(store: FileStore, directory: string): Promise<boolean> {
  if ((await store.listFiles(directory)).length) return true
  for (const child of await store.listDirs(directory)) if (await directoryContainsFiles(store, `${directory}/${child}`)) return true
  return false
}

async function removeCompletedBackup(store: FileStore, root: string, changes: JournalTextChange[]): Promise<void> {
  for (const change of changes) if (await store.exists(change.path)) await store.removeFile(change.path)
  if (!(await directoryContainsFiles(store, root))) await store.remove(root)
}

async function collectUpgradeTrashDocuments(store: FileStore, updatedAt: string, seenIds: Set<string>): Promise<UpgradeDocument[]> {
  const raw = await store.readText('.storyfabric/trash/index.json')
  if (raw === null) return []
  let entries: unknown
  try { entries = JSON.parse(raw) } catch { throw new Error('升级前发现回收站索引无效；原文件已保留') }
  if (!Array.isArray(entries)) throw new Error('升级前发现回收站索引无效；原文件已保留')
  const documents: UpgradeDocument[] = []
  for (const value of entries) {
    if (!value || typeof value !== 'object' || (value.kind !== 'chapter' && value.kind !== 'outline')) continue
    const { id, kind, originalPath } = value
    const path = value.trashPath ?? `.storyfabric/trash/${kind}/${id}.md`
    try {
      if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(id) || typeof path !== 'string' || typeof originalPath !== 'string'
        || normalizeRelativePath(path) !== path || !path.startsWith('.storyfabric/trash/')
        || normalizeRelativePath(originalPath) !== originalPath || !originalPath.startsWith(kind === 'chapter' ? 'chapters/' : 'outline/')) throw new Error('invalid')
    } catch { throw new Error('升级前发现回收站文档路径无效；原文件已保留') }
    const beforeText = await store.readText(path)
    if (beforeText === null) throw new Error(`升级前无法读取回收站文档：${path}；原文件已保留`)
    let documentId: unknown
    try { documentId = parseFrontMatter(beforeText).data.id } catch { throw new Error(`升级前发现回收站文档元数据无效：${path}；原文件已保留`) }
    if (documentId !== id) throw new Error(`升级前发现回收站文档 ID 与索引冲突：${path}；原文件已保留`)
    documents.push({ path, beforeText, afterText: convertLegacyDocument(originalPath, beforeText, updatedAt, seenIds) })
  }
  return documents
}

async function upgradeFormatFour(store: FileStore, rawMetadata: string, metadata: Record<string, unknown>): Promise<void> {
  const createdAt = new Date().toISOString()
  const seenIds = new Set<string>()
  const documents = [
    ...await collectUpgradeDocuments(store, 'chapters', createdAt, seenIds),
    ...await collectUpgradeDocuments(store, 'outline', createdAt, seenIds),
    ...await collectUpgradeTrashDocuments(store, createdAt, seenIds)
  ]
  const originals = [{ path: 'storyfabric.json', beforeText: rawMetadata, afterText: JSON.stringify({ ...metadata, version: CURRENT_WORKSPACE_VERSION }, null, 2) }, ...documents]
  let backupId: string
  let backupRoot: string
  do { backupId = `fb_${newWriteRevision().slice(3)}`; backupRoot = `.storyfabric/format-backups/${backupId}` } while (await store.exists(backupRoot))
  const files: Array<{ path: string; backupPath: string; checksum: string; byteLength: number }> = []
  const backupChanges: JournalTextChange[] = []
  for (const original of originals) {
    const encoded = new TextEncoder().encode(original.beforeText)
    const bytes = await store.readBytes(original.path)
    if (bytes === null || bytes.length !== encoded.length || bytes.some((value, index) => value !== encoded[index])) throw new Error(`升级前文档编码或原文发生变化：${original.path}；原文件已保留`)
    const backupPath = `${backupRoot}/${original.path}`
    files.push({ path: original.path, backupPath, checksum: bytesContentRevision(bytes), byteLength: bytes.byteLength })
    backupChanges.push({ path: backupPath, beforeText: null, afterText: original.beforeText })
  }
  const manifest = { schemaVersion: 1, backupId, fromVersion: 4, toVersion: CURRENT_WORKSPACE_VERSION, createdAt, files }
  backupChanges.push({ path: `${backupRoot}/manifest.json`, beforeText: null, afterText: JSON.stringify(manifest, null, 2) })
  const currentChanges: JournalTextChange[] = [...documents]
  if (!(await store.exists('chapters/volumes.json'))) currentChanges.push({ path: 'chapters/volumes.json', beforeText: null, afterText: DEFAULT_VOLUMES })
  currentChanges.push(originals[0])
  // Finish potentially failing directory preparation before overwriting any originals.
  for (const directory of WORKSPACE_DIRS) await store.ensureDir(directory)
  const backup = await commitTextChanges(store, `workspace-upgrade-backup-${backupId}`, [
    ...originals.map(({ path, beforeText }) => ({ path, beforeText, afterText: beforeText })), ...backupChanges
  ])
  if (!backup.ok) {
    if (!backup.recoveryRequired && !(await directoryContainsFiles(store, backupRoot))) await store.remove(backupRoot)
    throw new Error(backup.recoveryRequired ? `RECOVERY_REQUIRED：${backup.text}` : backup.text)
  }
  // Keep the durable backup outside the current-file rollback: a failed rollback
  // must never delete the only intact pre-upgrade originals.
  let transaction: Awaited<ReturnType<typeof commitTextChanges>>
  try { transaction = await commitTextChanges(store, `workspace-upgrade-${backupId}`, currentChanges) }
  catch (error) { throw new Error(`RECOVERY_REQUIRED：升级事务无法完成，原始备份保存在 ${backupRoot}；${error instanceof Error ? error.message : String(error)}`) }
  if (!transaction.ok) {
    if (!transaction.recoveryRequired) await removeCompletedBackup(store, backupRoot, backupChanges)
    throw new Error(transaction.recoveryRequired ? `RECOVERY_REQUIRED：${transaction.text}；原始备份保存在 ${backupRoot}` : transaction.text)
  }
}

/** Creates format 5, or upgrades format 4 only after the user's explicit consent. */
export function migrateWorkspace(store: FileStore, options: WorkspaceMigrationOptions = {}): Promise<void> {
  return coordinatorFor(store).run('workspace-format-upgrade', () => migrateWorkspaceLocked(store, options))
}

async function migrateWorkspaceLocked(store: FileStore, options: WorkspaceMigrationOptions): Promise<void> {
  const upgradeJournals = (await store.listFiles('.storyfabric/transactions', '.json')).filter((name) => name.startsWith('workspace-upgrade-'))
  if (upgradeJournals.length) {
    const records = await pendingMutationJournals(store)
    const recovery = upgradeJournals.find((name) => records.find((record) => typeof record.id === 'string' && `${record.id}.json` === name)?.status !== 'committed')
    if (recovery) throw new Error(`RECOVERY_REQUIRED：上次工作区升级尚未完成恢复，请先检查 .storyfabric/transactions/${recovery} 与 .storyfabric/format-backups/；原文件已保留`)
  }
  const raw = await store.readText('storyfabric.json')
  if (raw !== null) {
    let meta: Record<string, unknown>
    try {
      meta = JSON.parse(raw.replace(/^\uFEFF/, ''))
      if (!meta || typeof meta !== 'object' || Array.isArray(meta)) throw new Error('invalid')
    } catch { throw new Error('工作区元数据无效，需要按格式 5 重写；原文件已保留') }
    if (meta.app !== 'storyfabric' || typeof meta.version !== 'number' || !Number.isInteger(meta.version)) throw new Error('工作区元数据无效，需要按格式 5 重写；原文件已保留')
    if (meta.version > CURRENT_WORKSPACE_VERSION) throw new Error(`工作区版本 ${meta.version} 高于当前支持版本 ${CURRENT_WORKSPACE_VERSION}`)
    if (meta.version === 4) {
      if (options.upgradeLegacy !== true) throw new Error('WORKSPACE_UPGRADE_REQUIRED：这是格式 4 的旧项目，需要确认备份并升级为格式 5；原文件尚未修改，不会伪造历史版本')
      await upgradeFormatFour(store, raw, meta)
      return
    } else if (meta.version !== CURRENT_WORKSPACE_VERSION) throw new Error(`工作区格式 ${meta.version} 需要按格式 5 重写；原文件已保留，未重建历史`)
    await validateDocumentTree(store, 'chapters')
    await validateDocumentTree(store, 'outline')
  } else {
    const [files, directories] = await Promise.all([store.listFiles(''), store.listDirs('')])
    if (files.length || directories.length) throw new Error('工作区缺少格式元数据，需要按格式 5 重写；原文件已保留')
  }
  for (const directory of WORKSPACE_DIRS) await store.ensureDir(directory)
  if (!(await store.exists('chapters/volumes.json'))) await store.writeText('chapters/volumes.json', DEFAULT_VOLUMES)
  if (raw === null) await store.writeText('storyfabric.json', JSON.stringify({ app: 'storyfabric', version: CURRENT_WORKSPACE_VERSION, name: 'StoryFabric', createdAt: new Date().toISOString() }, null, 2))
}
