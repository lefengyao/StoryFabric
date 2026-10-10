import { promises as fs } from 'node:fs'
import { checkForUpdates } from '../shared/updates'
import { version as APP_VERSION } from '../../package.json'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { extname, join, relative, resolve, sep } from 'node:path'
import { URL } from 'node:url'
import type { FileStore } from '../core/storage/fileStore'
import { getDocumentSnapshot, saveDocument, saveHistoryVersion, listHistoryVersions, getHistoryVersion, updateHistoryVersion, deleteHistoryVersion, restoreHistoryVersion } from '../core/workspace/documentWrites'
import type { DocumentKind, HistorySaveOptions, HistoryVersionPatch } from '../shared/documentHistory'
import { NodeFileStore } from '../core/storage/nodeFileStore'
import { orderRecentWorkspacePaths } from '../shared/recentWorkspaces'
import { createAccessKeyVerifier, createAuthAttemptTracker, createSessionStore } from './auth'
import { ServerSettingsStore } from './settingsStore'
import { UsageService } from '../core/usage/usageService'
import { listWritingDays } from '../core/usage/writingStats'
import { WorkspaceRegistry } from './workspaceRegistry'
import type { AgentEventEnvelope, FetchModelsInput, RuntimeAgentEventEnvelope, SettingsPatch, StoryFabricApi } from '../shared/api'
import { adaptLegacyAgentEvent, legacyEventIdentity } from '../shared/agentRuntime'
import { RunEventBuffer, type RunReplay } from '../shared/runEvents'
import type { RunEventEnvelope } from '../shared/agentRuntime'
import { throwIfWorkspaceRequestAborted } from '../shared/api'
import type { ChapterDoc, ChatSession, OutlineDoc, ProviderInput, Relationship, RunAgentRequest, SettingDoc, StoryEvent, NoteDoc, VolumeMeta, WorkspaceListItem } from '../shared/types'
import { CoreAgentService } from '../core/agent/agentLoop'
import { getAdapter, fetchProviderModels } from '../core/llm'
import { CoreSessionStore } from '../core/workspace/sessionStore'
import { decodeSessionArchive, exportSessionArchive } from '../core/workspace/sessionArchive'
import { exportWorkspaceArchive, WORKSPACE_ARCHIVE_MAX_BYTES, WORKSPACE_ARCHIVE_MIME } from '../core/workspace/archive'
import { listVolumes, saveVolume, deleteVolume, moveChapter, readGraphLayout, writeGraphLayout } from '../core/workspace/workspaceService'
import { readWritingTools, writeWritingTools } from '../core/workspace/writingTools'
import type { WritingToolsPreferences } from '../shared/writingTools'
import { listTrash, restoreFromTrash, purgeTrashEntry } from '../core/workspace/trash'
import { deleteChapter, deleteCharacter, deleteEvent, deleteNote, deleteOutlineDoc, deleteSetting, getChapterBody, getNote, getSetting, listNotes, listSettings, loadRelationships, saveChapter, saveCharacter, saveEvent, saveNote, saveOutlineDoc, saveRelationships, saveSetting, searchProject, genId } from '../core/workspace/entityStore'
import { summarizeContentPackage } from '../core/skills/packageStore'
import { GlobalSkillLibrary } from '../core/skills/globalSkillLibrary'
import { MemoryStore } from '../core/memory/memoryStore'
import { builtinPackages } from '../core/skills/builtin'
import { RuleStore } from '../core/rules/ruleStore'
import { GoalStore } from '../core/goal/goalStore'
import type { ContentPackage } from '../core/skills/types'
import { creativePreferencesFromOrchestrationDefaults } from '../shared/creative'
import { SourceCatalog } from '../core/inspiration/sourceCatalog'
import { normalizeProjectDocPath, validateProjectDocContent } from '../core/workspace/projectDocs'
import { saveInspirationArtifact } from '../core/inspiration/inspirationService'
import type { InspirationImport } from '../shared/inspiration'
import { CloudAccountService } from '../core/cloud/cloudAccountService'
import { cloudConfigFromEnv } from '../core/cloud/oidcClient'
import { MemoryCloudCredentialStore } from '../core/cloud/cloudCredential'

const MAX_JSON_BODY_BYTES = 16 * 1024 * 1024
const DEFAULT_SESSION_TTL = 8 * 60 * 60 * 1000
const DEFAULT_BODY_IDLE_TIMEOUT_MS = 60_000
const DEFAULT_REQUEST_TIMEOUT_MS = 10 * 60_000
const DEFAULT_HEADERS_TIMEOUT_MS = 30_000
const DEFAULT_KEEP_ALIVE_TIMEOUT_MS = 10_000

export async function recordRecentWorkspaceBestEffort(record: () => Promise<void>): Promise<boolean> {
  try {
    await record()
    return true
  } catch {
    console.warn('[storyfabric] failed to persist recent workspace record')
    return false
  }
}

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
  /** Optional explicit CORS origin. Unset means same-origin/no CORS headers. */
  corsOrigin?: string
  /** Remote deployments reject provider endpoints that resolve to private addresses by default. */
  allowPrivateProviderUrls?: boolean
  /** Maximum time without receiving request-body data. */
  bodyIdleTimeoutMs?: number
  /** Maximum time allowed for a complete request, including handler work. */
  requestTimeoutMs?: number
  /** Maximum time allowed to receive request headers. */
  headersTimeoutMs?: number
  /** Idle timeout for keep-alive sockets. */
  keepAliveTimeoutMs?: number
}

interface AuthContext {
  token: string
  workspaceId?: string
}
type ServerCloud = CloudAccountService

interface Runtime {
  store: FileStore
  sessions: CoreSessionStore
  agent: CoreAgentService
  operationQueue: Promise<void>
}

interface ScopedEnvelope extends AgentEventEnvelope {
  workspaceId: string
}

