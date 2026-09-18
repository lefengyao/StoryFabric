# 编排、Skill 与智能询问 0.1.7：Task 0 基线与 0.1.6 正式产物

日期：2026-09-18
工作区：D:\生产项目\项目\TrailblazerStation\StoryFabricAllConsole\StoryFabric
计划：docs/superpowers/plans/2026-09-18-orchestration-skills-questions-017-plan.md

## 范围与保护边界

- 本 checkpoint 记录 Task 0 执行前的脏工作树、测试基线、0.1.6 正式产物和最终版本切换。
- 未执行 git reset、git checkout、git clean，也没有覆盖计划之外的用户改动。
- 未读取、写入或修改 E:\New项目\Novel\开局被抢课逼疯，我带全地府修仙。
- Task 0 初始提交只包含本 checkpoint、package.json、根 package-lock.json；后续规格复核修复允许提交必要的 electron-builder.yml 与本 checkpoint 更新。其他脏文件均不得 stage 或提交。
- release/0.1.6/ 是本任务要求生成的正式产物目录；不将其内容当作源码改动，也不使用快照产物覆盖该目录。

## Git 基线

执行命令：git status --short；git rev-parse HEAD；git diff --stat；git diff -- src/core/agent/agentLoop.ts src/core/orchestration src/core/skills src/renderer/src/pages/chat/ChatPage.tsx src/renderer/src/components/chat/ChatSidebar.tsx。

基线 HEAD：dde454af1d6d0816f480227ffa1dea5db7fb9ce7
基线 git diff --stat：67 files changed, 2585 insertions(+), 673 deletions(-)。

### 基线脏文件清单

已跟踪修改：

android/app/build.gradle
package-lock.json
package.json
src/core/agent/__tests__/implementationAudit.test.ts
src/core/agent/__tests__/modelCallGateway.test.ts
src/core/agent/__tests__/runtime.test.ts
src/core/agent/agentLoop.ts
src/core/agent/modelCallGateway.ts
src/core/agent/runStore.ts
src/core/agent/runtime.ts
src/core/orchestration/__tests__/scheduler.test.ts
src/core/orchestration/scheduler.ts
src/core/orchestration/stageRunner.ts
src/core/orchestration/subagents.ts
src/core/orchestration/toolPolicy.ts
src/core/orchestration/types.ts
src/core/tools/registry.ts
src/core/workspace/__tests__/sessionArchive.test.ts
src/core/workspace/__tests__/sessionPreferences.test.ts
src/core/workspace/sessionArchive.ts
src/core/workspace/sessionPreferences.ts
src/core/workspace/sessionStore.ts
src/main/agent/agentLoop.ts
src/main/index.ts
src/main/ipc.ts
src/main/services/__tests__/sessionStore.test.ts
src/main/services/sessionStore.ts
src/main/services/settingsService.ts
src/preload/index.ts
src/renderer/src/App.tsx
src/renderer/src/components/chat/AgentActivity.tsx
src/renderer/src/components/chat/AttachmentMenu.tsx
src/renderer/src/components/chat/ChatSidebar.tsx
src/renderer/src/components/chat/OrchestrationPanel.tsx
src/renderer/src/components/chat/OrchestrationResults.tsx
src/renderer/src/components/chat/RunTimeline.tsx
src/renderer/src/components/ui/TextContextMenu.tsx
src/renderer/src/layouts/AppLayout.tsx
src/renderer/src/lib/sidebarPresentation.ts
src/renderer/src/pages/chapters/ChaptersPage.tsx
src/renderer/src/pages/characters/CharactersPage.tsx
src/renderer/src/pages/chat/ChatPage.tsx
src/renderer/src/pages/notes/NotesPage.tsx
src/renderer/src/pages/outline/OutlinePage.tsx
src/renderer/src/pages/relations/RelationsPage.tsx
src/renderer/src/pages/settings/CreativeExtensionsView.tsx
src/renderer/src/pages/settings/ModelManagerView.tsx
src/renderer/src/pages/settings/SettingsPage.tsx
src/renderer/src/pages/settingsDocs/SettingsDocsPage.tsx
src/renderer/src/platform/__tests__/httpApi.test.ts
src/renderer/src/platform/androidApi.ts
src/renderer/src/platform/httpApi.ts
src/renderer/src/stores/__tests__/chatScope.test.ts
src/renderer/src/stores/chatScope.ts
src/renderer/src/stores/chatStore.ts
src/renderer/src/stores/runStore.ts
src/renderer/src/styles/index.css
src/server/runEvents.ts
src/server/server.ts
src/server/settingsStore.ts
src/shared/__tests__/agentRuntime.test.ts
src/shared/agentRuntime.ts
src/shared/api.ts
src/shared/creative.ts
src/shared/ipc.ts
src/shared/platformCapabilities.ts
src/shared/types.ts

未跟踪修改：

