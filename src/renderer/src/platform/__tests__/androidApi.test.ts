import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const doubles = vi.hoisted(() => ({
  preferencesGet: vi.fn(),
  preferencesSet: vi.fn(),
  listDirs: vi.fn(),
  exists: vi.fn(),
  ensureDir: vi.fn(),
  remove: vi.fn(),
  mkdir: vi.fn(),
  validateWorkspace: vi.fn(),
  loadWorkspaceListItem: vi.fn(),
  loadSummary: vi.fn(),
  importWorkspaceArchive: vi.fn(),
  setWorkspaceName: vi.fn(),
  fetchProviderModels: vi.fn(),
  getAdapter: vi.fn(),
  agentOptions: undefined as Record<string, unknown> | undefined,
  createCapacitorWebFetch: vi.fn(),
  nativeFetcher: vi.fn(),
  clipboardRead: vi.fn(),
  clipboardWrite: vi.fn(),
  readText: vi.fn(),
  initializeWorkspace: vi.fn(),
  pickDirectory: vi.fn(),
  safMkdir: vi.fn()
}))

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: doubles.preferencesGet,
    set: doubles.preferencesSet
  }
}))

vi.mock('@capacitor/filesystem', () => ({
  Directory: { Data: 'DATA', Cache: 'CACHE' },
  Filesystem: { mkdir: doubles.mkdir }
}))

vi.mock('@capacitor/clipboard', () => ({
  Clipboard: {
    read: doubles.clipboardRead,
    write: doubles.clipboardWrite
  }
}))

vi.mock('@capacitor/core', () => ({
  CapacitorHttp: { request: vi.fn() },
  registerPlugin: vi.fn(() => ({}))
}))

vi.mock('../capacitorWebFetch', () => ({
  createCapacitorWebFetch: doubles.createCapacitorWebFetch
}))

vi.mock('../../../../core/agent/agentLoop', () => ({
  CoreAgentService: class FakeCoreAgentService {
    readonly options: Record<string, unknown>

    constructor(options: Record<string, unknown>) {
      this.options = options
      doubles.agentOptions = options
    }
  }
}))

vi.mock('../capacitorFileStore', () => ({
  CapacitorFileStore: class FakeCapacitorFileStore {
    constructor(readonly path: string) {}
    listDirs(subdir: string): Promise<string[]> { return doubles.listDirs(this.path, subdir) }
    exists(path: string): Promise<boolean> { return doubles.exists(this.path, path) }
    ensureDir(path: string): Promise<void> { return doubles.ensureDir(this.path, path) }
    remove(path: string): Promise<void> { return doubles.remove(this.path, path) }
    readText(path: string): Promise<string | null> { return doubles.readText(this.path, path) }
  }
}))

vi.mock('../safFileStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../safFileStore')>()
  return {
    ...actual,
    documentTree: { pickDirectory: doubles.pickDirectory, mkdir: doubles.safMkdir },
    SafFileStore: class FakeSafFileStore {
      constructor(readonly path: string) {}
      listDirs(subdir: string): Promise<string[]> { return doubles.listDirs(this.path, subdir) }
      exists(path: string): Promise<boolean> { return doubles.exists(this.path, path) }
      ensureDir(path: string): Promise<void> { return doubles.ensureDir(this.path, path) }
      remove(path: string): Promise<void> { return doubles.remove(this.path, path) }
      readText(path: string): Promise<string | null> { return doubles.readText(this.path, path) }
    }
  }
})

vi.mock('../../../../core/workspace/workspaceService', () => ({
  deleteVolume: vi.fn(),
  initializeWorkspace: doubles.initializeWorkspace,
  listVolumes: vi.fn(),
  loadSummary: doubles.loadSummary,
  loadWorkspaceListItem: doubles.loadWorkspaceListItem,
  moveChapter: vi.fn(),
  readGraphLayout: vi.fn(),
  saveVolume: vi.fn(),
  setWorkspaceName: doubles.setWorkspaceName,
  validateWorkspace: doubles.validateWorkspace,
  writeGraphLayout: vi.fn()
}))

vi.mock('../../../../core/workspace/archive', () => ({
  exportWorkspaceArchive: vi.fn(),
  importWorkspaceArchive: doubles.importWorkspaceArchive
}))

vi.mock('../../../../core/llm', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../../core/llm')>(),
  fetchProviderModels: doubles.fetchProviderModels,
  getAdapter: doubles.getAdapter
}))

import { AndroidPlatformApi, normalizeAndroidWorkspacePath } from '../androidApi'
import { makeSafPath } from '../safFileStore'

function storedSettings(value: unknown): void {
  doubles.preferencesGet.mockResolvedValue({ value: JSON.stringify(value) })
}

