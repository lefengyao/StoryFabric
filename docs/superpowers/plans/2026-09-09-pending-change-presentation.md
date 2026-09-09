# Pending Change Presentation & Agent Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让待确认变更弹窗正确呈现删除/恢复操作、为共享 core agent loop 补齐测试、并让两端失败结果的 `preview` 逐字一致。

**Architecture:** 把弹窗展示逻辑抽成 renderer 侧的纯函数 `pendingChangeView`（可单测），弹窗只负责按 variant 渲染；core agent loop 通过注入假 `LlmAdapterFactory` 测试，不碰网络；`preview` 分歧只在 main 的抛错兜底分支，改一处并加跨注册表运行时对照断言。

**Tech Stack:** TypeScript, React 19, Vitest 4, Tailwind v4 主题令牌, `diff`（行级 diff）, `MemoryFileStore` / `NodeFileStore`。

**Spec:** `docs/superpowers/specs/2026-09-09-pending-change-presentation-design.md`

---

## File map

- Create `src/renderer/src/lib/pendingChangeView.ts`：待确认变更 → 弹窗展示模型的纯函数。
- Create `src/renderer/src/lib/__tests__/pendingChangeView.test.ts`：四种 variant、标签回退、文案断言。
- Modify `src/renderer/src/lib/utils.ts:24-30`：`ENTITY_KIND_LABEL` 补 `note`/`setting`。
- Modify `src/renderer/src/components/chat/PendingChangeDialog.tsx`：按 variant 分支渲染。
- Create `src/core/agent/__tests__/agentLoop.test.ts`：core 共享运行时的读写工具路径测试。
- Modify `src/main/tools/registry.ts:684`：失败 `preview` 补前缀。
- Modify `src/main/tools/__tests__/registryParity.test.ts`：增加失败结果 parity 用例。

---

## Task 1: 待确认变更展示

**Files:**
- Create: `src/renderer/src/lib/pendingChangeView.ts`
- Create: `src/renderer/src/lib/__tests__/pendingChangeView.test.ts`
- Modify: `src/renderer/src/lib/utils.ts`
- Modify: `src/renderer/src/components/chat/PendingChangeDialog.tsx`

- [x] **Step 1: 写失败的测试**

创建 `src/renderer/src/lib/__tests__/pendingChangeView.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import type { PendingChange } from '../../../../shared/types'
import { pendingChangeView } from '../pendingChangeView'

function change(patch: Partial<PendingChange>): PendingChange {
  return { id: 'chg_1', toolName: 'save_note', entityKind: 'note', entityId: 'note_1', title: '删除便签：测试', beforeText: '', afterText: '', ...patch }
}

describe('pendingChangeView', () => {
  it('把删除便签渲染为移入回收站的结果说明，而不是内容 diff', () => {
    const view = pendingChangeView(change({ toolName: 'delete_note', beforeText: '# 便签\n内容', afterText: '移入回收站' }))
    expect(view).toEqual({
      variant: 'remove',
      label: '便签',
      caption: '智能体请求删除便签 —— 确认后才会移入回收站',
      outcome: '将移入回收站，可从回收站恢复'
    })
  })

  it('把回收站恢复渲染为恢复结果说明', () => {
    const view = pendingChangeView(
      change({ toolName: 'restore_from_trash', entityKind: 'chapter', beforeText: '{"id":"cha_1"}', afterText: '恢复到 chapters/draft/第一章.md' })
    )
    expect(view).toEqual({
      variant: 'restore',
      label: '章节',
      caption: '智能体请求恢复章节 —— 确认后才会恢复到原位置',
      outcome: '恢复到 chapters/draft/第一章.md'
    })
  })

  it('内容变更保持新建/更新语义', () => {
    expect(pendingChangeView(change({ beforeText: '' })).variant).toBe('create')
    expect(pendingChangeView(change({ beforeText: '' })).caption).toBe('智能体请求新建便签 —— 确认后才会写入工作区')
    expect(pendingChangeView(change({ beforeText: '旧内容' })).variant).toBe('update')
    expect(pendingChangeView(change({ beforeText: '旧内容' })).caption).toBe('智能体请求更新便签 —— 确认后才会写入工作区')
  })

  it('未知实体类型回退为通用标签', () => {
    expect(pendingChangeView(change({ entityKind: 'unknown' as PendingChange['entityKind'] })).label).toBe('实体')
  })

  it('为便签和设定提供中文标签', () => {
    expect(pendingChangeView(change({ entityKind: 'note' })).label).toBe('便签')
    expect(pendingChangeView(change({ entityKind: 'setting' })).label).toBe('设定')
  })
})
```

