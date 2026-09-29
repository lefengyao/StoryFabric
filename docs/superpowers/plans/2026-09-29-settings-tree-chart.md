# 设定横向树状图与图片导出 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在设定页面增加可编辑父子关系、横向树状图和跨桌面/Android 的 PNG 导出。

**Architecture:** 在现有 `SettingDoc` front matter 中保存可选 `parentId`，实体层负责关系校验，渲染层用纯函数生成稳定树布局和 SVG，再复用现有 Capacitor/浏览器文件分享链路生成 PNG。设定页面保留当前列表和 Markdown 编辑流程，通过列表/图表切换进入 React Flow 画布。

**Tech Stack:** TypeScript、React 19、`@xyflow/react`、Vitest、Capacitor Filesystem/Share、原生 SVG/Canvas。

---

## 文件地图

- Modify: `src/shared/types.ts`，给 `SettingDoc` 和 `SettingMeta` 增加可选 `parentId`。
- Modify: `src/core/workspace/entityStore.ts`，规范化和校验设定父级，保存到 front matter。
- Test: `src/core/workspace/__tests__/writingStructure.test.ts`，覆盖父级保存、清空、循环和孤儿。
- Create: `src/renderer/src/lib/settingsTree.ts`，构建树、稳定排序、横向布局和异常保护。
- Create: `src/renderer/src/lib/settingsTree.test.ts`，测试树逻辑和父级选项。
- Create: `src/renderer/src/lib/settingsTreeImage.ts`，生成 SVG 和 PNG 文件。
- Create: `src/renderer/src/lib/settingsTreeImage.test.ts`，测试 XML 转义、尺寸和节点边。
- Create: `src/renderer/src/lib/shareFiles.ts`，抽取通用图片分享/下载函数。
- Modify: `src/renderer/src/lib/chapterLongImage.ts`，改用通用分享函数并保留原 API。
- Create: `src/renderer/src/lib/shareFiles.test.ts`，覆盖浏览器下载分支和分享结果。
- Modify: `src/renderer/src/pages/settingsDocs/SettingsDocsPage.tsx`，加入父级选择、列表/图表切换、React Flow 和导出按钮。
- Modify: `src/renderer/src/styles/index.css`，只增加设定节点需要的稳定尺寸/移动端画布样式。

## Task 1: 添加设定父级字段与实体层校验

**Files:**
- Modify: `src/shared/types.ts:145-153`
- Modify: `src/core/workspace/entityStore.ts:313-360`
- Test: `src/core/workspace/__tests__/writingStructure.test.ts`

- [ ] **Step 1: 写失败测试，证明父级会保存、清空并拒绝循环。**

在 `writing structure` 测试中加入以下行为测试：创建根设定 `世界观`，创建 `地理` 指向根，读取后检查 `parentId`；再次传入 `parentId: ''` 应清空；创建 `人物` 指向 `地理` 后，把 `世界观` 指向 `人物` 应抛出包含“循环”的错误，且根设定仍无父级。

```ts
it('persists setting parents and rejects cycles', async () => {
  const store = new MemoryFileStore()
  await initializeWorkspace(store, '测试')
  const root = await saveSetting(store, { title: '世界观', content: '' })
  const child = await saveSetting(store, { title: '地理', parentId: root.id, content: '' })
  expect((await getSetting(store, child.id))?.parentId).toBe(root.id)
  await saveSetting(store, { id: child.id, parentId: '', content: '' })
  expect((await getSetting(store, child.id))?.parentId).toBeUndefined()
  const nested = await saveSetting(store, { title: '人物', parentId: root.id, content: '' })
  await expect(saveSetting(store, { id: root.id, parentId: nested.id })).rejects.toThrow('循环')
  expect((await getSetting(store, root.id))?.parentId).toBeUndefined()
})
```

- [ ] **Step 2: 运行测试确认它因字段未实现而失败。**

Run: `npx vitest run src/core/workspace/__tests__/writingStructure.test.ts`

