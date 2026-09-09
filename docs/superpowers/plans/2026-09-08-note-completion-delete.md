# Note Completion Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the agent ask about deleting a clearly completed note task and, only after explicit user consent plus the existing UI confirmation, move that note to the recycle bin.

**Architecture:** Keep completion detection conversational and explicit in the shared system prompt. Add a narrowly scoped `delete_note` write tool in both core and Electron registries; it creates a pending note deletion and delegates storage to the existing `deleteNote` recycle-bin path. Keep prompt text, tool descriptions, and runtime behavior aligned through focused tests without adding background polling or automatic deletion.

**Tech Stack:** TypeScript, Vitest, Node `FileStore`, Electron IPC/service adapters, Markdown note storage, existing `PendingChange` workflow.

---

## File map

- Modify `src/core/agent/workspacePolicy.ts`: add the explicit note-completion question and consent rule.
- Modify `src/core/agent/__tests__/prompts.test.ts`: assert the shared prompt contains the note rule.
- Modify `src/core/tools/registry.ts`: expose and execute `delete_note` for the shared runtime.
- Modify `src/core/tools/__tests__/registryPlacement.test.ts`: verify missing/unknown note ids, pending deletion, rejection, and confirmed recycle-bin movement.
- Modify `src/main/tools/registry.ts`: expose and execute the Electron desktop `delete_note` path using the main-process service adapter.
- Modify `src/main/agent/__tests__/agentLoop.test.ts`: verify a delete tool call creates a pending change and the user can reject it without deleting the note.
- Modify `src/shared/types.ts` only if a new shared type is required; no new type is expected because `PendingChange.entityKind` already supports `note`.

## Task 1: Write failing behavior tests

### Step 1: Add core registry tests before implementation

In `src/core/tools/__tests__/registryPlacement.test.ts`, add these cases using `MemoryFileStore`, `initializeWorkspace`, `saveNote`, `listNotes`, `listTrash`, and `executeTool`:

```ts
it('rejects deletion without a note id and for an unknown note', async () => {
  const store = new MemoryFileStore()
  await initializeWorkspace(store, '测试')

  const missing = await executeTool(store, 'delete_note', '{}')
  expect(missing.kind).toBe('result')
  expect(missing.ok).toBe(false)
  expect(missing.text).toContain('noteId')

  const unknown = await executeTool(store, 'delete_note', JSON.stringify({ noteId: 'note_missing' }))
  expect(unknown.kind).toBe('result')
  expect(unknown.ok).toBe(false)
  expect(unknown.text).toContain('未找到便签')
})

it('moves a completed note to the recycle bin only after the pending change is applied', async () => {
  const store = new MemoryFileStore()
  await initializeWorkspace(store, '测试')
  const note = await saveNote(store, { title: '已完成任务', content: '整理第一章' })

  const pending = await executeTool(store, 'delete_note', JSON.stringify({ noteId: note.id }))
  expect(pending.kind).toBe('pending')
  expect((await listNotes(store)).map((item) => item.id)).toContain(note.id)

  if (pending.kind === 'pending') {
    expect(pending.change.entityKind).toBe('note')
    expect(pending.change.title).toContain('删除便签')
    await pending.apply()
  }

  expect((await listNotes(store)).map((item) => item.id)).not.toContain(note.id)
  expect((await listTrash(store)).map((item) => item.id)).toContain(note.id)
})
```

### Step 2: Add the desktop rejection test before implementation

In `src/main/agent/__tests__/agentLoop.test.ts`, add a test following the existing pending-change tests. Create a note in the temporary workspace, queue an OpenAI-compatible tool call for `delete_note`, wait for `pending-change`, reject it with `agent.confirmChange(id, false)`, then assert the note Markdown file still exists. The queued tool call must be:

```ts
{ name: 'delete_note', arguments: JSON.stringify({ noteId }) }
```

The test must also assert the persisted session contains a tool message mentioning rejection.

### Step 3: Extend the prompt contract test

In `src/core/agent/__tests__/prompts.test.ts`, assert `CORE_PROMPT` contains all of these phrases or their exact semantic equivalents:

```ts
expect(CORE_PROMPT).toContain('便签')
expect(CORE_PROMPT).toContain('明确表示任务已完成')
expect(CORE_PROMPT).toContain('是否删除')
expect(CORE_PROMPT).toContain('只有用户明确同意后才调用 delete_note')
```

Run the focused tests:

```powershell
npm test -- --run src/core/tools/__tests__/registryPlacement.test.ts src/core/agent/__tests__/prompts.test.ts src/main/agent/__tests__/agentLoop.test.ts
```

Expected result: the new registry and agent tests fail because `delete_note` is currently unknown and the prompt lacks the new rule; existing tests continue to pass.

## Task 2: Implement the safe delete tool

### Step 1: Add the tool definitions

In both `src/core/tools/registry.ts` and `src/main/tools/registry.ts`:

- Add `delete_note` to `TOOL_DEFS` with description: `只有用户明确同意删除已完成便签后才能调用；将便签移入回收站，需要用户确认。`.
- Define `noteId` as a required string parameter.
- Add `delete_note` to `WRITE_TOOLS`.

