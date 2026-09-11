---
status: in-progress
branch: main
timestamp: 2026-09-09T20:35:00+08:00
files_modified:
  - src/core/llm/types.ts
  - src/core/llm/openaiCompatible.ts
  - src/core/llm/anthropic.ts
  - src/core/llm/gemini.ts
  - src/core/llm/__tests__/adapters.test.ts
  - src/main/agent/agentLoop.ts
  - src/main/ipc.ts
  - src/renderer/src/lib/pendingCommit.ts
  - src/renderer/src/pages/settings/SettingsPage.tsx
---

## Working on: 清单第 (4) 项 Token 消耗监测（阶段 1–2 完成）

### Summary

为 Token 消耗监测打通底层：合并重复的适配器、在 core 适配层解析并归一三家协议的 usage。持久化、IPC/SSE 透传、左侧栏用量页尚未开始。

### Completed

1. **修复复检发现的新 bug**：`SettingsPage` 的两个取色器共用一个防抖定时器，先改浅色再在 400ms 内改深色会取消浅色落盘。抽出 `createKeyedDebounce`（按 key 独立计时，3 个用例覆盖），提交 `69bd89e`。
2. **合并重复适配器**：`src/main/llm/*` 是 `src/core/llm/*` 的副本（仅差一个尾行与两个类型导出），只有 `main/agent/agentLoop.ts` 与 `main/ipc.ts` 引用。改为引用 core 并删除副本，适配器测试移到 `src/core/llm/__tests__/adapters.test.ts`。提交 `81efb28`。
3. **usage 采集**：`StreamResult.usage?: TokenUsage`（`promptTokens` / `completionTokens` / `cachedTokens` / `cacheWriteTokens`），三家协议归一：
   - OpenAI：请求加 `stream_options: { include_usage: true }`；若服务返回 400 且报该字段，退回不带该字段重试一次（避免破坏不支持的兼容服务）。
   - Anthropic：`message_start.message.usage` 取输入/缓存字段，`message_delta.usage.output_tokens` 补输出。
   - Gemini：`usageMetadata`。
   提交 `9447e31`。

### Verification Evidence

- `npm test -- --run`：32 文件 / 138 用例通过（适配器 9 例，含 4 个 usage 用例）
- `npx tsc -b --pretty false`：exit 0
- 非 vacuous 验证：临时让三家适配器都不返回 `usage` → 3 个 usage 用例全部失败；恢复后全绿

### Remaining (阶段 3–5)

1. `CoreAgentService` / `DesktopAgentService` 注入 `onUsage`，把 `providerId + model + usage` 落成记录。
2. 持久化：独立 `usage.json`（main userData / server data 目录），新增 `getUsageRecords()` API + IPC + server RPC + android 空实现。
3. 渲染端纯函数聚合（按模型 / 按日 / 缓存命中率）+ 左侧栏「用量」入口 + 页面。
4. 全量验证、打包、质量审查。
