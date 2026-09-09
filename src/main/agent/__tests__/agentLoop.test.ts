import { promises as fs } from 'fs'
import { mkdtemp } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, ChatSession } from '../../../shared/types'
import type { AgentEventEnvelope } from '../../../shared/api'
import { serializeNote } from '../../../core/workspace/entityStore'
import { AgentService } from '../agentLoop'
import { SettingsService } from '../../services/settingsService'
import { SessionStore } from '../../services/sessionStore'
import { saveCharacter, saveNote } from '../../services/entityStore'
import { listTrash } from '../../services/workspaceService'

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const c of chunks) controller.enqueue(encoder.encode(c))
        controller.close()
      }
    }),
    { status: 200 }
  )
}

const openaiSse = (payload: Record<string, unknown>, finish: 'tool_calls' | 'stop'): string[] => [
  `data: ${JSON.stringify(payload)}\n\n`,
  `data: {"choices":[{"delta":{},"finish_reason":"${finish}"}]}\n\n`,
  'data: [DONE]\n\n'
]

let root: string
let settings: SettingsService
let events: AgentEventEnvelope[]

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'sf-agent-'))
  settings = new SettingsService(join(root, 'settings.json'))
  await settings.saveProvider({ name: 'mock', protocol: 'openai', baseUrl: 'https://mock.local/v1', apiKey: 'sk-test', models: ['mock-model'] })
  const s = await settings.load()
  providerId = s.providers[0].id
  events = []
})

afterEach(async () => {
  vi.restoreAllMocks()
  globalThis.fetch = originalFetch
  await fs.rm(root, { recursive: true, force: true })
})

const originalFetch = globalThis.fetch
let providerId = ''

function makeAgent(): AgentService {
  return new AgentService(settings, (_sid, ev: AgentEvent) => events.push({ sessionId: _sid, event: ev }))
}

function stubFetch(responses: Response[]): void {
  const queue = [...responses]
  globalThis.fetch = vi.fn(async () => {
    const res = queue.shift()
    if (!res) throw new Error('no queued response')
    return res
  })
}

async function loadPersisted(sessionId: string): Promise<ChatSession | null> {
  return new SessionStore(root).load(sessionId)
}