- [x] **Step 2: 运行测试确认失败**

Run: `npm test -- --run src/renderer/src/lib/__tests__/pendingChangeView.test.ts`
Expected: FAIL —— `Failed to resolve import "../pendingChangeView"`。

- [x] **Step 3: 实现纯函数**

创建 `src/renderer/src/lib/pendingChangeView.ts`：

```ts
import type { PendingChange } from '../../../shared/types'
import { ENTITY_KIND_LABEL } from './utils'

export type PendingChangeVariant = 'create' | 'update' | 'remove' | 'restore'

export interface PendingChangeView {
  variant: PendingChangeVariant
  label: string
  caption: string
  outcome?: string
}

/** 把待确认变更映射为弹窗展示模型：删除/恢复不是内容 diff，单独呈现结果说明。 */
export function pendingChangeView(change: PendingChange): PendingChangeView {
  const label = ENTITY_KIND_LABEL[change.entityKind] ?? '实体'
  if (change.toolName === 'delete_note') {
    return { variant: 'remove', label, caption: `智能体请求删除${label} —— 确认后才会移入回收站`, outcome: '将移入回收站，可从回收站恢复' }
  }
  if (change.toolName === 'restore_from_trash') {
    return { variant: 'restore', label, caption: `智能体请求恢复${label} —— 确认后才会恢复到原位置`, outcome: change.afterText }
  }
  const variant: PendingChangeVariant = change.beforeText ? 'update' : 'create'
  return { variant, label, caption: `智能体请求${variant === 'update' ? '更新' : '新建'}${label} —— 确认后才会写入工作区` }
}
```

- [x] **Step 4: 补齐实体标签**

修改 `src/renderer/src/lib/utils.ts` 的 `ENTITY_KIND_LABEL`：

```ts
export const ENTITY_KIND_LABEL: Record<string, string> = {
  character: '人物',
  relationship: '关系',
  outline: '大纲',
  event: '事件',
  chapter: '章节',
  note: '便签',
  setting: '设定'
}
```

- [x] **Step 5: 运行测试确认通过**

Run: `npm test -- --run src/renderer/src/lib/__tests__/pendingChangeView.test.ts`
Expected: PASS（5 个用例）。

- [x] **Step 6: 让弹窗按 variant 渲染**

把 `src/renderer/src/components/chat/PendingChangeDialog.tsx` 整体替换为：

```tsx
/** 写变更确认弹窗：内容变更以行级 diff 展示；删除/恢复展示为只读上下文 + 结果说明 */
import { Check, X } from 'lucide-react'
import { useMemo } from 'react'
import { diffLines } from 'diff'
import type { PendingChange } from '../../../../shared/types'
import { Button } from '../ui/primitives'
import { Modal } from '../ui/modal'
import { pendingChangeView } from '../../lib/pendingChangeView'

export function PendingChangeDialog({
  change,
  onConfirm
}: {
  change: PendingChange
  onConfirm: (approved: boolean) => void
}): React.ReactElement {
  const view = pendingChangeView(change)
  const isContentDiff = view.variant === 'create' || view.variant === 'update'
  const parts = useMemo(() => {
    if (!isContentDiff) return null
    try {
      return diffLines(change.beforeText || '', change.afterText || '')
    } catch {
      return null
    }
  }, [change, isContentDiff])

  return (
    <Modal open onOpenChange={() => onConfirm(false)} title={change.title} description={view.caption} wide>
      {isContentDiff ? (
        <div className="max-h-[46vh] overflow-auto rounded-lg border border-line bg-app p-3 font-mono text-xs leading-5">
          {!parts && <span className="text-muted">（无法生成差异预览）</span>}
          {parts?.map((p, i) => (
            <pre
              key={i}
              className={`whitespace-pre-wrap break-all ${
                p.added ? 'bg-accent/10 text-accent' : p.removed ? 'bg-danger/10 text-danger' : 'text-muted'
              }`}
            >
              {(p.added ? '+ ' : p.removed ? '- ' : '  ') + p.value}
            </pre>
          ))}
          {parts && parts.length === 1 && parts[0].added && !change.beforeText && <span className="text-faint">（新文件）</span>}
        </div>
      ) : (
        <div className="max-h-[46vh] overflow-auto rounded-lg border border-line bg-app p-3">
          {view.outcome && (
            <div
              className={`mb-3 rounded-md px-3 py-2 text-xs ${
                view.variant === 'remove' ? 'bg-danger-soft text-danger' : 'bg-accent-soft text-accent'
              }`}
            >
              {view.outcome}
            </div>
          )}
          {change.beforeText ? (
            <pre className="whitespace-pre-wrap break-all font-mono text-xs leading-5 text-muted">{change.beforeText}</pre>
          ) : (
            <span className="text-faint">（无现有内容）</span>
          )}
        </div>
      )}
      <div className="mt-4 flex items-center justify-end gap-2">
        <Button variant="ghost" onClick={() => onConfirm(false)}>
          <X size={14} /> 拒绝
        </Button>
        <Button variant="primary" onClick={() => onConfirm(true)}>
          <Check size={14} /> 应用写入
        </Button>
      </div>
    </Modal>
  )
}
```

