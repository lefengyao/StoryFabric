# 项目清单（Backlog）

> 记录已知但未排期的工作项。完成一项后移到对应的 plan/spec，或直接删除。
> 最后更新：2026-09-09

## UI 展示平滑度（用户反馈 2026-09-09）

用户反馈「有一些 UI 展示不够平滑」，并给出第一处具体位置（其余**待补充**）。

- [x] **关系图谱左下角缩放控件是纯白方块**（`RelationsPage.tsx:254` 的 xyflow `<Controls>`），深色主题下与背景反差过大、刺眼。已修：`styles/index.css` 通过 xyflow 主题变量把按钮背景/边框/悬停接入 `--panel` / `--line` / `--elevated` / `--muted`，并加圆角与细边框（`706e074`）。
- [ ] 其余位置待用户指明（页面 + 操作 + 观感）
- 已按候选方向逐项排查并优化（2026-09-09）：
  - [x] 弹窗开合过渡（`9bd68ec`）：原 `animate-in` 类依赖未安装的 tailwindcss-animate，实际无动画；改为自定义 keyframes + `--animate-*` 令牌，尊重 `prefers-reduced-motion`。
  - [x] 智能体流式文本重渲染（`eb7c2b0`）：`MessageItem` 加 `memo`；`text-delta` 改 rAF 批处理（`rafBatcher.ts`），done/error/abort 处强制冲刷。
  - [x] 长列表滚动（`9bd68ec`）：新增 `.list-row { content-visibility: auto; contain-intrinsic-size: auto 44px }` 并应用到章节/便签/角色/大纲列表。
  - [x] 页面切换与首屏（`19c263c`）：导航项 hover/focus/touch 预取路由 chunk，消除首次进入的 Spinner 闪烁。
  - [x] 关系图谱布局抖动（`f8db594`）：`Math.random()` 初值改为按 id 确定性播种（`graphSeed.ts`），已有坐标用 `fx/fy` 钉住，`chars.find` 改 Map。

## 新功能（用户提出 2026-09-09）

### 1. 设置页分类 + 上侧选择栏

现状：`src/renderer/src/pages/settings/SettingsPage.tsx` 是单列滚动，四个 `<section>`（供应商 / 智能体 / 默认模型 / 外观），无分类导航。

- [x] 把各项设置按类别分组，顶部加横向选择栏（tab）切换，而不是一路滚到底。（已完成：四个 tab「模型与供应商 / 智能体 / 外观 / 通知」，tab 写入 `?tab=`，见 `plans/2026-09-09-settings-ia-appearance-notifications.md`）
- 待确认：移动端是否降级为单列滚动（当前 tab 横滑，内容仍单列）。

### 2. 更多实用设置

- [x] **对话完成提示音**：`done` 事件时播放 WebAudio 合成双音；「通知」tab 提供开关 + 试听；出错/中止不响。
- [x] **自定义主题色**：深浅主题各存一个基色，`accent.ts` 推导 `--accent` 家族；「外观」tab 提供取色器、十六进制输入、预设与重置。
- [x] 其他外观设置（2026-09-09，提交 `c832223`/`40635de`/`3ea72fb`/`bfe6f7a`）：编辑器字号/行距/字体（CSS 变量驱动 `.cm-scroller`）、消息气泡密度、发送快捷键、章节空闲自动保存（关闭/5s/15s/30s）；默认值均等于改动前观感。
- [x] 每模型参数（2026-09-09，提交 `2a94685`/`6753813`/`b126211`）：内置模型档案（上下文/输出上限/输出参数名/推理支持）+ 供应商弹窗逐模型覆盖 + 三家协议请求映射。

### 3. Token 消耗监测（左侧栏新入口）

现状（实现前）：**全仓库没有任何 LLM 用量采集**。现已完成：

