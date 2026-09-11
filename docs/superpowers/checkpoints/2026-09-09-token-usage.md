---
status: completed
branch: main
timestamp: 2026-09-09T20:40:00+08:00
files_modified:
  - src/core/usage/usageLog.ts
  - src/core/usage/usageService.ts
  - src/core/llm/types.ts
  - src/core/llm/openaiCompatible.ts
  - src/core/llm/anthropic.ts
  - src/core/llm/gemini.ts
  - src/core/agent/agentLoop.ts
  - src/shared/types.ts
  - src/shared/ipc.ts
  - src/shared/api.ts
  - src/preload/index.ts
  - src/main/ipc.ts
  - src/main/index.ts
  - src/main/agent/agentLoop.ts
  - src/server/server.ts
  - src/renderer/src/pages/usage/UsagePage.tsx
  - src/renderer/src/App.tsx
  - src/renderer/src/layouts/AppLayout.tsx
---

## Completed: 清单第 (4) 项 Token 消耗监测

### Summary

三家协议的 token 用量采集、独立持久化、三端 API 与左侧栏「用量」页全部完成。应用已用含本功能的包重启（PID 24296），发行包内确认含 `UsagePage-*.js`。

### Design Decisions

- **持久化**：独立 `usage.json`（桌面 userData、服务端 data 目录），不塞进 `settings.json`——用量是数据不是配置。
- **统计范围**：所有 LLM 调用；当前快捷操作并未单独发起模型调用（`quickActionModel` 仅存储），因此实际等同智能体对话。
- **OpenAI 兼容兼容性**：请求加 `stream_options: { include_usage: true }`；仅当服务返回 400 且响应体提到该字段时退回重试一次，避免破坏不支持的兼容服务。
- **`UsageService` 放 core**（`src/core/usage/usageService.ts`），main 与 server 共用，避免 server 反向依赖 main。
- **合并重复适配器**：`src/main/llm/*` 是 core 的副本，删除并改引用，否则 usage 解析要打两遍。

### Verification Evidence

- `npm test -- --run`：34 文件 / **150 用例通过**（新增 usageLog 6、usageService 4、适配器 usage 4、agent loop 用量回报 2）
- `npx tsc -b --pretty false`：exit 0
- `npm run build` / `npm run dist:win`：exit 0；发行包 `app.asar` 内含 `out/renderer/assets/UsagePage-*.js`
- 非 vacuous 验证：临时让三家适配器都不返回 `usage` → 3 个用例失败，恢复后全绿

### Notes and Risks

- 会话进行中查看用量页不会实时刷新，需点「刷新」或重进页面。
- 服务端用量文件为 `data/usage.json`，不在工作区归档内；换机器不迁移。
- 过程中曾出现一次 `git add` 路径错误导致 import 修复漏提交、HEAD 短暂不可构建，已用 `2d0f33f` 补上并复验。
