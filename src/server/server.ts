import { promises as fs } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { extname, join, relative, resolve, sep } from 'node:path'
import { URL } from 'node:url'
import { NodeFileStore } from '../core/storage/nodeFileStore'
import { createAccessKeyVerifier, createSessionStore } from './auth'
import { ServerSettingsStore } from './settingsStore'
import { UsageService } from '../core/usage/usageService'
import { WorkspaceRegistry } from './workspaceRegistry'
import type { AgentEventEnvelope, FetchModelsInput, SettingsPatch, StoryFabricApi } from '../shared/api'
import type { ChapterDoc, ChatSession, OutlineDoc, ProviderInput, Relationship, RunAgentRequest, SettingDoc, StoryEvent, NoteDoc, VolumeMeta } from '../shared/types'
import { CoreAgentService } from '../core/agent/agentLoop'
import { getAdapter, fetchProviderModels } from '../core/llm'
import { CoreSessionStore } from '../core/workspace/sessionStore'
import { decodeSessionArchive, exportSessionArchive } from '../core/workspace/sessionArchive'
import { exportWorkspaceArchive, WORKSPACE_ARCHIVE_MAX_BYTES, WORKSPACE_ARCHIVE_MIME } from '../core/workspace/archive'
import { listVolumes, saveVolume, deleteVolume, moveChapter, readGraphLayout, writeGraphLayout } from '../core/workspace/workspaceService'
import { listTrash, restoreFromTrash, purgeTrashEntry } from '../core/workspace/trash'
import { deleteChapter, deleteCharacter, deleteEvent, deleteNote, deleteOutlineDoc, deleteSetting, getChapterBody, getNote, getSetting, listNotes, listSettings, loadRelationships, saveChapter, saveCharacter, saveEvent, saveNote, saveOutlineDoc, saveRelationships, saveSetting, searchProject, genId } from '../core/workspace/entityStore'

const MAX_JSON_BODY_BYTES = 16 * 1024 * 1024
const DEFAULT_SESSION_TTL = 8 * 60 * 60 * 1000

export interface StoryFabricServerOptions {
  accessKey: string
  /** Deprecated legacy root; first boot moves it under the managed data directory. */
  workspaceRoot?: string
  dataDir?: string
  workspaceRegistry?: WorkspaceRegistry
  settingsPath?: string
  staticDir?: string
  sessionTtlMs?: number
  cookieSecure?: boolean
  corsOrigin?: string
}

interface AuthContext {
  token: string
  workspaceId?: string
}

interface Runtime {
  store: NodeFileStore
  sessions: CoreSessionStore
  agent: CoreAgentService
  operationQueue: Promise<void>
}

interface ScopedEnvelope extends AgentEventEnvelope {
  workspaceId: string
}

class EventHub {
  private readonly listeners = new Set<{ workspaceId: () => string | undefined; send: (envelope: AgentEventEnvelope) => void }>()

