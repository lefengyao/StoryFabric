# 跨平台工作区打开与导入统一实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Electron、网页和 Android 的“打开工作区”入口中统一支持打开已有目录、粘贴受控路径和导入压缩包新建工作区，并验证整个流程。

**Architecture:** 保留列表打开的现有不透明工作区 ID 语义，新增 `openWorkspaceByPath(path)` 作为显式的路径打开能力。服务器在托管根目录内把真实路径解析为不透明 ID；本地平台直接使用各自的目录校验；所有压缩包导入继续复用既有原子导入服务。欢迎页提供统一弹窗，平台 API 只负责文件和目录能力，页面不直接处理解压或服务器文件系统。

**Tech Stack:** TypeScript、React、Electron IPC/preload、Node `fs/promises`、Node HTTP、Capacitor Filesystem、Vitest、现有 workspace archive/registry 服务。

---

## 文件范围与职责

### 修改

- `src/shared/api.ts`：声明跨平台 `openWorkspaceByPath`，更新路径和导入目标注释。
- `src/shared/ipc.ts`：增加 Electron 路径打开 IPC 通道。
- `src/preload/index.ts`：暴露路径打开方法。
- `src/main/ipc.ts`：将路径打开 IPC 接到现有本地工作区打开和校验逻辑。
- `src/server/workspaceRegistry.ts`：保存受控相对目录，按服务器路径查找或登记合法工作区。
- `src/server/server.ts`：增加 `POST /api/workspaces/open-path`。
- `src/renderer/src/platform/httpApi.ts`：发送服务器路径打开请求。
- `src/renderer/src/platform/androidApi.ts`：限制应用私有工作区路径并实现路径打开。
- `src/renderer/src/pages/welcome/WelcomePage.tsx`：统一打开/导入弹窗和跨平台行为。
- `src/renderer/src/layouts/AppLayout.tsx`：复用压缩包文件读取规则，保持应用内导入与欢迎页一致。
- `src/renderer/src/platform/__tests__/httpApi.test.ts`：覆盖 HTTP 路径打开请求。
- `src/server/__tests__/workspaceRegistry.test.ts`：覆盖路径校验、登记和旧注册表兼容。
- `src/server/__tests__/server.test.ts`：覆盖路径打开 HTTP 端点。

### 新建

- `src/renderer/src/lib/workspaceArchiveFile.ts`：集中压缩包文件名校验和 `File` 到 `Uint8Array` 的读取。
- `src/renderer/src/lib/__tests__/workspaceArchiveFile.test.ts`：覆盖压缩包筛选和读取行为。

---

### Task 1: 先锁定平台 API 和压缩包文件读取契约

**Files:**
- Modify: `src/shared/api.ts`
- Modify: `src/shared/ipc.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/main/ipc.ts`
- Create: `src/renderer/src/lib/workspaceArchiveFile.ts`
- Create: `src/renderer/src/lib/__tests__/workspaceArchiveFile.test.ts`

- [ ] **Step 1: 写压缩包读取工具的失败测试**

在 `src/renderer/src/lib/__tests__/workspaceArchiveFile.test.ts` 添加以下行为测试：文件名大小写为 `.storyfabric.zip` 时接受；普通 `.zip` 和文本文件名拒绝；接受的文件读取后返回与 `arrayBuffer()` 相同的 `Uint8Array`。

```ts
import { describe, expect, it } from 'vitest'
import { isWorkspaceArchiveFile, readWorkspaceArchiveFile } from '../workspaceArchiveFile'

describe('workspaceArchiveFile', () => {
  it('只接受 StoryFabric 工作区压缩包', () => {
    expect(isWorkspaceArchiveFile(new File(['x'], 'demo.storyfabric.zip'))).toBe(true)
    expect(isWorkspaceArchiveFile(new File(['x'], 'DEMO.STORYFABRIC.ZIP'))).toBe(true)
    expect(isWorkspaceArchiveFile(new File(['x'], 'demo.zip'))).toBe(false)
  })

  it('读取压缩包字节', async () => {
    await expect(readWorkspaceArchiveFile(new File(['abc'], 'demo.storyfabric.zip'))).resolves.toEqual(new Uint8Array([97, 98, 99]))
  })
})
```

