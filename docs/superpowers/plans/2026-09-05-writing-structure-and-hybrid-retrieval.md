# 写作结构与混合检索 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不破坏现有 Windows Electron 工作区格式和 Agent 写确认机制的前提下，增加章节分卷与三类资料箱、总纲/章纲、主要/次要角色、背景/其他设定、便签，并让智能体按章节邻接和术语索引按需读取资料。

**Architecture:** 继续使用 `FileStore` 抽象、Markdown + YAML frontmatter、JSON 元数据和共享 `src/core`。Windows 通过 Electron IPC 调用共享核心，Android 保留同一份 `StoryFabricApi`/核心实现，但本轮不构建、不安装、不做 Android UI 回归。检索由共享核心提供有上限的索引查询和章节上下文，不把整本小说拼进系统提示词。

**Tech Stack:** React 19, TypeScript, Zustand, Electron IPC, Capacitor `FileStore`, `gray-matter`, `jszip`, Vitest, Tailwind CSS v4。

---

## 技术栈与方案结论

1. **现有技术栈可行。** 文件工作区适合小说资料：可读、可备份、可跨 Windows/Android 导入；新增分类只需要扩展共享类型、序列化和目录索引，不需要引入数据库迁移框架。
2. **继续现有混合模式。** UI 直接操作 `StoryFabricApi`，Agent 通过 `TOOL_DEFS` 和 `executeTool` 读写；读取自动执行，写入/移动/恢复必须生成 diff 并等待确认。
3. **MCP 暂不作为主链路。** 当前 Agent 工具注册表已经是进程内的工具协议。现在引入外部 MCP server 会增加子进程生命周期、跨端打包、权限边界和失败恢复成本，不能改善本地文件读写的核心瓶颈。后续如需让外部 Agent 使用工作区，再把同一组 `ToolDefJson`/执行器包成可选 MCP 适配器，不能复制一套业务逻辑。
4. **先做确定性检索，再考虑向量检索。** 章节邻接、标题、标签、设定和人工标注术语都能用本地索引稳定解决；在没有真实项目规模和命中率数据前，不引入向量数据库、后台服务或网络依赖。
5. **“删除”默认进入回收站。** Agent 不提供永久删除工具；UI 的删除也只移动到 `.storyfabric/trash`，永久清空由回收站页面二次确认。

## 目标数据布局

新工作区使用以下布局，导入旧工作区时由 v1 → v2 迁移补齐缺失字段：

```text
storyfabric.json                 # version: 2
characters/
  primary/*.md                   # 主要角色
  secondary/*.md                 # 次要角色
outline/
  total/*.md                     # 总纲
  chapters/<chapterId>/*.md      # 章纲
settings/
  background/*.md                # 背景设定
  other/*.md                     # 其他设定
chapters/
  volumes.json                   # [{ id, title, order }]
  main/<volumeId>/*.md           # 正文箱
  draft/*.md                     # 草稿箱
notes/*.md                       # 便签
events/*.md
relationships.json
.storyfabric/
  sessions/*.json
  index.json                     # 可重建的派生检索索引
  trash/                         # 回收站实体与恢复元数据
```

兼容规则：旧版 `characters/*.md`、`outline/*.md`、`chapters/*.md` 先按 frontmatter 默认分类读取；打开工作区时执行一次幂等迁移，旧章节放入“正文箱/第一卷”，旧大纲放入“总纲”，旧人物放入“次要角色”，旧设定目录不存在时创建空目录。导入归档后也必须执行同一迁移。

## Agent 检索策略

系统提示词只说明规则，不携带项目正文。工具结果必须有大小上限：

| 场景 | 首选工具 | 返回内容 |
| --- | --- | --- |
| 了解项目结构 | `list_chapters`、`list_characters`、`list_settings` | 仅 id、标题、分类、卷、字数、摘要 |
| 修改某一章 | `get_chapter_context` | 目标章完整正文 + 前后各 2 章的标题/摘要/受限片段，默认最多 12,000 字符 |
| 遇到陌生名词 | `lookup_term` | 术语命中、章节标注、背景/其他设定、总纲/章纲的来源 id 和短片段 |
| 用户明确引用 | `get_*` | 只读取被引用实体，不扩展成全项目上下文 |
| 普通搜索 | `search_project` | 最多 40 个命中，每项只给 id、标题和片段，不返回整章 |