  subscribe(workspaceId: () => string | undefined, send: (envelope: AgentEventEnvelope) => void): () => void {
    const listener = { workspaceId, send }
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(envelope: ScopedEnvelope): void {
    for (const listener of this.listeners) {
      if (listener.workspaceId() === envelope.workspaceId) listener.send({ sessionId: envelope.sessionId, event: envelope.event })
    }
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
  const bytes = await readBinaryBody(req, MAX_JSON_BODY_BYTES)
  return Buffer.from(bytes).toString('utf8')
}

async function readBinaryBody(req: IncomingMessage, maxBytes: number): Promise<Uint8Array> {
  const contentLength = Number(req.headers['content-length'] ?? 0)
  if (Number.isFinite(contentLength) && contentLength > maxBytes) throw new Error('请求内容过大')
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += value.length
    if (size > maxBytes) throw new Error('请求内容过大')
    chunks.push(value)
  }
  return new Uint8Array(Buffer.concat(chunks))
}

function parseCookie(req: IncomingMessage, name: string): string | null {
  const raw = req.headers.cookie ?? ''
  for (const part of raw.split(';')) {
    const [key, ...value] = part.trim().split('=')
    if (key === name) {
      try { return decodeURIComponent(value.join('=')) } catch { return null }
    }
  }
  return null
}

function decodeUri(value: string): string | null {
  try { return decodeURIComponent(value) } catch { return null }
}

function parseBearer(req: IncomingMessage): string | null {
  const header = req.headers.authorization ?? ''
  const match = /^Bearer ([A-Za-z0-9_-]{32,})$/.exec(header)
  return match?.[1] ?? null
}

function cookieHeader(token: string, secure: boolean, ttlMs: number): string {
  return `storyfabric_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(ttlMs / 1000)}${secure ? '; Secure' : ''}`
}

function clearCookie(secure: boolean): string {
  return `storyfabric_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`
}

function mimeType(path: string): string {
  return {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2'
  }[extname(path).toLowerCase()] ?? 'application/octet-stream'
}

async function serveStatic(req: IncomingMessage, res: ServerResponse, root: string): Promise<boolean> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false
  const requestUrl = new URL(req.url ?? '/', 'http://storyfabric.local')
  let pathname: string
  try { pathname = decodeURIComponent(requestUrl.pathname) } catch { sendError(res, 400, '非法 URL'); return true }
  const rootPath = resolve(root)
  const requested = resolve(rootPath, `.${pathname === '/' ? '/index.html' : pathname}`)
  const rel = relative(rootPath, requested)
  if (rel === '..' || rel.startsWith(`..${sep}`)) { sendError(res, 403, '禁止访问服务目录外路径'); return true }
  let filePath = requested
  try { if ((await fs.stat(filePath)).isDirectory()) filePath = join(filePath, 'index.html') } catch {
    if (!requestUrl.pathname.includes('.')) filePath = join(rootPath, 'index.html')
    else return false
  }
  try {
    const body = await fs.readFile(filePath)
    res.writeHead(200, { 'content-type': mimeType(filePath), 'cache-control': 'no-cache' })
    if (req.method !== 'HEAD') res.end(body)
    else res.end()
    return true
  } catch { return false }
}

/** Compatibility helper for callers that still bootstrap from a legacy root. */
export async function ensureServerWorkspace(root: string): Promise<void> {
  await WorkspaceRegistry.open(resolve(root, '..'), root)
}