function defaultListItem(_store: unknown, fallbackName: string, path: string): Record<string, unknown> {
  return { name: fallbackName, path, chapterCount: 0, volumeCount: 0, relationshipCount: 0 }
}

function freshApi(): AndroidPlatformApi {
  return new AndroidPlatformApi()
}

beforeEach(() => {
  vi.clearAllMocks()
  doubles.preferencesGet.mockResolvedValue({ value: null })
  doubles.preferencesSet.mockResolvedValue(undefined)
  doubles.listDirs.mockResolvedValue([])
  doubles.exists.mockResolvedValue(false)
  doubles.ensureDir.mockResolvedValue(undefined)
  doubles.remove.mockResolvedValue(undefined)
  doubles.mkdir.mockResolvedValue(undefined)
  doubles.validateWorkspace.mockResolvedValue({ ok: true })
  doubles.loadWorkspaceListItem.mockImplementation(defaultListItem)
  doubles.loadSummary.mockResolvedValue({ name: 'demo', path: 'workspaces/demo' })
  doubles.importWorkspaceArchive.mockResolvedValue(undefined)
  doubles.setWorkspaceName.mockResolvedValue(undefined)
  doubles.fetchProviderModels.mockResolvedValue([])
  doubles.getAdapter.mockReturnValue({})
  doubles.nativeFetcher = vi.fn()
  doubles.createCapacitorWebFetch.mockImplementation(() => doubles.nativeFetcher)
  doubles.agentOptions = undefined
  doubles.clipboardRead.mockResolvedValue({ type: 'text/plain', value: '' })
  doubles.clipboardWrite.mockResolvedValue(undefined)
  doubles.initializeWorkspace.mockResolvedValue(undefined)
  doubles.pickDirectory.mockResolvedValue({ uri: null })
  doubles.safMkdir.mockResolvedValue(undefined)
  doubles.readText.mockResolvedValue(null)
})

it('collects usage from every Android project and attributes legacy project-local records', async () => {
  doubles.listDirs.mockResolvedValue(['alpha', 'beta'])
  doubles.readText.mockImplementation(async (root: string, path: string) => {
    if (path !== '.storyfabric/usage-records.json') return null
    const promptTokens = root === 'workspaces/alpha' ? 10 : root === 'workspaces/beta' ? 20 : 0
    return JSON.stringify([{ at: promptTokens, providerId: 'p', providerName: 'P', model: 'm', promptTokens, completionTokens: 0, cachedTokens: 0, cacheWriteTokens: 0 }])
  })
  const records = await freshApi().getUsageRecords()
  expect(records.map((record) => [record.workspaceId, record.promptTokens])).toEqual([
    ['workspaces/alpha', 10], ['workspaces/beta', 20]
  ])
})

afterEach(() => {
  vi.useRealTimers()
})

describe('normalizeAndroidWorkspacePath', () => {
  it('接受 workspaces/<name> 并去除首尾空白', () => {
    expect(normalizeAndroidWorkspacePath('  workspaces/demo  ')).toBe('workspaces/demo')
  })

  it.each([
    '/data/user/0/app/workspaces/demo',
    'workspaces/..',
    'workspaces/demo/chapters',
    'workspaces\\demo'
  ])('拒绝非法路径 %s', (path) => {
    expect(() => normalizeAndroidWorkspacePath(path)).toThrow('Android 工作区路径必须位于应用内部 workspaces 目录下')
  })

  it('通过 API 以 rejected Promise 返回非法路径', async () => {
    const api = Object.create(AndroidPlatformApi.prototype) as AndroidPlatformApi
    await expect(api.openWorkspaceByPath('workspaces/..')).rejects.toThrow('Android 工作区路径必须位于应用内部 workspaces 目录下')
  })

  it('直接打开工作区时也拒绝绕过规范化的旧路径', async () => {
    const api = Object.create(AndroidPlatformApi.prototype) as AndroidPlatformApi
    await expect(api.openWorkspace('workspaces/../legacy')).rejects.toThrow('Android 工作区路径必须位于应用内部 workspaces 目录下')
  })

  it('从 lastWorkspacePath 恢复时拒绝旧路径', async () => {
    const api = Object.create(AndroidPlatformApi.prototype) as AndroidPlatformApi
    Object.assign(api as unknown as Record<string, unknown>, {
      currentPath: null,
      currentStore: null,
      settings: { lastWorkspacePath: 'workspaces/../legacy' },
      loadSettings: async () => ({ lastWorkspacePath: 'workspaces/../legacy' })
    })
    await expect(api.getCurrentWorkspace()).rejects.toThrow('Android 工作区路径必须位于应用内部 workspaces 目录下')
  })
})

