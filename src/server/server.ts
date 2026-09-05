import { promises as fs } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { basename, dirname, extname, relative, resolve, join, sep } from 'node:path'
import { URL } from 'node:url'
import { createAccessKeyVerifier, createSessionStore } from './auth'
import { ServerSettingsStore } from './settingsStore'
import type { AgentEventEnvelope, FetchModelsInput, SettingsPatch, StoryFabricApi } from '../shared/api'
import type { ChapterDoc, ChatSession, OutlineDoc, ProviderInput, Relationship, RunAgentRequest, SettingDoc, StoryEvent, NoteDoc, VolumeMeta } from '../shared/types'
import { NodeFileStore } from '../core/storage/nodeFileStore'
import { CoreAgentService } from '../core/agent/agentLoop'
import { getAdapter, fetchProviderModels } from '../core/llm'
import { CoreSessionStore } from '../core/workspace/sessionStore'
import { decodeSessionArchive, exportSessionArchive } from '../core/workspace/sessionArchive'
import { exportWorkspaceArchive, importWorkspaceArchive } from '../core/workspace/archive'
import { initializeWorkspace, loadSummary, validateWorkspace, listVolumes, saveVolume, deleteVolume, moveChapter, readGraphLayout, writeGraphLayout } from '../core/workspace/workspaceService'
import { listTrash, restoreFromTrash, purgeTrashEntry } from '../core/workspace/trash'
import { deleteChapter, deleteCharacter, deleteEvent, deleteNote, deleteOutlineDoc, deleteSetting, getChapterBody, getNote, getSetting, listNotes, listSettings, loadRelationships, saveChapter, saveCharacter, saveEvent, saveNote, saveOutlineDoc, saveRelationships, saveSetting, searchProject, genId } from '../core/workspace/entityStore'

const MAX_BODY_BYTES = 16 * 1024 * 1024
const DEFAULT_SESSION_TTL = 8 * 60 * 60 * 1000

export interface StoryFabricServerOptions {
  accessKey: string
  workspaceRoot: string
  settingsPath?: string
  staticDir?: string
  sessionTtlMs?: number
  cookieSecure?: boolean
}

class EventHub {
  private readonly listeners = new Set<(envelope: AgentEventEnvelope) => void>()

  subscribe(listener: (envelope: AgentEventEnvelope) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(envelope: AgentEventEnvelope): void {
    for (const listener of this.listeners) listener(envelope)
  }
}

function sendJson(res: ServerResponse, status: number, value: unknown, headers: Record<string, string> = {}): void {
  const payload = JSON.stringify(value)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers })
  res.end(payload)
}

function sendError(res: ServerResponse, status: number, error: unknown): void {
  sendJson(res, status, { error: error instanceof Error ? error.message : String(error) })
}

async function readBody(req: IncomingMessage): Promise<string> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += value.length
    if (size > MAX_BODY_BYTES) throw new Error('请求内容过大')
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function parseCookie(req: IncomingMessage, name: string): string | null {
  const raw = req.headers.cookie ?? ''
  for (const part of raw.split(';')) {
    const [key, ...value] = part.trim().split('=')
    if (key === name) return decodeURIComponent(value.join('='))
  }
  return null
}

function cookieHeader(token: string, secure: boolean, ttlMs: number): string {
  return `storyfabric_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(ttlMs / 1000)}${secure ? '; Secure' : ''}`
}

function clearCookie(secure: boolean): string {
  return `storyfabric_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`
}

function mimeType(path: string): string {
  return {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2'
  }[extname(path).toLowerCase()] ?? 'application/octet-stream'
}

async function serveStatic(req: IncomingMessage, res: ServerResponse, root: string): Promise<boolean> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false
  const requestUrl = new URL(req.url ?? '/', 'http://storyfabric.local')
  let pathname: string
  try {
    pathname = decodeURIComponent(requestUrl.pathname)
  } catch {
    sendError(res, 400, '非法 URL')
    return true
  }
  const rootPath = resolve(root)
  const requested = resolve(rootPath, `.${pathname === '/' ? '/index.html' : pathname}`)
  const rel = relative(rootPath, requested)
  if (rel === '..' || rel.startsWith(`..${sep}`)) {
    sendError(res, 403, '禁止访问工作区外路径')
    return true
  }
  let filePath = requested
  try {
    const stat = await fs.stat(filePath)
    if (stat.isDirectory()) filePath = join(filePath, 'index.html')
  } catch {
    if (!requestUrl.pathname.includes('.')) filePath = join(rootPath, 'index.html')
    else return false
  }
  try {
    const body = await fs.readFile(filePath)
    res.writeHead(200, { 'content-type': mimeType(filePath), 'cache-control': 'no-cache' })
    if (req.method !== 'HEAD') res.end(body)
    else res.end()
    return true
  } catch {
    return false
  }
}