.qa-server-data/
.superpowers/brainstorm/ui-layout-20260918-163952/
src/core/agent/__tests__/approvalAudit.test.ts
src/core/agent/__tests__/approvalIntegration.test.ts
src/core/agent/__tests__/approvalPolicy.test.ts
src/core/agent/__tests__/goalIntegration.test.ts
src/core/agent/__tests__/orchestrationGrounding.test.ts
src/core/agent/__tests__/requestContext.test.ts
src/core/agent/__tests__/toolRecovery.test.ts
src/core/agent/approvalAudit.ts
src/core/agent/approvalPolicy.ts
src/core/agent/runController.ts
src/core/agent/toolLoop.ts
src/core/goal/
src/core/orchestration/__tests__/projectContext.test.ts
src/core/orchestration/__tests__/roleContracts.test.ts
src/core/orchestration/artifactValidation.ts
src/core/orchestration/projectContext.ts
src/core/orchestration/rolePrompts.ts
src/core/skills/__tests__/globalSkillLibrary.test.ts
src/core/skills/__tests__/legacyMigration.test.ts
src/core/skills/__tests__/packageArchive.test.ts
src/core/skills/__tests__/skillResolver.test.ts
src/core/skills/globalSkillLibrary.ts
src/core/skills/legacyMigration.ts
src/core/skills/packageArchive.ts
src/core/skills/skillResolver.ts
src/core/skills/skillTools.ts
src/main/runtimeEvents.ts
src/renderer/src/components/chat/SkillActivity.tsx
src/renderer/src/components/chat/__tests__/orchestrationPanel.test.ts
src/renderer/src/components/chat/__tests__/orchestrationPolicy.test.ts
src/renderer/src/lib/__tests__/contextUsagePresentation.test.ts
src/renderer/src/lib/__tests__/creativePreferences.test.ts
src/renderer/src/lib/__tests__/layoutPresentation.test.ts
src/renderer/src/lib/agentMessageReducer.ts
src/renderer/src/lib/contextUsagePresentation.ts
src/renderer/src/lib/creativePreferences.ts
src/renderer/src/lib/layoutPresentation.test.ts
src/renderer/src/lib/layoutPresentation.ts
src/renderer/src/pages/creative/
src/renderer/src/pages/goals/
src/renderer/src/pages/settings/OrchestrationSettingsView.tsx
src/renderer/src/pages/settings/__tests__/
src/renderer/src/stores/__tests__/chatInterleaving.test.ts
src/renderer/src/stores/__tests__/runStore.test.ts
src/shared/__tests__/goalContracts.test.ts
src/shared/agentEvidence.ts
src/shared/runEvents.ts

### 与本计划重叠的现有变更

按计划指定命令检查后，已跟踪重叠 diff 为 9 个文件、959 insertions(+), 223 deletions(-)：

src/core/agent/agentLoop.ts
src/core/orchestration/__tests__/scheduler.test.ts
src/core/orchestration/scheduler.ts
src/core/orchestration/stageRunner.ts
src/core/orchestration/subagents.ts
src/core/orchestration/toolPolicy.ts
src/core/orchestration/types.ts
src/renderer/src/components/chat/ChatSidebar.tsx
src/renderer/src/pages/chat/ChatPage.tsx

计划重叠目录中还存在未跟踪文件；git diff 不展示未跟踪内容：

src/core/orchestration/__tests__/projectContext.test.ts
src/core/orchestration/__tests__/roleContracts.test.ts
src/core/orchestration/artifactValidation.ts
src/core/orchestration/projectContext.ts
src/core/orchestration/rolePrompts.ts
src/core/skills/__tests__/globalSkillLibrary.test.ts
src/core/skills/__tests__/legacyMigration.test.ts
src/core/skills/__tests__/packageArchive.test.ts
src/core/skills/__tests__/skillResolver.test.ts
src/core/skills/globalSkillLibrary.ts
src/core/skills/legacyMigration.ts
src/core/skills/packageArchive.ts
src/core/skills/skillResolver.ts
src/core/skills/skillTools.ts

上述文件及所有其他基线脏文件均属于既有用户工作；Task 0 不覆盖、不回滚、不 stage。

## 基线验证

### 测试

命令：npm test -- --reporter=dot
退出码：0
结果：149 test files passed；731 tests passed；1 skipped（732 total）。耗时 40.02s。
附带既有 stderr：src/server/__tests__/server.test.ts 和 src/main/__tests__/ipcRecentWorkspaces.test.ts 输出 failed to persist recent workspace record；未导致测试失败。

### TypeScript

命令：npx tsc --noEmit -p tsconfig.web.json；退出码 0；通过。

命令：npx tsc --noEmit -p tsconfig.node.json；退出码 1；基线失败，未伪装为通过。
错误：orchestrationGrounding.test.ts 第 127、151、190、194 行的可选值断言；ipcRecentWorkspaces.test.ts 第 44、76、111、140、161 行的 AppContext 缺少 runtimeEvents。

### Diff 检查

命令：git diff --check；退出码 0；通过，无 whitespace 错误。

## 0.1.6 正式产物