describe('AndroidPlatformApi capabilities', () => {
  it('reports the creative rules and flexible orientation capabilities it actually implements', async () => {
    await expect(freshApi().getCapabilities()).resolves.toMatchObject({
      skills: true,
      rules: true,
      orchestration: true,
      budgets: true,
      orientation: 'best-effort'
    })
  })
})

describe('AndroidPlatformApi recent workspaces', () => {
  it('并发记录 recent 工作区时串行合并而不丢路径或时间', async () => {
    let preferencesValue = JSON.stringify({ recentWorkspaces: [], recentWorkspaceOpenedAt: {} })
    doubles.preferencesGet.mockImplementation(async () => ({ value: preferencesValue }))
    doubles.preferencesSet.mockImplementation(async ({ value }: { value: string }) => {
      preferencesValue = value
    })
    const firstApi = freshApi()
    const secondApi = freshApi()
    const firstRecord = (firstApi as unknown as { recordRecentWorkspace: (path: string) => Promise<void> }).recordRecentWorkspace.bind(firstApi)
    const secondRecord = (secondApi as unknown as { recordRecentWorkspace: (path: string) => Promise<void> }).recordRecentWorkspace.bind(secondApi)

    await Promise.all([firstRecord('workspaces/first'), secondRecord('workspaces/second')])

    const saved = JSON.parse(preferencesValue) as { recentWorkspaces: string[]; recentWorkspaceOpenedAt: Record<string, string>; lastWorkspacePath?: string }
    expect(saved.recentWorkspaces).toEqual(expect.arrayContaining(['workspaces/first', 'workspaces/second']))
    expect(saved.recentWorkspaceOpenedAt).toEqual({
      'workspaces/first': expect.any(String),
      'workspaces/second': expect.any(String)
    })
    expect(['workspaces/first', 'workspaces/second']).toContain(saved.lastWorkspacePath)
  })

  it('recent 记录队列失败后仍继续处理后续打开操作', async () => {
    let preferencesValue = JSON.stringify({ recentWorkspaces: [], recentWorkspaceOpenedAt: {} })
    doubles.preferencesGet.mockImplementation(async () => ({ value: preferencesValue }))
    let saveCount = 0
    let rejectFirstSave: (reason: Error) => void = () => undefined
    doubles.preferencesSet.mockImplementation(({ value }: { value: string }) => {
      saveCount += 1
      if (saveCount === 1) return new Promise<void>((_resolve, reject) => { rejectFirstSave = reject })
      preferencesValue = value
      return Promise.resolve()
    })
    const api = freshApi()
    const record = (api as unknown as { recordRecentWorkspace: (path: string) => Promise<void> }).recordRecentWorkspace.bind(api)

    const first = record('workspaces/failed')
    for (let attempt = 0; attempt < 20 && saveCount < 1; attempt += 1) await Promise.resolve()
    const second = record('workspaces/recovered')
    await Promise.resolve()
    expect(saveCount).toBe(1)
    rejectFirstSave(new Error('Preferences 暂时不可用'))
    await expect(first).rejects.toThrow('Preferences 暂时不可用')
    await expect(second).resolves.toBeUndefined()

    const saved = JSON.parse(preferencesValue) as { recentWorkspaces: string[]; lastWorkspacePath?: string }
    expect(saved.recentWorkspaces).toContain('workspaces/recovered')
    expect(saved.lastWorkspacePath).toBe('workspaces/recovered')
  })

  it('普通设置写入与 recent 记录串行合并，避免并发写入互相覆盖', async () => {
    let preferencesValue = JSON.stringify({ theme: 'system', recentWorkspaces: [], recentWorkspaceOpenedAt: {} })
    doubles.preferencesGet.mockImplementation(async () => ({ value: preferencesValue }))
    let saveCount = 0
    let releaseFirstSave: () => void = () => undefined
    doubles.preferencesSet.mockImplementation(({ value }: { value: string }) => {
      saveCount += 1
      if (saveCount === 1) return new Promise<void>((resolve) => { releaseFirstSave = () => { preferencesValue = value; resolve() } })
      preferencesValue = value
      return Promise.resolve()
    })
    const api = freshApi()

    const update = api.updateSettings({ theme: 'dark' })
    for (let attempt = 0; attempt < 20 && saveCount < 1; attempt += 1) await Promise.resolve()
    const record = (api as unknown as { recordRecentWorkspace: (path: string) => Promise<void> }).recordRecentWorkspace('workspaces/concurrent')
    for (let attempt = 0; attempt < 20 && doubles.preferencesGet.mock.calls.length < 1; attempt += 1) await Promise.resolve()

    releaseFirstSave()
    await Promise.all([update, record])

    const saved = JSON.parse(preferencesValue) as { theme: string; recentWorkspaces: string[] }
    expect(saved.theme).toBe('dark')
    expect(saved.recentWorkspaces).toContain('workspaces/concurrent')
  })

  it('普通设置写入失败后队列仍可继续记录 recent 工作区', async () => {
    let preferencesValue = JSON.stringify({ recentWorkspaces: [], recentWorkspaceOpenedAt: {} })
    doubles.preferencesGet.mockImplementation(async () => ({ value: preferencesValue }))
    let saveCount = 0
    doubles.preferencesSet.mockImplementation(({ value }: { value: string }) => {
      saveCount += 1
      if (saveCount === 1) return Promise.reject(new Error('Preferences 暂时不可用'))
      preferencesValue = value
      return Promise.resolve()
    })
    const api = freshApi()

    await expect(api.updateSettings({ theme: 'dark' })).rejects.toThrow('Preferences 暂时不可用')
    await expect((api as unknown as { recordRecentWorkspace: (path: string) => Promise<void> }).recordRecentWorkspace('workspaces/recovered-after-settings-failure')).resolves.toBeUndefined()

    const saved = JSON.parse(preferencesValue) as { recentWorkspaces: string[] }
    expect(saved.recentWorkspaces).toContain('workspaces/recovered-after-settings-failure')
  })

  it.each([
    ['getSettings', (api: AndroidPlatformApi) => api.getSettings()],
    ['listRecentWorkspaces', (api: AndroidPlatformApi) => api.listRecentWorkspaces()]
  ])('%s waits for an earlier settings write before reading Preferences', async (_name, readSettings) => {
    let preferencesValue = JSON.stringify({ theme: 'system', recentWorkspaces: [], recentWorkspaceOpenedAt: {} })
    doubles.preferencesGet.mockImplementation(async () => ({ value: preferencesValue }))
    let releaseSave: () => void = () => undefined
    doubles.preferencesSet.mockImplementation(({ value }: { value: string }) => new Promise<void>((resolve) => {
      releaseSave = () => { preferencesValue = value; resolve() }
    }))
    const api = freshApi()

    const write = api.updateSettings({ theme: 'dark' })
    for (let attempt = 0; attempt < 20 && doubles.preferencesSet.mock.calls.length < 1; attempt += 1) await Promise.resolve()

    let readSettled = false
    const read = readSettings(api).then(() => { readSettled = true })
    await Promise.resolve()
    expect(doubles.preferencesGet).toHaveBeenCalledOnce()
    expect(readSettled).toBe(false)

    releaseSave()
    await Promise.all([write, read])
    expect(JSON.parse(preferencesValue).theme).toBe('dark')
  })

  it('坏形状设置会按 provider 配置类型过滤或补默认值，同时保留合法 provider', async () => {
    const normalizedProvider = { id: 'provider-normalized', name: '可归一化', protocol: 'anthropic', baseUrl: 'https://normalized.example', models: ['claude-3'], hasKey: false, modelSettings: {} }
    const validProvider = { id: 'provider-1', name: '保留', protocol: 'openai', baseUrl: 'https://example.test', models: [], hasKey: false, modelSettings: {} }
    storedSettings({
      theme: 'dark',
      customPrompt: '保留这段提示词',
      lastWorkspacePath: { invalid: true },
      providers: [
        validProvider,
        normalizedProvider,
        { id: 'missing-core-fields' },
        { id: 'bad-name', name: 42, protocol: 'openai', baseUrl: 'https://example.test', models: [], modelSettings: {} },
        { id: 'bad-protocol', name: '错误协议', protocol: 'invalid', baseUrl: 'https://example.test', models: [], modelSettings: {} },
        { id: 'bad-base-url', name: '错误地址', protocol: 'openai', baseUrl: 42, models: [], modelSettings: {} },
        { id: 'bad-fields', name: '补默认值', protocol: 'openai', baseUrl: 'https://defaults.example', models: 'not-an-array', hasKey: 'yes', modelSettings: [] },
        null,
        'invalid',
        42,
        ['invalid-array']
      ]
    })

    const settings = await freshApi().getSettings()

    expect(settings.theme).toBe('dark')
    expect(settings.customPrompt).toBe('保留这段提示词')
    expect(settings.lastWorkspacePath).toBeUndefined()
    expect(settings.providers).toEqual([validProvider, normalizedProvider, { id: 'bad-fields', name: '补默认值', protocol: 'openai', baseUrl: 'https://defaults.example', models: [], hasKey: false, modelSettings: {} }])
  })

  it('兼容旧设置缺少时间映射，并安全处理 null 或非对象时间映射', async () => {
    const api = freshApi()

    for (const recentWorkspaceOpenedAt of [undefined, null, [], 'broken']) {
      storedSettings({ recentWorkspaces: ['workspaces/legacy'], recentWorkspaceOpenedAt })

      await expect(api.listRecentWorkspaces()).resolves.toEqual([
        { name: 'legacy', path: 'workspaces/legacy', chapterCount: 0, volumeCount: 0, relationshipCount: 0 }
      ])
    }
  })

  it('按打开时间倒序返回最近工作区并附带 lastOpenedAt', async () => {
    storedSettings({
      recentWorkspaces: ['workspaces/legacy', 'workspaces/old', 'workspaces/new'],
      recentWorkspaceOpenedAt: {
        'workspaces/old': '2026-09-01T00:00:00.000Z',
        'workspaces/new': '2026-09-10T00:00:00.000Z'
      }
    })

    const result = await freshApi().listRecentWorkspaces()

    expect(result).toEqual([
      { name: 'new', path: 'workspaces/new', chapterCount: 0, volumeCount: 0, relationshipCount: 0, lastOpenedAt: '2026-09-10T00:00:00.000Z' },
      { name: 'old', path: 'workspaces/old', chapterCount: 0, volumeCount: 0, relationshipCount: 0, lastOpenedAt: '2026-09-01T00:00:00.000Z' },
      { name: 'legacy', path: 'workspaces/legacy', chapterCount: 0, volumeCount: 0, relationshipCount: 0 }
    ])
  })

  it('renames an Android project and forgets its recent entry without removing its files', async () => {
    let preferencesValue = JSON.stringify({ recentWorkspaces: ['workspaces/demo'], recentWorkspaceOpenedAt: { 'workspaces/demo': '2026-09-01T00:00:00.000Z' }, lastWorkspacePath: 'workspaces/demo' })
    doubles.preferencesGet.mockImplementation(async () => ({ value: preferencesValue }))
    doubles.preferencesSet.mockImplementation(async (input: { value: string }) => { preferencesValue = input.value })
    const api = freshApi()
    await api.renameWorkspace('workspaces/demo', '新名称')
    expect(doubles.setWorkspaceName).toHaveBeenCalledWith(expect.objectContaining({ path: 'workspaces/demo' }), '新名称')
    await api.forgetRecentWorkspace('workspaces/demo')
    const saved = JSON.parse(preferencesValue) as { recentWorkspaces: string[]; recentWorkspaceOpenedAt: Record<string, string>; lastWorkspacePath?: string }
    expect(saved.recentWorkspaces).toEqual([])
    expect(saved.recentWorkspaceOpenedAt).toEqual({})
    expect(saved.lastWorkspacePath).toBeUndefined()
    expect(doubles.remove).not.toHaveBeenCalled()
  })

  it('跳过非法或已删除的路径，并用后面的有效工作区补足五条', async () => {
    storedSettings({
      recentWorkspaces: [
        '/data/user/0/app/workspaces/outside',
        'workspaces/deleted',
        'workspaces/broken',
        'workspaces/valid-1',
        'workspaces/valid-2',
        'workspaces/valid-3',
        'workspaces/valid-4',
        'workspaces/valid-5',
        'workspaces/valid-6'
      ],
      recentWorkspaceOpenedAt: {}
    })
    doubles.validateWorkspace.mockImplementation(async (store: { path: string }) => ({ ok: store.path !== 'workspaces/deleted' }))
    doubles.loadWorkspaceListItem.mockImplementation(async (_store: unknown, fallbackName: string, path: string) => {
      if (path === 'workspaces/broken') throw new Error('损坏')
      return defaultListItem(_store, fallbackName, path)
    })

    const result = await freshApi().listRecentWorkspaces()

    expect(result.map((item) => item.path)).toEqual([
      'workspaces/valid-1',
      'workspaces/valid-2',
      'workspaces/valid-3',
      'workspaces/valid-4',
      'workspaces/valid-5'
    ])
  })

  it('listWorkspaces 仍发现全部应用内部工作区，不受最近列表五条限制', async () => {
    doubles.listDirs.mockResolvedValue(['a', 'b', 'c', 'd', 'e', 'f'])
    storedSettings({ recentWorkspaces: ['workspaces/a'], recentWorkspaceOpenedAt: {} })

    const result = await freshApi().listWorkspaces()

    expect(result.map((item) => item.path)).toEqual([
      'workspaces/a',
      'workspaces/b',
      'workspaces/c',
      'workspaces/d',
      'workspaces/e',
      'workspaces/f'
    ])
  })

  it('成功打开工作区通过统一记录逻辑更新路径、时间映射和 lastWorkspacePath', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-11T08:00:00.000Z'))
    storedSettings({ recentWorkspaces: ['workspaces/old'], recentWorkspaceOpenedAt: { 'workspaces/old': '2026-09-01T00:00:00.000Z' } })
    const api = freshApi()
    ;(api as unknown as { installWorkspace: ReturnType<typeof vi.fn> }).installWorkspace = vi.fn()

    await api.openWorkspace('workspaces/demo')

    const saved = JSON.parse(doubles.preferencesSet.mock.calls[0][0].value) as Record<string, unknown>
    expect(saved.recentWorkspaces).toEqual(['workspaces/demo', 'workspaces/old'])
    expect(saved.recentWorkspaceOpenedAt).toEqual({
      'workspaces/demo': '2026-09-11T08:00:00.000Z',
      'workspaces/old': '2026-09-01T00:00:00.000Z'
    })
    expect(saved.lastWorkspacePath).toBe('workspaces/demo')
  })

  it('成功导入工作区通过统一记录逻辑更新路径、时间映射和 lastWorkspacePath', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-11T09:00:00.000Z'))
    storedSettings({ recentWorkspaces: [], recentWorkspaceOpenedAt: {} })
    const api = freshApi()
    ;(api as unknown as { installWorkspace: ReturnType<typeof vi.fn> }).installWorkspace = vi.fn()

    await api.importWorkspace(new Uint8Array(), 'imported.storyfabric.zip')

    const saved = JSON.parse(doubles.preferencesSet.mock.calls[0][0].value) as Record<string, unknown>
    expect(saved.recentWorkspaces).toEqual(['workspaces/imported'])
    expect(saved.recentWorkspaceOpenedAt).toEqual({ 'workspaces/imported': '2026-09-11T09:00:00.000Z' })
    expect(saved.lastWorkspacePath).toBe('workspaces/imported')
  })
})