export async function ensureServerWorkspace(root: string, name = 'StoryFabric'): Promise<void> {
  await fs.mkdir(root, { recursive: true })
  const store = new NodeFileStore(root)
  if (!(await store.exists('storyfabric.json'))) await initializeWorkspace(store, name)
}

export function createStoryFabricServer(options: StoryFabricServerOptions): Server {
  const root = resolve(options.workspaceRoot)
  const store = new NodeFileStore(root)
  const sessions = new CoreSessionStore(store)
  const settings = new ServerSettingsStore(options.settingsPath ?? join(dirname(root), 'settings.json'))
  const verifier = createAccessKeyVerifier(options.accessKey)
  const authSessions = createSessionStore({ ttlMs: options.sessionTtlMs ?? DEFAULT_SESSION_TTL })
  const sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL
  const events = new EventHub()
  const secureCookie = options.cookieSecure ?? process.env.STORYFABRIC_COOKIE_SECURE === '1'
  const agent = new CoreAgentService({
    store,
    sessions,
    settings: () => settings.agentSettings(),
    getAdapter,
    emit: (sessionId, event) => events.emit({ sessionId, event })
  })

  const requireAuth = (req: IncomingMessage, res: ServerResponse): boolean => {
    const token = parseCookie(req, 'storyfabric_session')
    if (token && authSessions.has(token)) return true
    sendError(res, 401, '需要登录')
    return false
  }

  const summary = (): Promise<Awaited<ReturnType<typeof loadSummary>>> => loadSummary(store, basename(root), root)
  const saveChapterMeta = async (input: Partial<ChapterDoc>): Promise<unknown> => {
    const saved = await saveChapter(store, input)
    const { content: _content, ...meta } = saved
    void _content
    return meta
  }

  const dispatch = async (method: string, args: unknown[]): Promise<unknown> => {
    const arg = <T>(index = 0): T => args[index] as T
    switch (method as keyof StoryFabricApi) {
      case 'pickFolder': return null
      case 'getDefaultWorkspaceDir': return root
      case 'createWorkspace': await ensureServerWorkspace(root, String(arg<string>(1) || 'StoryFabric')); return root
      case 'openWorkspace': {
        const requested = arg<string>()
        if (requested && resolve(requested) !== root) throw new Error('Linux 服务只允许访问配置的工作区')
        return summary()
      }
      case 'closeWorkspace': return undefined
      case 'getCurrentWorkspace': return summary()
      case 'refreshWorkspace': return summary()
      case 'exportWorkspace': { const current = await summary(); return exportWorkspaceArchive(store, current.name) }
      case 'importWorkspace': await importWorkspaceArchive(store, arg<string>()); return summary()
      case 'getChapterBody': return getChapterBody(store, arg<string>())
      case 'searchProject': return searchProject(store, arg<string>())
      case 'getGraphLayout': return readGraphLayout(store)
      case 'saveGraphLayout': return writeGraphLayout(store, arg<Record<string, { x: number; y: number }> >())
      case 'saveCharacter': return saveCharacter(store, arg())
      case 'deleteCharacter': return deleteCharacter(store, arg<string>())
      case 'saveRelationships': return saveRelationships(store, arg<Relationship[]>())
      case 'saveOutlineDoc': return saveOutlineDoc(store, arg<Partial<OutlineDoc>>())
      case 'deleteOutlineDoc': return deleteOutlineDoc(store, arg<string>())
      case 'saveEvent': return saveEvent(store, arg<Partial<StoryEvent>>())
      case 'deleteEvent': return deleteEvent(store, arg<string>())
      case 'saveChapter': return saveChapterMeta(arg<Partial<ChapterDoc>>())
      case 'deleteChapter': return deleteChapter(store, arg<string>())
      case 'listVolumes': return listVolumes(store)
      case 'saveVolume': return saveVolume(store, arg<Partial<VolumeMeta> & { id?: string }>())
      case 'deleteVolume': return deleteVolume(store, arg<string>())
      case 'moveChapter': return moveChapter(store, arg<string>(), arg<{ box: 'draft' | 'main'; volumeId?: string }>(1))
      case 'listTrash': return listTrash(store)
      case 'restoreTrash': return restoreFromTrash(store, arg<string>())
      case 'purgeTrash': return purgeTrashEntry(store, arg<string>())
      case 'listSettings': return listSettings(store)
      case 'getSetting': return getSetting(store, arg<string>())
      case 'saveSetting': return saveSetting(store, arg<Partial<SettingDoc>>())
      case 'deleteSetting': return deleteSetting(store, arg<string>())
      case 'listNotes': return listNotes(store)
      case 'getNote': return getNote(store, arg<string>())
      case 'saveNote': return saveNote(store, arg<Partial<NoteDoc>>())
      case 'deleteNote': return deleteNote(store, arg<string>())
      case 'getSettings': return settings.load()
      case 'updateSettings': return settings.update(arg<SettingsPatch>())
      case 'saveProvider': return settings.saveProvider(arg<ProviderInput>())
      case 'deleteProvider': return settings.deleteProvider(arg<string>())
      case 'fetchModels': {
        const input = arg<FetchModelsInput>()
        const provider = await settings.providerInput(input)
        return fetchProviderModels(provider.protocol, provider.baseUrl, provider.apiKey)
      }
      case 'agentRun': {
        const request = arg<RunAgentRequest>()
        const existing = request.sessionId ? await sessions.load(request.sessionId) : null
        const session = existing ?? await sessions.create()
        if (!existing) await sessions.save(session)
        const nextRequest = { ...request, sessionId: session.id }
        void agent.run(nextRequest).catch((error) => {
          events.emit({ sessionId: session.id, event: { type: 'error', message: error instanceof Error ? error.message : String(error) } })
          events.emit({ sessionId: session.id, event: { type: 'done' } })
        })
        return { sessionId: session.id }
      }
      case 'agentConfirm': agent.confirmChange(arg<string>(), Boolean(arg<boolean>(1))); return undefined
      case 'agentAbort': agent.abort(arg<string>()); return undefined
      case 'listSessions': return sessions.list()
      case 'createSession': { const session = await sessions.create(); await sessions.save(session); return session }
      case 'exportSession': { const session = await sessions.load(arg<string>()); if (!session) throw new Error('会话不存在'); return exportSessionArchive(session) }
      case 'importSession': {
        const imported = decodeSessionArchive(arg<string>())
        const session: ChatSession = { ...imported, id: genId('sess'), title: imported.title || '导入会话', updatedAt: Date.now(), archived: false }
        await sessions.save(session)
        return { id: session.id, title: session.title, updatedAt: session.updatedAt, messageCount: session.messages.filter((message) => message.role === 'user' || message.role === 'assistant').length, archived: false }
      }
      case 'loadSession': return sessions.load(arg<string>())
      case 'deleteSession': return sessions.delete(arg<string>())
      case 'updateSession': if (!(await sessions.updateMeta(arg<string>(), arg<{ title?: string; archived?: boolean }>(1)))) throw new Error('会话不存在'); return undefined
      default: throw new Error(`不支持的 API 方法：${method}`)
    }
  }

  const handleRpc = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!requireAuth(req, res)) return
    let payload: { method?: string; args?: unknown[] }
    try {
      payload = JSON.parse(await readBody(req)) as { method?: string; args?: unknown[] }
    } catch (error) {
      sendError(res, 400, error instanceof Error ? error.message : '请求 JSON 无效')
      return
    }
    if (!payload.method || !Array.isArray(payload.args)) {
      sendError(res, 400, 'RPC 请求格式无效')
      return
    }
    try {
      sendJson(res, 200, { result: await dispatch(payload.method, payload.args) })
    } catch (error) {
      sendError(res, 400, error)
    }
  }

  return createServer(async (req, res) => {
    res.setHeader('x-content-type-options', 'nosniff')
    res.setHeader('referrer-policy', 'no-referrer')
    const pathname = new URL(req.url ?? '/', 'http://storyfabric.local').pathname

    if (pathname === '/healthz' && req.method === 'GET') {
      sendJson(res, 200, { ok: true })
      return
    }
    if (pathname === '/api/auth/login' && req.method === 'POST') {
      try {
        const body = JSON.parse(await readBody(req)) as { key?: string }
        if (!verifier.verify(String(body.key ?? ''))) {
          sendError(res, 401, '访问密钥错误')
          return
        }
        const token = authSessions.issue()
        sendJson(res, 200, { authenticated: true }, { 'set-cookie': cookieHeader(token, secureCookie, sessionTtlMs) })
      } catch (error) {
        sendError(res, 400, error)
      }
      return
    }
    if (pathname === '/api/auth/logout' && req.method === 'POST') {
      const token = parseCookie(req, 'storyfabric_session')
      if (token) authSessions.revoke(token)
      sendJson(res, 200, { authenticated: false }, { 'set-cookie': clearCookie(secureCookie) })
      return
    }
    if (pathname === '/api/auth/session' && req.method === 'GET') {
      sendJson(res, 200, { authenticated: Boolean(parseCookie(req, 'storyfabric_session') && authSessions.has(parseCookie(req, 'storyfabric_session')!)) })
      return
    }
    if (pathname === '/api/events' && req.method === 'GET') {
      if (!requireAuth(req, res)) return
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' })
      res.write(': connected\n\n')
      const unsubscribe = events.subscribe((envelope) => res.write(`data: ${JSON.stringify(envelope)}\n\n`))
      const keepAlive = setInterval(() => res.write(': keepalive\n\n'), 25_000)
      req.on('close', () => { clearInterval(keepAlive); unsubscribe() })
      return
    }
    if (pathname === '/api/rpc' && req.method === 'POST') {
      await handleRpc(req, res)
      return
    }
    if (options.staticDir && await serveStatic(req, res, options.staticDir)) return
    sendError(res, 404, '未找到资源')
  })
}
