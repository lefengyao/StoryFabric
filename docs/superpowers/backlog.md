# 项目清单（Backlog）

> 记录已知但未排期的工作项。完成一项后移到对应的 plan/spec，或直接删除。
> 最后更新：2026-09-09

## UI 展示平滑度（用户反馈 2026-09-09）

用户反馈「有一些 UI 展示不够平滑」，具体页面/交互**待补充**。

- [ ] 待用户指明具体位置（页面 + 操作 + 观感）
- 候选自查方向（未确认，仅供排查参考）：
  - [ ] 弹窗开合过渡（`components/ui/modal.tsx`）与遮罩动画
  - [ ] 智能体流式文本逐字重渲染（`pages/chat/ChatPage.tsx` + `stores/chatStore.ts`）
  - [ ] 长列表滚动（章节 / 便签 / 角色，是否需虚拟化或分批渲染）
  - [ ] 页面切换与首屏骨架（路由切换时的空白/跳动）
  - [ ] 关系图谱（`@xyflow/react` + d3-force）布局抖动

## 新功能（用户提出 2026-09-09）

### 1. 设置页分类 + 上侧选择栏

现状：`src/renderer/src/pages/settings/SettingsPage.tsx` 是单列滚动，四个 `<section>`（供应商 / 智能体 / 默认模型 / 外观），无分类导航。

- [ ] 把各项设置按类别分组，顶部加横向选择栏（tab）切换，而不是一路滚到底。
- 待确认：分类方案（建议「模型与供应商 / 智能体 / 外观 / 通知 / 数据与备份」）、移动端是否降级为单列滚动、是否把当前 tab 写进 URL（便于深链与刷新保持）。

### 2. 更多实用设置

- [ ] **对话完成提示音**：智能体 `done` 事件时在渲染端播放提示音；需设置项（开关 + 音量/音色）。注意 Web 端的浏览器自动播放策略（需用户交互后解锁），Electron 无此限制；音源用内置音频文件或 WebAudio 合成（后者无需打包资源）。
- [ ] **自定义主题色**：`src/renderer/src/styles/index.css:14-17,31-34` 的 `--accent` / `--accent-strong` / `--accent-soft` / `--accent-fg` 是 CSS 变量，可运行时覆盖。需取色器 + 预设色板 + 深浅色分别保存 + 对比度校验（`--accent-fg` 按背景自动取黑/白）。
- [ ] 其他候选（待用户确认）：字号/行距、编辑器字体、自动保存间隔、发送快捷键、消息气泡密度。

### 3. Token 消耗监测（左侧栏新入口）

现状：**全仓库没有任何 LLM 用量采集** —— `grep -E 'usage|prompt_tokens|completion_tokens|cached_tokens|input_tokens|output_tokens'` 在 `src` 的 `.ts` 文件里零命中（`token` 一词只出现在访问密钥会话 `src/server/auth.ts` 等处）；`openaiCompatible.ts` / `anthropic.ts` / `gemini.ts` 都丢弃了 API 返回的用量字段。

- [ ] 适配器解析 usage → 统一类型 → 经 agent loop / IPC / SSE 传到渲染端 → 持久化 → 左侧栏新页面展示。
- 需要的数据：**各模型消耗**、**日消耗**、**平均缓存命中**。
- 落点：
  - `src/main/llm/{openaiCompatible,anthropic,gemini}.ts` 与 `src/core/llm/*` 的流式解析
  - `StreamResult`（`src/main/llm/types.ts`、`src/core/llm/types.ts`）增加 `usage?`
  - 左侧栏 `NAV_ITEMS`（`src/renderer/src/layouts/AppLayout.tsx:11-18`）+ 新路由 + 新页面
- 待确认：持久化位置（工作区 `.storyfabric/` vs 全局 `settings.json`，前者随工作区备份、后者跨项目汇总）、统计范围（仅智能体对话 vs 含续写/润色等快捷操作）、日切分时区、缓存口径（OpenAI `prompt_tokens_details.cached_tokens`、Anthropic `cache_read_input_tokens` / `cache_creation_input_tokens`、Gemini `cachedContentTokenCount`）、是否需要费用估算（需模型单价表，维护成本高）。

## 待排期

- [ ] **新建类写入工具的 `change.entityId` 是幻影 id**：`sim` 用 `genId()` 造了一个 id 放进 `PendingChange.entityId`，但 `commit` 保存的是**无 id 的 `patch`**，落盘时 `saveX(patch)` 又生成一次 id，两者不一致（core `tools/registry.ts` 与 main `tools/registry.ts` 的 `save_note`/`save_character`/`save_event`/`save_chapter`/`save_setting` 等分支皆然）。已读代码确认（`entityStore.ts:340` 的 `input.id ?? genId(...)`）；观察来源：写 A+B 的 parity 测试时，用 `save_note` 待确认变更的 `entityId` 去 `delete_note` 得到「未找到便签」的非 pending 结果（该断言未保留在最终测试中）。影响任何依赖 `change.entityId` 的 UI 跳转/高亮。
- [ ] **`save_relationship` 两端仍未完全等价**：main 的 title 多 `【${type}】`（`main/tools/registry.ts:594`），人物不存在的错误文案也不同。A3 只对齐了 `beforeText`。
- [ ] **`PendingChangeDialog` 的 `view.confirmLabel` 接线无测试保护**：仓库无 React 组件测试设施；变异验证表明改回硬编码文案全量测试仍绿（风险低：单一调用点 + 必填字段由 tsc 兜底）。
- [ ] **可清理的死分支**：`core/tools/registry.ts:118` 与 `main/tools/registry.ts:669` 的 `name === 'restore_from_trash' ? 'chapter'` 在 A1 后不可达；建议抽 `kindOfTool(name)` 映射。
- [ ] **测试硬度**：`pendingChangeView` 的 `outcome: undefined` 与实现键存在性耦合（`toStrictEqual` 对 undefined 键做双向存在性检查）；core loop 的请求快照是浅拷贝，消息对象按引用。
- [ ] core agent loop 的假适配器只验证注入结果与请求快照，未覆盖真实协议适配器的消息映射（已由 `src/main/llm/__tests__/adapters.test.ts` 部分覆盖）。
- [ ] 主线计划 `docs/superpowers/plans/2026-09-05-writing-structure-and-hybrid-retrieval.md`（50 项未勾选）。
- [ ] Android 端按 `docs/android-handoff.md` 的验收清单恢复（当前暂缓）。
- [ ] `docs/design.md` 已与实现脱节（仍写 14 个工具、`src/main/agent/prompts.ts` 等旧结构），需要重写或标注为历史文档。

## 已完成（2026-09-09）

- [x] A+B 批次：`restore_from_trash` 用回收站条目的真实 `entityKind`（core/main）；桌面端首次建关系的 `beforeText` 与 core 对齐；确认按钮按操作显示「移入回收站 / 确认恢复 / 应用写入」；`pendingChangeView` 测试改 `toStrictEqual` 全量断言；core loop 假适配器记录请求快照并断言回注内容。
- [x] 便签删除的待确认变更标题两端对齐、失败 preview 两端对齐（见 `plans/2026-09-08-note-completion-delete.md`）。
- [x] 待确认变更弹窗的删除/恢复展示（见 `plans/2026-09-09-pending-change-presentation.md`）。