describe('AndroidPlatformApi fetchModels', () => {
  it('providerId 存在时使用已保存归一化 provider 的 protocol 和 baseUrl', async () => {
    storedSettings({
      providers: [{
        id: 'provider-saved',
        name: '已保存供应商',
        protocol: 'anthropic',
        baseUrl: 'https://saved.example/v1',
        models: ['claude-3'],
        hasKey: true,
        modelSettings: {}
      }]
    })
    doubles.fetchProviderModels.mockResolvedValue(['claude-3'])

    const result = await freshApi().fetchModels({
      providerId: 'provider-saved',
      protocol: 'openai',
      baseUrl: 'https://stale.example/v1',
      apiKey: 'input-key'
    })

    expect(result).toEqual(['claude-3'])
    expect(doubles.fetchProviderModels).toHaveBeenCalledWith('anthropic', 'https://saved.example/v1', 'input-key', { fetcher: expect.any(Function) })
  })
})

describe('AndroidPlatformApi agent transport', () => {
  it('passes the native Capacitor fetcher to LLM adapters', async () => {
    doubles.validateWorkspace.mockResolvedValue({ ok: true })
    doubles.loadSummary.mockResolvedValue({ name: 'demo', path: 'workspaces/demo' })

    await freshApi().openWorkspace('workspaces/demo')

    const getAdapter = doubles.agentOptions?.getAdapter as ((protocol: string, baseUrl: string) => unknown)
    getAdapter('openai', 'https://gateway.example/v1')

    expect(doubles.getAdapter).toHaveBeenCalledWith(
      'openai',
      'https://gateway.example/v1',
      expect.objectContaining({ fetcher: doubles.nativeFetcher })
    )
  })
})