章节编辑规则写入 `src/core/agent/prompts.ts`：先取目标章上下文；陌生名词先查 `lookup_term`；只有工具返回的资料才能进入后续模型轮次；章节正文超过上限时继续用 id 分段获取，禁止一次读取整本小说。

## 实现边界

现有 `src/main/services/entityStore.ts` 与 `src/core/workspace/entityStore.ts` 有重复逻辑。第一步先保留主进程对外的 `root: string` 函数签名，但内部统一包装为 `new NodeFileStore(root)` 后调用 `src/core`；后续实体、迁移、回收站和检索只改共享核心。这样 Windows、Android 和 Agent 不会各自维护一套序列化规则。

---

### Task 1: 扩展共享领域类型与 v2 迁移契约

**Files:**
- Modify: `src/shared/types.ts`
- Create: `src/core/workspace/migration.ts`
- Modify: `src/core/workspace/workspaceService.ts`
- Modify: `src/main/services/workspaceService.ts`
- Modify: `src/main/services/entityStore.ts`
- Create: `src/core/workspace/__tests__/workspaceMigration.test.ts`
- Create: `src/main/services/__tests__/workspaceService.test.ts`

- [ ] **Step 1: 写迁移失败测试**

```ts
import matter from 'gray-matter'
import { MemoryFileStore } from '../../storage/fileStore'
import { loadSummary } from '../workspaceService'

it('旧版扁平工作区读取时补齐 v2 默认分类', async () => {
  const store = new MemoryFileStore()
  await store.writeText('storyfabric.json', JSON.stringify({ app: 'storyfabric', version: 1, name: '旧项目' }))
  await store.writeText('chapters/0001-开端.md', matter.stringify('正文', { id: 'cha_1', title: '开端', order: 1, volume: '第一卷' }))
  const summary = await loadSummary(store, '旧项目', 'memory://old')
  expect(summary.version).toBe(2)
  expect(summary.volumes).toEqual([{ id: 'vol_default', title: '第一卷', order: 1 }])
  expect(summary.chapters[0].box).toBe('main')
  expect(summary.chapters[0].volumeId).toBe('vol_default')
})
```

- [ ] **Step 2: 定义共享类型**

在 `src/shared/types.ts` 增加以下类型，并将 `EntityKind`、`SearchHit`、`WorkspaceSummary`、`OutlineDoc`、`CharacterDoc`、`ChapterMeta`、`ChapterDoc` 扩展为使用它们：

```ts
export type CharacterTier = 'primary' | 'secondary'
export type OutlineKind = 'total' | 'chapter'
export type SettingCategory = 'background' | 'other'
export type ChapterBox = 'draft' | 'main' | 'trash'

export interface VolumeMeta { id: string; title: string; order: number }
export interface TermAnnotation { term: string; note?: string; linkedEntityIds?: string[] }
export interface SettingDoc { id: string; title: string; category: SettingCategory; tags: string[]; content: string }
export interface NoteDoc { id: string; title: string; tags: string[]; pinned: boolean; createdAt: number; updatedAt: number; content: string }
export type SettingMeta = Omit<SettingDoc, 'content'>
export type NoteMeta = Omit<NoteDoc, 'content'>
export interface TrashEntry { id: string; kind: EntityKind; originalPath: string; deletedAt: number; title: string }
```

`CharacterDoc` 增加 `tier: CharacterTier`；`OutlineDoc` 增加 `kind: OutlineKind` 和可选 `chapterId`；`ChapterMeta` 增加 `box: ChapterBox`、`volumeId: string`、`terms: TermAnnotation[]`；`WorkspaceSummary` 增加 `version: number`、`volumes`、`settings: SettingMeta[]`、`notes: NoteMeta[]` 和 `trashCount`。`EntityKind` 增加 `setting`、`note`。

- [ ] **Step 3: 先统一主进程服务适配层**

