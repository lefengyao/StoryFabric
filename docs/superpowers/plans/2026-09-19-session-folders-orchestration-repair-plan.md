# 会话文件夹与编排运行修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 将会话迁移到日期描述文件夹、支持会话级普通/编排切换，并修复编排工具、审批、版本校验和阶段停住问题，最后生成项目文档适配副本。

**Architecture:** 以共享的会话路径与迁移模块统一 Electron、HTTP 和 Android 存储行为；会话文件夹使用稳定 `session.json`，临时运行数据放在同一会话的 `tmp/`。编排运行继续使用现有七阶段调度器，但补上会话/运行范围的审批等待、统一 `writeRevision`、可恢复错误状态和普通模式分支验证。

**Tech Stack:** TypeScript、Electron IPC、HTTP RPC、Capacitor Android bridge、React/Zustand、Vitest、Vite。

---

## 执行约束

- 保留当前工作树中与本计划无关的修改；禁止 `git reset --hard`、`git checkout --` 和清理未跟踪文件。
- 每个行为变更先写一个能复现问题的失败测试，运行确认失败后再写最小实现。
- Electron 的 `SessionStore`、跨平台 `CoreSessionStore`、HTTP server 和 Android bridge 必须共享同一数据契约。
- 删除只接受会话 ID，不接受前端物理路径；任何路径由后端根据受控目录名生成。
- 在最终验证前不要修改指定小说项目的原始 `docs/修仙体系设计.md`。

## 文件变更总览

| 单元 | 主要文件 |
|---|---|
| 会话路径与迁移 | `src/shared/sessionPaths.ts`、`src/shared/types.ts`、`src/core/workspace/sessionStore.ts`、`src/main/services/sessionStore.ts` |
| API 与删除/归档 | `src/shared/api.ts`、`src/main/ipc.ts`、`src/server/server.ts`、`src/renderer/src/platform/httpApi.ts`、`src/renderer/src/platform/androidApi.ts` |
| 模式切换 UI | `src/renderer/src/stores/chatStore.ts`、`src/renderer/src/stores/chatScope.ts`、`src/renderer/src/pages/chat/ChatPage.tsx`、`src/renderer/src/components/chat/ChatSidebar.tsx` |
| 写入版本 | `src/core/workspace/resourceRevision.ts`、`src/core/retrieval/projectCorpus.ts`、`src/core/retrieval/documentReader.ts`、`src/core/tools/registry.ts`、`src/core/tools/projectDocTools.ts` |
| 审批/恢复 | `src/shared/types.ts`、`src/core/agent/agentLoop.ts`、`src/main/agent/agentLoop.ts`、`src/main/ipc.ts`、`src/server/server.ts`、`src/renderer/src/stores/chatStore.ts` |
| 编排失败可视化 | `src/core/agent/toolLoop.ts`、`src/core/orchestration/scheduler.ts`、`src/core/orchestration/stageRunner.ts`、`src/renderer/src/components/chat/RunTimeline.tsx`、`src/renderer/src/components/chat/AgentActivity.tsx` |

---

### Task 1: 建立故障回归测试基线

**Files:**
- Create: `src/core/agent/__tests__/sessionModeRegression.test.ts`
- Create: `src/core/workspace/__tests__/sessionFolderRegression.test.ts`
- Modify: `src/core/agent/__tests__/approvalIntegration.test.ts`
- Modify: `src/core/tools/__tests__/mutationConflict.test.ts`

- [ ] **Step 1: 写普通模式回归测试**

测试使用真实 `CoreAgentService`、`MemoryFileStore` 和 mock adapter，创建带有 `creativePreferences.orchestrationEnabled=true` 的会话，然后发送 `mode: 'normal'`；断言只发生普通模型调用、没有 `stage-start` 事件。

```ts
it('normal mode overrides a persisted orchestration snapshot for this run', async () => {
  const session = await sessions.create()
  session.creativePreferences = orchestrationPreferences
  await sessions.save(session)
  const events: AgentEvent[] = []
  await service.run({ sessionId: session.id, mode: 'normal', providerId: 'mock', model: 'mock', message: '一句简单修改' })
  expect(events.some((event) => event.type === 'stage-start')).toBe(false)
})
```

- [ ] **Step 2: 写文件夹、归档和目录删除失败测试**

