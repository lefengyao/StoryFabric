import { describe, expect, it, vi } from 'vitest'
import { HttpPlatformApi, WebAuthRequiredError } from '../httpApi'

describe('web platform api', () => {
  it('loads supplier pricing through the authenticated cloud RPC', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ result: [] }), { headers: { 'content-type': 'application/json' } }))
    const api = new HttpPlatformApi(fetcher)
    await expect(api.cloudAccount.getSupplierLobby!()).resolves.toEqual([])
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({ method: 'cloudSupplierLobby', args: [] })
  })
  it('opens account authorization in a popup and keeps the app page alive', async () => {
    const originalWindow = (globalThis as { window?: unknown }).window
    const popup = { focus: vi.fn() }
    const open = vi.fn(() => popup)
    const assign = vi.fn()
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { open, location: { assign } } })
    try {
      let call = 0
      const api = new HttpPlatformApi(async () => {
        call += 1
        return call === 1
          ? new Response(JSON.stringify({ url: 'https://accounts.example/oauth/authorize' }), { status: 200 })
          : new Response(JSON.stringify({ result: { phase: 'authorizing', persistent: false } }), { status: 200 })
      })

      await expect(api.cloudAccount.beginLogin()).resolves.toMatchObject({ phase: 'authorizing' })
      expect(open).toHaveBeenCalledWith('https://accounts.example/oauth/authorize', 'storyfabric-account-login', 'popup,width=520,height=760,resizable=yes,scrollbars=yes')
      expect(popup.focus).toHaveBeenCalledOnce()
      expect(assign).not.toHaveBeenCalled()
    } finally {
      if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window
      else Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow })
    }
  })

  it('falls back to same-tab navigation when the authorization popup is blocked', async () => {
    const originalWindow = (globalThis as { window?: unknown }).window
    const open = vi.fn(() => null)
    const assign = vi.fn()
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { open, location: { assign } } })
    try {
      let call = 0
      const api = new HttpPlatformApi(async () => {
        call += 1
        return call === 1
          ? new Response(JSON.stringify({ url: 'https://accounts.example/oauth/authorize' }), { status: 200 })
          : new Response(JSON.stringify({ result: { phase: 'authorizing', persistent: false } }), { status: 200 })
      })

      await api.cloudAccount.beginLogin()
      expect(assign).toHaveBeenCalledWith('https://accounts.example/oauth/authorize')
    } finally {
      if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window
      else Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow })
    }
  })

  it('maps StoryFabric calls to authenticated RPC requests', async () => {
    const requests: Array<{ url: string; body: string }> = []
    const api = new HttpPlatformApi(async (input, init) => {
      requests.push({ url: String(input), body: String(init?.body ?? '') })
      return new Response(JSON.stringify({ result: { name: '服务工作区' } }), { status: 200, headers: { 'content-type': 'application/json' } })
    })

    await expect(api.getCurrentWorkspace()).resolves.toEqual({ name: '服务工作区' })
    expect(requests[0].url).toBe('/api/rpc')
    expect(JSON.parse(requests[0].body)).toEqual({ method: 'getCurrentWorkspace', args: [] })
  })

  it('requests recent workspaces from the dedicated endpoint', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const recent = [{ name: '最近工作区', path: 'ws_recent', chapterCount: 1, volumeCount: 0, relationshipCount: 0, lastOpenedAt: '2026-09-11T08:00:00.000Z' }]
    const api = new HttpPlatformApi(async (input, init) => {
      requests.push({ url: String(input), init })
      return new Response(JSON.stringify(recent), { status: 200, headers: { 'content-type': 'application/json' } })
    })

    await expect(api.listRecentWorkspaces()).resolves.toEqual(recent)
    expect(requests[0].url).toBe('/api/workspaces/recent')
    expect(requests[0].init?.credentials).toBe('include')
  })

  it('sends rename and recent-list removal through authenticated RPC', async () => {
    const calls: unknown[] = []
    const api = new HttpPlatformApi(async (_input, init) => {
      calls.push(JSON.parse(String(init?.body)))
      return new Response(JSON.stringify({ result: null }), { status: 200 })
    })
    await api.renameWorkspace('ws_1', '新名称')
    await api.forgetRecentWorkspace('ws_1')
    expect(calls).toEqual([
      { method: 'renameWorkspace', args: ['ws_1', '新名称'] },
      { method: 'forgetRecentWorkspace', args: ['ws_1'] }
    ])
  })

  it('invokes the default browser fetch with the global receiver', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = function (this: unknown, _input: RequestInfo | URL, _init?: RequestInit): Promise<Response> {
      if (this !== globalThis) throw new TypeError('Illegal invocation')
      return Promise.resolve(new Response(JSON.stringify({ result: { name: '默认 fetch' } }), { status: 200 }))
    } as typeof fetch

    try {
      const api = new HttpPlatformApi()
      await expect(api.getCurrentWorkspace()).resolves.toEqual({ name: '默认 fetch' })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('surfaces an authentication error for expired web sessions', async () => {
    const api = new HttpPlatformApi(async () => new Response(JSON.stringify({ error: '需要登录' }), { status: 401 }))

    await expect(api.getCurrentWorkspace()).rejects.toBeInstanceOf(WebAuthRequiredError)
  })

  it('explains when a web host returns HTML instead of the StoryFabric API response', async () => {
    const api = new HttpPlatformApi(async () => new Response('<!doctype html><title>Vite</title>', {
      status: 200,
      headers: { 'content-type': 'text/html' }
    }))

    await expect(api.getCurrentWorkspace()).rejects.toThrow('未连接到 StoryFabric 服务')
  })

  it('uploads raw workspace ZIP bytes to the binary endpoint', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const api = new HttpPlatformApi(async (input, init) => {
      requests.push({ url: String(input), init })
      return new Response(JSON.stringify({ name: '导入副本', path: 'ws_test' }), { status: 201, headers: { 'content-type': 'application/json' } })
    }, 'https://server.example', { kind: 'bearer', token: 't'.repeat(32) })

    await api.importWorkspace(new Uint8Array([1, 2, 3]), '项目.storyfabric.zip', { name: '导入副本' })
    expect(requests[0].url).toBe('https://server.example/api/workspaces/import')
    expect(requests[0].init?.headers).toMatchObject({ authorization: `Bearer ${'t'.repeat(32)}`, 'content-type': 'application/zip' })
    expect(requests[0].init?.body).toBeInstanceOf(ArrayBuffer)
  })

  it('opens a workspace by path with a trimmed JSON POST body', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const api = new HttpPlatformApi(async (input, init) => {
      requests.push({ url: String(input), init })
      return new Response(JSON.stringify({ name: '路径工作区', path: 'ws_path' }), { status: 200, headers: { 'content-type': 'application/json' } })
    }, 'https://server.example', { kind: 'bearer', token: 't'.repeat(32) })

    await api.openWorkspaceByPath('  /srv/storyfabric/workspaces/demo  ')

    expect(requests[0].url).toBe('https://server.example/api/workspaces/open-path')
    expect(requests[0].init?.method).toBe('POST')
    expect(requests[0].init?.headers).toMatchObject({ authorization: `Bearer ${'t'.repeat(32)}`, 'content-type': 'application/json' })
    expect(JSON.parse(String(requests[0].init?.body))).toEqual({ path: '/srv/storyfabric/workspaces/demo' })
  })

  it('forwards an AbortSignal to open and import requests', async () => {
    const requests: RequestInit[] = []
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init) requests.push(init)
      return new Response(JSON.stringify({ name: '工作区', path: 'ws_signal' }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    const api = new HttpPlatformApi(fetcher, 'https://server.example', { kind: 'bearer', token: 't'.repeat(32) })
    const controller = new AbortController()

    await api.openWorkspaceByPath('/srv/workspace', { signal: controller.signal })
    await api.importWorkspace(new Uint8Array([1]), 'workspace.storyfabric.zip', undefined, { signal: controller.signal })

    expect(requests[0].signal).toBe(controller.signal)
    expect(requests[1].signal).toBe(controller.signal)
  })

  it('rejects an empty workspace path', async () => {
    const api = new HttpPlatformApi()

    await expect(api.openWorkspaceByPath('  ')).rejects.toThrow('请输入工作区路径')
  })

  it('forwards explicit upgrade consent for IDs, paths and archive imports', async () => {
    const requests: RequestInit[] = []
    const api = new HttpPlatformApi(async (_input, init) => {
      requests.push(init!)
      return new Response(JSON.stringify({ name: '升级后', path: 'ws_upgraded', version: 5 }), { headers: { 'content-type': 'application/json' } })
    }, 'https://server.example')
    await api.openWorkspace('ws_old', { upgradeLegacy: true })
    await api.openWorkspaceByPath('/srv/workspaces/old', { upgradeLegacy: true })
    await api.importWorkspace(new Uint8Array([1]), 'old.storyfabric.zip', undefined, { upgradeLegacy: true })
    expect(JSON.parse(String(requests[0].body))).toEqual({ upgradeLegacy: true })
    expect(JSON.parse(String(requests[1].body))).toEqual({ path: '/srv/workspaces/old', upgradeLegacy: true })
    expect(requests[2].headers).toMatchObject({ 'x-storyfabric-upgrade-legacy': 'true' })
  })

  it('aborts a bearer SSE request when unsubscribing', async () => {
    let request: RequestInit | undefined
    const api = new HttpPlatformApi(async (_input, init) => {
      request = init
      return new Response(null, { status: 200 })
    }, 'https://server.example', { kind: 'bearer', token: 't'.repeat(32) })

    const unsubscribe = api.onAgentEvent(() => undefined)
    await Promise.resolve()
    expect(request?.signal?.aborted).toBe(false)
    unsubscribe()
    expect(request?.signal?.aborted).toBe(true)
  })

  it('recovers unified runtime events from a sequence cursor', async () => {
    const requests: string[] = []
    const api = new HttpPlatformApi(async (input) => {
      requests.push(String(input))
      return new Response(JSON.stringify({ replayable: true, events: [], snapshotSeq: 8 }), { status: 200, headers: { 'content-type': 'application/json' } })
    }, 'https://server.example', { kind: 'bearer', token: 't'.repeat(32) })

    await expect(api.recoverRunEvents('run/1', 7)).resolves.toMatchObject({ replayable: true, snapshotSeq: 8 })
    expect(requests[0]).toBe('https://server.example/api/runs/run%2F1/events?after=7')
  })

  it('forwards creative preferences through the session update RPC', async () => {
    const requests: Array<{ url: string; body: string }> = []
    const api = new HttpPlatformApi(async (input, init) => {
      requests.push({ url: String(input), body: String(init?.body ?? '') })
      return new Response(JSON.stringify({ result: undefined }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    const creativePreferences = {
      mode: 'orchestration' as const,
      orchestrationEnabled: true,
      subagentsEnabled: false,
      intensity: 'standard' as const,
      selectedSkillIds: [],
      selectedRuleSetIds: [],
      orchestration: {
        mode: 'single' as const,
        enabled: true,
        subagentsEnabled: false,
        enabledStageIds: ['write'],
        modelByStage: {}
      }
    }

    await api.updateSession('session-1', { creativePreferences })

    expect(JSON.parse(requests[0].body)).toEqual({
      method: 'updateSession',
      args: ['session-1', { creativePreferences }]
    })
  })

  it('forwards structured question answers and Skill candidate decisions', async () => {
    const requests: Array<{ method: string; args: unknown[] }> = []
    const api = new HttpPlatformApi(async (_input, init) => {
      const payload = JSON.parse(String(init?.body ?? '{}')) as { method: string; args: unknown[] }
      requests.push(payload)
      return new Response(JSON.stringify({ result: undefined }), { status: 200, headers: { 'content-type': 'application/json' } })
    })

    const answer = { questionId: 'question-1', answers: { direction: 'a' } }
    await api.agentAnswerQuestion(answer)
    await api.agentResolveSkillCandidate('candidate-1', 'install-enable')

    expect(requests).toEqual([
      { method: 'agentAnswerQuestion', args: [answer] },
      { method: 'agentResolveSkillCandidate', args: ['candidate-1', 'install-enable'] }
    ])
  })
})