describe('AgentService', () => {
  it('读工具自动执行并回注，最终生成回答', async () => {
    await saveCharacter(root, { name: '林晚', role: '主角' })

    stubFetch([
      sseResponse(
        openaiSse({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'list_characters', arguments: '{}' } }] } }] }, 'tool_calls')
      ),
      sseResponse(openaiSse({ choices: [{ delta: { content: '工作区里有 1 位人物：林晚。' } }] }, 'stop'))
    ])

    const agent = makeAgent()
    const { sessionId } = await agent.run(root, { message: '有哪些人物？', providerId, model: 'mock-model' })

    const types = events.map((e) => e.event.type)
    expect(types).toContain('session')
    expect(types).toContain('text-delta')
    expect(types).toContain('tool-start')
    expect(types).toContain('tool-done')
    expect(types).toContain('done')

    // 工具结果是人物列表 JSON
    const session = (await loadPersisted(sessionId))!
    const toolMsg = session.messages.find((m) => m.role === 'tool')
    expect(toolMsg?.text).toContain('林晚')
    // 最终助手消息在最后
    expect(session.messages.at(-1)?.role).toBe('assistant')
    expect(session.messages.at(-1)?.text).toContain('林晚')
  })

  it('写工具生成待确认变更：拒绝则不落盘', async () => {
    stubFetch([
      sseResponse(
        openaiSse(
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    { index: 0, id: 'w1', function: { name: 'save_character', arguments: JSON.stringify({ character: { name: '新角色', summary: 'AI 创建' } }) } }
                  ]
                }
              }
            ]
          },
          'tool_calls'
        )
      ),
      sseResponse(openaiSse({ choices: [{ delta: { content: '好的，已按你的意见放弃。' } }] }, 'stop'))
    ])

    const agent = makeAgent()
    const runPromise = agent.run(root, { message: '帮我建个人物', providerId, model: 'mock-model' })

    // 等待 pending-change 出现后拒绝
    await vi.waitFor(() => {
      expect(events.some((e) => e.event.type === 'pending-change')).toBe(true)
    })
    const changeEv = events.find((e) => e.event.type === 'pending-change')!
    agent.confirmChange((changeEv.event as { change: { id: string } }).change.id, false)

    const { sessionId } = await runPromise

    const charactersDir = join(root, 'characters')
    let files: string[] = []
    try {
      files = await fs.readdir(charactersDir)
    } catch {
      /* 目录不存在 */
    }
    expect(files).toHaveLength(0)

    const session = (await loadPersisted(sessionId))!
    const toolMsgs = session.messages.filter((m) => m.role === 'tool')
    expect(toolMsgs.some((m) => m.text?.includes('拒绝'))).toBe(true)
  })

  it('delete_note 拒绝后保留便签且回注拒绝消息', async () => {
    const note = await saveNote(root, { title: '待删除便签', content: '保留内容' })
    stubFetch([
      sseResponse(
        openaiSse(
          {
            choices: [
              {
                delta: {
                  tool_calls: [{ index: 0, id: 'w-delete-note', function: { name: 'delete_note', arguments: JSON.stringify({ noteId: note.id }) } }]
                }
              }
            ]
          },
          'tool_calls'
        )
      ),
      sseResponse(openaiSse({ choices: [{ delta: { content: '好的，已保留这条便签。' } }] }, 'stop'))
    ])

    const agent = makeAgent()
    const runPromise = agent.run(root, { message: '删除这条便签', providerId, model: 'mock-model' })

    await vi.waitFor(() => {
      expect(events.some((e) => e.event.type === 'pending-change')).toBe(true)
    })
    const changeEv = events.find((e) => e.event.type === 'pending-change')!
    agent.confirmChange((changeEv.event as { change: { id: string } }).change.id, false)

    const { sessionId } = await runPromise
    const noteFiles = await fs.readdir(join(root, 'notes'))
    expect(noteFiles.some((file) => file.includes('待删除便签'))).toBe(true)

    const session = (await loadPersisted(sessionId))!
    const toolMsgs = session.messages.filter((m) => m.role === 'tool')
    expect(toolMsgs.some((m) => m.text?.includes('拒绝'))).toBe(true)
  })

  it('delete_note 批准后移入回收站且回注成功消息', async () => {
    const note = await saveNote(root, { title: '批准删除便签', content: '待移入回收站' })
    stubFetch([
      sseResponse(
        openaiSse(
          {
            choices: [
              {
                delta: {
                  tool_calls: [{ index: 0, id: 'w-delete-note-approved', function: { name: 'delete_note', arguments: JSON.stringify({ noteId: ` ${note.id} ` }) } }]
                }
              }
            ]
          },
          'tool_calls'
        )
      ),
      sseResponse(openaiSse({ choices: [{ delta: { content: '已完成删除。' } }] }, 'stop'))
    ])

    const agent = makeAgent()
    const runPromise = agent.run(root, { message: '确认删除这条便签', providerId, model: 'mock-model' })

    await vi.waitFor(() => {
      expect(events.some((e) => e.event.type === 'pending-change')).toBe(true)
    })
    const changeEv = events.find((e) => e.event.type === 'pending-change')!
    expect((changeEv.event as { change: { beforeText: string } }).change.beforeText).toBe(serializeNote(note))
    agent.confirmChange((changeEv.event as { change: { id: string } }).change.id, true)

    const { sessionId } = await runPromise
    const noteFiles = await fs.readdir(join(root, 'notes'))
    expect(noteFiles.some((file) => file.includes('批准删除便签'))).toBe(false)
    expect((await listTrash(root)).some((entry) => entry.id === note.id)).toBe(true)

    const session = (await loadPersisted(sessionId))!
    const toolMsgs = session.messages.filter((m) => m.role === 'tool')
    expect(toolMsgs.some((m) => m.text?.includes('已将便签「批准删除便签」移入回收站'))).toBe(true)
  })

  it.each([
    ['数字', 123],
    ['空字符串', ''],
    ['空白字符串', '   ']
  ])('delete_note 对%s noteId 拒绝且不产生待确认变更', async (_label, noteId) => {
    stubFetch([
      sseResponse(
        openaiSse(
          {
            choices: [
              {
                delta: {
                  tool_calls: [{ index: 0, id: `w-delete-note-invalid-${String(noteId)}`, function: { name: 'delete_note', arguments: JSON.stringify({ noteId }) } }]
                }
              }
            ]
          },
          'tool_calls'
        )
      ),
      sseResponse(openaiSse({ choices: [{ delta: { content: '参数无效。' } }] }, 'stop'))
    ])

    const agent = makeAgent()
    const { sessionId } = await agent.run(root, { message: '删除便签', providerId, model: 'mock-model' })

    expect(events.some((e) => e.event.type === 'pending-change')).toBe(false)
    const session = (await loadPersisted(sessionId))!
    const toolMsgs = session.messages.filter((m) => m.role === 'tool')
    expect(toolMsgs.some((m) => m.text?.includes('delete_note 必须提供有效 noteId'))).toBe(true)
  })

  it('写工具确认后写入工作区', async () => {
    stubFetch([
      sseResponse(
        openaiSse(
          {
            choices: [
              {
                delta: {
                  tool_calls: [{ index: 0, id: 'w2', function: { name: 'save_character', arguments: JSON.stringify({ character: { name: '确认君', content: '# 确认君' } }) } }]
                }
              }
            ]
          },
          'tool_calls'
        )
      ),
      sseResponse(openaiSse({ choices: [{ delta: { content: '已创建。' } }] }, 'stop'))
    ])

    const agent = makeAgent()
    const runPromise = agent.run(root, { message: '建一个人物', providerId, model: 'mock-model' })

    await vi.waitFor(() => {
      expect(events.some((e) => e.event.type === 'pending-change')).toBe(true)
    })
    const changeEv = events.find((e) => e.event.type === 'pending-change')!
    agent.confirmChange((changeEv.event as { change: { id: string } }).change.id, true)

    await runPromise
    const chars = await fs.readdir(join(root, 'characters'))
    expect(chars.some((f) => f.includes('确认君'))).toBe(true)
  })

  it('流式期间的重命名/归档在落盘时保留', async () => {
    stubFetch([
      sseResponse(
        openaiSse(
          {
            choices: [
              {
                delta: {
                  tool_calls: [{ index: 0, id: 'w3', function: { name: 'save_character', arguments: JSON.stringify({ character: { name: '改名君' } }) } }]
                }
              }
            ]
          },
          'tool_calls'
        )
      ),
      sseResponse(openaiSse({ choices: [{ delta: { content: '完成。' } }] }, 'stop'))
    ])

    const agent = makeAgent()
    const runPromise = agent.run(root, { message: '建一个人物', providerId, model: 'mock-model' })

    await vi.waitFor(() => {
      expect(events.some((e) => e.event.type === 'pending-change')).toBe(true)
    })
    const sid = events[0].sessionId
    // 用户在等待确认期间重命名并归档了会话
    await new SessionStore(root).updateMeta(sid, { title: '用户改的名字', archived: true })
    const changeEv = events.find((e) => e.event.type === 'pending-change')!
    agent.confirmChange((changeEv.event as { change: { id: string } }).change.id, true)

    await runPromise
    const persisted = (await loadPersisted(sid))!
    expect(persisted.title).toBe('用户改的名字')
    expect(persisted.archived).toBe(true)
  })

  it('中止会话时循环退出且不抛出', async () => {
    // 永不返回、但响应 abort 信号的流
    globalThis.fetch = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              init?.signal?.addEventListener('abort', () => {
                controller.error(new DOMException('aborted', 'AbortError'))
              })
            }
          }),
          { status: 200 }
        )
    )
    const agent = makeAgent()
    const p = agent.run(root, { message: '慢慢想', providerId, model: 'mock-model' })
    await vi.waitFor(() => {
      expect(events.length).toBeGreaterThan(0)
    })
    const sid = events[0]?.sessionId
    expect(sid).toBeTruthy()
    agent.abort(sid!)
    const { sessionId } = await p
    expect(sessionId).toBe(sid!)
    const types = events.map((e) => e.event.type)
    expect(types).toContain('error')
  })
})