将 `src/main/services/entityStore.ts` 中现有重复实现改为 root-to-store 薄包装，保留当前导入函数名和参数形状，内部统一调用 `src/core/workspace/entityStore.ts`；`src/main/services/workspaceService.ts` 同样通过 `NodeFileStore` 调用共享 `validateWorkspace`、`initializeWorkspace` 和迁移函数。这样后续只在 `src/core` 增加字段和规则，不再复制到主进程。

- [ ] **Step 4: 实现幂等 v1 → v2 默认值**

在新建的 `src/core/workspace/migration.ts` 中集中使用相同的 `CURRENT_WORKSPACE_VERSION = 2` 和 `migrateWorkspace(store)`：创建 `characters/primary`、`characters/secondary`、`outline/total`、`outline/chapters`、`settings/background`、`settings/other`、`chapters/draft`、`chapters/main`、`notes`、`.storyfabric/trash`；读取旧 frontmatter 时默认人物为 `secondary`、大纲为 `total`、章节为 `main`；根据旧 `volume` 名称建立稳定的 `vol_<顺序>` id；只在缺失或版本小于 2 时写回 `storyfabric.json`。两个平台的 `loadSummary` 在读取前调用同一迁移函数。

- [ ] **Step 5: 运行共享测试**

Run: `npx vitest run src/core/workspace/__tests__/workspaceMigration.test.ts src/main/services/__tests__/workspaceService.test.ts`

Expected: 新增迁移用例 PASS，旧有工作区加载测试不回归。

- [ ] **Step 6: 提交独立数据契约**

```bash
git add src/shared/types.ts src/core/workspace/migration.ts src/core/workspace/workspaceService.ts src/main/services/entityStore.ts src/main/services/workspaceService.ts src/core/workspace/__tests__/workspaceMigration.test.ts src/main/services/__tests__/workspaceService.test.ts
git commit -m "feat: define v2 writing workspace contract"
```

### Task 2: 增加回收站、恢复和工作区清理

**Files:**
- Modify: `src/core/storage/fileStore.ts`
- Modify: `src/core/storage/__tests__/fileStore.test.ts`
- Create: `src/core/workspace/trash.ts`
- Create: `src/core/workspace/housekeeping.ts`
- Modify: `src/core/workspace/archive.ts`
- Create: `src/core/workspace/__tests__/trash.test.ts`
- Create: `src/core/workspace/__tests__/housekeeping.test.ts`

- [ ] **Step 1: 写失败测试**

覆盖三个行为：删除实体后原路径不存在且 `.storyfabric/trash` 有恢复记录；恢复后原 id、正文和分类不变；清理只删除 `.tmp`、`.bak`、`.storyfabric/tmp` 下的临时文件，不删除任何 `.md`、`.json` 用户资料。

- [ ] **Step 2: 增加安全移动契约**

给 `FileStore` 增加 `move(from: string, to: string): Promise<void>`。`MemoryFileStore` 用读写映射实现；`NodeFileStore` 使用同工作区内的 `fs.rename`；`CapacitorFileStore` 使用 `Filesystem.rename`。三者都拒绝绝对路径和 `..` 穿越。

- [ ] **Step 3: 实现 `trash.ts`**

定义（`TrashEntry` 类型从 `src/shared/types.ts` 引入）：

```ts
export async function moveToTrash(store: FileStore, entry: TrashEntry): Promise<void>
export async function listTrash(store: FileStore): Promise<TrashEntry[]>
export async function restoreFromTrash(store: FileStore, id: string): Promise<void>
export async function purgeTrashEntry(store: FileStore, id: string): Promise<void>
```

实现采用 `.storyfabric/trash/<kind>/<id>.md` 和 `.storyfabric/trash/index.json`，恢复前检查目标路径不存在；永久清理只由显式 UI 调用，Agent 不暴露该函数。

- [ ] **Step 4: 实现 `housekeeping.ts` 并接入打开/导入**

`cleanupWorkspace(store)` 只清理 `.storyfabric/tmp` 和工作区内名称以 `.tmp`、`.bak` 结尾且超过 24 小时的文件；不得扫描和删除未知扩展名。`loadSummary` 和归档导入完成后调用一次，失败只记录可读错误，不阻断打开工作区。

- [ ] **Step 5: 更新归档目录白名单并测试**

