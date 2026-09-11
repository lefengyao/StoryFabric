---
status: completed
branch: main
timestamp: 2026-09-09T20:20:00+08:00
files_modified:
  - src/core/tools/registry.ts
  - src/main/tools/registry.ts
  - src/core/tools/__tests__/registryEntityId.test.ts
  - src/main/tools/__tests__/registryEntityId.test.ts
  - src/main/tools/__tests__/registryParity.test.ts
  - src/renderer/src/lib/pendingChangeView.ts
  - src/renderer/src/lib/__tests__/pendingChangeView.test.ts
  - src/core/agent/__tests__/agentLoop.test.ts
---

## Completed: 清单第 (5) 项（代码质量批次）

### Summary

清单「待排期」里的四个代码项全部完成，全部先写失败测试再修：

1. **幻影 `entityId`**：新建实体的待确认变更 id 与落盘 id 不一致。
   - 实测结果比 backlog 记录更精确：**core 全部 6 个创建分支都错**；main 的 `simulateCharacter/Event/Chapter/Outline` 早已用带 id 的 `effPatch`（正确），只有 `simulateSetting` / `simulateNote` 仍错。
   - 修法：保存时传 `{ ...patch, id: after.id }`，让落盘 id 与待确认变更一致（更新路径行为不变，因为此时 `patch.id === after.id`）。
2. **`save_relationship` 两端对齐**：title 统一为 `新增关系：甲 → 乙`（空 type 不再渲染 `【】`）；错误文案统一为主进程那侧更可执行的 `人物不存在：<id>。请先用 list_characters 获取有效 id。`
3. **死分支清理**：两端抽出 `kindOfTool(name)` 映射，取代 A1 后不可达的 `name === 'restore_from_trash' ? 'chapter'`。
4. **测试硬度**：`pendingChangeView` 测试改用「`toStrictEqual`（不含 outcome 键）+ `expect(view.outcome).toBeUndefined()`」，实现侧去掉显式 `outcome: undefined`，不再与键存在性耦合；core loop 请求快照由浅拷贝改为 `messages.map((m) => ({ ...m }))`。

### Verification Evidence

- 红相位：`registryEntityId.test.ts`（core）6/6 失败 → 修复后 6/6 通过；main 侧 2/6 失败（setting、note）→ 修复后 6/6 通过；关系 parity 断言 `expected '新增关系：甲 → 乙【朋友】' to be '新增关系：甲 → 乙'` → 修复后通过
- `npm test -- --run`：31 文件 / 127 用例通过
- `npx tsc -b --pretty false`：exit 0
- 提交：`12a7127`、`6f4a963`、`9738552`

### Notes and Risks

- 修复后 `change.entityId` 与落盘 id 一致，任何依赖它的 UI 跳转/高亮才可靠。
- `kindOfTool` 的最终兜底仍是 `'outline'`，与旧默认行为一致；`restore_from_trash` 恒走 `sim.entityKind`（回收站条目真实 kind）。
