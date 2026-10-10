import type { FileStore } from '../storage/fileStore'
import type { DocumentFor, DocumentKind, HistoricalDocument, HistorySource, HistoryVersion, HistoryVersionId, HistoryVersionPatch, HistoryVersionRecord } from '../../shared/documentHistory'
import { genId, countWords } from '../workspace/entityStore'
import type { JournalTextChange } from '../workspace/mutationJournal'

interface HistoryManifest {
  schemaVersion: 1
  entityKind: DocumentKind
  entityId: string
  nextSequence: number
  versions: HistoryVersion[]
}
export interface HistoryPlan {
  root: string
  beforeText: string | null
  manifest: HistoryManifest
  changes: JournalTextChange[]
}

export function documentHistoryKey(kind: DocumentKind, id: string): string {
  if (kind !== 'chapter' && kind !== 'outline') throw new Error('INVALID_ARGUMENT：文档类型无效')
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('INVALID_ARGUMENT：文档 ID 无效')
  return `${kind}:${id}`
}

export function historyRoot(kind: DocumentKind, id: string): string {
  documentHistoryKey(kind, id)
  return `.storyfabric/history/${kind === 'chapter' ? 'chapters' : 'outlines'}/${id}`
}

export function historyRecordPath(kind: DocumentKind, id: string, versionId: string): string {
  if (!/^hv_[a-zA-Z0-9_-]+$/.test(versionId)) throw new Error('INVALID_ARGUMENT：历史版本 ID 无效')
  return `${historyRoot(kind, id)}/versions/${versionId}.json`
}

function validMetadata(version: HistoryVersion, kind: DocumentKind, id: string): boolean {
  return version?.schemaVersion === 1 && version.entityKind === kind && version.entityId === id
    && /^hv_[a-zA-Z0-9_-]+$/.test(version.historyVersionId) && Number.isSafeInteger(version.historySequence) && version.historySequence > 0
    && /^wr_[a-zA-Z0-9_-]+$/.test(version.sourceWriteRevision) && typeof version.createdAt === 'string'
    && typeof version.title === 'string' && Number.isFinite(version.wordCount)
    && ['manual', 'automatic', 'agent', 'baseline', 'before-restore', 'restored'].includes(version.source)
    && typeof version.label === 'string' && typeof version.note === 'string' && typeof version.pinned === 'boolean'
}

export async function createHistoryPlan(store: FileStore, kind: DocumentKind, id: string): Promise<HistoryPlan> {
  const root = historyRoot(kind, id)
  const beforeText = await store.readText(`${root}/manifest.json`)
  let manifest: HistoryManifest
  if (beforeText === null) {
    const existing = await store.listFiles(`${root}/versions`, '.json')
    if (existing.length) throw new Error('RECOVERY_REQUIRED：历史目录缺少序号清单，请保留原文件并处理')
    manifest = { schemaVersion: 1, entityKind: kind, entityId: id, nextSequence: 1, versions: [] }
  } else {
    try {
      manifest = JSON.parse(beforeText) as HistoryManifest
      if (manifest.schemaVersion !== 1 || manifest.entityKind !== kind || manifest.entityId !== id
        || !Number.isSafeInteger(manifest.nextSequence) || manifest.nextSequence < 1 || !Array.isArray(manifest.versions)
        || manifest.versions.some((version) => !validMetadata(version, kind, id))
        || manifest.versions.some((version) => version.historySequence >= manifest.nextSequence)
        || new Set(manifest.versions.map((version) => version.historyVersionId)).size !== manifest.versions.length
        || new Set(manifest.versions.map((version) => version.historySequence)).size !== manifest.versions.length) throw new Error('invalid')
    } catch { throw new Error('RECOVERY_REQUIRED：历史清单格式损坏，请保留原文件并处理') }
  }
  return { root, beforeText, manifest, changes: [] }
}