将 `src/core/workspace/archive.ts` 的 `ROOT_DIRS` 增加 `settings`、`notes`、`.storyfabric` 已覆盖的子树，并为回收站归档增加往返测试。工作区归档不能包含 API Key、`node_modules`、`out`、`release` 或 Android build 目录。

- [ ] **Step 6: 运行测试并提交**

Run: `npx vitest run src/core/workspace/__tests__/trash.test.ts src/core/workspace/__tests__/housekeeping.test.ts src/core/workspace/__tests__/archive.test.ts`

```bash
git add src/core/storage src/core/workspace
git commit -m "feat: add recoverable workspace trash and cleanup"
```

### Task 3: 实现章节分卷和草稿箱/正文箱/回收站

**Files:**
- Modify: `src/core/workspace/entityStore.ts`
- Modify: `src/main/services/entityStore.ts`
- Modify: `src/core/workspace/workspaceService.ts`
- Modify: `src/shared/api.ts`
- Modify: `src/shared/ipc.ts`
- Modify: `src/main/ipc.ts`
- Modify: `src/renderer/src/platform/androidApi.ts`
- Modify: `src/renderer/src/pages/chapters/ChaptersPage.tsx`
- Modify: `src/renderer/src/layouts/AppLayout.tsx`
- Create: `src/core/workspace/__tests__/chapterTree.test.ts`
- Test: `src/main/services/__tests__/entityStore.test.ts`

- [ ] **Step 1: 写章节树和迁移测试**

测试创建卷、在草稿箱创建章节、移动章节到指定卷、按 `box → volume.order → chapter.order` 排序、删除到回收站和恢复；测试旧 `chapters/*.md` 默认进入 `main/vol_default`。

- [ ] **Step 2: 增加存储 API**

在共享 `StoryFabricApi` 增加以下接口，Electron IPC 和 Android 实现必须同时实现：

```ts
listVolumes(): Promise<VolumeMeta[]>
saveVolume(input: Partial<VolumeMeta> & { id?: string }): Promise<VolumeMeta>
deleteVolume(id: string): Promise<void>
moveChapter(id: string, target: { box: Exclude<ChapterBox, 'trash'>; volumeId?: string }): Promise<void>
listTrash(): Promise<TrashEntry[]>
restoreTrash(id: string): Promise<void>
purgeTrash(id: string): Promise<void>
```

`saveChapter` 写入 `chapters/main/<volumeId>/` 或 `chapters/draft/`；删除改为 `moveToTrash`；回收站条目不再出现在 `listChapters`。`volume` 字符串保留用于旧归档兼容，但新文件以 `volumeId` 和 `volumes.json` 为准。

`deleteVolume` 在卷下仍有章节时返回可读错误，不自动删除或移动章节；用户必须先将章节移动到其他卷或草稿箱。

- [ ] **Step 3: 更新 Agent 写入确认的实体类型**

章节移动、恢复和删除都生成 `PendingChange`；确认前显示源位置和目标位置，拒绝不改磁盘。永久清空只允许 UI 调用并显示二次确认。

- [ ] **Step 4: 重做 Windows 章节页为树形列表**

将 `ChaptersPage` 左栏拆为三个顶层节点：草稿箱、正文箱、回收站；正文箱展开卷，卷下展开章节。提供“新建卷”“新建章节”“移动到草稿箱/正文箱”“恢复”“清空回收站”操作，编辑区保留现有 MarkdownEditor、外部修改检测和 AI 续写入口。所有按钮沿用现有 `Button`/`Modal`，不把路径逻辑写进组件。

- [ ] **Step 5: 更新导航和手动验收**

在 Windows 开发窗口运行 `npm run dev`，完成：创建两卷、每卷两章、移动一章到草稿箱、删除并恢复一章、重启后树顺序一致。记录结果后运行章节单测。

- [ ] **Step 6: 提交章节树**

```bash
git add src/core/workspace/entityStore.ts src/main/services/entityStore.ts src/core/workspace/workspaceService.ts src/shared/api.ts src/shared/ipc.ts src/main/ipc.ts src/renderer/src/platform/androidApi.ts src/renderer/src/pages/chapters/ChaptersPage.tsx src/renderer/src/layouts/AppLayout.tsx src/core/workspace/__tests__/chapterTree.test.ts src/main/services/__tests__/entityStore.test.ts
git commit -m "feat: add chapter volumes and writing boxes"
```