- [x] **Step 7: 类型检查与提交**

Run: `npx tsc -b --pretty false`
Expected: exit 0。

```bash
git add src/renderer/src/lib/pendingChangeView.ts src/renderer/src/lib/__tests__/pendingChangeView.test.ts src/renderer/src/lib/utils.ts src/renderer/src/components/chat/PendingChangeDialog.tsx
git commit -m "fix(renderer): present note removal as an outcome instead of a diff"
```

---

## Task 2: core agent loop 测试

**Files:**
- Create: `src/core/agent/__tests__/agentLoop.test.ts`

- [x] **Step 1: 写覆盖用例**

创建 `src/core/agent/__tests__/agentLoop.test.ts`：

```ts
import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent, ChatSession } from '../../../shared/types'
import type { LlmAdapter, LlmAdapterFactory, StreamResult } from '../../llm/types'
import { MemoryFileStore } from '../../storage/fileStore'
import { initializeWorkspace } from '../../workspace/workspaceService'
import { listNotes, saveNote } from '../../workspace/entityStore'
import { listTrash } from '../../workspace/trash'
import { CoreSessionStore } from '../../workspace/sessionStore'
import { CoreAgentService } from '../agentLoop'

const providerId = 'prov_openai'

/** 脚本化适配器：按顺序返回预置结果，不触网。 */
function scriptedFactory(results: StreamResult[]): LlmAdapterFactory {
  const queue = [...results]
  const adapter: LlmAdapter = {
    stream: async () => {
      const next = queue.shift()
      if (!next) throw new Error('脚本已耗尽：出现未预期的额外模型调用')
      return next
    }
  }
  return () => adapter
}

const text = (value: string): StreamResult => ({ text: value, toolCalls: [], stopReason: 'stop' })
const call = (id: string, name: string, args: Record<string, unknown>): StreamResult => ({
  text: '',
  toolCalls: [{ id, name, argsJson: JSON.stringify(args) }],
  stopReason: 'tool_calls'
})

async function createStore(): Promise<MemoryFileStore> {
  const store = new MemoryFileStore()
  await initializeWorkspace(store, '测试')
  return store
}

function makeService(store: MemoryFileStore, results: StreamResult[], events: AgentEvent[]): CoreAgentService {
  return new CoreAgentService({
    store,
    sessions: new CoreSessionStore(store),
    settings: async () => ({ providers: [{ id: providerId, protocol: 'openai', baseUrl: 'https://mock.local/v1', apiKey: 'sk-test' }] }),
    getAdapter: scriptedFactory(results),
    emit: (_sid, event) => events.push(event)
  })
}

async function loadSession(store: MemoryFileStore, sessionId: string): Promise<ChatSession> {
  const session = await new CoreSessionStore(store).load(sessionId)
  if (!session) throw new Error('会话未落盘')
  return session
}

describe('CoreAgentService', () => {
  it('读工具自动执行并把结果回注给模型', async () => {
    const store = await createStore()
    await saveNote(store, { title: '林晚的设定', content: '主角' })
    const events: AgentEvent[] = []
    const service = makeService(store, [call('c1', 'list_notes', {}), text('工作区里有 1 条便签。')], events)

    const { sessionId } = await service.run({ message: '有哪些便签？', providerId, model: 'mock-model' })
    const session = await loadSession(store, sessionId)

    expect(session.messages.some((m) => m.role === 'tool' && m.text?.includes('林晚的设定'))).toBe(true)
    expect(session.messages.at(-1)?.text).toBe('工作区里有 1 条便签。')
  })

  it('delete_note 被拒绝后保留便签、回收站为空并回注拒绝消息', async () => {
    const store = await createStore()
    const note = await saveNote(store, { title: '待删除便签', content: '保留内容' })
    const events: AgentEvent[] = []
    const service = makeService(store, [call('c1', 'delete_note', { noteId: note.id }), text('好的，已保留这条便签。')], events)

    const runPromise = service.run({ message: '删除这条便签', providerId, model: 'mock-model' })
    await vi.waitFor(() => expect(events.some((e) => e.type === 'pending-change')).toBe(true))
    const changeEvent = events.find((e) => e.type === 'pending-change')
    if (!changeEvent || changeEvent.type !== 'pending-change') throw new Error('未收到待确认变更事件')
    expect(changeEvent.change.title).toBe('删除便签：待删除便签')
    service.confirmChange(changeEvent.change.id, false)

    const { sessionId } = await runPromise
    expect((await listNotes(store)).some((item) => item.id === note.id)).toBe(true)
    expect(await listTrash(store)).toHaveLength(0)
    const session = await loadSession(store, sessionId)
    expect(session.messages.some((m) => m.role === 'tool' && m.text?.includes('拒绝'))).toBe(true)
  })

  it('delete_note 被批准后移入回收站并回注成功消息', async () => {
    const store = await createStore()
    const note = await saveNote(store, { title: '批准删除便签', content: '待移入回收站' })
    const events: AgentEvent[] = []
    const service = makeService(store, [call('c1', 'delete_note', { noteId: ` ${note.id} ` }), text('已完成。')], events)

    const runPromise = service.run({ message: '确认删除这条便签', providerId, model: 'mock-model' })
    await vi.waitFor(() => expect(events.some((e) => e.type === 'pending-change')).toBe(true))
    const changeEvent = events.find((e) => e.type === 'pending-change')
    if (!changeEvent || changeEvent.type !== 'pending-change') throw new Error('未收到待确认变更事件')
    service.confirmChange(changeEvent.change.id, true)

    const { sessionId } = await runPromise
    expect((await listNotes(store)).some((item) => item.id === note.id)).toBe(false)
    expect((await listTrash(store)).some((entry) => entry.id === note.id)).toBe(true)
    const session = await loadSession(store, sessionId)
    expect(session.messages.some((m) => m.role === 'tool' && m.text?.includes('已将便签「批准删除便签」移入回收站'))).toBe(true)
  })

  it.each([
    ['缺失', null],
    ['空字符串', ''],
    ['纯空白', '   ']
  ])('delete_note 对%s noteId 拒绝且不产生待确认变更', async (_label, noteId) => {
    const store = await createStore()
    const events: AgentEvent[] = []
    const service = makeService(store, [call('c1', 'delete_note', noteId === null ? {} : { noteId }), text('参数无效。')], events)

    const { sessionId } = await service.run({ message: '删除便签', providerId, model: 'mock-model' })

    expect(events.some((e) => e.type === 'pending-change')).toBe(false)
    const session = await loadSession(store, sessionId)
    expect(session.messages.some((m) => m.role === 'tool' && m.isError && m.text?.includes('noteId'))).toBe(true)
  })
})
```

