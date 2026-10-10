import type { ChatMessage, ChatSession, SessionMeta } from '../../shared/types'
import { validateCreativePreferences, type CreativePreferences } from '../../shared/creative'
import {
  SESSION_ROOT,
  isSafeSessionDir,
  legacySessionBackupPath,
  legacySessionPath,
  safeSessionId,
  sessionDirName,
  sessionJsonPath,
  sessionTmpPath
} from '../../shared/sessionPaths'
import type { FileStore } from '../storage/fileStore'
import { genId } from './entityStore'
import { setSessionApprovalPolicy, setSessionModelPreference } from './sessionPreferences'
import { compactRepeatedReadResults, repairOrphanedToolCalls } from '../agent/messageHistory'
import { withSessionWriteLock } from '../../shared/sessionWriteLock'

const storeKeys = new WeakMap<object, string>()
let nextStoreKey = 1

export interface SessionSaveOptions {
  /** Allow an intentional metadata update to replace the on-disk value. */
  preserveArchived?: boolean
  preserveApprovalPolicy?: boolean
  preserveCreativePreferences?: boolean
}

function keyForStore(store: object): string {
  const existing = storeKeys.get(store)
  if (existing) return existing
  const key = `store-${nextStoreKey++}`
  storeKeys.set(store, key)
  return key
}

export function titleFromMessage(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > 24 ? `${t.slice(0, 24)}…` : t || '新会话'
}

export class CoreSessionStore {
  private readonly writeKeyBase: string

  constructor(private readonly store: FileStore, workspaceKey?: string) {
    this.writeKeyBase = workspaceKey ?? keyForStore(store)
  }

  async create(): Promise<ChatSession> {
    const now = Date.now()
    return { id: genId('sess'), title: '新会话', createdAt: now, updatedAt: now, archived: false, approvalPolicy: 'strict', messages: [] }
  }

  private async readSession(path: string): Promise<ChatSession | null> {
    const raw = await this.store.readText(path)
    if (!raw) return null
    try {
      const session = JSON.parse(raw) as ChatSession
      if (typeof session.id !== 'string' || !session.id) return null
      if (session.creativePreferences !== undefined) session.creativePreferences = validateCreativePreferences(session.creativePreferences)
      return session
    } catch { return null }
  }

  private async storedDir(id: string): Promise<string | null> {
    const safeId = safeSessionId(id)
    let dirs: string[] = []
    try { dirs = await this.store.listDirs(SESSION_ROOT) } catch { return null }
    for (const dir of dirs) {
      if (dir === 'legacy' || !isSafeSessionDir(dir)) continue
      const session = await this.readSession(sessionJsonPath(dir))
      if (session?.id === safeId || session?.id === id) return dir
    }
    return null
  }

  private async writeAt(session: ChatSession, storageDir: string): Promise<void> {
    const next = session.creativePreferences === undefined
      ? { ...session, storageDir }
      : { ...session, storageDir, creativePreferences: validateCreativePreferences(session.creativePreferences) }
    const jsonPath = sessionJsonPath(storageDir)
    await this.store.ensureDir(`${SESSION_ROOT}/${storageDir}`)
    await this.store.ensureDir(sessionTmpPath(storageDir))
    const tmpPath = `${jsonPath}.tmp`
    await this.store.writeText(tmpPath, JSON.stringify(next, null, 2))
    await this.store.move(tmpPath, jsonPath)
    session.storageDir = storageDir
  }

  private async migrateLegacy(): Promise<void> {
    let files: string[] = []
    try { files = await this.store.listFiles(SESSION_ROOT, '.json') } catch { return }
    for (const file of files) {
      const legacyPath = `${SESSION_ROOT}/${file}`
      const session = await this.readSession(legacyPath)
      if (!session) continue
      const existing = await this.storedDir(session.id)
      if (!existing) {
        const storageDir = session.storageDir && isSafeSessionDir(session.storageDir) ? session.storageDir : sessionDirName(session)
        try {
          await this.writeAt(session, storageDir)
          const verified = await this.readSession(sessionJsonPath(storageDir))
          if (!verified || verified.id !== session.id) continue
        } catch { continue }
      }
      try {
        await this.store.ensureDir(`${SESSION_ROOT}/legacy`)
        const backup = legacySessionBackupPath(file)
        if (await this.store.exists(backup)) await this.store.remove(backup)
        await this.store.move(legacyPath, backup)
      } catch { /* 保留原文件，下一次打开继续迁移 */ }
    }
  }

