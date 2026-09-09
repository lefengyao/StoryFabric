---
status: completed
branch: main
timestamp: 2026-09-09T22:06:00+08:00
files_modified:
  - src/shared/types.ts
  - src/core/llm/types.ts
  - src/core/llm/modelCatalog.ts
  - src/core/llm/modelParams.ts
  - src/core/llm/reasoningMap.ts
  - src/renderer/src/lib/modelCapability.ts
  - src/renderer/src/pages/settings/ModelManagerView.tsx
  - src/renderer/src/pages/settings/SettingsPage.tsx
  - src/renderer/src/pages/chat/ChatPage.tsx
---

## Completed: 模型能力管理与思考强度映射

### Summary

用户要求「模型选择处做扩展」：拉取模型移出小窗、逐模型展开面板、能力由用户决定（不锁死）、官方思考强度映射自填、支持自定义增删模型。设计见 `specs/2026-09-09-model-capability-management-design.md`，计划见 `plans/2026-09-09-model-capability-management.md`。

- **数据**：`ModelSettings` 新增 `reasoningSupport` / `vision` / `reasoningMap`（`ReasoningMap = { path, values: {off,low,medium,high} }`）；`ModelProfile` 新增 `vision`（18 个家族档 + 通用档）。三端持久化自动透传，无需迁移；`pruneModelSettings` 天然覆盖新字段。
- **core**：新增 `reasoningMap.ts`（`parseReasoningValue` / `setByPath` / `isWritableReasoningPath` / `RESERVED_REASONING_KEYS`）；`buildModelParams` 优先级为 **用户明确关闭 > 用户映射 > 协议内置 > 不发**，`off` 有值才发，映射命中时不再附加内置推理参数，写入后重申输出上限。
- **UI**：新增整页 `ModelManagerView.tsx`（拉取 → 候选勾选/全部添加 → 手动添加 → 搜索 → 逐模型展开：支持拓展思考 / 思考强度 / 官方映射（参数路径 + 四等级值）/ 支持图片输入 / 上下文 / 输出）；供应商小窗瘦身为 名称/协议/Base URL/API Key + 「管理模型」入口；聊天窗口模型下拉显示「思考 / 图片」后缀。
- **提交**：`aa042e4`（类型）、`eaacdca`（映射纯函数）、`33eb805`（vision + 透传）、`67e3bbb`（buildModelParams）、`019a155`（适配器级）、`66c14fc`（持久化往返）、`6048b9d`（渲染层纯逻辑）、`8f60a6d`（整页 + 小窗瘦身）、`bcf1aa7`（聊天标记）、`1145edd`（弹窗旧列表覆盖修复）、`8a04510`（原型链防护）、`16102e0`（首轮审查修复）、`5a62eed`（复审修复）。

### Verification Evidence

- `npm test -- --run`：**46 文件 / 259 用例通过**（新增 `reasoningMap` 10 例、`modelCapability` 11 例，及 `modelCatalog` / `modelParams` / `adapters` / `settingsService` / `server` 的补充断言）
- `npx tsc -b --pretty false`：exit 0
- `npm run build` / `npm run dist:win` / `npm run server:build:all`：exit 0（`release\win-unpacked\StoryFabric.exe` 22:02 重新打包，安装包 `StoryFabric Setup 0.1.0.exe` 同步生成）
- asar 核验：`reasoningMap` / `reasoningSupport` / `管理模型` / `官方思考强度映射` / `支持图片输入` / `支持拓展思考` / `从服务拉取` / `generationConfig.thinkingConfig` 全部 true
- 变异验证：把 `useMap` 强制为 `false` 时适配器映射测试失败，还原后 `git diff` 为空
- 手工走查：应用已用新包重新启动，走查清单见下（UI 交互由用户确认）

### 质量审查（2026-09-09）

独立只读审查（范围 `d2c1b81..1145edd`）结论 **PASS**，无阻塞/无重大，9 条 minor。已修复 6 条：

1. `params.reasoningMap?.values?.[level]` 缺可选链（手工改过的/RPC 数据缺 `values` 会 TypeError，导致每轮 agent 失败）。
2. 映射路径可覆盖请求体保留字段（`model`/`messages`/`max_tokens` 等）与原型链键 → 新增保留键拒绝 + `isWritableReasoningPath`，映射写入后重申输出上限。
3. 聊天窗口 `p.modelSettings[m]` 未兜底（Android 旧数据无该字段会白屏）→ `?.`。
4. 用户未表态时档案默认值会压制用户映射 → 仅 `reasoningSupport === false` 才禁用映射。
5. 映射提示与协议不符（Anthropic 需 `thinking` 整对象、Gemini 需 `generationConfig.` 前缀）→ 占位符与 `mappingWarning(map, protocol)` 按协议给出。
7. 「管理模型」对未保存供应商改为禁用 + 提示（原为点击后报错）。

未改（已与审查者确认口径）：脏值判断用 `JSON.stringify`（开关来回切会留下显式 `reasoningSupport:false`，视为真实意图）；侧边栏切换页面会丢弃未保存编辑（规格只要求「返回」按钮确认）。

**复审（范围 `1145edd..16102e0`）结论 PASS**，独立复跑测试 46 文件 / 256 例通过；指出 2 条新 minor，已修（`5a62eed`）：

- 映射把 Gemini 的 `generationConfig` 整个换成标量后，重申输出上限会抛 `TypeError` → 改为容器守卫，非对象时重建 `generationConfig`（含单测）。
- `mappingWarning` 对缺 `path`/`values` 的脏数据会抛错（会让模型管理整页白屏）→ 全部兜底（含单测）；Anthropic 校验收紧为「只接受 `thinking`」。
- 附带：Anthropic 映射 `thinking: {type:'disabled'}` 时不再回放历史思考块（适配器按 `type !== 'disabled'` 判定，含单测）。

### Notes and Risks

- 档案 `reasoning` / `vision` 只是开关初值，用户可覆盖且不再锁死（旧代码的 `disabled={!profile.reasoning}` 已删除）。
- 映射是**单一参数路径**：Anthropic 需填 `thinking` 并写完整 JSON 对象（适配器只读 `max_tokens` / `thinking`），Gemini 需 `generationConfig.` 前缀；多字段协同形式不支持。
- 「支持拓展思考」打开后强度默认仍是「关」，需再选等级才发送推理参数（与既有语义一致）。
- 图片开关目前只做记录与展示，图片输入本身未实现（附件仍只有工作区实体）。
- 展开面板与保存按钮的页面级交互无组件测试覆盖（仓库无 jsdom/@testing-library），由纯函数测试 + 人工走查保障。

### 交付后调整（2026-09-09，提交 `4584f85`）

用户反馈「按保存后会退出管理界面，这是一个糟糕的设计」→ 改为**保存后留在本页**：顶部显示短暂「已保存」提示（2.5s，组件卸载清理定时器），未保存状态复位（按钮回到禁用），可继续编辑其他模型；「返回」是唯一离开方式（有未保存改动时仍确认）。规格文档已同步。

### 手工走查清单（待用户确认）

1. 设置 → 模型与供应商 → 供应商卡片「管理模型」→ 整页。
2. 「从服务拉取」→ 候选列表 → 勾选/全部添加。
3. 手动添加一个内测模型名 → 不重复添加。
4. 展开模型 → 打开「支持拓展思考」→ 选强度 → 填官方映射（参数路径 + 各等级值）→ 保存。
5. 删除模型 → 保存 → 重新进入确认其设置一并消失。
6. 工作台聊天页模型下拉出现「思考 / 图片」后缀。