describe('AndroidPlatformApi clipboard', () => {
  it('uses the Android system clipboard for reading and writing text', async () => {
    const api = freshApi()
    doubles.clipboardRead.mockResolvedValue({ type: 'text/plain', value: '来自系统剪贴板' })

    await api.clipboardWriteText!('写入系统剪贴板')
    await expect(api.clipboardReadText!()).resolves.toBe('来自系统剪贴板')

    expect(doubles.clipboardWrite).toHaveBeenCalledWith({ string: '写入系统剪贴板' })
    expect(doubles.clipboardRead).toHaveBeenCalledOnce()
  })
})

describe('Android external workspaces', () => {
  const treeUri = 'content://com.android.externalstorage.documents/tree/primary%3ADocuments'

  it('creates a project under the directory selected through Android SAF', async () => {
    doubles.pickDirectory.mockResolvedValue({ uri: treeUri })
    const api = freshApi()
    const parent = await api.pickFolder()
    expect(parent).toBe(makeSafPath(treeUri))

    const path = await api.createWorkspace(parent!, '星海拾遗')
    expect(path).toMatch(/^saf:/)
    expect(doubles.safMkdir).toHaveBeenCalledWith(expect.objectContaining({ treeUri, root: '', exclusive: true }))
    expect(doubles.initializeWorkspace).toHaveBeenCalledWith(expect.objectContaining({ path }), '星海拾遗')
  })

  it('lists a previously registered external project alongside internal projects', async () => {
    const externalPath = makeSafPath(treeUri, '星海拾遗_123')
    doubles.preferencesGet.mockImplementation(async ({ key }: { key: string }) => ({ value: key === 'storyfabric.external-workspaces' ? JSON.stringify([externalPath]) : null }))
    doubles.listDirs.mockResolvedValue(['internal'])
    const list = await freshApi().listWorkspaces()
    expect(list.map((item) => item.path).sort()).toEqual([externalPath, 'workspaces/internal'].sort())
  })

  it('registers an opened external project for the all-projects view', async () => {
    const externalPath = makeSafPath(treeUri)
    await freshApi().openWorkspace(externalPath)
    expect(doubles.preferencesSet).toHaveBeenCalledWith({
      key: 'storyfabric.external-workspaces', value: JSON.stringify([externalPath])
    })
  })

  it('imports a ZIP directly into a selected external parent folder', async () => {
    const parent = makeSafPath(treeUri)
    await freshApi().importWorkspace(new Uint8Array([1, 2]), 'archive.storyfabric.zip', { parentDir: parent, name: '外部导入' })
    expect(doubles.importWorkspaceArchive).toHaveBeenCalledWith(expect.objectContaining({ path: makeSafPath(treeUri, '外部导入') }), new Uint8Array([1, 2]), { upgradeLegacy: false })
    expect(doubles.safMkdir).toHaveBeenCalledWith({ treeUri, root: '', path: '外部导入', exclusive: true })
  })
})