- [x] **Step 2: 运行测试确认通过**

Run: `npm test -- --run src/core/agent/__tests__/agentLoop.test.ts`
Expected: PASS（6 个用例：1 读工具 + 2 删除路径 + 3 非法 noteId）。

- [x] **Step 3: 红绿验证（确认测试真的能捕获回归）**

临时把 `src/core/tools/registry.ts` 中 `delete_note` 的 `title` 改回 `移入回收站：${note.title}`：

Run: `npm test -- --run src/core/agent/__tests__/agentLoop.test.ts`
Expected: FAIL —— 断言 `'移入回收站：待删除便签'` 与 `'删除便签：待删除便签'` 不符。

随后**必须**把该行改回 `删除便签：${note.title}` 并重跑，确认 PASS。

- [x] **Step 4: 类型检查与提交**

Run: `npx tsc -b --pretty false`
Expected: exit 0。

```bash
git add src/core/agent/__tests__/agentLoop.test.ts
git commit -m "test(core): cover shared agent loop note deletion paths"
```

---

## Task 3: 失败结果 preview 对齐

**Files:**
- Modify: `src/main/tools/registry.ts:684`
- Modify: `src/main/tools/__tests__/registryParity.test.ts`

- [x] **Step 1: 写失败的 parity 测试**