断言新保存路径包含 `sessions/<date-slug-id>/session.json`，归档只改变 `archived`，删除后 `session.json` 和 `tmp/` 都不存在，另一个会话目录仍存在。

- [ ] **Step 3: 写版本统一回归测试**

先通过 `search_project` 获取章节命中，再把命中的 `writeRevision` 传给 `save_chapter`；断言保存成功。再修改章节后使用旧 revision，断言返回结构化冲突而不是普通字符串错误。

- [ ] **Step 4: 运行红灯测试**

Run: `npm test -- src/core/agent/__tests__/sessionModeRegression.test.ts src/core/workspace/__tests__/sessionFolderRegression.test.ts src/core/tools/__tests__/mutationConflict.test.ts src/core/agent/__tests__/approvalIntegration.test.ts`

Expected: FAIL，原因应分别是普通模式仍进入编排、旧文件存储没有目录、`writeRevision` 不存在或版本口径不一致；若测试因类型错误失败，先修正测试本身后重新运行，不能把类型错误当成红灯证据。

---

### Task 2: 实现会话文件夹、首次命名和旧会话迁移

**Files:**
- Create: `src/shared/sessionPaths.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/core/workspace/sessionStore.ts`
- Modify: `src/main/services/sessionStore.ts`
- Modify: `src/core/workspace/__tests__/sessionStore.test.ts`
- Modify: `src/main/services/__tests__/sessionStore.test.ts`

- [ ] **Step 1: 定义受控路径函数和会话字段**

在 `sessionPaths.ts` 中实现 `safeSessionSlug(title)`, `sessionDirName(createdAt, title, id)`, `sessionJsonPath(dirName)` 和 `legacySessionJsonPath(id)`。slug 只保留中文、字母、数字、短横线和下划线，连续分隔符折叠，空结果使用 `session`。

```ts
export function sessionDirName(createdAt: number, title: string, id: string): string {
  const date = new Date(createdAt).toISOString().slice(0, 10)
  return `${date}-${safeSessionSlug(title)}-${safeId(id)}`
}
```

在 `ChatSession` 增加可选 `storageDir?: string`；旧会话没有该字段时只能根据 ID 查找旧文件，不能接受外部路径。

- [ ] **Step 2: 让两个 SessionStore 以目录为主、旧文件为回退**

`CoreSessionStore` 使用 `FileStore.listDirs` 查找会话目录；`SessionStore` 使用 Node `fs.readdir` 查找目录。两者都按以下优先级加载：新目录的 `session.json` → 旧 `<id>.json` → 不存在。

保存时先写 `<sessions>/<dir>.tmp/session.json.tmp`，验证 JSON 可读后移动到最终目录；新格式保存不得写回根目录旧 JSON。

- [ ] **Step 3: 添加懒迁移和 legacy 备份**

迁移函数读取旧 JSON、验证会话结构、生成目录并写入 `session.json`，成功后把旧 JSON 移动到 `.storyfabric/sessions/legacy/<id>.json`。迁移失败保留旧文件并返回诊断，不中断其他会话。

- [ ] **Step 4: 实现首次命名回退链路**

在 `CoreAgentService.run` 首次发送前调用一个无工具、短输出的 `session-title` 模型请求；输出不符合短标题规则时调用 `titleFromMessage`。命名失败不能阻断主运行。首次主运行保存前写入 `storageDir`，后续重命名只改 JSON 内容。

- [ ] **Step 5: 运行会话存储测试**

Run: `npm test -- src/core/workspace/__tests__/sessionStore.test.ts src/main/services/__tests__/sessionStore.test.ts src/core/workspace/__tests__/sessionFolderRegression.test.ts`

Expected: PASS；验证新目录、旧文件迁移、迁移失败保留原文件、重复列出不会产生重复会话、归档只修改 JSON。

---

### Task 3: 接通会话 API、归档和文件夹删除

**Files:**
- Modify: `src/shared/api.ts`
- Modify: `src/main/ipc.ts`
- Modify: `src/server/server.ts`
- Modify: `src/renderer/src/platform/httpApi.ts`
- Modify: `src/renderer/src/platform/androidApi.ts`
- Modify: `src/renderer/src/stores/chatStore.ts`
- Modify: `src/renderer/src/pages/chat/ChatPage.tsx`
- Modify: `src/renderer/src/components/chat/ChatSidebar.tsx`
- Create or modify: `src/main/__tests__/sessionFolderIpc.test.ts`

