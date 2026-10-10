import type { FileStore } from '../storage/fileStore'

export interface JournalTextChange {
  path: string
  beforeText: string | null
  afterText: string | null
}

export interface MutationJournalResult {
  ok: boolean
  text: string
  recoveryRequired?: boolean
}

interface JournalRecord {
  version: 1
  id: string
  createdAt: number
  status: 'prepared' | 'committed' | 'recovery_required'
  changes: JournalTextChange[]
}

function journalPath(id: string): string {
  return `.storyfabric/transactions/${id.replace(/[^a-zA-Z0-9_-]/g, '')}.json`
}

async function writeJournal(store: FileStore, record: JournalRecord): Promise<void> {
  await store.ensureDir('.storyfabric/transactions')
  await store.writeText(journalPath(record.id), JSON.stringify(record, null, 2))
}

export async function commitTextChanges(
  store: FileStore,
  id: string,
  changes: JournalTextChange[],
  afterCommit?: () => Promise<void>
): Promise<MutationJournalResult> {
  const record: JournalRecord = { version: 1, id, createdAt: Date.now(), status: 'prepared', changes }
  await writeJournal(store, record)
  for (const change of changes) {
    const current = await store.readText(change.path)
    if (current !== change.beforeText) {
      record.status = 'recovery_required'
      await writeJournal(store, record)
      return { ok: false, text: `提交前发现外部修改：${change.path}`, recoveryRequired: true }
    }
  }

  const applied: JournalTextChange[] = []
  let externalDetected = false
  try {
    for (const change of changes) {
      if (await store.readText(change.path) !== change.beforeText) {
        externalDetected = true
        throw new Error(`提交期间发现外部修改：${change.path}`)
      }
      if (change.beforeText === change.afterText) continue
      applied.push(change)
      if (change.afterText === null) await store.remove(change.path)
      else await store.writeText(change.path, change.afterText)
    }
    if (afterCommit) await afterCommit()
    for (const change of changes) {
      if (await store.readText(change.path) !== change.afterText) {
        externalDetected = true
        throw new Error(`提交期间发现外部修改：${change.path}`)
      }
    }
    record.status = 'committed'
    await writeJournal(store, record)
    await store.remove(journalPath(id)).catch(() => undefined)
    return { ok: true, text: '事务已提交' }
  } catch (error) {
    let recoveryRequired = externalDetected
    for (const change of [...applied].reverse()) {
      try {
        const current = await store.readText(change.path)
        if (current === change.beforeText) continue
        if (current !== change.afterText) {
          recoveryRequired = true
          continue
        }
        if (change.beforeText === null) await store.remove(change.path)
        else await store.writeText(change.path, change.beforeText)
      } catch { recoveryRequired = true }
    }
    record.status = recoveryRequired ? 'recovery_required' : 'prepared'
    try { await writeJournal(store, record) } catch { recoveryRequired = true }
    if (!recoveryRequired) await store.remove(journalPath(id)).catch(() => undefined)
    return {
      ok: false,
      text: recoveryRequired
        ? `RECOVERY_REQUIRED：事务或回滚未能安全完成，请检查恢复记录 ${journalPath(id)}`
        : `事务失败并已回滚：${error instanceof Error ? error.message : String(error)}`,
      ...(recoveryRequired ? { recoveryRequired: true } : {})
    }
  }
}

export async function pendingMutationJournals(store: FileStore): Promise<JournalRecord[]> {
  const names = await store.listFiles('.storyfabric/transactions', '.json').catch(() => [])
  const records: JournalRecord[] = []
  for (const name of names) {
    const raw = await store.readText(`.storyfabric/transactions/${name}`)
    if (!raw) continue
    try {
      const parsed = JSON.parse(raw) as JournalRecord
      if (parsed?.version === 1 && Array.isArray(parsed.changes)) records.push(parsed)
    } catch {
      /* A damaged journal remains on disk for manual inspection. */
    }
  }
  return records
}
