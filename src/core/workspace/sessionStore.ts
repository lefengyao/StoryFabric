import type { ChatMessage, ChatSession, SessionMeta } from '../../shared/types'
import { validateCreativePreferences, type CreativePreferences } from '../../shared/creative'
import type { FileStore } from '../storage/fileStore'
import { genId } from './entityStore'
import { setSessionApprovalPolicy, setSessionModelPreference } from './sessionPreferences'

export function titleFromMessage(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > 24 ? `${t.slice(0, 24)}…` : t || '新会话'
}

export class CoreSessionStore {
  constructor(private readonly store: FileStore) {}

  async create(): Promise<ChatSession> {
    const now = Date.now()
    return { id: genId('sess'), title: '新会话', createdAt: now, updatedAt: now, archived: false, approvalPolicy: 'strict', messages: [] }
  }

  private pathOf(id: string): string { return `.storyfabric/sessions/${id.replace(/[^a-zA-Z0-9_-]/g, '')}.json` }

  async load(id: string): Promise<ChatSession | null> {
    const raw = await this.store.readText(this.pathOf(id))
    if (!raw) return null
    try {
      const session = JSON.parse(raw) as ChatSession
      if (session.creativePreferences !== undefined) session.creativePreferences = validateCreativePreferences(session.creativePreferences)
      return session
    } catch { return null }
  }

  async save(session: ChatSession): Promise<void> {
    await this.store.ensureDir('.storyfabric/sessions')
    await this.store.writeText(this.pathOf(session.id), JSON.stringify(session, null, 2))
  }

  async delete(id: string): Promise<void> { await this.store.remove(this.pathOf(id)) }

  async updateMeta(id: string, patch: { title?: string; archived?: boolean; approvalPolicy?: import('../../shared/types').ApprovalPolicy; creativePreferences?: CreativePreferences }): Promise<boolean> {
    const session = await this.load(id)
    if (!session) return false
    if (patch.title !== undefined) session.title = patch.title.trim() || session.title
    if (patch.archived !== undefined) session.archived = patch.archived
    let next = patch.approvalPolicy === undefined ? session : setSessionApprovalPolicy(session, patch.approvalPolicy)
    if (patch.creativePreferences !== undefined) next = { ...next, creativePreferences: validateCreativePreferences(patch.creativePreferences), updatedAt: Date.now() }
    await this.save(next)
    return true
  }

  async updateModelPreference(id: string, preference: import('../../shared/types').SessionModelPreference): Promise<boolean> {
    const session = await this.load(id)
    if (!session) return false
    await this.save(setSessionModelPreference(session, preference))
    return true
  }

  async list(): Promise<SessionMeta[]> {
    const metas: SessionMeta[] = []
    for (const file of await this.store.listFiles('.storyfabric/sessions', '.json')) {
      const raw = await this.store.readText(`.storyfabric/sessions/${file}`)
      if (!raw) continue
      try {
        const s = JSON.parse(raw) as ChatSession
        metas.push({ id: s.id, title: s.title, updatedAt: s.updatedAt, messageCount: s.messages.filter((m: ChatMessage) => m.role === 'user' || m.role === 'assistant').length, archived: Boolean(s.archived) })
      } catch {
        /* skip invalid session */
      }
    }
    return metas.sort((a, b) => b.updatedAt - a.updatedAt)
  }
}