class EventHub {
  private readonly listeners = new Set<{ workspaceId: () => string | undefined; send: (envelope: AgentEventEnvelope) => void }>()
  private readonly runtimeListeners = new Set<{ workspaceId: () => string | undefined; send: (envelope: RuntimeAgentEventEnvelope) => void }>()
  private readonly buffers = new Map<string, RunEventBuffer>()
  private readonly sequences = new Map<string, number>()
  private readonly touched = new Map<string, number>()
  // A run retains a bounded event window and its latest snapshot. Limit the
  // number of retained runs so completed sessions cannot grow server memory.
  private readonly maxRuns = 32

  private ensureCapacity(key: string): void {
    if (this.buffers.has(key)) return
    while (this.buffers.size >= this.maxRuns) {
      const oldest = [...this.touched.entries()].sort((a, b) => a[1] - b[1])[0]?.[0]
      if (!oldest) break
      this.buffers.delete(oldest)
      this.sequences.delete(oldest)
      this.touched.delete(oldest)
    }
  }

  subscribe(workspaceId: () => string | undefined, send: (envelope: AgentEventEnvelope) => void): () => void {
    const listener = { workspaceId, send }
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  subscribeRuntime(workspaceId: () => string | undefined, send: (envelope: RuntimeAgentEventEnvelope) => void): () => void {
    const listener = { workspaceId, send }
    this.runtimeListeners.add(listener)
    return () => this.runtimeListeners.delete(listener)
  }

  emit(envelope: ScopedEnvelope): void {
    for (const listener of this.listeners) {
      if (listener.workspaceId() === envelope.workspaceId) listener.send({ sessionId: envelope.sessionId, ...(envelope.runId ? { runId: envelope.runId } : {}), event: envelope.event })
    }
    if (!envelope.runId) return
    const key = `${envelope.workspaceId}\u0000${envelope.runId}`
    this.ensureCapacity(key)
    const seq = (this.sequences.get(key) ?? 0) + 1
    this.sequences.set(key, seq)
    this.touched.set(key, Date.now())
    const runtime = adaptLegacyAgentEvent({ workspaceId: envelope.workspaceId, sessionId: envelope.sessionId, runId: envelope.runId, ...legacyEventIdentity(envelope.event), seq, event: envelope.event })
    const buffer = this.buffers.get(key) ?? new RunEventBuffer()
    buffer.append(runtime)
    buffer.setSnapshot({ workspaceId: envelope.workspaceId, sessionId: envelope.sessionId, runId: envelope.runId, lastSeq: seq, event: runtime.event })
    this.buffers.set(key, buffer)
    for (const listener of this.runtimeListeners) {
      if (listener.workspaceId() === envelope.workspaceId) listener.send(runtime)
    }
  }

  replay(workspaceId: string, runId: string, afterSeq: number): RunReplay {
    return (this.buffers.get(`${workspaceId}\u0000${runId}`) ?? new RunEventBuffer()).replay(afterSeq)
  }
}

function sendJson(res: ServerResponse, status: number, value: unknown, headers: Record<string, string> = {}): void {
  if (res.destroyed || res.writableEnded) return
  const payload = JSON.stringify(value)
  try {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers })
    res.end(payload)
  } catch {
    // The client may have disconnected while the handler was finishing.
  }
}

function sendError(res: ServerResponse, status: number, error: unknown): void {
  sendJson(res, status, { error: error instanceof Error ? error.message : String(error) })
}

async function readBody(req: IncomingMessage, idleTimeoutMs = DEFAULT_BODY_IDLE_TIMEOUT_MS): Promise<string> {
  const bytes = await readBinaryBody(req, MAX_JSON_BODY_BYTES, idleTimeoutMs)
  return Buffer.from(bytes).toString('utf8')
}

async function readBinaryBody(req: IncomingMessage, maxBytes: number, idleTimeoutMs = DEFAULT_BODY_IDLE_TIMEOUT_MS): Promise<Uint8Array> {
  const contentLength = Number(req.headers['content-length'] ?? 0)
  if (Number.isFinite(contentLength) && contentLength > maxBytes) throw new Error('请求内容过大')
  const timeoutMs = Math.max(1_000, idleTimeoutMs)
  return new Promise<Uint8Array>((resolve, reject) => {
    let settled = false
    let size = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const chunks: Buffer[] = []

    const cleanup = (): void => {
      if (timer) clearTimeout(timer)
      req.off('data', onData)
      req.off('end', onEnd)
      req.off('error', onError)
      req.off('aborted', onAborted)
    }
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      cleanup()
      if (error) {
        if (!req.destroyed) req.destroy()
        reject(error)
      } else {
        resolve(new Uint8Array(Buffer.concat(chunks)))
      }
    }
    const armTimeout = (): void => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => finish(new Error('请求读取超时')), timeoutMs)
    }
    const onData = (chunk: Buffer | string): void => {
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += value.length
      if (size > maxBytes) {
        finish(new Error('请求内容过大'))
        return
      }
      chunks.push(value)
      armTimeout()
    }
    const onEnd = (): void => finish()
    const onError = (error: Error): void => finish(error)
    const onAborted = (): void => finish(new Error('请求已取消'))

    req.on('data', onData)
    req.once('end', onEnd)
    req.once('error', onError)
    req.once('aborted', onAborted)
    armTimeout()
  })
}

function requestAbortSignal(req: IncomingMessage, res?: ServerResponse): AbortSignal {
  const controller = new AbortController()
  const abort = () => controller.abort()
  req.on('aborted', abort)
  req.socket.on('close', abort)
  req.on('close', () => {
    if (!req.complete) abort()
  })
  res?.on('close', () => {
    if (!res.writableEnded) abort()
  })
  return controller.signal
}