- [x] 适配器解析 usage → 统一类型 `TokenUsage` → agent loop 回报 `UsageRecord` → 落盘 `usage.json` → 左侧栏「用量」页面。
- [x] 需要的数据：**各模型消耗**、**日消耗（最近 14 天）**、**平均缓存命中**。
- 决策：持久化用独立 `usage.json`（桌面 userData / 服务端 data 目录，非 `settings.json`）；统计范围为**全部 LLM 调用**（当前快捷操作未单独发起调用，因此等同智能体对话）；缓存口径已按三家协议归一。
- 后续可做（未排期）：费用估算（需模型单价表）、按工作区拆分、导出 CSV。

### 4. 模型能力管理与思考强度映射（2026-09-09）

- [x] 模型管理独立整页（`ModelManagerView.tsx`）：拉取移出供应商小窗、勾选添加/删除、手动添加（内测模型）、搜索；供应商小窗只留名称/协议/Base URL/API Key + 入口。
- [x] 逐模型展开面板：支持拓展思考（用户决定，**不再按内置档案锁死**）、思考强度下拉、支持图片输入、上下文长度、输出上限。
- [x] 官方思考强度 → 本地等级映射（用户自填：点路径 + 关/低/中/高四个值），优先级为 用户明确关闭 > 映射 > 协议内置 > 不发；`off` 填了值才发。
- [x] 聊天窗口模型下拉显示「思考 / 图片」能力后缀。
- [x] 设计：`specs/2026-09-09-model-capability-management-design.md`；计划：`plans/2026-09-09-model-capability-management.md`。
- [ ] **图片输入本身未实现**（附件目前只有工作区实体）：本批只记录能力标记与展示，等做图片输入时复用该开关（含文件选择、编码、三家协议多模态消息体、存储清理）。
- [ ] 映射是**单一参数路径**：Anthropic 需直接填 `thinking` 并写完整 JSON 对象，Gemini 需 `generationConfig.` 前缀；多字段协同形式不支持。
- [ ] 展开面板里「支持拓展思考」打开后强度默认仍是「关」，需要用户再选等级才会发送推理参数（与既有语义一致，若希望默认给中等强度需另定）。

### 5. 远程服务器部署（SSH + Docker，2026-09-09）

- [x] 欢迎页「服务」模式新增「安装到服务器」向导：SSH 地址/端口/用户名/密码 → 主机指纹核对并 pin → 环境检查（Linux / Docker / 端口 / sudo）→ 安装配置（安装目录、服务端口、基础镜像）→ 六步进度与实时日志 → 完成页显示服务地址与访问密钥。
- [x] 已部署服务器卡片：检查更新（比对容器镜像 tag 与本地部署包版本）、更新（换容器不删数据）、查看日志、卸载（保留 `<安装目录>/data`）。
- [x] 部署包随安装包分发：`npm run server:bundle` 生成 `release/storyfabric-server-<version>.tar.gz`，经 `extraResources` 落到 `resources/server-bundle.tar.gz`。
- [x] 安全：所有用户输入经 `shQuote`；密码只走 `sudo -S` 的 stdin；密码 safeStorage 加密存独立 `deploy-targets.json`，不回传渲染层；访问密钥在服务器上用 `openssl rand` 生成（`umask 077`，0400）。
- [x] 设计：`specs/2026-09-09-remote-server-deploy-design.md`；计划：`plans/2026-09-09-remote-server-deploy.md`。
- [ ] **不做/未做**：自动安装 Docker、密钥登录（只支持密码）、HTTPS/证书（用 Caddy/Nginx 反代）、多服务器批量、从官网下载部署包（已预留 `bundleSource: 'bundled' | 'url'`）。
- [ ] 真机走查由用户执行（安装 / 重启自愈 / 更新 / 卸载保留数据）；本机无 Docker、无 Linux 服务器，端到端只能靠真机验证。

## 待排期

