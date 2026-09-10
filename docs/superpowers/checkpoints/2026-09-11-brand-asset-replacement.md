---
status: in-progress
branch: main
timestamp: 2026-09-11T00:32:26+08:00
files_modified:
  - docs/superpowers/specs/2026-09-11-brand-assets-replacement-design.md
  - docs/superpowers/plans/2026-09-11-brand-assets-replacement.md
  - storyfabric-logo.svg
  - storyfabric-logo-flat.svg
  - storyfabric-logo-mono.svg
  - src/renderer/src/components/icons/BrandMark.tsx
  - src/renderer/src/components/icons/__tests__/BrandMark.test.tsx
  - vitest.config.ts
---

## Working on: 全平台品牌资产替换

### Summary

用户提供了三个全新 SVG，已确认三者职责：第一份用于任务栏、发行包和系统图标；`flat` 用于软件界面；`mono` 用于白底可调色水印。设计规范和实施计划已经写入并提交，当前已完成 Task 1 的组件实现与两轮修复，暂停在 Task 1 的最终代码质量复审阶段。

### Decisions Made

- 使用统一的 `BrandMark` 组件，避免继续保留旧的内嵌渐变 `AppLogo` 实现。
- `flat` 通过稳定的 Vite SVG 资源作为软件内品牌图形。
- `mono` 通过 CSS mask 渲染，继承 `currentColor`，调用方可以调整颜色和透明度；暂不强行新增水印场景。
- 第一份 `storyfabric-logo.svg` 作为 Electron 和 Android 发行图标的源文件，后续由现有 `scripts/generate-icons.mjs` 生成 ICO、PNG 和 Android 各密度资源。
- 原有用户未提交修改全部保留，没有 reset、stash、清理或覆盖。
- 当前工作在 `main` 分支直接进行，不能使用破坏性回退操作。

### Completed

1. 已确认并提交设计规范：`cdaeb48 docs: specify brand asset replacement`。
2. 已确认并提交实施计划：`0db3ac1 docs: add brand asset replacement plan`。
3. Task 1 初始实现：`c188e79 feat: add unified brand mark component`。
4. 修复 SVG 未纳入提交、Vitest 不发现 `.tsx` 测试：`ddf3df0 fix: include brand assets and tests`。
5. 修复 flat 图片缺少原生 `alt`：`72940de fix: add native alt text to brand mark`。
6. Task 1 规范审查已通过。

### Remaining Work

1. 重新进行 Task 1 的代码质量复审；上一次因用户中断等待，复审代理已关闭。需要确认 `BrandMark`、测试、SVG 和 Vitest 配置没有其他问题。
2. Task 2：将侧栏、欢迎页、Web 登录页从 `AppLogo` 迁移到 `BrandMark variant="flat"`，增加 flat favicon，并删除旧内嵌 logo。
3. Task 2 完成后按流程做规范审查和代码质量审查，发现问题必须修复并复审。
4. Task 3：修改 `scripts/generate-icons.mjs`，改用 `storyfabric-logo.svg`，生成 Electron ICO/PNG，并同步 Android launcher、round launcher、foreground/background 资源。
5. Task 3 完成后按流程做规范审查和代码质量审查。
6. Task 4：执行品牌引用扫描、全量 Vitest、两套 TypeScript 检查、Electron/Web/Mobile/Server 构建和 `git diff --check`。
7. 按完成开发分支流程收尾；当前分支已经是 `main`，不需要再合并。

### Notes

- `storyfabric-logo.svg` 当前仍是工作区中的未跟踪文件，Task 3 必须将它作为发行图标源纳入对应提交；不要误删或用旧 `resources/icon.svg` 覆盖。
- Task 1 的组件文件已从根目录 SVG 导入 flat/mono 资源；后续迁移调用方前先确认构建路径在 Web、Electron 和 Mobile 配置下都成立。
- 审查过程中观察到仓库存在与本任务无关的既有脏文件和测试/类型检查波动，不能清理或回滚。最终报告应把本任务结果与这些既有工作区状态区分开。
- Task 1 曾验证：聚焦测试通过，TypeScript 检查通过，Electron production build 通过。全量验证应在所有任务完成后重新执行。
- 断点位置：完成 Task 1 的规范审查后，等待 Task 1 代码质量复审结论。