Expected: the new test fails because `SettingDoc` does not yet expose or validate `parentId`.

- [ ] **Step 3: 实现字段规范化和循环校验。**

在 `SettingDoc` 增加 `parentId?: string`。在 `entityStore.ts` 增加只接受非空字符串的 `settingParentId` 规范化函数和 `validateSettingParent(all, id, parentId)`：父级为空时返回；父级等于自身时抛错；沿 `parentId` 向上遍历，重复节点时抛出“设定父级关系存在循环”；缺失目标不抛错，交给图表层按孤儿根节点处理。保存时用 `parentId: ''` 清空；新旧实体都在写盘前校验。序列化只在有值时写 `parentId`，避免旧文件出现空字段。

```ts
export interface SettingDoc {
  id: string
  title: string
  category: SettingCategory
  tags: string[]
  parentId?: string
  content: string
}
```

- [ ] **Step 4: 运行测试确认父级场景全部通过。**

Run: `npx vitest run src/core/workspace/__tests__/writingStructure.test.ts`

Expected: all tests pass, including the new parent persistence and cycle test.

- [ ] **Step 5: 提交实体层改动。**

```bash
git add src/shared/types.ts src/core/workspace/entityStore.ts src/core/workspace/__tests__/writingStructure.test.ts
git commit -m "feat: add setting parent relationships"
```

## Task 2: 实现稳定树构建、横向布局和父级选项

**Files:**
- Create: `src/renderer/src/lib/settingsTree.ts`
- Test: `src/renderer/src/lib/settingsTree.test.ts`

- [ ] **Step 1: 写失败测试，锁定树布局和异常行为。**

测试三个节点 `世界观 -> 地理 -> 港口` 与根 `人物`：检查深度分别为 0/1/2，x 坐标严格递增，同级按标题排序；孤儿成为根并带 warning；手工构造循环时构建不会递归溢出并带 warning；`availableParentIds` 排除当前节点和所有后代。

```ts
it('lays out settings from left to right with stable sibling order', () => {
  const graph = buildSettingsTree([
    { id: 'b', title: '人物', category: 'other', tags: [], parentId: undefined },
    { id: 'c', title: '港口', category: 'background', tags: [], parentId: 'a' },
    { id: 'a', title: '地理', category: 'background', tags: [], parentId: 'r' },
    { id: 'r', title: '世界观', category: 'background', tags: [] }
  ])
  expect(graph.nodes.find((node) => node.id === 'r')?.position.x).toBeLessThan(graph.nodes.find((node) => node.id === 'a')!.position.x)
  expect(graph.nodes.find((node) => node.id === 'a')?.position.x).toBeLessThan(graph.nodes.find((node) => node.id === 'c')!.position.x)
  expect(graph.edges).toEqual([{ id: 'setting:r:a', source: 'r', target: 'a' }, { id: 'setting:a:c', source: 'a', target: 'c' }])
})

it('promotes orphan and cyclic settings to safe roots', () => {
  const graph = buildSettingsTree([
    { id: 'a', title: '甲', category: 'background', tags: [], parentId: 'b' },
    { id: 'b', title: '乙', category: 'background', tags: [], parentId: 'a' },
    { id: 'c', title: '丙', category: 'other', tags: [], parentId: 'missing' }
  ])
  expect(graph.warnings).toHaveLength(2)
  expect(graph.nodes).toHaveLength(3)
})

it('excludes a setting and its descendants from parent choices', () => {
  expect(availableParentIds(items, 'a')).toEqual(['b'])
})
```

- [ ] **Step 2: 运行测试确认它因 helper 尚不存在而失败。**

Run: `npx vitest run src/renderer/src/lib/settingsTree.test.ts`

Expected: module or exported function failures.

- [ ] **Step 3: 实现 `buildSettingsTree` 和父级候选计算。**