- [ ] **用量持久化的跨实例并发**：`UsageService` 的队列是实例私有的，多进程/多实例写同一 `usage.json` 会互相覆盖（桌面单实例锁 + 服务端单进程下不触发）。若未来支持共享 data 目录，改为 JSONL 追加写。
- [ ] **`UsagePage` 无渲染端测试**（仓库无 jsdom/@testing-library）；页面层空态/加载态/错误态/条形图仅人工确认。
- [ ] **Anthropic 流缺少 `message_start` 时**（非标准流）：`message_delta` 单独出现会把 `promptTokens` 记为 0，缓存命中率随之失真；正常流不受影响。
- [ ] **`PendingChangeDialog` 的 `view.confirmLabel` 接线无测试保护**：仓库无 React 组件测试设施；变异验证表明改回硬编码文案全量测试仍绿（风险低：单一调用点 + 必填字段由 tsc 兜底）。
- [ ] core agent loop 的假适配器只验证注入结果与请求快照，未覆盖真实协议适配器的消息映射（已由 `src/main/llm/__tests__/adapters.test.ts` 部分覆盖）。
- [ ] **`ChaptersPage` 自动保存的页面级接线无组件测试**（仓库无 jsdom/@testing-library，页面目录下无任何测试文件）：`flush`/`discard`/覆盖确认的调用时机只由 `lib/__tests__/autosave.test.ts` 单测 + 人工验证保障，`discard()` 的两次接线（删除前、无改动时）一旦被误删，全量测试不会报警。
- [ ] **自动保存的调度 effect 在 React StrictMode 下会双跑**（dev only）：当前实现幂等（重新 schedule 只重置计时），仅在有共享实例时需重新评估。
- [ ] **覆盖确认弹窗的 `setConfirmOverwrite(true)` 可能在组件卸载后触发**：React 18 已不产生告警，仅是一次无用渲染。
- [ ] 主线计划 `docs/superpowers/plans/2026-09-05-writing-structure-and-hybrid-retrieval.md`（50 项未勾选）。
- [ ] Android 端按 `docs/android-handoff.md` 的验收清单恢复（当前暂缓）。
- [ ] `docs/design.md` 已与实现脱节（仍写 14 个工具、`src/main/agent/prompts.ts` 等旧结构），需要重写或标注为历史文档。

## 已完成（2026-09-09）

- [x] **清单第 (4) 项 Token 消耗监测**：三家协议 usage 归一（OpenAI 需 `stream_options.include_usage`，被拒时回退重试）、`usage.json` 独立持久化、`getUsageRecords()` 三端打通、左侧栏「用量」页（各模型 / 最近 14 天 / 平均缓存命中）。
- [x] **清单第 (5) 项代码质量批次**：新建实体的待确认 `entityId` 与落盘 id 对齐（core 六个分支 + main 的 setting/note）；`save_relationship` 两端 title（空 type 不再渲染 `【】`）与错误文案对齐；`kindOfTool(name)` 取代不可达的 restore 死分支；`pendingChangeView` 测试解耦 `outcome` 键存在性、core loop 请求快照改深拷贝。
- [x] A+B 批次：`restore_from_trash` 用回收站条目的真实 `entityKind`（core/main）；桌面端首次建关系的 `beforeText` 与 core 对齐；确认按钮按操作显示「移入回收站 / 确认恢复 / 应用写入」；`pendingChangeView` 测试改 `toStrictEqual` 全量断言；core loop 假适配器记录请求快照并断言回注内容。
- [x] 便签删除的待确认变更标题两端对齐、失败 preview 两端对齐（见 `plans/2026-09-08-note-completion-delete.md`）。
- [x] 待确认变更弹窗的删除/恢复展示（见 `plans/2026-09-09-pending-change-presentation.md`）。
- [x] 终检非阻塞项收尾（`34ddc20`）：新增 `Autosave.discard()`，删除章节前丢弃待执行保存（避免删完又被写回）、无未保存改动时用 discard 取代 cancel（干净卸载不再多写一次磁盘）；补适配器级测试「关闭推理时请求体不带 thinking 且不回放历史思考块」（两处变异均被捕获）。
