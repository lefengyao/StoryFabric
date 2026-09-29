/** 智能体会话持久化：<workspace>/.storyfabric/sessions/<date-slug-id>/session.json */
import { promises as fs } from 'fs'
import { join } from 'path'
import type { ChatMessage, ChatSession, SessionMeta } from '../../shared/types'
import { validateCreativePreferences, type CreativePreferences } from '../../shared/creative'
import { isSafeSessionDir, legacySessionPath, safeSessionId, sessionDirName } from '../../shared/sessionPaths'
import { genId } from './entityStore'
import { setSessionApprovalPolicy, setSessionModelPreference } from '../../core/workspace/sessionPreferences'
import { withSessionWriteLock } from '../../shared/sessionWriteLock'

export function titleFromMessage(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > 24 ? t.slice(0, 24) + '…' : t || '新会话'
}

export class SessionStore {
  private dir: string
  private readonly workspaceRoot: string

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot
    this.dir = join(workspaceRoot, '.storyfabric', 'sessions')
  }

  private writeKey(id: string): string { return `${this.workspaceRoot}:${id}` }

  private pathOf(storageDir: string): string { return join(this.dir, storageDir, 'session.json') }
  private legacyPathOf(id: string): string { return join(this.dir, `${safeSessionId(id)}.json`) }

  async create(): Promise<ChatSession> {
    const now = Date.now()
    return { id: genId('sess'), title: '新会话', createdAt: now, updatedAt: now, archived: false, approvalPolicy: 'strict', messages: [] }
  }

  private async readPath(path: string): Promise<ChatSession | null> {
    try {
      const session = JSON.parse(await fs.readFile(path, 'utf-8')) as ChatSession
      if (typeof session.id !== 'string' || !session.id) return null
      if (session.creativePreferences !== undefined) session.creativePreferences = validateCreativePreferences(session.creativePreferences)
      return session
    } catch { return null }
  }

  private async storedDir(id: string): Promise<string | null> {
    let dirs: string[] = []
    try { dirs = await fs.readdir(this.dir, { withFileTypes: true }).then((entries) => entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)) } catch { return null }
    for (const dir of dirs) {
      if (dir === 'legacy' || !isSafeSessionDir(dir)) continue
      const session = await this.readPath(this.pathOf(dir))
      if (session?.id === id) return dir
    }
    return null
  }

  private async writeAt(session: ChatSession, storageDir: string): Promise<void> {
    const next = session.creativePreferences === undefined
      ? { ...session, storageDir }
      : { ...session, storageDir, creativePreferences: validateCreativePreferences(session.creativePreferences) }
    const target = this.pathOf(storageDir)
    await fs.mkdir(join(this.dir, storageDir, 'tmp'), { recursive: true })
    const tmp = `${target}.tmp`
    await fs.writeFile(tmp, JSON.stringify(next, null, 2), 'utf-8')
    try {
      await fs.rename(tmp, target)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' && (error as NodeJS.ErrnoException).code !== 'EPERM') throw error
      await fs.rm(target, { force: true })
      await fs.rename(tmp, target)
    }
    session.storageDir = storageDir
  }

  private async migrateLegacy(): Promise<void> {
    let files: string[] = []
    try { files = (await fs.readdir(this.dir, { withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.endsWith('.json')).map((entry) => entry.name) } catch { return }
    for (const file of files) {
      const legacyPath = join(this.dir, file)
      const session = await this.readPath(legacyPath)
      if (!session) continue
      const existing = await this.storedDir(session.id)
      if (!existing) {
        const storageDir = session.storageDir && isSafeSessionDir(session.storageDir) ? session.storageDir : sessionDirName(session)
        try {
          await this.writeAt(session, storageDir)
          const verified = await this.readPath(this.pathOf(storageDir))
          if (!verified || verified.id !== session.id) continue
        } catch { continue }
      }
      try {
        await fs.mkdir(join(this.dir, 'legacy'), { recursive: true })
        const backup = join(this.dir, 'legacy', file)
        await fs.rm(backup, { force: true })
        await fs.rename(legacyPath, backup)
      } catch { /* 保留原文件，下一次打开继续迁移 */ }
    }
  }

  async updateMeta(id: string, patch: { title?: string; archived?: boolean; approvalPolicy?: import('../../shared/types').ApprovalPolicy; creativePreferences?: CreativePreferences }): Promise<boolean> {
    return withSessionWriteLock(this.writeKey(id), async () => {
      await this.migrateLegacy()
      const dir = await this.storedDir(id)
      const session = dir ? await this.readPath(this.pathOf(dir)) : await this.readPath(this.legacyPathOf(id))
      if (!session) return false
      if (patch.title !== undefined) session.title = patch.title.trim() || session.title
      if (patch.archived !== undefined) session.archived = patch.archived
      let next = patch.approvalPolicy === undefined ? session : setSessionApprovalPolicy(session, patch.approvalPolicy)
      if (patch.creativePreferences !== undefined) next = { ...next, creativePreferences: validateCreativePreferences(patch.creativePreferences), updatedAt: Date.now() }
      await this.saveUnlocked(next)
      return true
    })
  }

  async updateModelPreference(id: string, preference: import('../../shared/types').SessionModelPreference): Promise<boolean> {
    const session = await this.load(id)
    if (!session) return false
    await this.save(setSessionModelPreference(session, preference))
    return true
  }

  async load(id: string): Promise<ChatSession | null> {
    await this.migrateLegacy()
    const dir = await this.storedDir(id)
    if (dir) return this.readPath(this.pathOf(dir))
    try { return await this.readPath(this.legacyPathOf(id)) } catch { return null }
  }

  private async saveUnlocked(session: ChatSession): Promise<void> {
      await this.migrateLegacy()
      const existingDir = await this.storedDir(session.id)
      const initialDir = sessionDirName({ ...session, title: '新会话' })
      const requestedDir = session.storageDir && isSafeSessionDir(session.storageDir) ? session.storageDir : null
      const desiredDir = requestedDir && requestedDir !== initialDir ? requestedDir : sessionDirName(session)
      const isInitialRename = Boolean(existingDir && existingDir !== desiredDir && session.title !== '新会话' && existingDir === initialDir)
      if (existingDir && existingDir !== desiredDir && isInitialRename) await fs.rename(join(this.dir, existingDir), join(this.dir, desiredDir))
      await this.writeAt(session, desiredDir)
  }

  async save(session: ChatSession): Promise<void> {
    return withSessionWriteLock(this.writeKey(session.id), () => this.saveUnlocked(session))
  }

  async delete(id: string): Promise<void> {
    return withSessionWriteLock(this.writeKey(id), async () => {
      await this.migrateLegacy()
      const dir = await this.storedDir(id)
      if (dir) await fs.rm(join(this.dir, dir), { recursive: true, force: true })
      await fs.rm(this.legacyPathOf(id), { force: true })
      await fs.rm(join(this.dir, 'legacy', `${safeSessionId(id)}.json`), { force: true })
    })
  }

  async list(): Promise<SessionMeta[]> {
    await this.migrateLegacy()
    let dirs: string[] = []
    try { dirs = (await fs.readdir(this.dir, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name) } catch { return [] }
    const metas: SessionMeta[] = []
    for (const dir of dirs) {
      if (dir === 'legacy' || !isSafeSessionDir(dir)) continue
      const s = await this.readPath(this.pathOf(dir))
      if (!s) continue
      metas.push({ id: s.id, title: s.title, updatedAt: s.updatedAt, messageCount: s.messages.filter((m: ChatMessage) => m.role === 'user' || m.role === 'assistant').length, archived: Boolean(s.archived) })
    }
    return metas.sort((a, b) => b.updatedAt - a.updatedAt)
  }
}