- [ ] **Step 2: 运行新测试并确认它因工具不存在而失败**

运行：`npx vitest run src/renderer/src/lib/__tests__/workspaceArchiveFile.test.ts`

预期：FAIL，提示 `workspaceArchiveFile` 模块或导出不存在。

- [ ] **Step 3: 实现最小压缩包读取工具**

创建 `src/renderer/src/lib/workspaceArchiveFile.ts`：

```ts
export const WORKSPACE_ARCHIVE_ACCEPT = '.storyfabric.zip,application/zip'

export function isWorkspaceArchiveFile(file: File): boolean {
  return file.name.toLowerCase().endsWith('.storyfabric.zip')
}

export async function readWorkspaceArchiveFile(file: File): Promise<Uint8Array> {
  if (!isWorkspaceArchiveFile(file)) throw new Error('请选择 .storyfabric.zip 工作区压缩包')
  return new Uint8Array(await file.arrayBuffer())
}
```

- [ ] **Step 4: 运行工具测试并确认通过**

运行：`npx vitest run src/renderer/src/lib/__tests__/workspaceArchiveFile.test.ts`

预期：2 个测试通过。

- [ ] **Step 5: 扩展共享平台 API 和 Electron IPC 契约**

在 `StoryFabricApi` 的工作区区域加入：

```ts
openWorkspaceByPath(path: string): Promise<WorkspaceSummary>
```

在 `IPC` 枚举中加入 `OpenWorkspaceByPath`，并在 preload 暴露：

```ts
openWorkspaceByPath: (path) => ipcRenderer.invoke(IPC.OpenWorkspaceByPath, path),
```

在 `src/main/ipc.ts` 注册：

```ts
ipcMain.handle(IPC.OpenWorkspaceByPath, async (_event, path: string) => {
  const value = path.trim()
  if (!value) throw new Error('请输入工作区路径')
  const valid = await validateWorkspace(value)
  if (!valid.ok) throw new Error(valid.reason)
  currentRoot = value
  await recentPush(ctx.settings, value)
  return loadSummary(value)
})
```

`openWorkspace` 保持原有列表和已有调用方语义；新增方法只承接用户输入或系统选择器返回的路径。

- [ ] **Step 6: 运行类型检查，确认契约变更列出未实现的平台适配器**

运行：`npx tsc --noEmit -p tsconfig.json`

预期：若 Android/HTTP 适配器尚未添加方法，TypeScript 明确列出实现类缺少 `openWorkspaceByPath`；不得忽略该错误，下一任务补齐。

- [ ] **Step 7: 提交平台契约和读取工具**

```bash
git add src/shared/api.ts src/shared/ipc.ts src/preload/index.ts src/main/ipc.ts src/renderer/src/lib/workspaceArchiveFile.ts src/renderer/src/lib/__tests__/workspaceArchiveFile.test.ts
git commit -m "feat: define workspace path open contract"
```

### Task 2: 实现服务器工作区路径解析与安全登记

**Files:**
- Modify: `src/server/workspaceRegistry.ts`
- Test: `src/server/__tests__/workspaceRegistry.test.ts`

- [ ] **Step 1: 写路径打开失败和成功测试**

在现有 registry 测试中覆盖：

1. 已登记目录的绝对路径返回其原有不透明 ID。
2. 托管根目录内、存在 `storyfabric.json` 但未登记的目录被登记并打开，原目录位置和内容保持不变。
3. 托管根目录本身、根目录外、`..` 穿越、普通文件、损坏目录均抛出可读错误。
4. 旧注册表没有 `directory` 字段时仍能读取，默认目录位置为记录 ID。
5. 通过目录符号链接逃出托管根目录时拒绝。

测试目录构造使用现有 `makeTempDir`/`initializeWorkspace` 风格；未登记目录名使用 `from-disk`，确认返回的摘要 `path` 匹配 `^ws_[a-z0-9]{12}$` 且不是实际目录名。

- [ ] **Step 2: 运行 registry 测试确认新增测试失败**

运行：`npx vitest run src/server/__tests__/workspaceRegistry.test.ts`

预期：新增的 `openPath` 测试因方法不存在或路径登记逻辑不存在而失败，现有测试保持通过。