export function historicalDocument<K extends DocumentKind>(document: DocumentFor<K>): HistoricalDocument<K> {
  const { writeRevision: _revision, updatedAt: _updatedAt, ...payload } = document
  return payload as HistoricalDocument<K>
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, child]) => child !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`).join(',')}}`
  return JSON.stringify(value)
}

export function sameHistoricalDocument(first: unknown, second: unknown): boolean { return stableJson(first) === stableJson(second) }

export function appendHistoryVersion<K extends DocumentKind>(plan: HistoryPlan, document: DocumentFor<K>, source: HistorySource, label = '', restoredFromHistoryVersionId?: HistoryVersionId): HistoryVersionRecord<K> {
  if (plan.manifest.nextSequence >= Number.MAX_SAFE_INTEGER) throw new Error('历史版本序号已超过范围')
  const historyVersionId = genId('hv') as HistoryVersionId
  const record: HistoryVersionRecord<K> = {
    schemaVersion: 1, historyVersionId, historySequence: plan.manifest.nextSequence++, entityKind: plan.manifest.entityKind,
    entityId: plan.manifest.entityId, createdAt: new Date().toISOString(), source, title: document.title,
    wordCount: countWords(document.content), label, pinned: false, note: '', sourceWriteRevision: document.writeRevision,
    ...(restoredFromHistoryVersionId ? { restoredFromHistoryVersionId } : {}), document: historicalDocument(document)
  }
  const { document: _payload, ...metadata } = record
  plan.manifest.versions.push(metadata)
  plan.changes.push({ path: `${plan.root}/versions/${historyVersionId}.json`, beforeText: null, afterText: JSON.stringify(record, null, 2) })
  return record
}

export function historyPlanChanges(plan: HistoryPlan): JournalTextChange[] {
  return [...plan.changes, { path: `${plan.root}/manifest.json`, beforeText: plan.beforeText, afterText: JSON.stringify(plan.manifest, null, 2) }]
}

export async function readHistoryVersion<K extends DocumentKind>(store: FileStore, kind: K, id: string, versionId: string, plan?: HistoryPlan): Promise<HistoryVersionRecord<K>> {
  const path = historyRecordPath(kind, id, versionId)
  const loaded = plan ?? await createHistoryPlan(store, kind, id)
  const metadata = loaded.manifest.versions.find((version) => version.historyVersionId === versionId)
  if (!metadata) throw new Error('NOT_FOUND：未找到历史版本')
  const raw = await store.readText(path)
  if (raw === null) throw new Error('RECOVERY_REQUIRED：历史版本正文缺失')
  try {
    const record = JSON.parse(raw) as HistoryVersionRecord<K>
    if (!validMetadata(record, kind, id) || record.historyVersionId !== versionId || record.historySequence !== metadata.historySequence
      || !record.document || record.document.id !== id || typeof record.document.content !== 'string' || 'writeRevision' in record.document) throw new Error('invalid')
    return { ...record, label: metadata.label, pinned: metadata.pinned, note: metadata.note }
  } catch { throw new Error('RECOVERY_REQUIRED：历史版本正文格式损坏') }
}

export function patchHistoryMetadata(plan: HistoryPlan, versionId: string, patch: HistoryVersionPatch): HistoryVersion {
  if (Object.keys(patch).some((key) => !['label', 'note', 'pinned'].includes(key))
    || (patch.pinned !== undefined && typeof patch.pinned !== 'boolean')
    || (patch.label !== undefined && typeof patch.label !== 'string') || (patch.note !== undefined && typeof patch.note !== 'string')) throw new Error('INVALID_ARGUMENT：只能修改历史名称、备注和保留标记')
  const index = plan.manifest.versions.findIndex((version) => version.historyVersionId === versionId)
  if (index === -1) throw new Error('NOT_FOUND：未找到历史版本')
  const current = plan.manifest.versions[index]
  const next = { ...current, ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) }
  plan.manifest.versions[index] = next
  return next
}
