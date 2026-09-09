# 待确认变更展示与智能体后续项设计

**日期：** 2026-09-09
**状态：** 已确认，待实现

## 背景

`2026-09-08-note-completion-delete` 计划闭环后遗留三项 follow-up，本设计一并处理：

1. `PendingChangeDialog` 无条件把 `beforeText`/`afterText` 当行级 diff 渲染。`delete_note` 的 `afterText` 是结果描述句「移入回收站」，用户会看到整篇便签被标为删除行、外加一行「+ 移入回收站」；副标题又用 `beforeText ? '更新' : '新建'` 把删除说成「更新」，且 `ENTITY_KIND_LABEL` 缺 `note`/`setting`，标签退化为「实体」。
2. `src/core/agent/agentLoop.ts`（web / server / Android 共享运行时）没有测试文件，`delete_note` 的拒绝与批准路径只有 Electron 桌面端有覆盖。
3. 抛错路径的 `preview` 两端不一致：core 含「工具执行失败：」前缀，main 不含，影响所有工具在界面上的失败提示。

## 目标

- 删除/恢复类待确认变更不再以行级 diff 呈现，改为「只读上下文 + 单行结果说明」，副标题准确描述操作。
- 补齐 `note`/`setting` 实体标签。
- core agent loop 的读写工具路径有与桌面端对称的测试覆盖。
- 两端失败 `preview` 逐字一致。

## 非目标

- 不改变 `PendingChange` 的共享类型（不新增 `operation` 字段）。
- 不改变 `diffLines` 对新建/更新变更的展示。
- 不改变便签 Markdown 格式、回收站结构或任何落盘行为。
- 不重构与本设计无关的渲染或注册表代码。

## 设计

### 1. 待确认变更展示（renderer）

新增纯函数模块 `src/renderer/src/lib/pendingChangeView.ts`：

```ts
export type PendingChangeVariant = 'create' | 'update' | 'remove' | 'restore'

export interface PendingChangeView {
  variant: PendingChangeVariant
  label: string
  caption: string
  outcome?: string
}

export function pendingChangeView(change: PendingChange): PendingChangeView
```

判定规则：

| 条件 | variant | caption | outcome |
| --- | --- | --- | --- |
| `toolName === 'delete_note'` | `remove` | 智能体请求删除<标签> —— 确认后才会移入回收站 | 将移入回收站，可从回收站恢复 |
| `toolName === 'restore_from_trash'` | `restore` | 智能体请求恢复<标签> —— 确认后才会恢复到原位置 | `change.afterText` |
| 其他且 `beforeText` 非空 | `update` | 智能体请求更新<标签> —— 确认后才会写入工作区 | 无 |
| 其他且 `beforeText` 为空 | `create` | 智能体请求新建<标签> —— 确认后才会写入工作区 | 无 |

标签为 `ENTITY_KIND_LABEL[change.entityKind] ?? '实体'`，上表中所有 `<标签>` 均使用该值。

修改 `src/renderer/src/lib/utils.ts`：`ENTITY_KIND_LABEL` 增加 `note: '便签'`、`setting: '设定'`。

修改 `src/renderer/src/components/chat/PendingChangeDialog.tsx`：

- 通过 `pendingChangeView(change)` 取得 `variant`/`caption`/`outcome`，副标题改用 `caption`。
- `remove` 与 `restore` 分支不调用 `diffLines`：以等宽只读块展示 `beforeText`（上下文），下方以高亮单行展示 `outcome`。
- `create` 与 `update` 分支保持现有行级 diff 渲染。

### 2. core agent loop 测试

新增 `src/core/agent/__tests__/agentLoop.test.ts`，使用 `MemoryFileStore`、`initializeWorkspace`、`saveNote`、`listNotes`、`listTrash` 与 `CoreSessionStore`，并注入假 `LlmAdapterFactory`：适配器按脚本依次返回预置 `StreamResult`（文本或 `toolCalls`），不使用网络或 `fetch` 打桩。

覆盖用例：

1. 读工具自动执行，结果回注后生成最终回答。
2. `delete_note` 被拒绝：便签仍在、回收站为空、会话中工具消息包含拒绝说明。
3. `delete_note` 被批准：便签移入回收站、会话中工具消息包含「移入回收站」。
4. 非法 `noteId`（缺失/空串/纯空白）：不产生 `pending-change` 事件，结果为 `ok: false`。

### 3. 失败 preview 对齐

修改 `src/main/tools/registry.ts` 的 `writeTool` 兜底分支：

```ts
return { kind: 'result', ok: false, text: `工具执行失败：${msg}`, preview: clip(`工具执行失败：${msg}`) }
```

扩展 `src/main/tools/__tests__/registryParity.test.ts`：core 侧用 `MemoryFileStore`，main 侧用临时目录（`NodeFileStore` + `initializeWorkspace`）初始化工作区，对 `delete_note` 传未知 `noteId` 各执行一次，断言两次结果的 `text` 与 `preview` 逐字相等。

## 测试与验证

- 新增 `src/renderer/src/lib/__tests__/pendingChangeView.test.ts`：四种 variant、标签回退、caption 与 outcome 逐字断言。
- 新增 `src/core/agent/__tests__/agentLoop.test.ts`：上述 4 个用例。
- 扩展 `src/main/tools/__tests__/registryParity.test.ts`：失败结果 parity。
- 全量验证：`npm test -- --run`、`npx tsc -b --pretty false`、`npm run build`、`git diff --check`。

## 风险

- 渲染分支改动只影响弹窗展示，不影响确认/拒绝的数据流；`create`/`update` 路径保持原样以限制回归面。
- `restore_from_trash` 的 `afterText` 形如「恢复到 <原路径>」，作为单行说明展示；若后续需要更丰富的恢复预览，另开计划。
- core agent loop 测试通过注入假适配器覆盖循环逻辑，不验证各 LLM 协议适配器的解析细节（已由 `src/main/llm/__tests__/adapters.test.ts` 覆盖）。