function requestWasAborted(req: IncomingMessage, res: ServerResponse, signal: AbortSignal): boolean {
  return signal.aborted || req.aborted || req.socket.destroyed || res.destroyed
}

function throwIfRequestAborted(req: IncomingMessage, res: ServerResponse, signal: AbortSignal): void {
  if (requestWasAborted(req, res, signal)) {
    const error = new Error('工作区请求已取消')
    error.name = 'AbortError'
    throw error
  }
  throwIfWorkspaceRequestAborted(signal)
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
  // OAuth returns to /api/cloud/callback through a top-level cross-site GET.
  // Lax sends this session cookie for that navigation while still blocking
  // it on cross-site subrequests and writes.
  return `storyfabric_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(ttlMs / 1000)}${secure ? '; Secure' : ''}`
}

function clearCookie(secure: boolean): string {
  return `storyfabric_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`
}

function cloudTransactionCookie(value: string, secure: boolean): string {
  return `storyfabric_cloud_oauth=${encodeURIComponent(value)}; Path=/api/cloud; HttpOnly; SameSite=Lax; Max-Age=600${secure ? '; Secure' : ''}`
}
function clearCloudTransactionCookie(secure: boolean): string {
  return `storyfabric_cloud_oauth=; Path=/api/cloud; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`
}

/**
 * Rebuild the OAuth callback URL as seen by the public deployment.
 *
 * The Node server usually sits behind an HTTP reverse proxy, while the OIDC
 * redirect URI is registered with the public HTTPS origin. Using a hard-coded
 * HTTP base here makes openid-client reject an otherwise valid callback. The
 * configured redirect URI is the authoritative public origin; forwarded
 * headers are only a fallback for deployments that construct the callback
 * configuration elsewhere.
 */
export function cloudCallbackUrl(req: IncomingMessage, redirectUri?: string): URL {
  const raw = req.url ?? '/'
  if (/^https?:\/\//i.test(raw)) return new URL(raw)
  if (redirectUri) return new URL(raw, redirectUri)

  const forwarded = req.headers['x-forwarded-proto']
  const protocol = (Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0])?.trim().toLowerCase()
  const safeProtocol = protocol === 'https' ? 'https' : 'http'
  return new URL(raw, `${safeProtocol}://${req.headers.host ?? 'localhost'}`)
}