- [ ] **Step 1: 先扩展 API 类型**

保持 `deleteSession(id: string)` 的调用形状不变，让后端负责解析目录；`updateSession` 增加会话创作模式已经由现有 `creativePreferences` 覆盖，不新增第二套模式字段。为需要显示路径的诊断增加只读 `storageDir?: string`，不把物理绝对路径暴露给 renderer。

- [ ] **Step 2: 让三种平台删除整个目录**

Electron、HTTP 和 Android 都调用同一个会话存储实现。删除前检查运行状态；运行中返回明确错误。删除操作只接受 `id`，使用 `sessionDirName`/已保存 `storageDir` 计算目标，禁止前端传入路径。

- [ ] **Step 3: 保持归档行为不变但适配目录**

`setArchived` 只调用 `updateMeta({ archived })`，列表通过 `session.json` 元数据刷新。活动会话归档后创建普通新会话；取消归档后可以从归档列表恢复并打开。

- [ ] **Step 4: 写 API 和 UI 回归测试**

覆盖：删除活动会话后创建新普通会话、删除非活动会话不影响当前会话、归档不删除临时目录、错误目录 ID 不会越界。

Run: `npm test -- src/main/__tests__/sessionFolderIpc.test.ts src/renderer/src/stores/__tests__/chatScope.test.ts src/core/workspace/__tests__/archive.test.ts`

Expected: PASS。

---

### Task 4: 增加会话级普通/编排切换

**Files:**
- Modify: `src/shared/creative.ts`
- Modify: `src/renderer/src/lib/creativePreferences.ts`
- Modify: `src/renderer/src/stores/chatScope.ts`
- Modify: `src/renderer/src/stores/chatStore.ts`
- Modify: `src/renderer/src/pages/chat/ChatPage.tsx`
- Modify: `src/renderer/src/components/chat/ChatSidebar.tsx`
- Create: `src/renderer/src/components/chat/SessionModePicker.tsx`
- Modify: `src/core/agent/__tests__/sessionModeRegression.test.ts`
- Create: `src/renderer/src/components/chat/__tests__/sessionModePicker.test.tsx`

- [ ] **Step 1: 定义会话模式转换函数**

在 `creativePreferences.ts` 增加纯函数：

```ts
export function withOrchestrationEnabled(value: CreativePreferences, enabled: boolean): CreativePreferences {
  if (!enabled) return { ...value, mode: 'basic', orchestrationEnabled: false, subagentsEnabled: false }
  const orchestration = value.orchestration ?? normalizeOrchestrationPreferences(undefined)
  return { ...value, mode: 'orchestration', orchestrationEnabled: true, subagentsEnabled: orchestration.subagentsEnabled, orchestration: { ...orchestration, enabled: true } }
}
```

- [ ] **Step 2: 写 UI 失败测试并确认红灯**

测试在会话快照为编排时点击“普通模式”，断言调用 `updateSession` 的 patch 将 `orchestrationEnabled` 设为 false；切换回编排时恢复原 stages、budget 和 subagent 配置。

Run: `npm test -- src/renderer/src/components/chat/__tests__/sessionModePicker.test.tsx`

Expected: FAIL，直到 picker 和 store wiring 完成。

- [ ] **Step 3: 接入全尺寸和独立会话窗口**

把 picker 放在审批控件附近，但与 `AgentMode normal/goal` 分开标识；发送请求继续传 `mode`，同时读取当前会话 `creativePreferences`。运行期间禁用切换，保存后立即更新当前 store。

- [ ] **Step 4: 修正核心分支并运行绿色测试**

`CoreAgentService.run` 接收并验证本次 `creative` 快照，确保普通模式不会因历史会话快照进入 `runOrchestration`。运行 Task 1 的核心回归测试和 picker 测试。

Expected: PASS，普通简单需求没有 `stage-start`，编排模式仍按配置启动。

---

### Task 5: 统一读取/写入版本号并修复保存失败

**Files:**
- Modify: `src/core/retrieval/projectCorpus.ts`
- Modify: `src/core/retrieval/documentReader.ts`
- Modify: `src/core/retrieval/contextBuilder.ts`
- Modify: `src/core/tools/registry.ts`
- Modify: `src/core/tools/projectDocTools.ts`
- Modify: `src/core/agent/prompts.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/core/tools/__tests__/mutationConflict.test.ts`
- Create: `src/core/tools/__tests__/writeRevisionConsistency.test.ts`