it('rejects legacy open before changing active Android workspace or recent settings, then forwards consent', async () => {
  const api = freshApi()
  await api.openWorkspace('workspaces/current')
  doubles.preferencesSet.mockClear()
  doubles.loadSummary.mockRejectedValueOnce(new Error('WORKSPACE_UPGRADE_REQUIRED：旧项目'))
  await expect(api.openWorkspace('workspaces/legacy')).rejects.toThrow('WORKSPACE_UPGRADE_REQUIRED')
  expect(doubles.preferencesSet).not.toHaveBeenCalled()
  expect(doubles.agentOptions?.workspaceId).toBe('workspaces/current')
  doubles.loadSummary.mockResolvedValueOnce({ name: '升级后', path: 'workspaces/legacy', version: 5 })
  await expect(api.openWorkspace('workspaces/legacy', { upgradeLegacy: true })).resolves.toMatchObject({ version: 5 })
  expect(doubles.loadSummary).toHaveBeenLastCalledWith(expect.objectContaining({ path: 'workspaces/legacy' }), 'legacy', 'workspaces/legacy', { upgradeLegacy: true })
  await api.importWorkspace(new Uint8Array([1]), 'old.storyfabric.zip', undefined, { upgradeLegacy: true })
  expect(doubles.importWorkspaceArchive).toHaveBeenLastCalledWith(expect.anything(), new Uint8Array([1]), { upgradeLegacy: true })
})