- [ ] **Step 3: 扩展注册表记录并集中解析目录**

将记录类型扩展为：

```ts
interface WorkspaceRecord {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  directory?: string
}
```

增加两个内部函数：

```ts
private directoryOf(record: WorkspaceRecord): string {
  const directory = record.directory?.trim() || record.id
  const root = resolve(this.managedRoot, directory)
  if (!isWithin(this.managedRoot, root)) throw new Error('工作区目录越界')
  return root
}

private rootOf(record: WorkspaceRecord): string {
  return this.directoryOf(record)
}
```

将 `list`、`summary`、`getStore`、`create`、`importArchive` 和旧工作区迁移中的目录解析统一改为使用记录目录；加载注册表时要求 `directory`（若存在）是非空相对路径，并拒绝绝对路径、`..` 越界和重复目录。

- [ ] **Step 4: 实现 `openPath` 的真实路径边界检查**

在 `WorkspaceRegistry` 中加入：

```ts
async openPath(input: string): Promise<WorkspaceSummary> {
  await this.ensureReady()
  return this.mutate(async () => {
    const requested = resolve(input.trim())
    const managed = await fs.realpath(this.managedRoot)
    const target = await fs.realpath(requested).catch(() => { throw new Error('工作区路径不存在') })
    if (!isWithin(managed, target)) throw new Error('工作区路径必须位于服务器工作区目录内')
    const stat = await fs.stat(target)
    if (!stat.isDirectory()) throw new Error('工作区路径必须是文件夹')
    const valid = await validateWorkspace(new NodeFileStore(target))
    if (!valid.ok) throw new Error(valid.reason)

    const existing = this.records.find((record) => this.rootOf(record) === target)
    if (existing) return loadSummary(new NodeFileStore(target), existing.name, existing.id)

    const id = `ws_${randomUUID().replace(/-/g, '').slice(0, 12)}`
    const relativeDirectory = relative(this.managedRoot, target)
    const summary = await loadSummary(new NodeFileStore(target), basename(target), id)
    const now = Date.now()
    this.records.push({ id, name: summary.name, directory: relativeDirectory, createdAt: now, updatedAt: now })
    try {
      await this.saveRecords()
    } catch (error) {
      this.records = this.records.filter((record) => record.id !== id)
      throw error
    }
    return loadSummary(new NodeFileStore(target), summary.name, id)
  })
}
```

在实际实现中保留 `target !== managed` 的检查，使用 `isWithin` 的非空相对路径语义，并确保保存失败只回滚内存注册表而不删除用户目录。

- [ ] **Step 5: 运行 registry 全量测试**

运行：`npx vitest run src/server/__tests__/workspaceRegistry.test.ts`

预期：原有测试和新增路径打开测试全部通过。

- [ ] **Step 6: 提交服务器注册表能力**

```bash
git add src/server/workspaceRegistry.ts src/server/__tests__/workspaceRegistry.test.ts
git commit -m "feat: open managed workspace by server path"
```

### Task 3: 接入 HTTP 端点和各平台 API 适配器

**Files:**
- Modify: `src/server/server.ts`
- Modify: `src/server/__tests__/server.test.ts`
- Modify: `src/renderer/src/platform/httpApi.ts`
- Modify: `src/renderer/src/platform/androidApi.ts`
- Modify: `src/renderer/src/platform/__tests__/httpApi.test.ts`

- [ ] **Step 1: 写 HTTP 客户端请求测试**

在 `httpApi.test.ts` 添加：

```ts
it('opens a workspace by server path', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const api = new HttpPlatformApi(async (url, init) => {
    calls.push({ url: String(url), init })
    return new Response(JSON.stringify({ name: 'Demo', path: 'ws_demo123456789', chapters: [], characters: [], relationships: [], outline: [], events: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
  }, 'https://server.test', { kind: 'bearer', token: 'token' })

  await api.openWorkspaceByPath('/srv/storyfabric/workspaces/demo')
  expect(calls[0].url).toBe('https://server.test/api/workspaces/open-path')
  expect(JSON.parse(String(calls[0].init?.body))).toEqual({ path: '/srv/storyfabric/workspaces/demo' })
})
```