### Task 4: 细化总纲与章纲

**Files:**
- Modify: `src/core/workspace/entityStore.ts`
- Modify: `src/main/services/entityStore.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/core/tools/registry.ts`
- Modify: `src/main/tools/registry.ts`
- Modify: `src/renderer/src/pages/outline/OutlinePage.tsx`
- Modify: `src/renderer/src/pages/chat/ChatPage.tsx`
- Create: `src/core/workspace/__tests__/outlineKinds.test.ts`

- [ ] **Step 1: 写失败测试**

验证 `kind: 'total'` 的大纲进入 `outline/total`，`kind: 'chapter'` 必须带 `chapterId` 并进入 `outline/chapters/<chapterId>`；旧大纲无 `kind` 时读为 `total`。

- [ ] **Step 2: 更新序列化和 API**

`saveOutlineDoc` 校验章纲的 `chapterId` 存在；`listOutline({ kind?, chapterId? })` 支持按分类和章节过滤；`get_outline` 工具只返回总纲摘要，新增 `list_chapter_outlines` 和 `get_chapter_outline` 避免一次读取全部章纲。

- [ ] **Step 3: 更新 Windows 大纲页**

页面顶部使用“总纲 / 章纲”分段控件；章纲模式先选章节再列出该章节的纲要文档；保存、重命名和回收站行为沿用共享实体服务。

- [ ] **Step 4: 测试并提交**

Run: `npx vitest run src/core/workspace/__tests__/outlineKinds.test.ts`

```bash
git add src/core/workspace/entityStore.ts src/main/services/entityStore.ts src/shared/types.ts src/core/tools/registry.ts src/renderer/src/pages/outline/OutlinePage.tsx src/renderer/src/pages/chat/ChatPage.tsx src/core/workspace/__tests__/outlineKinds.test.ts
git commit -m "feat: split total and chapter outlines"
```

### Task 5: 细化人物、增加设定资料和便签

**Files:**
- Modify: `src/core/workspace/entityStore.ts`
- Modify: `src/main/services/entityStore.ts`
- Modify: `src/shared/api.ts`
- Modify: `src/shared/ipc.ts`
- Modify: `src/main/ipc.ts`
- Modify: `src/renderer/src/platform/androidApi.ts`
- Modify: `src/renderer/src/pages/characters/CharactersPage.tsx`
- Create: `src/renderer/src/pages/settingsDocs/SettingsDocsPage.tsx`
- Create: `src/renderer/src/pages/notes/NotesPage.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/layouts/AppLayout.tsx`
- Create: `src/core/workspace/__tests__/settingsAndNotes.test.ts`

- [ ] **Step 1: 写实体 CRUD 测试**

验证人物 `tier` 分类和旧数据默认值；设定 `background`/`other` 分类、标题重命名和 Markdown 往返；便签创建、置顶、更新时间排序、回收和恢复。

- [ ] **Step 2: 实现共享实体服务**

增加 `listSettings`、`getSetting`、`saveSetting`、`deleteSetting`、`listNotes`、`getNote`、`saveNote`、`deleteNote`。`listSettings` 返回 `SettingMeta[]`，`listNotes` 返回 `NoteMeta[]`，打开时再按 id 读取正文。设定和便签都使用 frontmatter；便签 frontmatter 至少包含 `id/title/tags/pinned/createdAt/updatedAt`。人物保存时根据 `tier` 写入 `characters/primary` 或 `characters/secondary`。

- [ ] **Step 3: 扩展平台 API 与 IPC**

把新增实体接口加入 `src/shared/api.ts` 和 `src/shared/ipc.ts`，在 `src/main/ipc.ts`、`src/renderer/src/platform/androidApi.ts` 各接一层共享函数。渲染页面不得直接调用 Node、Electron 或 Capacitor。

- [ ] **Step 4: 更新 Windows UI**

