import type { FileStore } from '../storage/fileStore'
import { coordinatorFor, normalizedStorageIdentity } from '../workspace/mutationCoordinator'
import { resourceRevision } from '../workspace/resourceRevision'

// Compatibility for callers still paging with writeRevision. New callers carry
// the immutable raw-source token, which remains safe across independent readers.
const sourceBaselines = new WeakMap<ReturnType<typeof coordinatorFor>, Map<string, { writeRevision: string; readRevision: string; legacyInvalid: boolean }>>()

export function documentRawReadRevision(store: FileStore, kind: string, id: string, raw: string): string {
  return `rr_${resourceRevision(normalizedStorageIdentity(store), kind, id, raw).replace(/^r1-/, '')}`
}

export function rememberDocumentReadRevision(store: FileStore, kind: string, id: string, writeRevision: string, readRevision: string): void {
  const coordinator = coordinatorFor(store)
  let baselines = sourceBaselines.get(coordinator)
  if (!baselines) { baselines = new Map(); sourceBaselines.set(coordinator, baselines) }
  const key = `${kind}:${id}`
  const previous = baselines.get(key)
  const legacyInvalid = previous?.writeRevision === writeRevision && (previous.legacyInvalid || previous.readRevision !== readRevision)
  baselines.set(key, { writeRevision, readRevision, legacyInvalid })
}

/** Candidate preparation must compare with the source actually returned by a read tool. */
export function assertDocumentReadSourceUnchanged(store: FileStore, kind: string, id: string, raw: string, writeRevision: string, baseReadRevision?: string): void {
  const baseline = sourceBaselines.get(coordinatorFor(store))?.get(`${kind}:${id}`)
  const actual = documentRawReadRevision(store, kind, id, raw)
  if (baseReadRevision !== undefined) {
    if (baseReadRevision !== actual) throw new Error('SOURCE_CHANGED：读取后原文已经变化，请重新读取后生成变更')
    return
  }
  if (baseline?.legacyInvalid && baseline.writeRevision === writeRevision) {
    throw new Error('SOURCE_CHANGED：当前修订曾对应不同原文，请重新读取并将 readRevision 原样作为 baseReadRevision 提交')
  }
  if (baseline && (baseline.writeRevision !== writeRevision || baseline.readRevision !== actual)) {
    throw new Error('SOURCE_CHANGED：读取后原文已经变化，请重新读取后生成变更')
  }
}

export function checkDocumentReadRevision(store: FileStore, kind: string, id: string, raw: string, writeRevision: string, expectedRevision?: string): { readRevision: string; matches: boolean } {
  const readRevision = documentRawReadRevision(store, kind, id, raw)
  const coordinator = coordinatorFor(store)
  const key = `${kind}:${id}`
  const previous = sourceBaselines.get(coordinator)?.get(key)
  const legacyMatch = expectedRevision === writeRevision && (!previous || (previous.writeRevision === writeRevision && !previous.legacyInvalid && previous.readRevision === readRevision))
  const matches = expectedRevision === undefined || expectedRevision === readRevision || legacyMatch
  if (matches && (expectedRevision === undefined || !previous)) {
    rememberDocumentReadRevision(store, kind, id, writeRevision, readRevision)
  }
  return { readRevision, matches }
}