### Step 2: Implement the core pending change

In `src/core/tools/registry.ts`:

- Import `deleteNote` and `serializeNote` from `../workspace/entityStore`.
- Add a `delete_note` branch in `writeTool` before the generic relationship fallback.
- Reject an empty `noteId` with `delete_note 必须提供 noteId`.
- Load the note with `getNote`; reject a missing note with `未找到便签：<id>`.
- Build a `Simulated` object with `entityId` equal to the note id, `beforeText` from `serializeNote(note)`, `afterText` equal to `移入回收站`, and title `删除便签：<title>`.
- Commit with `deleteNote(store, noteId)` and return `已将便签「<title>」移入回收站`.
- Include `delete_note` in the pending change’s `entityKind === 'note'` mapping.

### Step 3: Implement the desktop pending change

In `src/main/tools/registry.ts`:

- Import `deleteNote` from the main entity-store adapter; use `JSON.stringify(note, null, 2)` for the preview so the adapter does not need a desktop-only serializer export.
- Add a focused `simulateDeleteNote(root, noteId)` helper beside `simulateNote` with the same validation, preview, title, and commit behavior as the core branch.
- Add a `delete_note` case in `executeTool` that validates `noteId` and calls the helper.
- Include `delete_note` in the desktop `WRITE_TOOLS` set and map it to `entityKind: 'note'`.

### Step 4: Add the shared prompt rule

In `src/core/agent/workspacePolicy.ts`, add this explicit policy block:

```text
【便签完成后的处理】
- 便签只是任务记录，不代表任务已经完成。只有当前对话明确对应某条便签，并且用户明确表示该任务已完成时，才询问“是否删除这条便签？”。
- 询问不等于删除。用户没有明确同意、表示暂不删除或拒绝时，保持便签不变，不调用 delete_note。
- 只有用户明确同意后才能调用 delete_note，并传入已经用 list_notes 或 get_note 核实过的 noteId；工具返回 pending 仍需等待用户在界面确认。
- 删除成功只能说“已移入回收站”，不能说“永久删除”。
```

## Task 3: Verify and clean up

- [x] Run the focused tests and confirm all new cases pass.
- [x] Run `npm test` and confirm the complete suite passes.（25 个文件 / 89 个用例通过）
- [x] Run `npx tsc --noEmit` and confirm there are no type errors.（注意：根 `tsconfig.json` 是 solution-style，`npx tsc --noEmit` 只检查 0 个文件、属于假通过；实际执行 `npx tsc -b --pretty false`，exit 0）
- [x] Run `npm run build` and confirm the Electron bundles build successfully.
- [x] Run `npm run dist:win` and confirm both Windows targets are generated.（NSIS 安装包 + portable 包）
- [x] Start `release/win-unpacked/StoryFabric.exe` for eight seconds with `Start-Process -WindowStyle Hidden`; confirm it stays alive, then stop only that process.（存活 8 秒、3 个子进程，停止后无残留）
- [x] Run `npm audit --registry=https://registry.npmjs.org --audit-level=moderate` and confirm zero vulnerabilities.（先发现 `sharp <0.35.4` 的 libheif high 漏洞，升级到 0.35.4 后为 0 vulnerabilities）
- [x] Run `git diff --check` and `git status --short`; do not stage or remove the user-owned reproduction files in `examples/minimal-workspace`.
- [x] Update the session log with test, build, smoke-test, and audit results.

## Commit sequence

1. `test: cover completed note deletion workflow`
2. `feat: ask before deleting completed notes`
3. `test: verify completed note cleanup end to end` (only if the desktop regression test is isolated as a separate change)

## Verification results (2026-09-09)

验证阶段发现并修复了两处计划未覆盖的缺陷：

1. **core 与 main 的待确认变更标题不一致**（`core/tools/registry.ts` 为 `移入回收站：<title>`，`main/tools/registry.ts` 为 `删除便签：<title>`）。按本计划 `:112`/`:121` 与仓库既有 `<动作>：<标题>` 约定，修正的是 core；并新增 `src/main/tools/__tests__/registryParity.test.ts` 与两端 title 断言作为回归保护。
2. **`tsc` 检查从未真正执行过**：已提交的 `src/core/tools/__tests__/registryPlacement.test.ts` 未收窄 `ToolOutcome` 联合类型，`src/core/agent/__tests__/prompts.test.ts` 反向 import `src/main/agent/prompts.ts` 触发 TS6307（web 项目不含 `src/main/agent/**`）。前者加 `expectResult` 收窄守卫，后者把跨端提示词一致性断言移到主进程测试。

同时补齐了提示词缺失规则、统一了两端 `delete_note` 工具定义、把 `sharp` 升级到 0.35.4（清除 libheif high 漏洞）。

质量审查（两轮，只读代理）：第二轮 **PASS**，需求 1–6 全部满足。

Follow-up（不阻塞本计划）：`PendingChangeDialog` 把 `afterText` 当行级 diff 渲染；`src/core/agent/agentLoop.ts` 无测试文件；失败结果 `preview` 前缀两端不一致；`ENTITY_KIND_LABEL` 缺 `note`/`setting`。