it.each(['failure', 'abort'])('rolls back Android import when its final summary has %s', async (mode) => {
  const api = freshApi()
  await api.openWorkspace('workspaces/current')
  doubles.preferencesSet.mockClear()
  const controller = new AbortController()
  let entered = false
  let release!: () => void
  const deferred = new Promise<void>((resolve) => { release = resolve })
  doubles.loadSummary.mockImplementationOnce(async () => {
    entered = true
    await deferred
    if (mode === 'failure') throw new Error('summary read failed')
    return { name: '导入项目', path: 'workspaces/imported', version: 5 }
  })
  const importing = api.importWorkspace(new Uint8Array([1]), 'imported.storyfabric.zip', undefined, { signal: controller.signal })
  await vi.waitFor(() => expect(entered).toBe(true))
  if (mode === 'abort') controller.abort()
  release()
  await expect(importing).rejects.toThrow(mode === 'failure' ? 'summary read failed' : '工作区请求已取消')
  expect(doubles.agentOptions?.workspaceId).toBe('workspaces/current')
  expect(doubles.preferencesSet).not.toHaveBeenCalled()
  expect(doubles.remove).toHaveBeenCalledWith('workspaces', 'imported')
})

it('an earlier Android summary failure cannot replace a later successful workspace', async () => {
  const api = freshApi()
  await api.openWorkspace('workspaces/original')
  let rejectOlder!: (error: Error) => void
  doubles.loadSummary.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectOlder = reject }))
  const older = api.openWorkspace('workspaces/older')
  await vi.waitFor(() => expect(rejectOlder).toBeTypeOf('function'))
  doubles.loadSummary.mockResolvedValueOnce({ name: 'newer', path: 'workspaces/newer' })
  await api.openWorkspace('workspaces/newer')
  rejectOlder(new Error('older summary failed'))
  await expect(older).rejects.toThrow('older summary failed')
  expect(doubles.agentOptions?.workspaceId).toBe('workspaces/newer')
  doubles.loadSummary.mockResolvedValueOnce({ name: 'newer', path: 'workspaces/newer' })
  await expect(api.getCurrentWorkspace()).resolves.toMatchObject({ path: 'workspaces/newer' })
})