在 `src/main/tools/__tests__/registryParity.test.ts` 中，把 import 段替换为：

```ts
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { MemoryFileStore } from '../../../core/storage/fileStore'
import { NodeFileStore } from '../../../core/storage/nodeFileStore'
import { initializeWorkspace } from '../../../core/workspace/workspaceService'
import { executeTool as executeCoreTool, TOOL_DEFS as CORE_TOOL_DEFS } from '../../../core/tools/registry'
import { executeTool as executeMainTool, TOOL_DEFS as MAIN_TOOL_DEFS } from '../registry'
```

并在 `describe` 内追加：

```ts
  it('reports the same failure text and preview for an unknown note', async () => {
    const memory = new MemoryFileStore()
    await initializeWorkspace(memory, '测试')
    const root = await mkdtemp(join(tmpdir(), 'sf-parity-'))
    try {
      await initializeWorkspace(new NodeFileStore(root), '测试')
      const args = JSON.stringify({ noteId: 'note_missing' })
      const core = await executeCoreTool(memory, 'delete_note', args)
      const main = await executeMainTool(root, 'delete_note', args)
      expect(main).toEqual(core)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
```

- [x] **Step 2: 运行测试确认失败**

Run: `npm test -- --run src/main/tools/__tests__/registryParity.test.ts`
Expected: FAIL —— `preview` 不一致：core 为 `工具执行失败：未找到便签：note_missing`，main 为 `未找到便签：note_missing`。

- [x] **Step 3: 对齐 main 的失败 preview**

修改 `src/main/tools/registry.ts` 的 `writeTool` 兜底分支（第 684 行）：

```ts
    return { kind: 'result', ok: false, text: `工具执行失败：${msg}`, preview: clip(`工具执行失败：${msg}`) }
```

- [x] **Step 4: 运行测试确认通过**

Run: `npm test -- --run src/main/tools/__tests__/registryParity.test.ts`
Expected: PASS（2 个用例）。

- [x] **Step 5: 全量验证与提交**

Run: `npm test -- --run`
Expected: 27 个测试文件全部通过（在现有 25 个基础上新增 `pendingChangeView.test.ts` 与 `agentLoop.test.ts`）。

Run: `npx tsc -b --pretty false`
Expected: exit 0。

```bash
git add src/main/tools/registry.ts src/main/tools/__tests__/registryParity.test.ts
git commit -m "fix(main): align failure preview with core registry"
```

---

## Task 4: 收尾验证

- [x] **Step 1: 全量测试与类型检查**

Run: `npm test -- --run`
Expected: 全部通过。

Run: `npx tsc -b --pretty false`
Expected: exit 0。

- [x] **Step 2: 构建与工作树检查**

Run: `npm run build`
Expected: exit 0。

Run: `git diff --check && git status --short`
Expected: `git diff --check` 无输出；`git status` 仅剩用户复现文件 `examples/minimal-workspace` 下两个未跟踪路径。

- [x] **Step 3: 更新计划与断点文档**

在 `docs/superpowers/plans/2026-09-09-pending-change-presentation.md` 勾选已完成步骤，并新建 `docs/superpowers/checkpoints/2026-09-09-pending-change-presentation.md` 记录结果（`docs/` 按 `.gitignore` 不入库，仅本地留档）。