export function createStoryFabricServer(options: StoryFabricServerOptions): Server {
  const dataRoot = resolve(options.dataDir ?? (options.workspaceRoot ? join(options.workspaceRoot, '..') : '/data'))
  const registry = options.workspaceRegistry ?? new WorkspaceRegistry(dataRoot, options.workspaceRoot ?? join(dataRoot, 'workspace'))
  const registryReady = registry.ensureReady()
  const settings = new ServerSettingsStore(options.settingsPath ?? join(dataRoot, 'settings.json'), options.accessKey)
  const usage = new UsageService(join(dataRoot, 'usage.json'))
  const verifier = createAccessKeyVerifier(options.accessKey)
  const authSessions = createSessionStore({ ttlMs: options.sessionTtlMs ?? DEFAULT_SESSION_TTL })
  const sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL
  const secureCookie = options.cookieSecure ?? process.env.STORYFABRIC_COOKIE_SECURE === '1'
  const corsOrigin = options.corsOrigin ?? process.env.STORYFABRIC_CORS_ORIGIN ?? '*'
  const authAttempts = new Map<string, { count: number; resetAt: number }>()
  const events = new EventHub()
  const runtimes = new Map<string, Runtime>()

  const authenticate = (req: IncomingMessage): AuthContext | null => {
    const token = parseBearer(req) ?? parseCookie(req, 'storyfabric_session')
    if (!token) return null
    const session = authSessions.get(token)
    return session ? { token, workspaceId: session.workspaceId } : null
  }

  const requireAuth = (req: IncomingMessage, res: ServerResponse): AuthContext | null => {
    const context = authenticate(req)
    if (context) return context
    sendError(res, 401, '需要登录')
    return null
  }

  const runtimeOf = async (context: AuthContext): Promise<{ id: string; runtime: Runtime }> => {
    await registryReady
    const id = context.workspaceId
    if (!id) throw new Error('请先选择工作区')
    let runtime = runtimes.get(id)
    if (!runtime) {
      const store = await registry.getStore(id)
      const sessions = new CoreSessionStore(store)
      const agent = new CoreAgentService({
        store,
        sessions,
        settings: () => settings.agentSettings(),
        getAdapter,
        emit: (sessionId, event) => events.emit({ workspaceId: id, sessionId, event }),
        onUsage: (record) => void usage.append(record).catch(() => {})
      })
      runtime = { store, sessions, agent, operationQueue: Promise.resolve() }
      runtimes.set(id, runtime)
    }
    return { id, runtime }
  }

  const serializeWorkspace = async <T>(runtime: Runtime, operation: () => Promise<T>): Promise<T> => {
    const run = runtime.operationQueue.catch(() => undefined).then(operation)
    runtime.operationQueue = run.then(() => undefined, () => undefined)
    return run
  }

  const dispatch = async (context: AuthContext, method: string, args: unknown[], serialized = false): Promise<unknown> => {
    await registryReady
    const arg = <T>(index = 0): T => args[index] as T
    if (method === 'pickFolder') return null
    if (method === 'getDefaultWorkspaceDir') return ''
    if (method === 'listWorkspaces') return registry.list()
    if (method === 'createWorkspace') {
      const summary = await registry.create(String(arg<string>(1) || 'StoryFabric'))
      authSessions.setWorkspace(context.token, summary.path)
      return summary.path
    }
    if (method === 'openWorkspace') {
      const summary = await registry.summary(String(arg<string>()))
      authSessions.setWorkspace(context.token, summary.path)
      return summary
    }
    if (method === 'closeWorkspace') { authSessions.setWorkspace(context.token); return undefined }
    if (method === 'getCurrentWorkspace' || method === 'refreshWorkspace') {
      const id = context.workspaceId
      return id ? registry.summary(id) : null
    }
    // 用量日志是服务端全局的，与工作区无关，也不该排在 agent 长任务的操作队列后面
    if (method === 'getUsageRecords') return usage.list()
    if (method === 'exportWorkspace' || method === 'importWorkspace') throw new Error('远程工作区请使用压缩包传输端点')

    const { id: workspaceId, runtime } = await runtimeOf(context)
    const needsImmediateAgentControl = method === 'agentConfirm' || method === 'agentAbort'
    if (!serialized && !needsImmediateAgentControl) return serializeWorkspace(runtime, () => dispatch(context, method, args, true))
    const { store } = runtime
    const saveChapterMeta = async (input: Partial<ChapterDoc>): Promise<unknown> => {
      const saved = await saveChapter(store, input)
      const { content: _content, ...meta } = saved
      return meta
    }

    switch (method as keyof StoryFabricApi) {
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
        const existing = request.sessionId ? await runtime.sessions.load(request.sessionId) : null
        const session = existing ?? await runtime.sessions.create()
        if (!existing) await runtime.sessions.save(session)
        const next = { ...request, sessionId: session.id }
        void serializeWorkspace(runtime, () => runtime.agent.run(next)).catch((error) => {
          events.emit({ workspaceId, sessionId: session.id, event: { type: 'error', message: error instanceof Error ? error.message : String(error) } })
          events.emit({ workspaceId, sessionId: session.id, event: { type: 'done' } })
        })
        return { sessionId: session.id }
      }
      case 'agentConfirm': runtime.agent.confirmChange(arg<string>(), Boolean(arg<boolean>(1))); return undefined
      case 'agentAbort': runtime.agent.abort(arg<string>()); return undefined
      case 'listSessions': return runtime.sessions.list()
      case 'createSession': { const session = await runtime.sessions.create(); await runtime.sessions.save(session); return session }
      case 'exportSession': { const session = await runtime.sessions.load(arg<string>()); if (!session) throw new Error('会话不存在'); return exportSessionArchive(session) }
      case 'importSession': {
        const imported = decodeSessionArchive(arg<string>())
        const session: ChatSession = { ...imported, id: genId('sess'), title: imported.title || '导入会话', updatedAt: Date.now(), archived: false }
        await runtime.sessions.save(session)
        return { id: session.id, title: session.title, updatedAt: session.updatedAt, messageCount: session.messages.filter((message) => message.role === 'user' || message.role === 'assistant').length, archived: false }
      }
      case 'loadSession': return runtime.sessions.load(arg<string>())
      case 'deleteSession': return runtime.sessions.delete(arg<string>())
      case 'updateSession': if (!(await runtime.sessions.updateMeta(arg<string>(), arg<{ title?: string; archived?: boolean }>(1)))) throw new Error('会话不存在'); return undefined
      default: throw new Error(`不支持的 API 方法：${method}`)
    }
  }

  const handleRpc = async (req: IncomingMessage, res: ServerResponse, context: AuthContext): Promise<void> => {
    let payload: { method?: string; args?: unknown[] }
    try { payload = JSON.parse(await readBody(req)) as { method?: string; args?: unknown[] } } catch (error) { sendError(res, 400, error instanceof Error ? error.message : '请求 JSON 无效'); return }
    if (!payload.method || !Array.isArray(payload.args)) { sendError(res, 400, 'RPC 请求格式无效'); return }
    try { sendJson(res, 200, { result: await dispatch(context, payload.method, payload.args) }) } catch (error) { sendError(res, 400, error) }
  }

  return createServer(async (req, res) => {
    res.setHeader('x-content-type-options', 'nosniff')
    res.setHeader('referrer-policy', 'no-referrer')
    res.setHeader('access-control-allow-origin', corsOrigin)
    if (corsOrigin !== '*') res.setHeader('access-control-allow-credentials', 'true')
    res.setHeader('access-control-allow-headers', 'authorization, content-type, x-storyfabric-workspace-name')
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS')
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
    const pathname = new URL(req.url ?? '/', 'http://storyfabric.local').pathname

    if (pathname === '/healthz' && req.method === 'GET') { sendJson(res, 200, { ok: true }); return }
    if (pathname === '/api/auth/login' && req.method === 'POST') {
      try {
        const address = req.socket.remoteAddress ?? 'unknown'
        const now = Date.now()
        const attempt = authAttempts.get(address)
        if (attempt && attempt.resetAt > now && attempt.count >= 10) { sendError(res, 429, '登录尝试过于频繁，请稍后再试'); return }
        const body = JSON.parse(await readBody(req)) as { key?: string }
        if (!verifier.verify(String(body.key ?? ''))) {
          const next = attempt && attempt.resetAt > now ? attempt : { count: 0, resetAt: now + 60_000 }
          next.count++
          authAttempts.set(address, next)
          sendError(res, 401, '访问密钥错误'); return
        }
        authAttempts.delete(address)
        const token = authSessions.issue()
        sendJson(res, 200, { authenticated: true }, { 'set-cookie': cookieHeader(token, secureCookie, sessionTtlMs) })
      } catch (error) { sendError(res, 400, error) }
      return
    }
    if (pathname === '/api/auth/token' && req.method === 'POST') {
      try {
        const address = req.socket.remoteAddress ?? 'unknown'
        const now = Date.now()
        const attempt = authAttempts.get(address)
        if (attempt && attempt.resetAt > now && attempt.count >= 10) { sendError(res, 429, '登录尝试过于频繁，请稍后再试'); return }
        const body = JSON.parse(await readBody(req)) as { key?: string }
        if (!verifier.verify(String(body.key ?? ''))) {
          const next = attempt && attempt.resetAt > now ? attempt : { count: 0, resetAt: now + 60_000 }
          next.count++
          authAttempts.set(address, next)
          sendError(res, 401, '访问密钥错误'); return
        }
        authAttempts.delete(address)
        sendJson(res, 200, { token: authSessions.issue(), expiresAt: Date.now() + sessionTtlMs })
      } catch (error) { sendError(res, 400, error) }
      return
    }
    if (pathname === '/api/auth/logout' && req.method === 'POST') {
      const token = parseBearer(req) ?? parseCookie(req, 'storyfabric_session')
      if (token) authSessions.revoke(token)
      sendJson(res, 200, { authenticated: false }, { 'set-cookie': clearCookie(secureCookie) })
      return
    }
    if (pathname === '/api/auth/session' && req.method === 'GET') { sendJson(res, 200, { authenticated: Boolean(authenticate(req)) }); return }

    // The login shell and its assets must be reachable before a session exists.
    // Keep every API route behind the access-key session below.
    if (!pathname.startsWith('/api/') && options.staticDir && await serveStatic(req, res, options.staticDir)) return

    const context = requireAuth(req, res)
    if (!context) return
    try { await registryReady } catch (error) { sendError(res, 500, error); return }

    if (pathname === '/api/workspaces' && req.method === 'GET') { sendJson(res, 200, await registry.list()); return }
    if (pathname === '/api/workspaces' && req.method === 'POST') {
      try {
        const body = JSON.parse(await readBody(req)) as { name?: string }
        const summary = await registry.create(String(body.name ?? 'StoryFabric'))
        authSessions.setWorkspace(context.token, summary.path)
        sendJson(res, 201, summary)
      } catch (error) { sendError(res, 400, error) }
      return
    }
    if (pathname === '/api/workspaces/import' && req.method === 'POST') {
      try {
        const bytes = await readBinaryBody(req, WORKSPACE_ARCHIVE_MAX_BYTES)
        const requestedName = req.headers['x-storyfabric-workspace-name']
        const name = typeof requestedName === 'string' ? decodeURIComponent(requestedName) : undefined
        const summary = await registry.importArchive(bytes, name)
        authSessions.setWorkspace(context.token, summary.path)
        sendJson(res, 201, summary)
      } catch (error) { sendError(res, 400, error) }
      return
    }
    const match = /^\/api\/workspaces\/([^/]+)\/(open|archive)$/.exec(pathname)
    if (match) {
      const id = decodeUri(match[1])
      if (id === null) { sendError(res, 400, '非法工作区地址'); return }
      if (match[2] === 'open' && req.method === 'POST') {
        try { const summary = await registry.summary(id); authSessions.setWorkspace(context.token, summary.path); sendJson(res, 200, summary) } catch (error) { sendError(res, 404, error) }
        return
      }
      if (match[2] === 'archive' && req.method === 'GET') {
        try {
          const summary = await registry.summary(id)
          const archive = await exportWorkspaceArchive(await registry.getStore(id), summary.name)
          res.writeHead(200, { 'content-type': WORKSPACE_ARCHIVE_MIME, 'content-disposition': 'attachment; filename=storyfabric.storyfabric.zip', 'cache-control': 'no-store' })
          res.end(Buffer.from(archive.bytes))
        } catch (error) { sendError(res, 404, error) }
        return
      }
    }
    if (pathname === '/api/events' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' })
      res.write(': connected\n\n')
      const unsubscribe = events.subscribe(() => authSessions.get(context.token)?.workspaceId, (envelope) => res.write(`data: ${JSON.stringify(envelope)}\n\n`))
      const keepAlive = setInterval(() => res.write(': keepalive\n\n'), 25_000)
      req.on('close', () => { clearInterval(keepAlive); unsubscribe() })
      return
    }
    if (pathname === '/api/rpc' && req.method === 'POST') { await handleRpc(req, res, context); return }
    if (options.staticDir && await serveStatic(req, res, options.staticDir)) return
    sendError(res, 404, '未找到资源')
  })
}