人物页使用“主要角色 / 次要角色”分组；新增“设定”页，分段显示“背景设定 / 其他设定”；新增“便签”页，支持置顶、编辑、搜索、移入回收站。便签编辑器复用 `MarkdownEditor`，列表只加载摘要，打开时再读正文。

- [ ] **Step 5: 增加导航和路由验收**

在 `App.tsx` 增加 `/settings-docs` 和 `/notes` 路由，在 `AppLayout.tsx` 增加对应导航项。Windows 手动验证新建、编辑、重命名、删除、恢复和重启持久化。

- [ ] **Step 6: 测试并提交**

Run: `npx vitest run src/core/workspace/__tests__/settingsAndNotes.test.ts`

```bash
git add src/core/workspace/entityStore.ts src/main/services/entityStore.ts src/shared/api.ts src/shared/ipc.ts src/main/ipc.ts src/renderer/src/platform/androidApi.ts src/renderer/src/pages/characters/CharactersPage.tsx src/renderer/src/pages/settingsDocs/SettingsDocsPage.tsx src/renderer/src/pages/notes/NotesPage.tsx src/renderer/src/App.tsx src/renderer/src/layouts/AppLayout.tsx src/core/workspace/__tests__/settingsAndNotes.test.ts
git commit -m "feat: add classified lore and notes"
```

### Task 6: 建立按需检索索引与章节上下文服务

**Files:**
- Create: `src/core/retrieval/projectIndex.ts`
- Create: `src/core/retrieval/contextBuilder.ts`
- Modify: `src/core/workspace/entityStore.ts`
- Modify: `src/core/workspace/workspaceService.ts`
- Modify: `src/shared/types.ts`
- Create: `src/core/retrieval/__tests__/projectIndex.test.ts`
- Create: `src/core/retrieval/__tests__/contextBuilder.test.ts`

- [ ] **Step 1: 写有上限的检索测试**

建立 5 章、2 个设定、1 个总纲和带术语标注的章节，验证：`getChapterContext` 返回目标章和前后各 2 章；超过字符预算时按章节边界截断；`lookupTerm('星门')` 优先命中章节标注、设定和大纲；`searchProject` 不返回完整章节正文。

- [ ] **Step 2: 定义索引接口**

在 `projectIndex.ts` 定义：

```ts
export interface ProjectIndexEntry { kind: EntityKind; id: string; title: string; category?: string; order?: number; volumeId?: string; terms?: string[]; text: string }
export interface ProjectIndex { version: 1; builtAt: number; entries: ProjectIndexEntry[] }
export async function buildProjectIndex(store: FileStore): Promise<ProjectIndex>
export async function searchIndex(store: FileStore, query: string, limit?: number): Promise<SearchHit[]>
export async function lookupTerm(store: FileStore, term: string): Promise<SearchHit[]>
```

索引正文只保存标题、摘要、标签、术语和受限片段；完整正文仍从实体文件按 id 获取。中文使用连续 2~3 字片段和原文 `includes`，英文使用小写词匹配，不引入分词服务。

- [ ] **Step 3: 实现章节上下文构造器**

在 `contextBuilder.ts` 定义 `getChapterContext(store, chapterId, options = { radius: 2, maxChars: 12000 })`：按 `box !== 'trash'` 的章节顺序找到目标；读取目标章完整正文；向前后各读取最多两章，只返回标题、卷、字数和限长片段；结果包含 `sourceIds` 供 Agent 透明展示。

- [ ] **Step 4: 接入派生索引生命周期**

`loadSummary` 在索引缺失、版本不匹配或实体写入后调用 `buildProjectIndex`；索引写入 `.storyfabric/index.json`，损坏时删除并重建。索引是派生文件，归档可以携带但任何版本都能重建。

- [ ] **Step 5: 替换全文搜索实现并测试**

让 `searchProject` 委托 `searchIndex`；保留最多 40 个 `SearchHit` 的公开上限。运行：

```bash
npx vitest run src/core/retrieval/__tests__/projectIndex.test.ts src/core/retrieval/__tests__/contextBuilder.test.ts src/main/services/__tests__/entityStore.test.ts
```

- [ ] **Step 6: 提交检索核心**

```bash
git add src/core/retrieval src/core/workspace/entityStore.ts src/core/workspace/workspaceService.ts src/shared/types.ts src/core/retrieval/__tests__
git commit -m "feat: add bounded project retrieval"
```