function cloudCallbackPage(success: boolean): string {
  const status = success ? 'complete' : 'error'
  const title = success ? '登录完成' : '登录未完成'
  const description = success
    ? '账户已连接，正在返回 StoryFabric…'
    : '授权没有完成，请返回 StoryFabric 重试。'
  // The callback is normally opened as a popup by the web client. Keep a
  // same-origin message for future clients, then close it. If a popup was
  // blocked and the OAuth page replaced the app tab, restore the hash route.
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body><p>${description}</p><script>(({status})=>{const message={type:'storyfabric-cloud-login',status};if(window.opener&&!window.opener.closed){window.opener.postMessage(message,window.location.origin);window.close();setTimeout(()=>{if(!window.closed)window.location.replace('/#user')},300)}else{window.location.replace('/#user')}})({status:${JSON.stringify(status)}})</script></body></html>`
}

function mimeType(path: string): string {
  return {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
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
  const configuredCorsOrigin = options.corsOrigin ?? process.env.STORYFABRIC_CORS_ORIGIN?.trim()
  const corsOrigin = configuredCorsOrigin || null
  const authAttempts = createAuthAttemptTracker()
  const allowPrivateProviderUrls = options.allowPrivateProviderUrls ?? process.env.STORYFABRIC_ALLOW_PRIVATE_PROVIDER_URLS === '1'
  const serverGetAdapter = (protocol: Parameters<typeof getAdapter>[0], baseUrl: string) => getAdapter(protocol, baseUrl, { allowPrivateUrls: allowPrivateProviderUrls })
  const events = new EventHub()
  const runtimes = new Map<string, Runtime>()
  const cloudSessions = new Map<string, ServerCloud>()
  const cloudConfig = cloudConfigFromEnv(process.env, true)
  const cloudFor = (token: string): ServerCloud => {
    let service = cloudSessions.get(token)
    if (!service) { service = new CloudAccountService(cloudConfig, new MemoryCloudCredentialStore()); cloudSessions.set(token, service) }
    return service
  }
  const globalSkillLibrary = new GlobalSkillLibrary(new NodeFileStore(dataRoot))
  const MAX_SSE_CLIENTS = 128
  let activeSseClients = 0
  const bodyIdleTimeoutMs = options.bodyIdleTimeoutMs ?? DEFAULT_BODY_IDLE_TIMEOUT_MS
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  const headersTimeoutMs = options.headersTimeoutMs ?? DEFAULT_HEADERS_TIMEOUT_MS
  const keepAliveTimeoutMs = options.keepAliveTimeoutMs ?? DEFAULT_KEEP_ALIVE_TIMEOUT_MS


  const listRecentWorkspaces = async (): Promise<WorkspaceListItem[]> => {
    const [currentSettings, workspaces] = await Promise.all([settings.load(), registry.list()])
    const byPath = new Map(workspaces.map((item) => [item.path, item]))
    const results: WorkspaceListItem[] = []
    const uniquePaths = [...new Set(currentSettings.recentWorkspaces)]
    for (const path of orderRecentWorkspacePaths(uniquePaths, currentSettings.recentWorkspaceOpenedAt)) {
      const item = byPath.get(path)
      if (!item) continue
      const lastOpenedAt = currentSettings.recentWorkspaceOpenedAt[path]
      results.push(lastOpenedAt ? { ...item, lastOpenedAt } : item)
      if (results.length >= 5) break
    }
    return results
  }

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
      const cloud = cloudFor(context.token)
      const agent = new CoreAgentService({
        store,
        workspaceId: id,
        sessions,
        settings: async () => {
          const current = await settings.agentSettings()
          const managed = await cloud.agentProvider(await settings.managedProviderPreferences())
          return managed ? { ...current, providers: [...current.providers, managed] } : current
        },
        consumeLegacyCustomPrompt: (migrate) => settings.consumeLegacyCustomPrompt(migrate),
        getAdapter: serverGetAdapter,
        emit: (sessionId, event, runId) => events.emit({ workspaceId: id, sessionId, ...(runId ? { runId } : {}), event }),
        onUsage: (record) => void usage.append(record).catch(() => {}),
        globalSkillLibrary
        ,memoryStore: new MemoryStore(new NodeFileStore(dataRoot), store)
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
    if (method === 'renameWorkspace') return registry.rename(String(arg<string>()), String(arg<string>(1) ?? ''))
    if (method === 'forgetRecentWorkspace') return settings.forgetRecentWorkspace(String(arg<string>()))
    if (method === 'createWorkspace') {
      const summary = await registry.create(String(arg<string>(1) || 'StoryFabric'))
      await recordRecentWorkspaceBestEffort(() => settings.recordRecentWorkspace(summary.path))
      authSessions.setWorkspace(context.token, summary.path)
      return summary.path
    }
    if (method === 'openWorkspace') {
      const summary = await registry.summary(String(arg<string>()), { upgradeLegacy: arg<{ upgradeLegacy?: boolean }>(1)?.upgradeLegacy === true })
      await recordRecentWorkspaceBestEffort(() => settings.recordRecentWorkspace(summary.path))
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
    if (method === 'getUsageBuckets') return usage.listBuckets()
    if (method === 'getWritingDays') {
      const workspaces = await registry.list()
      const rows = await Promise.all(workspaces.map(async ({ path }) =>
        (await listWritingDays(await registry.getStore(path))).map((day) => ({ ...day, workspaceId: path }))))
      return rows.flat()
    }
    if (method === 'importInspirationPath') throw new Error('远程灵感台不支持读取服务器外的电脑路径，请先上传资料文件')
    if (method === 'exportWorkspace' || method === 'importWorkspace') throw new Error('远程工作区请使用压缩包传输端点')
    if (method === 'listCreativePackages') {
      const installed = await globalSkillLibrary.list()
      const summaries = builtinPackages.map((pkg) => {
        const saved = installed.find((item) => item.manifest.id === pkg.manifest.id && item.manifest.version === pkg.manifest.version)
        return { id: pkg.manifest.id, version: pkg.manifest.version, name: pkg.manifest.name, description: pkg.manifest.description, enabled: saved?.enabled ?? true, skills: pkg.manifest.skills.map((item) => item.id), ruleSets: pkg.manifest.ruleSets.map((item) => item.id) }
      })
      return [...summaries, ...installed.filter((item) => !builtinPackages.some((builtin) => builtin.manifest.id === item.manifest.id && builtin.manifest.version === item.manifest.version)).map(summarizeContentPackage)]
    }
    if (method === 'installCreativePackage') return summarizeContentPackage(await globalSkillLibrary.install(arg<ContentPackage>(), true))
    if (method === 'setCreativePackageEnabled') {
      const id = arg<string>(), version = arg<string>(1), enabled = Boolean(arg<boolean>(2))
      const builtin = builtinPackages.find((pkg) => pkg.manifest.id === id && pkg.manifest.version === version)
      return summarizeContentPackage(await (builtin ? globalSkillLibrary.install(builtin, enabled) : globalSkillLibrary.setEnabled(id, version, enabled)))
    }
    if (method === 'listInspirationSources') return new SourceCatalog((await runtimeOf(context)).runtime.store).list()
    if (method === 'getMemory' || method === 'updateMemory') {
      const { runtime } = await runtimeOf(context)
      const memory = new MemoryStore(new NodeFileStore(dataRoot), runtime.store)
      return method === 'getMemory'
        ? memory.read(arg<import('../shared/memory').MemoryScope>())
        : memory.update(arg<import('../shared/memory').MemoryScope>(), arg<import('../shared/memory').MemoryUpdate>(1))
    }
    // Settings are global to the server and the web shell loads them before a
    // workspace is selected. Keep these RPCs outside the workspace runtime
    // gate; otherwise a fresh web session remains stuck on the settings spinner.
    const cloud = cloudFor(context.token)
    if (method === 'getSettings') {
      const current = await settings.load()
      const managed = await cloud.publicProvider(await settings.managedProviderPreferences())
      return managed ? { ...current, providers: [...current.providers, managed] } : current
    }
    if (method === 'cloudState') return cloud.getState()
    if (method === 'cloudCancel') return cloud.cancelLogin()
    if (method === 'cloudLogout') { const result = await cloud.logout(); cloudSessions.delete(context.token); return result }
    if (method === 'cloudOnboard') return cloud.retryOnboarding()
    if (method === 'cloudAccount') return cloud.getAccount()
    if (method === 'cloudUsage') return cloud.getUsage(arg<number>() ?? 1)
    if (method === 'cloudChannels') return cloud.getChannels()
    if (method === 'cloudGroups') return cloud.getGroups()
    if (method === 'cloudSupplierLobby') return cloud.getSupplierLobby()
    if (method === 'cloudRedeem') return cloud.redeem(arg())
    if (method === 'cloudRedeemHistory') return cloud.getRedeemHistory()
    if (method === 'cloudGroup') return cloud.selectGroup(arg())
    if (method === 'cloudRotate') return cloud.rotateConnection(arg())
    if (method === 'checkAppUpdate') return checkForUpdates({ currentVersion: APP_VERSION, platform: 'linux', preferences: (await settings.load()).updatePreferences })
    if (method === 'updateSettings') return settings.update(arg<SettingsPatch>())
    if (method === 'saveProvider') {
      const input = arg<ProviderInput>()
      return input.id === 'trailblazer-managed'
        ? settings.saveTrailblazerProvider(await cloud.scopeModelPreferences({ models: input.models, modelSettings: input.modelSettings ?? {} }))
        : settings.saveProvider(input)
    }
    if (method === 'deleteProvider') return arg<string>() === 'trailblazer-managed' ? settings.load() : settings.deleteProvider(arg<string>())
    if (method === 'fetchModels') {
      const input = arg<FetchModelsInput>()
      if (input.providerId === 'trailblazer-managed') {
        const models = await cloud.fetchModels(input.protocol)
        const current = await settings.managedProviderPreferences()
        await settings.saveTrailblazerProvider(await cloud.scopeModelPreferences({ models, modelSettings: current.modelSettings }))
        return models
      }
      const provider = await settings.providerInput(input)
      return fetchProviderModels(provider.protocol, provider.baseUrl, provider.apiKey, { allowPrivateUrls: allowPrivateProviderUrls })
    }

    const { id: workspaceId, runtime } = await runtimeOf(context)
    const needsImmediateAgentControl = method === 'agentConfirm' || method === 'agentAbort' || method === 'agentAnswerQuestion' || method === 'agentResolveSkillCandidate'
    if (!serialized && !needsImmediateAgentControl) return serializeWorkspace(runtime, () => dispatch(context, method, args, true))
    const { store } = runtime
    const saveChapterMeta = async (input: Partial<ChapterDoc>, options?: Parameters<StoryFabricApi['saveChapter']>[1]): Promise<unknown> => {
      const saved = await saveDocument(store, 'chapter', input, options)
      const { content: _content, ...meta } = saved
      return meta
    }

    switch (method as keyof StoryFabricApi) {
      case 'getChapterBody': return getChapterBody(store, arg<string>())
      case 'getDocumentSnapshot': return getDocumentSnapshot(store, arg<DocumentKind>(), arg<string>(1))
      case 'saveHistoryVersion': return saveHistoryVersion(store, arg<DocumentKind>(), arg<string>(1), arg<HistorySaveOptions>(2))
      case 'listHistoryVersions': return listHistoryVersions(store, arg<DocumentKind>(), arg<string | undefined>(1))
      case 'getHistoryVersion': return getHistoryVersion(store, arg<DocumentKind>(), arg<string>(1), arg<string>(2))
      case 'updateHistoryVersion': return updateHistoryVersion(store, arg<DocumentKind>(), arg<string>(1), arg<string>(2), arg<HistoryVersionPatch>(3))
      case 'deleteHistoryVersion': return deleteHistoryVersion(store, arg<DocumentKind>(), arg<string>(1), arg<string>(2), arg<boolean>(3))
      case 'restoreHistoryVersion': return restoreHistoryVersion(store, arg<DocumentKind>(), arg<string>(1), arg<string>(2), arg<string>(3), arg<string | undefined>(4))
      case 'searchProject': return searchProject(store, arg<string>())
      case 'getGraphLayout': return readGraphLayout(store)
      case 'getWritingTools': return readWritingTools(store)
      case 'saveWritingTools': return writeWritingTools(store, arg<WritingToolsPreferences>())
      case 'saveGraphLayout': return writeGraphLayout(store, arg<Record<string, { x: number; y: number }> >())
      case 'saveCharacter': return saveCharacter(store, arg())
      case 'deleteCharacter': return deleteCharacter(store, arg<string>())
      case 'saveRelationships': return saveRelationships(store, arg<Relationship[]>())
      case 'saveOutlineDoc': return saveDocument(store, 'outline', arg<Partial<OutlineDoc>>(), arg(1))
      case 'deleteOutlineDoc': return deleteOutlineDoc(store, arg<string>())
      case 'saveEvent': return saveEvent(store, arg<Partial<StoryEvent>>())
      case 'deleteEvent': return deleteEvent(store, arg<string>())
      case 'saveChapter': return saveChapterMeta(arg<Partial<ChapterDoc>>(), arg(1))
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
      case 'getCapabilities': return { protocolVersion: 1, skills: true, rules: true, orchestration: true, subagents: true, goalMode: true, eventRecovery: true, budgets: true, orientation: 'best-effort', fileImportExport: true, remoteDeployment: false }
      case 'listCreativeRules': return new RuleStore(store).load()
      case 'saveCreativeRules': await new RuleStore(store).save(arg()); return undefined
      case 'listInspirationSources': return new SourceCatalog(store).list()
      case 'importInspirationSource': {
        const input = arg<InspirationImport>() as InspirationImport & { bytes?: unknown }
        const rawBytes: unknown = input?.bytes
        const bytes = rawBytes instanceof Uint8Array
          ? rawBytes
          : rawBytes instanceof ArrayBuffer
            ? new Uint8Array(rawBytes)
            : Array.isArray(rawBytes)
              ? new Uint8Array(rawBytes)
              : rawBytes && typeof rawBytes === 'object'
                ? new Uint8Array(Object.keys(rawBytes as Record<string, unknown>).sort((a, b) => Number(a) - Number(b)).map((key) => Number((rawBytes as Record<string, unknown>)[key])))
                : new Uint8Array()
        return new SourceCatalog(store).importBytes({ name: String(input?.name ?? ''), bytes })
      }
      case 'removeInspirationSource': return new SourceCatalog(store).removeImported(arg<string>())
      case 'extractInspirationSource': return new SourceCatalog(store).extract(arg<string>())
      case 'readInspirationSource': return new SourceCatalog(store).readExtracted(arg<string>(), arg<number>(1))
      case 'readInspirationDoc': { const path = normalizeProjectDocPath(arg<string>()); return store.readText(`docs/${path}`) }
      case 'saveInspirationDoc': { const path = normalizeProjectDocPath(arg<string>()); const content = validateProjectDocContent(arg<string>(1)); await store.writeText(`docs/${path}`, content); return undefined }
      case 'saveInspirationArtifact': await saveInspirationArtifact(store, arg()); return undefined
      case 'agentRun': {
        const request = arg<RunAgentRequest>()
        const existing = request.sessionId ? await runtime.sessions.load(request.sessionId) : null
        const session = existing ?? await runtime.sessions.create()
        if (!existing) await runtime.sessions.save(session)
        const next = { ...request, sessionId: session.id }
        void runtime.agent.run(next).catch((error) => {
          events.emit({ workspaceId, sessionId: session.id, event: { type: 'error', message: error instanceof Error ? error.message : String(error) } })
          events.emit({ workspaceId, sessionId: session.id, event: { type: 'done' } })
        })
        return { sessionId: session.id, runId: runtime.agent.getActiveRunId(session.id) }
      }
      case 'compressSessionContext': {
        const sessionId = arg<string>()
        const providerId = arg<string>(1)
        const model = arg<string>(2)
        return runtime.agent.compressSessionContext(sessionId, providerId, model)
      }
      case 'agentConfirm': runtime.agent.confirmChange(arg<string>(1), Boolean(arg<boolean>(2)), arg<string>(), arg(3)); return undefined
      case 'agentAbort': runtime.agent.abort(arg<string>()); return undefined
      case 'agentAnswerQuestion': await runtime.agent.answerQuestion(arg<import('../shared/agentQuestions').AgentQuestionAnswer>()); return undefined
      case 'agentResolveSkillCandidate': await runtime.agent.resolveSkillCandidate(arg<string>(), arg<import('../shared/agentQuestions').SkillCandidateAction>(1)); return undefined
      case 'listGoals': return new GoalStore(store).list(workspaceId)
      case 'getGoal': {
        const goal = await new GoalStore(store).get(arg<string>())
        if (goal && goal.workspaceId !== workspaceId) throw new Error('目标不属于当前工作区')
        return goal
      }
      case 'continueGoal': {
        const goal = await new GoalStore(store).assertWorkspace(arg<string>(), workspaceId)
        const publicSettings = await settings.load()
        const preferred = publicSettings.defaultChatModel
        const preferredProvider = preferred && publicSettings.providers.find((provider) => provider.id === preferred.providerId && provider.models.includes(preferred.model))
        const fallbackProvider = publicSettings.providers.find((provider) => provider.models.length > 0 && provider.hasKey)
        const selected = preferredProvider ?? fallbackProvider
        if (!selected) throw new Error('请先配置可用的供应商和模型')
        const request = { mode: 'goal' as const, goalRunId: goal.id, message: goal.goal, sessionId: goal.sessionId, providerId: selected.id, model: preferredProvider ? preferred!.model : selected.models[0], approvalPolicy: goal.approvalPolicy }
        void runtime.agent.run(request).catch((error) => {
          events.emit({ workspaceId, sessionId: goal.sessionId, event: { type: 'error', message: error instanceof Error ? error.message : String(error) } })
          events.emit({ workspaceId, sessionId: goal.sessionId, event: { type: 'done' } })
        })
        return { goalId: goal.id, runId: runtime.agent.getActiveRunId(goal.sessionId) }
      }
      case 'stopGoal': {
        const goal = await new GoalStore(store).assertWorkspace(arg<string>(), workspaceId)
        runtime.agent.abort(goal.sessionId)
        return undefined
      }
      case 'replanGoal': {
        const goal = await new GoalStore(store).assertWorkspace(arg<string>(), workspaceId)
        const publicSettings = await settings.load()
        const preferred = publicSettings.defaultChatModel
        const preferredProvider = preferred && publicSettings.providers.find((provider) => provider.id === preferred.providerId && provider.models.includes(preferred.model))
        const fallbackProvider = publicSettings.providers.find((provider) => provider.models.length > 0 && provider.hasKey)
        const selected = preferredProvider ?? fallbackProvider
        if (!selected) throw new Error('请先配置可用的供应商和模型')
        const request = { mode: 'goal' as const, goalAction: 'replan' as const, goalRunId: goal.id, message: goal.goal, sessionId: goal.sessionId, providerId: selected.id, model: preferredProvider ? preferred!.model : selected.models[0], approvalPolicy: goal.approvalPolicy }
        void runtime.agent.run(request).catch((error) => {
          events.emit({ workspaceId, sessionId: goal.sessionId, event: { type: 'error', message: error instanceof Error ? error.message : String(error) } })
          events.emit({ workspaceId, sessionId: goal.sessionId, event: { type: 'done' } })
        })
        return { goalId: goal.id, runId: runtime.agent.getActiveRunId(goal.sessionId), planVersion: goal.planVersion + 1 }
      }
      case 'listSessions': return runtime.sessions.list()
      case 'createSession': { const session = await runtime.sessions.create(); session.creativePreferences = creativePreferencesFromOrchestrationDefaults((await settings.load()).orchestrationDefaults); await runtime.sessions.save(session); return session }
      case 'exportSession': { const session = await runtime.sessions.load(arg<string>()); if (!session) throw new Error('会话不存在'); return exportSessionArchive(session) }
      case 'importSession': {
        const imported = decodeSessionArchive(arg<string>())
        const session: ChatSession = { ...imported, id: genId('sess'), title: imported.title || '导入会话', updatedAt: Date.now(), archived: false }
        await runtime.sessions.save(session)
        return { id: session.id, title: session.title, updatedAt: session.updatedAt, messageCount: session.messages.filter((message) => message.role === 'user' || message.role === 'assistant').length, archived: false }
      }
      case 'loadSession': return runtime.sessions.load(arg<string>())
      case 'deleteSession': {
        const sessionId = arg<string>()
        if (runtime.agent.getActiveRunId(sessionId)) throw new Error('会话正在运行，请先停止运行后再删除')
        return runtime.sessions.delete(sessionId)
      }
      case 'updateSession': if (!(await runtime.sessions.updateMeta(arg<string>(), arg<Parameters<StoryFabricApi['updateSession']>[1]>(1)))) throw new Error('会话不存在'); return undefined
      case 'updateSessionModelPreference': if (!(await runtime.sessions.updateModelPreference(arg<string>(), arg<import('../shared/types').SessionModelPreference>(1)))) throw new Error('会话不存在'); return undefined
      default: throw new Error(`不支持的 API 方法：${method}`)
    }
  }

  const handleRpc = async (req: IncomingMessage, res: ServerResponse, context: AuthContext): Promise<void> => {
    let payload: { method?: string; args?: unknown[] }
    try { payload = JSON.parse(await readBody(req, bodyIdleTimeoutMs)) as { method?: string; args?: unknown[] } } catch (error) { sendError(res, 400, error instanceof Error ? error.message : '请求 JSON 无效'); return }
    if (!payload.method || !Array.isArray(payload.args)) { sendError(res, 400, 'RPC 请求格式无效'); return }
    try { sendJson(res, 200, { result: await dispatch(context, payload.method, payload.args) }) } catch (error) { sendError(res, 400, error) }
  }

  const server = createServer(async (req, res) => {
    res.setHeader('x-content-type-options', 'nosniff')
    res.setHeader('referrer-policy', 'no-referrer')
    if (corsOrigin) {
      res.setHeader('access-control-allow-origin', corsOrigin)
      if (corsOrigin !== '*') res.setHeader('access-control-allow-credentials', 'true')
      res.setHeader('access-control-allow-headers', 'authorization, content-type, x-storyfabric-workspace-name')
      res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS')
    }
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
    const pathname = new URL(req.url ?? '/', 'http://storyfabric.local').pathname

    if (pathname === '/healthz' && req.method === 'GET') { sendJson(res, 200, { ok: true }); return }
    if (pathname === '/api/auth/login' && req.method === 'POST') {
      try {
        const address = req.socket.remoteAddress ?? 'unknown'
        if (authAttempts.isBlocked(address)) { sendError(res, 429, '登录尝试过于频繁，请稍后再试'); return }
        const body = JSON.parse(await readBody(req, bodyIdleTimeoutMs)) as { key?: string }
        if (!verifier.verify(String(body.key ?? ''))) {
          authAttempts.recordFailure(address)
          sendError(res, 401, '访问密钥错误'); return
        }
        authAttempts.clear(address)
        const token = authSessions.issue()
        sendJson(res, 200, { authenticated: true }, { 'set-cookie': cookieHeader(token, secureCookie, sessionTtlMs) })
      } catch (error) { sendError(res, 400, error) }
      return
    }
    if (pathname === '/api/auth/token' && req.method === 'POST') {
      try {
        const address = req.socket.remoteAddress ?? 'unknown'
        if (authAttempts.isBlocked(address)) { sendError(res, 429, '登录尝试过于频繁，请稍后再试'); return }
        const body = JSON.parse(await readBody(req, bodyIdleTimeoutMs)) as { key?: string }
        if (!verifier.verify(String(body.key ?? ''))) {
          authAttempts.recordFailure(address)
          sendError(res, 401, '访问密钥错误'); return
        }
        authAttempts.clear(address)
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
    if (pathname === '/api/cloud/login' && req.method === 'POST') {
      try { const service = cloudFor(context.token); const url = await service.beginWebLogin(); const cookie = service.webTransactionCookie; if (!cookie) throw new Error('登录事务创建失败'); sendJson(res, 200, { url }, { 'set-cookie': cloudTransactionCookie(cookie, secureCookie) }) } catch (error) { sendError(res, 400, error) }
      return
    }
    if (pathname === '/api/cloud/callback' && req.method === 'GET') {
      try {
        await cloudFor(context.token).completeWebLogin(cloudCallbackUrl(req, cloudConfig?.redirectUri), parseCookie(req, 'storyfabric_cloud_oauth') ?? undefined)
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'set-cookie': clearCloudTransactionCookie(secureCookie) })
        res.end(cloudCallbackPage(true))
      } catch {
        res.writeHead(400, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'set-cookie': clearCloudTransactionCookie(secureCookie) })
        res.end(cloudCallbackPage(false))
      }
      return
    }
    try { await registryReady } catch (error) { sendError(res, 500, error); return }

    if (pathname === '/api/runtime-events' && req.method === 'GET') {
      if (activeSseClients >= MAX_SSE_CLIENTS) { sendError(res, 429, '实时事件连接数已达上限，请稍后重试'); return }
      activeSseClients += 1
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' })
      let closed = false
      let unsubscribe = (): void => undefined
      let keepAlive: ReturnType<typeof setInterval> | undefined
      const cleanup = (): void => {
        if (closed) return
        closed = true
        activeSseClients = Math.max(0, activeSseClients - 1)
        if (keepAlive) clearInterval(keepAlive)
        unsubscribe()
      }
      const write = (value: string): void => {
        if (closed || res.destroyed || res.writableEnded) { cleanup(); return }
        try { res.write(value) } catch { cleanup() }
      }
      write(': connected\n\n')
      if (closed) return
      unsubscribe = events.subscribeRuntime(() => authSessions.get(context.token)?.workspaceId, (envelope) => write(`data: ${JSON.stringify(envelope)}\n\n`))
      if (closed) { unsubscribe(); return }
      keepAlive = setInterval(() => write(': keepalive\n\n'), 25_000)
      req.once('close', cleanup)
      res.once('close', cleanup)
      res.once('error', cleanup)
      return
    }
    const runEventsMatch = /^\/api\/runs\/([^/]+)\/events$/.exec(pathname)
    if (runEventsMatch && req.method === 'GET') {
      const runId = decodeUri(runEventsMatch[1])
      const workspaceId = authSessions.get(context.token)?.workspaceId
      if (!runId || !workspaceId) { sendError(res, 409, '请先打开工作区'); return }
      const after = Number(new URL(req.url ?? '/', 'http://storyfabric.local').searchParams.get('after') ?? 0)
      sendJson(res, 200, events.replay(workspaceId, runId, Number.isFinite(after) && after >= 0 ? after : 0))
      return
    }

    if (pathname === '/api/workspaces' && req.method === 'GET') { sendJson(res, 200, await registry.list()); return }
    if (pathname === '/api/workspaces/recent' && req.method === 'GET') { sendJson(res, 200, await listRecentWorkspaces()); return }
    if (pathname === '/api/workspaces' && req.method === 'POST') {
      try {
        const body = JSON.parse(await readBody(req, bodyIdleTimeoutMs)) as { name?: string }
        const summary = await registry.create(String(body.name ?? 'StoryFabric'))
        await recordRecentWorkspaceBestEffort(() => settings.recordRecentWorkspace(summary.path))
        authSessions.setWorkspace(context.token, summary.path)
        sendJson(res, 201, summary)
      } catch (error) { sendError(res, 400, error) }
      return
    }
    if (pathname === '/api/workspaces/open-path' && req.method === 'POST') {
      const signal = requestAbortSignal(req, res)
      try {
        const body = JSON.parse(await readBody(req, bodyIdleTimeoutMs)) as { path?: string; upgradeLegacy?: boolean }
        const summary = await registry.openPath(body.path ?? '', signal, { upgradeLegacy: body.upgradeLegacy === true })
        await recordRecentWorkspaceBestEffort(() => settings.recordRecentWorkspace(summary.path, signal))
        throwIfWorkspaceRequestAborted(signal)
        authSessions.setWorkspace(context.token, summary.path)
        sendJson(res, 200, summary)
      } catch (error) { sendError(res, 400, error) }
      return
    }
    if (pathname === '/api/workspaces/import' && req.method === 'POST') {
      const signal = requestAbortSignal(req, res)
      let imported: Awaited<ReturnType<WorkspaceRegistry['importArchive']>> | null = null
      try {
        const bytes = await readBinaryBody(req, WORKSPACE_ARCHIVE_MAX_BYTES, bodyIdleTimeoutMs)
        const requestedName = req.headers['x-storyfabric-workspace-name']
        const name = typeof requestedName === 'string' ? decodeURIComponent(requestedName) : undefined
        imported = await registry.importArchive(bytes, name, signal, { upgradeLegacy: req.headers['x-storyfabric-upgrade-legacy'] === 'true' })
        await recordRecentWorkspaceBestEffort(() => settings.recordRecentWorkspace(imported!.path, signal))
        await new Promise<void>((resolve) => setImmediate(resolve))
        throwIfRequestAborted(req, res, signal)
        authSessions.setWorkspace(context.token, imported.path)
        sendJson(res, 201, imported)
      } catch (error) {
        if (imported && requestWasAborted(req, res, signal)) await registry.removeImported(imported).catch(() => undefined)
        sendError(res, 400, error)
      }
      return
    }
    const match = /^\/api\/workspaces\/([^/]+)\/(open|archive)$/.exec(pathname)
    if (match) {
      const id = decodeUri(match[1])
      if (id === null) { sendError(res, 400, '非法工作区地址'); return }
      if (match[2] === 'open' && req.method === 'POST') {
        const signal = requestAbortSignal(req, res)
        try {
          const rawBody = await readBody(req, bodyIdleTimeoutMs)
          const body = rawBody.trim() ? JSON.parse(rawBody) as { upgradeLegacy?: boolean } : {}
          throwIfWorkspaceRequestAborted(signal)
          const summary = await registry.summary(id, { upgradeLegacy: body.upgradeLegacy === true })
          await recordRecentWorkspaceBestEffort(() => settings.recordRecentWorkspace(summary.path, signal))
          throwIfWorkspaceRequestAborted(signal)
          authSessions.setWorkspace(context.token, summary.path)
          sendJson(res, 200, summary)
        } catch (error) { sendError(res, 404, error) }
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
      if (activeSseClients >= MAX_SSE_CLIENTS) { sendError(res, 429, '实时事件连接数已达上限，请稍后重试'); return }
      activeSseClients += 1
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' })
      let closed = false
      let unsubscribe = (): void => undefined
      let keepAlive: ReturnType<typeof setInterval> | undefined
      const cleanup = (): void => {
        if (closed) return
        closed = true
        activeSseClients = Math.max(0, activeSseClients - 1)
        if (keepAlive) clearInterval(keepAlive)
        unsubscribe()
      }
      const write = (value: string): void => {
        if (closed || res.destroyed || res.writableEnded) { cleanup(); return }
        try { res.write(value) } catch { cleanup() }
      }
      write(': connected\n\n')
      if (closed) return
      unsubscribe = events.subscribe(() => authSessions.get(context.token)?.workspaceId, (envelope) => write(`data: ${JSON.stringify(envelope)}\n\n`))
      if (closed) { unsubscribe(); return }
      keepAlive = setInterval(() => write(': keepalive\n\n'), 25_000)
      req.once('close', cleanup)
      res.once('close', cleanup)
      res.once('error', cleanup)
      return
    }
    if (pathname === '/api/rpc' && req.method === 'POST') { await handleRpc(req, res, context); return }
    if (options.staticDir && await serveStatic(req, res, options.staticDir)) return
    sendError(res, 404, '未找到资源')
  })

  server.requestTimeout = Math.max(1_000, requestTimeoutMs)
  server.headersTimeout = Math.max(1_000, Math.min(headersTimeoutMs, server.requestTimeout))
  server.keepAliveTimeout = Math.max(1_000, keepAliveTimeoutMs)
  return server
}