- [ ] **Step 1: 定义 `writeRevision` 的唯一计算入口**

为每类实体提供与 `save_*` 相同的规范化序列化函数；`writeRevision` 始终对该序列化结果调用 `contentRevision`。保留 `sourceRevision` 作为源文件文本回执，不再把它传入 `baseRevision`。

- [ ] **Step 2: 修改读取回执和搜索命中**

完整实体读取返回 `writeRevision`；搜索命中可加载实体时返回同样的 `writeRevision`，片段命中返回 `writable:false`。更新工具 schema、系统提示词和阶段角色提示，明确 `baseRevision` 必须取 `writeRevision`。

- [ ] **Step 3: 写失败测试并运行红灯**

用指定项目中章节的“搜索 → 读取 → save_chapter”路径构造测试；先传 `sourceRevision` 应被明确拒绝并给出“需要 writeRevision”的结构化错误，再传 `writeRevision` 成功；旧版本返回 `CONFLICT`/`SOURCE_CHANGED`。

Run: `npm test -- src/core/tools/__tests__/writeRevisionConsistency.test.ts src/core/tools/__tests__/mutationConflict.test.ts`

Expected: 新测试在实现前失败。

- [ ] **Step 4: 实现统一版本并通过测试**

将保存、移动、删除、恢复和项目文档写入都改为同一基线字段；应用前继续重新读取并比较，冲突只返回可重试结构化错误，不静默覆盖。

Run: `npm test -- src/core/tools/__tests__/writeRevisionConsistency.test.ts src/core/tools/__tests__/mutationConflict.test.ts src/main/tools/__tests__/registryParity.test.ts`

Expected: PASS。

---