it('does not install or clear Android runtime replay until recent settings commit succeeds', async () => {
  const api = freshApi()
  await api.openWorkspace('workspaces/current')
  type TestRuntime = { runtimeBuffers: Map<string, unknown>; runtimeSequences: Map<string, number>; runtimeTouched: Map<string, number> }
  const runtime = api as unknown as TestRuntime
  runtime.runtimeBuffers.set('current-run', { protected: true })
  runtime.runtimeSequences.set('current-run', 7)
  runtime.runtimeTouched.set('current-run', 10)
  doubles.preferencesSet.mockRejectedValueOnce(new Error('recent disk failed'))
  await expect(api.openWorkspace('workspaces/next')).rejects.toThrow('recent disk failed')
  expect(doubles.agentOptions?.workspaceId).toBe('workspaces/current')
  expect(runtime.runtimeBuffers.get('current-run')).toEqual({ protected: true })
  expect(runtime.runtimeSequences.get('current-run')).toBe(7)
  expect(runtime.runtimeTouched.get('current-run')).toBe(10)
})

describe('AndroidPlatformApi generation preferences', () => {
  it('returns fresh generation defaults when Preferences has no stored value', async () => {
    const api = freshApi()
    const first = await api.getSettings()
    first.agentGeneration.agentTemperature = 0

    await expect(api.getSettings()).resolves.toMatchObject({
      agentGeneration: { agentTemperature: 70, proseAlternativesEnabled: false, maxToolRounds: 100 }
    })
  })

  it('returns isolated generation defaults after malformed Preferences', async () => {
    doubles.preferencesGet.mockResolvedValue({ value: '{' })
    const api = freshApi()
    const first = await api.getSettings()
    try {
      first.agentGeneration.agentTemperature = 0

      await expect(api.getSettings()).resolves.toMatchObject({
        agentGeneration: { agentTemperature: 70, proseAlternativesEnabled: false, maxToolRounds: 100 }
      })
    } finally {
      first.agentGeneration.agentTemperature = 70
    }
  })

  it('passes normalized generation preferences through its CoreAgentService settings callback', async () => {
    storedSettings({ agentGeneration: { agentTemperature: 101, proseAlternativesEnabled: 'true', maxToolRounds: 250 } })
    const api = freshApi()
    await (api as unknown as { installWorkspace(path: string, store: unknown): Promise<void> }).installWorkspace('workspaces/generation', { path: 'workspaces/generation' })
    const coreAgent = (api as unknown as {
      agent: { options: { settings: () => Promise<{ agentGeneration?: unknown }> } } | null
    }).agent

    await expect(coreAgent?.options.settings()).resolves.toMatchObject({
      agentGeneration: { agentTemperature: 100, proseAlternativesEnabled: false, maxToolRounds: 250 }
    })
  })

  it('defaults and normalizes persisted generation preferences', async () => {
    storedSettings({ agentGeneration: { agentTemperature: 101, proseAlternativesEnabled: 'true', maxToolRounds: 250 } })

    await expect(freshApi().getSettings()).resolves.toMatchObject({
      agentGeneration: { agentTemperature: 100, proseAlternativesEnabled: false, maxToolRounds: 250 }
    })
    storedSettings({})
    await expect(freshApi().getSettings()).resolves.toMatchObject({
      agentGeneration: { agentTemperature: 70, proseAlternativesEnabled: false, maxToolRounds: 100 }
    })
  })

  it('persists normalized generation preferences', async () => {
    const api = freshApi()
    await api.updateSettings({ agentGeneration: { agentTemperature: -1, proseAlternativesEnabled: true, maxToolRounds: 250 } })

    expect(JSON.parse(doubles.preferencesSet.mock.calls.at(-1)?.[0].value ?? '{}')).toMatchObject({
      agentGeneration: { agentTemperature: 0, proseAlternativesEnabled: true, maxToolRounds: 250 }
    })
  })
})