### Task 7: 扩展 Agent 工具、写确认和术语标注

**Files:**
- Modify: `src/core/tools/registry.ts`
- Modify: `src/core/agent/prompts.ts`
- Modify: `src/main/agent/prompts.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/core/agent/agentLoop.ts`
- Modify: `src/main/agent/agentLoop.ts`
- Modify: `src/main/tools/registry.ts`
- Modify: `src/renderer/src/components/chat/PendingChangeDialog.tsx`
- Modify: `src/renderer/src/pages/chat/ChatPage.tsx`
- Modify: `src/renderer/src/pages/chapters/ChaptersPage.tsx`
- Test: `src/main/agent/__tests__/agentLoop.test.ts`
- Create: `src/core/tools/__tests__/registry.test.ts`

- [ ] **Step 1: 写工具行为测试**

验证 `get_chapter_context` 不读取回收站章节；`lookup_term` 返回设定/大纲/标注来源；Agent 修改章节时先调用上下文工具；`save_note`、`save_setting`、章节移动和恢复都暂停到 `PendingChange`；拒绝后磁盘内容和分类不变。

- [ ] **Step 2: 注册读取工具**

在 `TOOL_DEFS` 和 `readTool` 增加 `get_chapter_context`、`lookup_term`、`list_settings`、`get_setting`、`list_notes`、`get_note`、`list_chapter_outlines`、`get_chapter_outline`。读取工具只返回受限 JSON，工具卡片显示实体 id 和命中来源。

- [ ] **Step 3: 注册确认型写工具**

增加 `save_setting`、`save_note`、`move_chapter`、`restore_from_trash`；扩展 `WRITE_TOOLS` 和 `PendingChange.entityKind`。禁止注册 `purge_trash`、任意路径写入和直接删除工具。所有写工具都走现有 diff → `agentConfirm` → apply 流程。

- [ ] **Step 4: 更新 Agent 规则**

在两个 prompts 文件加入明确规则：不把项目资料放入系统提示词；修改章节先调用 `get_chapter_context`；陌生名词先调用 `lookup_term`；不得连续请求所有章节；写入、移动、恢复必须等待用户确认；拒绝后调整方案而不是重复原调用；永久删除只能由用户在回收站页面完成。

- [ ] **Step 5: 增加章节术语标注 UI**

在章节 frontmatter 保存 `terms: [{ term, note, linkedEntityIds }]`。章节编辑器增加术语列表的添加、编辑、删除；标注不改变正文字符，保存后触发索引重建。Chat 的 `@引用` 候选包含设定、便签和章纲。

- [ ] **Step 6: 运行 Agent 测试并提交**

Run: `npx vitest run src/main/agent/__tests__/agentLoop.test.ts src/core/tools/__tests__/registry.test.ts`

```bash
git add src/core/tools src/core/agent src/main/agent src/shared/types.ts src/renderer/src/components/chat/PendingChangeDialog.tsx src/renderer/src/pages/chat/ChatPage.tsx src/renderer/src/pages/chapters/ChaptersPage.tsx
git commit -m "feat: add bounded agent retrieval and confirmed writes"
```

### Task 8: Windows 优先集成与回归

**Files:**
- Modify: `src/renderer/src/layouts/AppLayout.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/styles/index.css`
- Create: `docs/windows-writing-workflow.md`
- Test: `src/renderer/src/platform/__tests__/platformApi.test.ts`

- [ ] **Step 1: 验证所有 API 面在 Electron 中可用**

运行：

```powershell
npx tsc -b --pretty false
npm test -- --run
npm run build
```

Expected: TypeScript、Vitest 和 Electron 构建全部通过；新增 `StoryFabricApi` 方法在 Electron IPC、preload 和 renderer 调用链上均可用。

- [ ] **Step 2: 运行 Windows 开发窗口冒烟**

`npm run dev` 后逐项记录：新建工作区 → 创建卷 → 创建草稿 → 移入正文箱 → 编辑章节并添加术语 → 创建章纲/总纲 → 创建主要/次要角色 → 创建背景/其他设定 → 创建便签 → Agent 查询陌生名词 → Agent 修改章节并确认 diff → 删除/恢复 → 重启应用。