### Task 6: 修复审批确认链路和待确认状态持久化

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/shared/api.ts`
- Modify: `src/core/agent/agentLoop.ts`
- Modify: `src/main/agent/agentLoop.ts`
- Modify: `src/main/ipc.ts`
- Modify: `src/server/server.ts`
- Modify: `src/renderer/src/stores/chatStore.ts`
- Modify: `src/renderer/src/components/chat/AgentActivity.tsx`
- Modify: `src/core/agent/__tests__/approvalIntegration.test.ts`
- Modify: `src/main/agent/__tests__/agentLoop.test.ts`

- [ ] **Step 1: 扩展待确认变更上下文**

给 `PendingChange` 增加可选 `sessionId`、`runId`、`stageId`；给 `ChatSession` 增加受控的 `waitingApproval` 字段。保存等待状态前写入会话和对应 `OrchestrationRunRecord`。

- [ ] **Step 2: 使确认按会话和变更 ID 定位**

将 `agentConfirm(changeId, approved)` 扩展为 `agentConfirm(sessionId, changeId, approved)`，Electron/HTTP/Android 统一传递。`waitConfirm` 校验 session/run；确认、拒绝、取消都清除持久等待状态并发送 `change-result`。

- [ ] **Step 3: 写审批红灯测试**

覆盖三种策略：strict 必须产生 pending 并在确认后写入；delete-confirm 的 `save_chapter` 不等待而 `delete_entity` 等待；auto 不产生 pending。增加“错误 session 不能确认另一个会话变更”和“进程刷新后发现持久 waitingApproval 时提示重新启动/恢复”的测试。

Run: `npm test -- src/core/agent/__tests__/approvalIntegration.test.ts src/main/agent/__tests__/agentLoop.test.ts`

Expected: 新增上下文和策略行为测试先失败。

- [ ] **Step 4: 通过工具回执显示实际失败原因**

`outcome.apply()` 返回 `ok:false` 时必须把文本、结构化错误码、阶段和工具名写入 `tool-receipt` 与 `change-result`；前端不能只显示“工具调用失败”。

Run: `npm test -- src/core/agent/__tests__/approvalIntegration.test.ts src/core/agent/__tests__/toolRecovery.test.ts src/main/agent/__tests__/agentLoop.test.ts`

Expected: PASS。

---

### Task 7: 编排阶段失败恢复与运行状态显示

**Files:**
- Modify: `src/core/agent/toolLoop.ts`
- Modify: `src/core/orchestration/scheduler.ts`
- Modify: `src/core/orchestration/stageRunner.ts`
- Modify: `src/core/agent/agentLoop.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/renderer/src/components/chat/RunTimeline.tsx`
- Modify: `src/renderer/src/components/chat/AgentActivity.tsx`
- Modify: `src/renderer/src/components/chat/OrchestrationPanel.tsx`
- Modify: `src/core/orchestration/__tests__/scheduler.test.ts`
- Modify: `src/core/agent/__tests__/toolRecovery.test.ts`

- [ ] **Step 1: 区分失败、等待和取消**

阶段状态至少区分 `failed`、`waiting_user`、`paused_budget` 和 `cancelled`；必要阶段失败时保留当前阶段、最后工具回执和恢复提示，不把它渲染成普通完成。

- [ ] **Step 2: 对可重试读取和版本冲突提供恢复信息**

工具循环对 `NOT_FOUND`、`INVALID_ARGUMENT`、`SOURCE_CHANGED`、`CONFLICT` 返回结构化工具结果；模型可先重新读取再提交。连续三次同一工具/参数仍停止，并记录停止原因。

- [ ] **Step 3: 写失败恢复测试并运行红灯**

测试一个阶段第一次读取失败、第二次读取成功后应继续；测试必要阶段失败时后续阶段为 stale 且 UI 记录当前阶段和错误；测试审批等待不被调度器误判为 failed。

Run: `npm test -- src/core/orchestration/__tests__/scheduler.test.ts src/core/agent/__tests__/toolRecovery.test.ts`

Expected: 新增恢复断言在实现前失败。

- [ ] **Step 4: 接入时间线显示**

在时间线中显示“阶段/工具/错误码/是否可重试/等待用户确认”，并让会话刷新后从 `session.json.orchestrationRuns` 恢复最近状态。

Run: `npm test -- src/core/orchestration/__tests__/scheduler.test.ts src/renderer/src/stores/__tests__/runStore.test.ts src/renderer/src/components/chat/__tests__/orchestrationPanel.test.ts`

Expected: PASS。

---

### Task 8: 文档副本更新与端到端项目验证

**Files:**
- Read: `E:/New项目/Novel/开局被抢课逼疯，我带全地府修仙/docs/修仙体系设计.md`
- Create: `E:/New项目/Novel/开局被抢课逼疯，我带全地府修仙/docs/2026-09-19-修仙体系设计-编排适配副本.md`
- Verify: `E:/New项目/Novel/开局被抢课逼疯，我带全地府修仙/docs/修仙体系设计.md`
- Verify: `src/core/tools/__tests__/projectDocTools.test.ts`

- [ ] **Step 1: 读取源文档并记录 revision**

通过项目文档读取工具或等价的只读读取取得全文和 revision，确认源文件没有在处理中变化。

- [ ] **Step 2: 创建副本而不覆盖源文档**

复制原文全部内容，在副本末尾增加“StoryFabric 现行协作规范”，明确：普通模式适合简单需求；单智能体编排按阶段执行；多智能体子智能体只读核对；资料先读、计划/设定/brief 完成后才能写正文；写入遵循会话审批策略；临时文件在会话目录 `tmp/`，长期设定留在 `docs/`。

- [ ] **Step 3: 用当前工具链保存副本**

副本使用 `save_project_doc` 的 `baseRevision`/创建路径，严格审批模式下先确认待变更；回读副本并断言源文档 revision 与内容不变。

- [ ] **Step 4: 运行完整验证和构建**

Run: `npm test`

Expected: 全部测试通过，无失败测试。

Run: `npm run build`

Expected: Electron/Vite 构建退出码为 0。

Run: `npm run web:build`

Expected: Web 构建退出码为 0。

Run: `npm run server:build`

Expected: Server 构建退出码为 0。

---

## 计划自检

- 规格中的四个目标单元分别由 Task 2、Task 4、Task 5–7、Task 8 覆盖。
- 归档、删除、旧格式迁移和临时文件隔离均有实现任务与测试任务。
- 普通模式和目标模式仍是两个独立字段，避免再次混淆。
- `sourceRevision` 与 `writeRevision` 的职责已经分离，所有写入入口都有统一测试任务。
- 未使用 TBD、TODO、占位任务或“稍后补充”步骤。
- 不包含原始项目文档覆盖操作；最终副本写入前后都要求回读验证。

## 执行顺序

按 Task 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 执行。每个任务完成后运行该任务的验证命令并检查 `git diff`，再进入下一任务；如果测试失败，回到对应任务，不叠加未经验证的修复。