- [ ] **Step 2: 写服务端 HTTP 路由测试**

在 `server.test.ts` 登录后 POST `/api/workspaces/open-path`，分别断言合法路径返回 200 和摘要、根目录外路径返回 400/404，且后续 RPC 使用该会话读取刚打开的工作区。

- [ ] **Step 3: 运行新增客户端和服务端测试确认失败**

运行：`npx vitest run src/renderer/src/platform/__tests__/httpApi.test.ts src/server/__tests__/server.test.ts`

预期：客户端方法和服务端端点相关测试失败，既有列表打开和导入测试通过。

- [ ] **Step 4: 实现 HTTP 客户端方法**

在 `HttpPlatformApi` 中加入：

```ts
openWorkspaceByPath(path: string): Promise<WorkspaceSummary> {
  const value = path.trim()
  if (!value) return Promise.reject(new Error('请输入工作区路径'))
  return this.rest('/api/workspaces/open-path', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: value })
  })
}
```

继续让 `openWorkspace(path)` 调用 `/api/workspaces/:id/open`，确保列表项和粘贴路径不混淆。

- [ ] **Step 5: 实现服务端 HTTP 路由**

在认证后的 `/api/workspaces` 路由区域、动态 `/:id` 路由之前加入：

```ts
if (pathname === '/api/workspaces/open-path' && req.method === 'POST') {
  try {
    const body = JSON.parse(await readBody(req)) as { path?: string }
    const summary = await registry.openPath(String(body.path ?? ''))
    authSessions.setWorkspace(context.token, summary.path)
    sendJson(res, 200, summary)
  } catch (error) {
    sendError(res, 400, error)
  }
  return
}
```

- [ ] **Step 6: 实现 Android 私有路径打开**

在 `androidApi.ts` 增加内部规范化函数，拒绝绝对路径、反斜杠、空段、`.`、`..` 和 `workspaces` 根本身，只允许 `workspaces/<workspace>` 形式：

```ts
function normalizeAndroidWorkspacePath(input: string): string {
  const value = input.trim().replaceAll('\\', '/')
  const parts = value.split('/').filter(Boolean)
  if (parts.length !== 2 || parts[0] !== WORKSPACE_PREFIX || parts[1] === '.' || parts[1] === '..') {
    throw new Error('Android 工作区路径必须位于应用内部 workspaces 目录下')
  }
  return `${WORKSPACE_PREFIX}/${parts[1]}`
}
```

`openWorkspaceByPath` 调用该函数后复用现有 `openWorkspace`；列表项的 `openWorkspace` 仍可直接使用已经生成的内部路径。

- [ ] **Step 7: 运行客户端、服务端和类型测试**

运行：`npx vitest run src/renderer/src/platform/__tests__/httpApi.test.ts src/server/__tests__/server.test.ts src/server/__tests__/workspaceRegistry.test.ts`，预期全部通过；再运行 `npx tsc --noEmit -p tsconfig.json`，预期无平台 API 缺失错误。

- [ ] **Step 8: 提交 API 适配器和服务端端点**

```bash
git add src/server/server.ts src/server/__tests__/server.test.ts src/renderer/src/platform/httpApi.ts src/renderer/src/platform/androidApi.ts src/renderer/src/platform/__tests__/httpApi.test.ts
git commit -m "feat: expose workspace path open over all platforms"
```

### Task 4: 重做欢迎页工作区弹窗

**Files:**
- Modify: `src/renderer/src/pages/welcome/WelcomePage.tsx`
- Modify: `src/renderer/src/layouts/AppLayout.tsx`
- Modify: `src/renderer/src/lib/workspaceArchiveFile.ts`

- [ ] **Step 1: 将欢迎页打开入口统一为弹窗入口**

把当前桌面本地的直接 `doOpen()` 分支改为加载工作区列表后打开同一弹窗；保留远程登录流程、Android 列表流程和网页列表流程。列表项继续调用 `open(item.path)`，路径输入调用新增的 `getPlatformApi().openWorkspaceByPath(path)`。

- [ ] **Step 2: 增加弹窗状态和文件输入引用**

在 `WelcomePage` 增加这些状态：