定义稳定常量 `SETTING_NODE_WIDTH = 224`、`SETTING_NODE_HEIGHT = 92`、`SETTING_LEVEL_GAP = 292`、`SETTING_ROW_GAP = 132`。先按 `title.localeCompare(..., 'zh-CN')`、id 排序，建立 `childrenByParent`；不存在的 parentId 进入 roots 和 warnings。用深度优先分配叶子行，再让父节点取子树 y 均值，保证横向展开且不重叠。遍历时维护当前路径，遇到循环就移除当前边、把节点放入 roots 并增加 warning。导出 `availableParentIds(items, currentId)`，从 currentId 遍历子孙后排除集合。

- [ ] **Step 4: 运行树逻辑测试确认通过。**

Run: `npx vitest run src/renderer/src/lib/settingsTree.test.ts`

Expected: all tree layout, warning, ordering and parent choice assertions pass.

- [ ] **Step 5: 提交树逻辑。**

```bash
git add src/renderer/src/lib/settingsTree.ts src/renderer/src/lib/settingsTree.test.ts
git commit -m "feat: add deterministic settings tree layout"
```

## Task 3: 生成完整树 SVG/PNG 并复用跨平台分享

**Files:**
- Create: `src/renderer/src/lib/settingsTreeImage.ts`
- Test: `src/renderer/src/lib/settingsTreeImage.test.ts`
- Create: `src/renderer/src/lib/shareFiles.ts`
- Modify: `src/renderer/src/lib/chapterLongImage.ts`
- Test: `src/renderer/src/lib/shareFiles.test.ts`

- [ ] **Step 1: 写失败测试，锁定 SVG 输出和分享 API。**

对含 `&`、`<`、`>` 的标题生成 SVG，断言文本已 XML 转义、所有节点和边存在、宽高覆盖布局 bounds；空树返回固定最小尺寸并不抛错。分享函数在 `navigator.canShare` 为 false 时创建一个 `a[download]`，返回 `downloaded`；当原生平台适配器返回成功时返回 `shared`。

- [ ] **Step 2: 运行测试确认导出模块尚未实现。**

Run: `npx vitest run src/renderer/src/lib/settingsTreeImage.test.ts src/renderer/src/lib/shareFiles.test.ts`

Expected: missing module/function failures.

- [ ] **Step 3: 实现 SVG 序列化和 PNG 栅格化。**

`settingsTreeSvg(graph)` 使用纯 SVG `<path>` 绘制从父节点右侧到子节点左侧的折线，节点使用固定圆角矩形和 `<text>`，所有动态文本通过 XML escape。`settingsTreePngFile(graph, name)` 创建 Blob URL、`Image`、Canvas，按 SVG 自带宽高绘制，返回 `File([blob], name, { type: 'image/png' })`；Canvas 或 Image 失败时抛出中文错误。

```ts
export function settingsTreeSvg(graph: SettingsTreeGraph): { svg: string; width: number; height: number }
export async function settingsTreePngFile(graph: SettingsTreeGraph, fileName: string): Promise<File>
```

- [ ] **Step 4: 抽取通用文件分享函数。**

实现 `shareFiles(files, title, dialogTitle)`：原生平台写入 Capacitor Cache 后调用 `Share.share`；浏览器支持文件分享时调用 `navigator.share`；否则逐文件用 object URL 和 `a.download` 下载。修改 `shareChapterImages` 只传入章节标题，保持原调用方和行为不变。动态导入 Capacitor，保证 Vitest 和桌面浏览器构建不需要原生运行时。

- [ ] **Step 5: 运行导出和分享测试确认通过。**

Run: `npx vitest run src/renderer/src/lib/settingsTreeImage.test.ts src/renderer/src/lib/shareFiles.test.ts`

Expected: SVG/PNG and existing chapter sharing tests pass.

- [ ] **Step 6: 提交导出能力。**

