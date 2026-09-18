/** 智能体会话持久化：<workspace>/.storyfabric/sessions/<id>.json */
import { promises as fs } from 'fs'
import { join } from 'path'
import type { ChatMessage, ChatSession, SessionMeta } from '../../shared/types'
import { validateCreativePreferences, type CreativePreferences } from '../../shared/creative'
import { genId } from './entityStore'
import { setSessionApprovalPolicy, setSessionModelPreference } from '../../core/workspace/sessionPreferences'

export function titleFromMessage(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > 24 ? t.slice(0, 24) + '…' : t || '新会话'
}

export class SessionStore {
  private dir: string

  constructor(workspaceRoot: string) {
    this.dir = join(workspaceRoot, '.storyfabric', 'sessions')
  }

  private pathOf(id: string): string {
    // 防目录穿越：id 只允许字母数字下划线连字符
    const safe = id.replace(/[^a-zA-Z0-9_-]/g, '')
    return join(this.dir, `${safe}.json`)
  }

  async create(): Promise<ChatSession> {
    const now = Date.now()
    return { id: genId('sess'), title: '新会话', createdAt: now, updatedAt: now, archived: false, approvalPolicy: 'strict', messages: [] }
  }

  /** 更新会话元信息（重命名 / 归档），文件不存在返回 false */
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

  async load(id: string): Promise<ChatSession | null> {
    try {
      const session = JSON.parse(await fs.readFile(this.pathOf(id), 'utf-8')) as ChatSession
      if (session.creativePreferences !== undefined) session.creativePreferences = validateCreativePreferences(session.creativePreferences)
      return session
    } catch {
      return null
    }
  }

  async save(session: ChatSession): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true })
    const tmp = this.pathOf(session.id) + '.tmp'
    const next = session.creativePreferences === undefined
      ? session
      : { ...session, creativePreferences: validateCreativePreferences(session.creativePreferences) }
    await fs.writeFile(tmp, JSON.stringify(next, null, 2), 'utf-8')
    await fs.rename(tmp, this.pathOf(session.id))
  }

  async delete(id: string): Promise<void> {
    await fs.rm(this.pathOf(id), { force: true })
  }

  async list(): Promise<SessionMeta[]> {
    let files: string[] = []
    try {
      files = (await fs.readdir(this.dir)).filter((f) => f.endsWith('.json'))
    } catch {
      return []
    }
    const metas: SessionMeta[] = []
    for (const f of files) {
      try {
        const s = JSON.parse(await fs.readFile(join(this.dir, f), 'utf-8')) as ChatSession
        metas.push({
          id: s.id,
          title: s.title,
          updatedAt: s.updatedAt,
          messageCount: s.messages.filter((m: ChatMessage) => m.role === 'user' || m.role === 'assistant').length,
          archived: Boolean(s.archived)
        })
      } catch {
        /* 跳过损坏文件 */
      }
    }
    return metas.sort((a, b) => b.updatedAt - a.updatedAt)
  }
}
