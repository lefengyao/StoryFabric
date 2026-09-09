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

## 待排期

- [ ] **新建类写入工具的 `change.entityId` 是幻影 id**：`sim` 用 `genId()` 造了一个 id 放进 `PendingChange.entityId`，但 `commit` 保存的是**无 id 的 `patch`**，落盘时 `saveX(patch)` 又生成一次 id，两者不一致（core `tools/registry.ts` 与 main `tools/registry.ts` 的 `save_note`/`save_character`/`save_event`/`save_chapter`/`save_setting` 等分支皆然）。已读代码确认，并在 `src/main/tools/__tests__/registryParity.test.ts` 中实测：用 `save_note` 待确认变更的 `entityId` 去 `delete_note` 会报「未找到便签」。影响任何依赖 `change.entityId` 的 UI 跳转/高亮。
- [ ] core agent loop 的假适配器只验证注入结果与请求快照，未覆盖真实协议适配器的消息映射（已由 `src/main/llm/__tests__/adapters.test.ts` 部分覆盖）。
- [ ] 主线计划 `docs/superpowers/plans/2026-09-05-writing-structure-and-hybrid-retrieval.md`（50 项未勾选）。
- [ ] Android 端按 `docs/android-handoff.md` 的验收清单恢复（当前暂缓）。
- [ ] `docs/design.md` 已与实现脱节（仍写 14 个工具、`src/main/agent/prompts.ts` 等旧结构），需要重写或标注为历史文档。

## 已完成（2026-09-09）

- [x] A+B 批次：`restore_from_trash` 用回收站条目的真实 `entityKind`（core/main）；桌面端首次建关系的 `beforeText` 与 core 对齐；确认按钮按操作显示「移入回收站 / 确认恢复 / 应用写入」；`pendingChangeView` 测试改 `toStrictEqual` 全量断言；core loop 假适配器记录请求快照并断言回注内容。
- [x] 便签删除的待确认变更标题两端对齐、失败 preview 两端对齐（见 `plans/2026-09-08-note-completion-delete.md`）。
- [x] 待确认变更弹窗的删除/恢复展示（见 `plans/2026-09-09-pending-change-presentation.md`）。