先将 package.json 与根 package-lock.json 版本切为 0.1.6。
npm run server:bundle：退出码 0。
npm run dist:win：退出码 0；该命令按脚本再次运行 server:bundle。

最终产物目录：D:\生产项目\项目\TrailblazerStation\StoryFabricAllConsole\StoryFabric\release\0.1.6

校验结果：

- release/0.1.6/server-bundle/VERSION：0.1.6
- release/0.1.6/storyfabric-server-0.1.6.tar.gz 内 VERSION：0.1.6
- release/0.1.6/win-unpacked/resources/server-bundle.tar.gz 内 VERSION：0.1.6
- release/0.1.6/latest.yml：版本字段为 0.1.6
- 实际安装器：release/0.1.6/StoryFabric Setup 0.1.6.exe
- 实际便携包：release/0.1.6/StoryFabric-Portable-0.1.6.zip
- 独立服务包 SHA256：2F045685FBF8B969A23B95461A9D11CB5A367D8860D91F7AAB55BE685934FB19
- 内嵌服务包 SHA256：2F045685FBF8B969A23B95461A9D11CB5A367D8860D91F7AAB55BE685934FB19
- 独立包与内嵌包 SHA256：一致。

已知发布顾虑：latest.yml 的 url/path 为 StoryFabric-Setup-0.1.6.exe，而实际安装器文件名为 StoryFabric Setup 0.1.6.exe。因此版本内容和包哈希通过，但安装器元数据文件名匹配未通过，不能将该正式产物标记为无条件发布就绪。

## 源码版本切换

将 package.json 和根 package-lock.json 切换到 0.1.7-snapshot 后运行 npm install --package-lock-only。
退出码：0；输出 up to date in 2s。
node -p require('./package.json').version：0.1.7-snapshot
node -p require('./package-lock.json').version：0.1.7-snapshot
node -p require('./package-lock.json').packages[empty].version：0.1.7-snapshot

当前源码版本为 0.1.7-snapshot。npm 以当前环境解析 lockfile 时额外写入了 Tailwind WASI 可选依赖的 lockfile 条目；该变化由要求执行的 npm install --package-lock-only 产生，未手工扩展其他源码文件。

## 初始提交边界

Task 0 初始提交前确认只 stage：

docs/superpowers/checkpoints/2026-09-18-orchestration-017-baseline.md
package.json
package-lock.json

初始提交信息：chore: record 0.1.6 release baseline for orchestration snapshot
初始提交：bd65f4b5b2bd957fd973c64b1a06716a6765d3fc

## 规格复核修复提交边界

本次修复只提交：

electron-builder.yml
docs/superpowers/checkpoints/2026-09-18-orchestration-017-baseline.md

release/0.1.6 下的两个旧重复产物属于被忽略的生成文件，按用户要求删除但不强行纳入 Git 提交；package.json、package-lock.json 和后续功能文件均不修改、不 stage。
本次修复提交信息：fix: align 0.1.6 installer metadata with artifact name；后续清理提交将只包含上述两个 Task 0 文件。

## 规格复核修复：latest.yml 安装器文件名

复核发现的根因：electron-builder.yml 原来的 nsis.artifactName 是 StoryFabric Setup ${version}.${ext}，实际生成带空格的 NSIS 文件；electron-builder 生成 latest.yml 时引用了连字符形式 StoryFabric-Setup-${version}.exe，导致 metadata 指向不存在的文件。

采用的最小可复现修复：将 electron-builder.yml 的 nsis.artifactName 统一为 StoryFabric-Setup-${version}.${ext}，临时把 package.json 与根 package-lock.json 版本设为 0.1.6，重新运行 npm run dist:win，完成后恢复源码版本为 0.1.7-snapshot。没有修改后续功能源码，也没有覆盖用户脏工作树。

修复验证：

- npm run dist:win：退出码 0。
- release/0.1.6/latest.yml 的 url/path 均为 StoryFabric-Setup-0.1.6.exe。
- release/0.1.6/StoryFabric-Setup-0.1.6.exe：存在。
- release/0.1.6/StoryFabric-Setup-0.1.6.exe.blockmap：存在。
- release/0.1.6/server-bundle/VERSION：0.1.6。
- 独立 tar 内 VERSION：0.1.6。
- win-unpacked/resources/server-bundle.tar.gz 内 VERSION：0.1.6。
- 独立服务包 SHA256：72402616BC05E5807A7EBB2B58A315AE25AB38B453ECF532FC37F75F7371451D。
- 内嵌服务包 SHA256：72402616BC05E5807A7EBB2B58A315AE25AB38B453ECF532FC37F75F7371451D。
- 两个服务包 SHA256：一致。
- 当前 package.json、根 package-lock.json 顶层及 packages[empty] 版本：0.1.7-snapshot。

重建不会清理 release/0.1.6 中旧的空格命名产物；旧文件仍存在但不再被 latest.yml 引用。本次不删除它们，以避免超出修复 metadata/config 缺口的最小范围。