- [ ] **Step 3: 加入上下文预算可观测性**

Agent 工具卡片显示 `get_chapter_context` 的目标章、邻接章数量和返回字符数；`lookup_term` 显示命中实体数。日志不得打印 API Key、完整会话或完整正文。

- [ ] **Step 4: 写 Windows 操作说明并提交**

`docs/windows-writing-workflow.md` 记录上述手动验收路径、失败时查看的日志位置和工作区数据布局，不记录任何真实 API Key 或用户小说正文。

```bash
git add src/renderer/src/layouts/AppLayout.tsx src/renderer/src/App.tsx src/renderer/src/styles/index.css docs/windows-writing-workflow.md src/renderer/src/platform/__tests__/platformApi.test.ts
git commit -m "test: validate Windows writing workflow"
```

### Task 9: 清理仓库构建产物并锁定多端边界

**Files:**
- Modify: `.gitignore`
- Create: `scripts/clean-build-artifacts.ps1`
- Modify: `README.md`
- Modify: `docs/platform-release.md`
- Modify: `docs/android-handoff.md`

- [ ] **Step 1: 固定仓库清理范围**

脚本只接受当前仓库根目录，并只删除明确目录：`out`、`release`、`android/app/build`、`android/build`、`android/.gradle`；不接收任意用户输入路径，不删除工作区目录。`.gitignore` 同步忽略这些目录和仓库内的 `*.tmp`；用户工作区的 `.storyfabric/index.json` 由工作区清理策略管理，不依赖仓库 `.gitignore`。

- [ ] **Step 2: 区分工作区清理与仓库清理**

README 和 Windows 文档明确：工作区只由 `housekeeping.ts` 清理已知临时文件；构建目录由 `scripts/clean-build-artifacts.ps1` 清理；不使用 `git clean -fdx`，不删除用户资料和会话。

- [ ] **Step 3: 保持 Android API 对齐但不产出**

为 Android `platformApi.ts` 补齐新增方法和类型编译路径，但本阶段只运行 `npx tsc -b --pretty false` 检查共享接口，不执行 `mobile:build`、`mobile:sync`、Gradle、ADB 或 APK 安装。Android 恢复条件继续以 `docs/android-handoff.md` 为准。

- [ ] **Step 4: 运行清理脚本和最终静态检查**

```powershell
pwsh -NoProfile -File scripts/clean-build-artifacts.ps1
npx tsc -b --pretty false
npm test -- --run
npm run build
git diff --check
```

Expected: 只清理仓库内列出的构建目录；测试和 Windows 构建通过；工作区内容不受影响。

- [ ] **Step 5: 提交文档和清理脚本**

```bash
git add .gitignore scripts/clean-build-artifacts.ps1 README.md docs/platform-release.md docs/android-handoff.md
git commit -m "chore: document Windows-first multi-platform boundaries"
```

## Windows 验收门槛

在宣布本轮功能可用前，以下结果必须全部具备：

- `npx tsc -b --pretty false` 通过。
- `npm test -- --run` 通过，包含迁移、回收站、章节树、分类实体、检索预算和 Agent 确认测试。
- `npm run build` 通过，Electron 启动后无控制台异常。
- 章节树能在三类资料箱之间创建、移动、删除、恢复，重启后顺序和分类一致。
- 总纲、章纲、主要/次要角色、背景/其他设定、便签均能编辑和持久化。
- Agent 不会默认读取整本小说；章节编辑会先读取前后两章；陌生名词会查设定/大纲/章节标注。
- Agent 的新增、更新、移动、恢复操作都显示 diff 并等待确认；拒绝不会写盘；永久删除只能由回收站 UI 完成。
- 工作区没有构建文件、API Key 或无主临时文件；仓库构建目录可由清理脚本安全移除。

## 暂不纳入本轮

- Android 真机 UI 适配、APK/AAB 产出、签名、安装和发布。
- 云同步、多人协作、远程 MCP server、向量数据库和后台索引服务。
- 章节版本快照和冲突合并。当前先沿用现有外部修改提示，待 Windows 工作流稳定后单独立项。