```ts
const [workspaceMode, setWorkspaceMode] = useState<'open' | 'import'>('open')
const [workspacePath, setWorkspacePath] = useState('')
const [archiveName, setArchiveName] = useState('')
const archiveInput = useRef<HTMLInputElement>(null)
```

增加路径打开处理：

```ts
const openTypedWorkspace = async (): Promise<void> => {
  const path = workspacePath.trim()
  if (!path) return
  setBusy(true)
  try {
    await getPlatformApi().openWorkspaceByPath(path)
    setWorkspaceOpen(false)
  } catch (err) {
    useWorkspace.setState({ error: err instanceof Error ? err.message : String(err) })
  } finally {
    setBusy(false)
  }
}
```

- [ ] **Step 3: 增加平台化文件夹浏览和压缩包导入处理**

文件夹浏览只在 Electron 本地且非 Android 时显示：调用 `api.pickFolder()` 并把结果放入 `workspacePath`，不直接打开。

压缩包处理必须先调用 `readWorkspaceArchiveFile(file)`，再按平台选择导入目标：

```ts
const importSelectedArchive = async (file: File): Promise<void> => {
  setBusy(true)
  try {
    const bytes = await readWorkspaceArchiveFile(file)
    let target: import('../../../../shared/api').WorkspaceImportTarget | undefined = { name: archiveName.trim() || undefined }
    if (mode === 'local' && !isAndroid) {
      const parentDir = await api.pickFolder()
      if (!parentDir) throw new Error('请选择导入工作区的目标文件夹')
      target = { parentDir, name: archiveName.trim() || undefined }
    }
    await useWorkspace.getState().importArchive(bytes, file.name, target)
    setWorkspaceOpen(false)
    setArchiveName('')
  } catch (err) {
    useWorkspace.setState({ error: err instanceof Error ? err.message : String(err) })
  } finally {
    setBusy(false)
    if (archiveInput.current) archiveInput.current.value = ''
  }
}
```

实现时必须只调用一次 `api.pickFolder()`，先保存结果到 `parentDir`，不得重复弹出系统选择器。

- [ ] **Step 4: 实现弹窗布局和明确文案**

将现有只显示列表的 Modal 改为：

```tsx
<Modal open={workspaceOpen} onOpenChange={setWorkspaceOpen} title="打开工作区" description="打开已有文件夹，或导入压缩包新建工作区">
  <div className="grid grid-cols-2 rounded-lg border border-line p-1 text-sm">
    <button type="button" onClick={() => setWorkspaceMode('open')}>打开已有文件夹</button>
    <button type="button" onClick={() => setWorkspaceMode('import')}>导入压缩包</button>
  </div>
  {workspaceMode === 'open' ? (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input value={workspacePath} onChange={(event) => setWorkspacePath(event.target.value)} placeholder="粘贴项目路径…" />
        {!isWeb && !isAndroid && <Button onClick={() => void browseWorkspaceFolder()}>浏览文件夹</Button>}
      </div>
      <Button variant="primary" onClick={() => void openTypedWorkspace()} disabled={!workspacePath.trim()} loading={busy}>打开路径</Button>
      {/* 下面保留现有工作区列表 */}
    </div>
  ) : (
    <div className="space-y-3">
      <Input value={archiveName} onChange={(event) => setArchiveName(event.target.value)} placeholder="新工作区名称（可选）" />
      <input ref={archiveInput} type="file" accept={WORKSPACE_ARCHIVE_ACCEPT} className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importSelectedArchive(file) }} />
      <Button variant="primary" onClick={() => archiveInput.current?.click()} loading={busy}>浏览压缩包并导入</Button>
    </div>
  )}
</Modal>
```

实际样式沿用现有 `Button`、`Input`、`Field` 和工作区列表样式；网页端不出现“浏览文件夹”，只出现路径输入和压缩包浏览，避免暗示网页可以访问服务器资源管理器。

- [ ] **Step 5: 让应用布局复用相同文件规则**

在 `AppLayout.tsx` 删除本地 `file.arrayBuffer()` 的重复校验，改为导入 `readWorkspaceArchiveFile` 和 `WORKSPACE_ARCHIVE_ACCEPT`。现有布局导入行为保持不变：本地桌面选择目标父目录，远程/Android 传递名称或空目标。这样应用内导入与欢迎页均拒绝普通 `.zip`。

