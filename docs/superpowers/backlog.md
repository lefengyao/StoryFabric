# 项目清单（Backlog）

> 记录已知但未排期的工作项。完成一项后移到对应的 plan/spec，或直接删除。
> 最后更新：2026-09-09

## UI 展示平滑度（用户反馈 2026-09-09）

用户反馈「有一些 UI 展示不够平滑」，并给出第一处具体位置（其余**待补充**）。

- [x] **关系图谱左下角缩放控件是纯白方块**（`RelationsPage.tsx:254` 的 xyflow `<Controls>`），深色主题下与背景反差过大、刺眼。已修：`styles/index.css` 通过 xyflow 主题变量把按钮背景/边框/悬停接入 `--panel` / `--line` / `--elevated` / `--muted`，并加圆角与细边框（`706e074`）。
- [ ] 其余位置待用户指明（页面 + 操作 + 观感）
- 候选自查方向（未确认，仅供排查参考）：
  - [ ] 弹窗开合过渡（`components/ui/modal.tsx`）与遮罩动画
  - [ ] 智能体流式文本逐字重渲染（`pages/chat/ChatPage.tsx` + `stores/chatStore.ts`）
  - [ ] 长列表滚动（章节 / 便签 / 角色，是否需虚拟化或分批渲染）
  - [ ] 页面切换与首屏骨架（路由切换时的空白/跳动）
  - [ ] 关系图谱（`@xyflow/react` + d3-force）布局抖动

## 新功能（用户提出 2026-09-09）

### 1. 设置页分类 + 上侧选择栏

现状：`src/renderer/src/pages/settings/SettingsPage.tsx` 是单列滚动，四个 `<section>`（供应商 / 智能体 / 默认模型 / 外观），无分类导航。

- [x] 把各项设置按类别分组，顶部加横向选择栏（tab）切换，而不是一路滚到底。（已完成：四个 tab「模型与供应商 / 智能体 / 外观 / 通知」，tab 写入 `?tab=`，见 `plans/2026-09-09-settings-ia-appearance-notifications.md`）
- 待确认：移动端是否降级为单列滚动（当前 tab 横滑，内容仍单列）。

### 2. 更多实用设置

- [x] **对话完成提示音**：`done` 事件时播放 WebAudio 合成双音；「通知」tab 提供开关 + 试听；出错/中止不响。
- [x] **自定义主题色**：深浅主题各存一个基色，`accent.ts` 推导 `--accent` 家族；「外观」tab 提供取色器、十六进制输入、预设与重置。
- [ ] 其他候选（待用户确认）：字号/行距、编辑器字体、自动保存间隔、发送快捷键、消息气泡密度。

### 3. Token 消耗监测（左侧栏新入口）

现状（实现前）：**全仓库没有任何 LLM 用量采集**。现已完成：

- [x] 适配器解析 usage → 统一类型 `TokenUsage` → agent loop 回报 `UsageRecord` → 落盘 `usage.json` → 左侧栏「用量」页面。
- [x] 需要的数据：**各模型消耗**、**日消耗（最近 14 天）**、**平均缓存命中**。
- 决策：持久化用独立 `usage.json`（桌面 userData / 服务端 data 目录，非 `settings.json`）；统计范围为**全部 LLM 调用**（当前快捷操作未单独发起调用，因此等同智能体对话）；缓存口径已按三家协议归一。
- 后续可做（未排期）：费用估算（需模型单价表）、按工作区拆分、导出 CSV。

## 待排期

- [ ] **用量持久化的跨实例并发**：`UsageService` 的队列是实例私有的，多进程/多实例写同一 `usage.json` 会互相覆盖（桌面单实例锁 + 服务端单进程下不触发）。若未来支持共享 data 目录，改为 JSONL 追加写。
- [ ] **`UsagePage` 无渲染端测试**（仓库无 jsdom/@testing-library）；页面层空态/加载态/错误态/条形图仅人工确认。
- [ ] **Anthropic 流缺少 `message_start` 时**（非标准流）：`message_delta` 单独出现会把 `promptTokens` 记为 0，缓存命中率随之失真；正常流不受影响。
- [ ] **`PendingChangeDialog` 的 `view.confirmLabel` 接线无测试保护**：仓库无 React 组件测试设施；变异验证表明改回硬编码文案全量测试仍绿（风险低：单一调用点 + 必填字段由 tsc 兜底）。
- [ ] core agent loop 的假适配器只验证注入结果与请求快照，未覆盖真实协议适配器的消息映射（已由 `src/main/llm/__tests__/adapters.test.ts` 部分覆盖）。
- [ ] 主线计划 `docs/superpowers/plans/2026-09-05-writing-structure-and-hybrid-retrieval.md`（50 项未勾选）。
- [ ] Android 端按 `docs/android-handoff.md` 的验收清单恢复（当前暂缓）。
- [ ] `docs/design.md` 已与实现脱节（仍写 14 个工具、`src/main/agent/prompts.ts` 等旧结构），需要重写或标注为历史文档。

## 已完成（2026-09-09）

- [x] **清单第 (4) 项 Token 消耗监测**：三家协议 usage 归一（OpenAI 需 `stream_options.include_usage`，被拒时回退重试）、`usage.json` 独立持久化、`getUsageRecords()` 三端打通、左侧栏「用量」页（各模型 / 最近 14 天 / 平均缓存命中）。
- [x] **清单第 (5) 项代码质量批次**：新建实体的待确认 `entityId` 与落盘 id 对齐（core 六个分支 + main 的 setting/note）；`save_relationship` 两端 title（空 type 不再渲染 `【】`）与错误文案对齐；`kindOfTool(name)` 取代不可达的 restore 死分支；`pendingChangeView` 测试解耦 `outcome` 键存在性、core loop 请求快照改深拷贝。
- [x] A+B 批次：`restore_from_trash` 用回收站条目的真实 `entityKind`（core/main）；桌面端首次建关系的 `beforeText` 与 core 对齐；确认按钮按操作显示「移入回收站 / 确认恢复 / 应用写入」；`pendingChangeView` 测试改 `toStrictEqual` 全量断言；core loop 假适配器记录请求快照并断言回注内容。
- [x] 便签删除的待确认变更标题两端对齐、失败 preview 两端对齐（见 `plans/2026-09-08-note-completion-delete.md`）。
- [x] 待确认变更弹窗的删除/恢复展示（见 `plans/2026-09-09-pending-change-presentation.md`）。