```bash
git add src/renderer/src/lib/settingsTreeImage.ts src/renderer/src/lib/settingsTreeImage.test.ts src/renderer/src/lib/shareFiles.ts src/renderer/src/lib/shareFiles.test.ts src/renderer/src/lib/chapterLongImage.ts
git commit -m "feat: export settings tree images"
```

## Task 4: 接入设定页面交互

**Files:**
- Modify: `src/renderer/src/pages/settingsDocs/SettingsDocsPage.tsx`
- Modify: `src/renderer/src/styles/index.css`

- [ ] **Step 1: 在接线前复跑树 view-model 测试。**

运行 `settingsTree.test.ts`，确认当前节点/后代排除和图表节点数据断言已经覆盖页面依赖的纯逻辑；页面接线只消费这些经过测试的结果，不在组件中重新实现树遍历。

- [ ] **Step 2: 增加列表/图表状态和图表节点组件。**

在 `SettingsDocsPage` 增加 `view: 'list' | 'tree'`、`exporting`、`graphError` 状态；用 `buildSettingsTree(items)` 生成 nodes/edges，使用现有 `ReactFlow`, `Background`, `Controls`, `useNodesState`, `useEdgesState`。树节点通过左右 Handle 呈现标题、分类和标签数；点击节点调用现有 `open`。

- [ ] **Step 3: 在顶部工具栏加入切换和导出按钮。**

在页面顶部增加两个图标+文字按钮，列表/图表切换使用 `List` / `GitBranch` 图标；图表模式显示 `Download` 导出按钮。导出处理为：`settingsTreeSvg` → `settingsTreePngFile` → `shareFiles([file], '设定图谱', '分享设定图谱')`，异常写入 `graphError`，空图禁用。

- [ ] **Step 4: 在编辑区加入父级选择器。**

使用 `availableParentIds(items, draft.id)` 过滤选项，第一项为“根节点”，选择根节点写入 `parentId: ''`，其他项写入对应 id。保存时将编辑草稿传给现有 `api.saveSetting`；实体层再次校验。创建新设定时默认根节点。

- [ ] **Step 5: 增加移动端画布尺寸和错误提示样式。**

给图表外层设置 `min-width`、`min-height` 和 `overflow: auto`，保证节点拖动不会改变工具栏布局；错误使用现有 danger token；空树显示 `EmptyState`。不改变现有列表和 Markdown 编辑器样式。

- [ ] **Step 6: 运行页面相关测试、类型检查和构建。**

Run: `npx vitest run src/renderer/src/lib/settingsTree.test.ts src/renderer/src/lib/settingsTreeImage.test.ts src/core/workspace/__tests__/writingStructure.test.ts`

Run: `npx tsc -b --pretty false`

Run: `npm run build`

Expected: all targeted tests pass, TypeScript exits 0, and Electron Vite build exits 0.

- [ ] **Step 7: 提交页面接入。**

```bash
git add src/renderer/src/pages/settingsDocs/SettingsDocsPage.tsx src/renderer/src/styles/index.css src/renderer/src/lib/settingsTree.test.ts
git commit -m "feat: add settings tree view"
```

## Task 5: 全量验证与交付检查

**Files:**
- Verify: all changed files and generated build output

- [ ] **Step 1: 运行全量测试。**

Run: `npm test`

Expected: zero failed tests; record the exact test file and assertion counts.

- [ ] **Step 2: 检查工作区差异和格式。**

Run: `git diff --check` and `git status --short`.

Expected: no whitespace errors; only the intended feature files are changed in addition to pre-existing user changes.

- [ ] **Step 3: 做一次手动桌面检查。**

Run: `npm run dev` and open “设定”：创建根设定和子设定，确认图表从左向右显示；切换列表后编辑父级，再回到图表确认边更新；点击导出确认下载 PNG；重启开发进程后确认父级仍存在。

- [ ] **Step 4: 汇总交付信息。**

报告新增字段、图表交互、导出平台、验证命令和任何无法在当前环境验证的 Android 原生行为。不要把 API Key 或本机设置内容写入日志或报告。