- [ ] **Step 6: 运行前端类型检查和构建**

运行：`npx tsc --noEmit -p tsconfig.web.json` 和项目已有前端构建命令 `npm run build`。

预期：无 JSX、平台 API 或 `File` 类型错误；构建产物成功生成。

- [ ] **Step 7: 提交欢迎页和复用逻辑**

```bash
git add src/renderer/src/pages/welcome/WelcomePage.tsx src/renderer/src/layouts/AppLayout.tsx src/renderer/src/lib/workspaceArchiveFile.ts
git commit -m "feat: unify workspace open and import picker"
```

### Task 5: 端到端验证与回归检查

**Files:**
- Modify only if a failing regression is found: the smallest affected source/test file.

- [ ] **Step 1: 运行工作区核心、服务器和渲染端测试**

运行：`npm test -- --run`

预期：全部已有测试和新增测试通过；若项目脚本不接受 `--run`，改用 `npx vitest run`，不得跳过测试文件。

- [ ] **Step 2: 验证服务器导入不会覆盖已有目录**

使用现有 server/registry 测试夹具上传一个合法归档：确认返回新摘要、注册表新增一条记录、原工作区文件未改变；重复导入生成另一个新目录或新的托管 ID，不覆盖原目录。上传损坏归档后确认 `.imports` 下没有残留临时目录。

- [ ] **Step 3: 验证路径打开不会创建或复制目录**

启动测试服务器，在托管根目录内创建一个合法但未登记的工作区，记录文件列表和修改时间；调用 `/api/workspaces/open-path` 后确认返回不透明 ID、注册表新增记录、目录内容和位置不变。依次请求根目录、目录外路径、`../` 路径和符号链接逃逸路径，确认均被拒绝。

- [ ] **Step 4: 做五平台手工验收**

按规格矩阵逐项操作：Electron 本地、Electron 远程、浏览器网页、Android 本地、Android 远程。每个平台确认列表打开、粘贴路径打开、可用的浏览按钮、压缩包导入、新目录保存和自动打开；网页端特别确认整个流程不需要服务器资源管理器。

- [ ] **Step 5: 运行最终检查并记录结果**

运行：

```bash
npm run build
npx tsc --noEmit -p tsconfig.json
npx tsc --noEmit -p tsconfig.web.json
git diff --check HEAD~4..HEAD
git status --short
```

预期：构建和两个类型检查成功，新增提交没有空白错误；`git status` 中只保留实现过程中原本存在的无关修改，不得把它们加入本功能提交。

- [ ] **Step 6: 提交必要的回归修复**

若前一步发现本功能引入的失败，只提交对应修复文件：

```bash
git add src/shared/api.ts src/shared/ipc.ts src/preload/index.ts src/main/ipc.ts src/server/workspaceRegistry.ts src/server/server.ts src/renderer/src/platform/httpApi.ts src/renderer/src/platform/androidApi.ts src/renderer/src/pages/welcome/WelcomePage.tsx src/renderer/src/layouts/AppLayout.tsx src/renderer/src/lib/workspaceArchiveFile.ts src/server/__tests__/workspaceRegistry.test.ts src/server/__tests__/server.test.ts src/renderer/src/platform/__tests__/httpApi.test.ts src/renderer/src/lib/__tests__/workspaceArchiveFile.test.ts
git commit -m "fix: verify workspace open import flows"
```

不要使用 `git add -A`，避免提交用户已有的无关改动。

---

## 实施自审

- 规格中的统一弹窗、打开与导入语义、服务器根目录边界、未登记目录登记、旧注册表兼容、Android 私有路径、HTTP 端点和验收矩阵均有对应任务。
- 计划没有要求实现服务器任意目录浏览器；网页端只上传本地压缩包或提交服务器路径。
- `openWorkspace` 与 `openWorkspaceByPath` 在 Task 1 定义，在 Task 3/4 中保持一致；`WorkspaceRecord.directory` 在 Task 2 定义后由所有 registry 方法复用。
- 所有实现任务先写失败测试，再实现，再运行测试；提交范围使用明确文件列表以保护当前脏工作区。