  async load(id: string): Promise<ChatSession | null> {
    await this.migrateLegacy()
    const dir = await this.storedDir(id)
    const session = dir
      ? await this.readSession(sessionJsonPath(dir))
      : await this.readSession(legacySessionPath(id)).catch(() => null)
    if (!session) return null
    const repaired = repairOrphanedToolCalls(session.messages)
    const compacted = compactRepeatedReadResults(repaired)
    if (JSON.stringify(compacted) !== JSON.stringify(session.messages)) {
      session.messages = compacted
      await this.save(session).catch(() => undefined)
    }
    return session
  }

  private async saveUnlocked(session: ChatSession, options: SessionSaveOptions = {}): Promise<void> {
    const compacted = compactRepeatedReadResults(session.messages)
    if (compacted !== session.messages) session.messages = compacted
    await this.migrateLegacy()
    const existingDir = await this.storedDir(session.id)
    const existing = existingDir ? await this.readSession(sessionJsonPath(existingDir)) : null
    if (existing) {
      if (existing.title !== '新会话' || session.title === '新会话') session.title = existing.title
      if (options.preserveArchived !== false) session.archived = existing.archived
      if (options.preserveApprovalPolicy !== false) session.approvalPolicy = existing.approvalPolicy
      if (options.preserveCreativePreferences !== false) session.creativePreferences = existing.creativePreferences ?? session.creativePreferences
    }
    const initialDir = sessionDirName({ ...session, title: '新会话' })
    const requestedDir = session.storageDir && isSafeSessionDir(session.storageDir) ? session.storageDir : null
    const desiredDir = requestedDir && requestedDir !== initialDir ? requestedDir : sessionDirName(session)
    const isInitialRename = Boolean(existingDir && existingDir !== desiredDir && session.title !== '新会话' && existingDir === initialDir)
    if (existingDir && existingDir !== desiredDir && isInitialRename) {
      await this.store.move(`${SESSION_ROOT}/${existingDir}`, `${SESSION_ROOT}/${desiredDir}`)
    }
    await this.writeAt(session, desiredDir)
  }

  async save(session: ChatSession, options: SessionSaveOptions = {}): Promise<void> {
    return withSessionWriteLock(`${this.writeKeyBase}:${session.id}`, () => this.saveUnlocked(session, options))
  }

  async delete(id: string): Promise<void> {
    return withSessionWriteLock(`${this.writeKeyBase}:${id}`, async () => {
      await this.migrateLegacy()
      const dir = await this.storedDir(id)
      if (dir) await this.store.remove(`${SESSION_ROOT}/${dir}`)
      const legacy = legacySessionPath(id)
      if (await this.store.exists(legacy)) await this.store.remove(legacy)
      const backup = `${SESSION_ROOT}/legacy/${safeSessionId(id)}.json`
      if (await this.store.exists(backup)) await this.store.remove(backup)
    })
  }

  async updateMeta(id: string, patch: { title?: string; archived?: boolean; approvalPolicy?: import('../../shared/types').ApprovalPolicy; creativePreferences?: CreativePreferences }): Promise<boolean> {
    return withSessionWriteLock(`${this.writeKeyBase}:${id}`, async () => {
      await this.migrateLegacy()
      const dir = await this.storedDir(id)
      const session = dir ? await this.readSession(sessionJsonPath(dir)) : await this.readSession(legacySessionPath(id))
      if (!session) return false
      if (patch.title !== undefined) session.title = patch.title.trim() || session.title
      if (patch.archived !== undefined) session.archived = patch.archived
      let next = patch.approvalPolicy === undefined ? session : setSessionApprovalPolicy(session, patch.approvalPolicy)
      if (patch.creativePreferences !== undefined) next = { ...next, creativePreferences: validateCreativePreferences(patch.creativePreferences), updatedAt: Date.now() }
      await this.saveUnlocked(next, {
        preserveArchived: patch.archived === undefined,
        preserveApprovalPolicy: patch.approvalPolicy === undefined,
        preserveCreativePreferences: patch.creativePreferences === undefined
      })
      return true
    })
  }

  async updateModelPreference(id: string, preference: import('../../shared/types').SessionModelPreference): Promise<boolean> {
    const session = await this.load(id)
    if (!session) return false
    await this.save(setSessionModelPreference(session, preference))
    return true
  }

  async list(): Promise<SessionMeta[]> {
    await this.migrateLegacy()
    const metas: SessionMeta[] = []
    let dirs: string[] = []
    try { dirs = await this.store.listDirs(SESSION_ROOT) } catch { return [] }
    for (const dir of dirs) {
      if (dir === 'legacy' || !isSafeSessionDir(dir)) continue
      const s = await this.readSession(sessionJsonPath(dir))
      if (!s) continue
      metas.push({ id: s.id, title: s.title, updatedAt: s.updatedAt, messageCount: s.messages.filter((m: ChatMessage) => m.role === 'user' || m.role === 'assistant').length, archived: Boolean(s.archived) })
    }
    return metas.sort((a, b) => b.updatedAt - a.updatedAt)
  }
}
