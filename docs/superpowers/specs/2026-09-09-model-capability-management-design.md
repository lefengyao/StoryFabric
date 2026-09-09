# 模型能力管理与思考强度映射设计

**日期：** 2026-09-09
**状态：** 已确认，待实现

## 背景

现状（`src/renderer/src/pages/settings/SettingsPage.tsx:474-545`）：模型列表是供应商编辑弹窗里的一个 textarea，旁边一个「从服务拉取模型列表」按钮，下面一张「模型参数」表。存在这些问题：

1. 拉取与逐模型配置挤在小窗里，模型一多就很难用。
2. 推理开关被内置档案锁死（`disabled={!profile.reasoning}`），而档案只是尽力而为的公开资料，可能不准。
3. 没有图片输入能力标记。
4. 无法自定义添加拉取不到的模型（内测模型）；拉取结果直接全量覆盖配置，用户不能选择只保留常用的几个。
5. 各供应商的推理参数形式差异大（`reasoning_effort` / `thinking_budget` / `enable_thinking` / `thinking.type` / `thinkingConfig.thinkingBudget`），内置映射覆盖不全，且没有可靠接口可以拉取。

## 目标

1. 「拉取模型」移出供应商小窗，进入独立的整页「模型管理」。
2. 每个模型可展开一个面板：是否支持拓展思考（用户决定，不锁死）、思考强度、是否支持图片输入、上下文长度、输出上限、官方强度映射。
3. 用户自填「官方思考强度 → 本地等级」映射，智能体窗口发请求时按它生效。
4. 支持勾选添加/删除、手动添加任意模型名（内测模型）。

## 非目标

- **不做图片输入本身**（文件选择、图片编码、三家协议的多模态消息体、存储与清理）。本次只记录「该模型是否支持图片输入」并在 UI 展示。
- 不做映射的多参数/多路径：一次只映射一个请求体路径（Anthropic 的 `thinking` 继续走内置形式，见「边界」）。
- 不改协议适配器的消息结构、不改用量统计、不改会话存储。
- 不做模型能力的自动探测（没有可靠的公开接口）。

## 术语

- **拓展思考**：供应商侧的 reasoning / thinking 能力。
- **本地等级**：`off | low | medium | high`（`ReasoningLevel`）。
- **官方强度映射**：本地等级 → 请求体某个路径的值，由用户填写。

## 数据层

### `src/shared/types.ts`

```ts
/** 官方思考强度 → 本地等级的映射（用户自填，因无法可靠拉取） */
export interface ReasoningMap {
  /** 请求体里的参数路径，点号分隔：reasoning_effort / thinking.type / generationConfig.thinkingConfig.thinkingBudget */
  path: string
  /** 各等级对应的值（保留用户输入原文，发送时解析） */
  values: Partial<Record<ReasoningLevel, string>>
}

/** 单个模型的参数覆盖 */
export interface ModelSettings {
  /** 是否支持拓展思考（缺省回落到内置档案） */
  reasoningSupport?: boolean
  /** 是否支持图片输入（缺省回落到内置档案） */
  vision?: boolean
  reasoning?: ReasoningLevel
  /** 官方思考强度映射；填了则优先于协议内置形式 */
  reasoningMap?: ReasoningMap
  contextTokens?: number
  maxOutputTokens?: number
}
```

`ModelProfile`（`src/core/llm/modelCatalog.ts`）新增 `vision: boolean`，只作为开关初值，用户可覆盖。

### 持久化

新字段都是可选的，无需数据迁移。三个默认值/合并点已经整体展开透传，逐个确认即可：

- `src/main/services/settingsService.ts`
- `src/server/settingsStore.ts`
- `src/renderer/src/platform/androidApi.ts`

`pruneModelSettings(models, settings)` 按模型名过滤整个对象，天然覆盖新字段。

## core：解析与请求映射

### `src/core/llm/types.ts`

```ts
export interface ModelParams {
  reasoning: ReasoningLevel
  /** 用户声明优先；缺省时 `buildModelParams` 回落到内置档案 */
  reasoningSupport?: boolean
  /** 官方强度映射；缺省或该等级没填时回落内置形式 */
  reasoningMap?: ReasoningMap
  contextTokens: number
  maxOutputTokens: number
}
```

`vision` 不进入请求参数，只在 UI 侧按 `provider.modelSettings[model].vision ?? profile.vision` 解析并展示。

### `resolveModelSettings`

在现有返回对象（`reasoning` / `contextTokens` / `maxOutputTokens`）基础上追加两个字段：

```ts
reasoningSupport: configured.reasoningSupport
reasoningMap: configured.reasoningMap
```

`reasoningSupport` 缺省时保持 `undefined`（由 `buildModelParams` 回落档案），这样「用户没表态」与「用户明确关闭」可区分。

### `buildModelParams(protocol, model, params)`

1. `support = params.reasoningSupport ?? profile.reasoning`；`support === false` → 绝不发送任何推理参数（无论档案怎么说）。
2. 若 `params.reasoningMap?.path` 非空：
   - `value = parseReasoningValue(map.values[params.reasoning])`
   - `value !== undefined` → `setByPath(body, path, value)`，并且**不**附加协议内置推理参数。
   - `value === undefined`（该等级没填）→ 回落到内置形式。
3. 没有映射 → 行为与现状完全一致。

**`off` 语义**：映射里给 `off` 填了值（例如 `enable_thinking` = `false`）就发送该值；没填就完全不发这个参数。

### 新增 `src/core/llm/reasoningMap.ts`

```ts
/** 空/空白 → undefined；先按 JSON 解析（2048 / true / "low"），失败则按裸字符串（low → 'low'） */
export function parseReasoningValue(raw?: string): unknown | undefined

/** 按点路径逐级建对象写入；路径为空或含空段时忽略 */
export function setByPath(target: Record<string, unknown>, path: string, value: unknown): void
```

### 边界

- Anthropic 的 `thinking` 需要 `type` + `budget_tokens` 两个字段协同，且约束 `max_tokens > budget_tokens ≥ 1024`，因此继续走内置形式；映射只覆盖单一参数，UI 里要写明。
- 用映射发送推理参数时不会产生 `thinkingBlocks`，Anthropic 的思考块回放仍只在内置 `thinking` 路径生效。
- Gemini 的嵌套路径（`generationConfig.thinkingConfig.thinkingBudget`）由 `setByPath` 建出，与内置的 `generationConfig` 合并而不是覆盖整个对象。

## UI

### 1. 模型管理整页（新组件 `src/renderer/src/pages/settings/ModelManagerView.tsx`）

入口：供应商卡片上的「管理模型」按钮。`SettingsPage` 持有 `managingId`，为真时在设置内容区渲染整页视图（带返回按钮），不再是小窗。

结构：

- **顶部**：供应商名 + 协议徽标；「从服务拉取」按钮；手动添加输入框 + 「添加」按钮；搜索框。
- **「已添加（N）」**：每行 = 模型名 + 能力徽标（思考 / 图片）+ 展开箭头 + 删除按钮。
  - 展开面板：`支持拓展思考` 开关 →（打开后）`思考强度` 下拉 + `官方思考强度映射`（参数路径 + 关/低/中/高四个值输入）；`支持图片输入` 开关；上下文长度、输出上限下拉。
  - 开关初值来自内置档案，用户改动以用户为准，且不置灰。
- **「服务返回但未添加（M）」**：拉取后出现，每行复选框 + 「添加选中」/「添加全部」。拉取结果**不落盘**，只是当前页面的候选清单；点「保存」时只写用户最终保留的 `models` 与 `modelSettings`。
- **顶部**：「保存」按钮 + 保存后短暂显示「已保存」；**保存后留在本页**继续编辑其他模型，「返回」才是唯一离开方式（有未保存改动时确认）。

### 2. 供应商小窗瘦身（`SettingsPage.tsx`）

- 移除：模型列表 textarea、「从服务拉取模型列表」按钮、「模型参数」表。
- 保留：名称 / 协议 / Base URL / API Key。
- 新增：「管理模型」按钮；未保存的新供应商禁用并提示「先保存供应商」。

### 3. 聊天窗口（`ChatPage.tsx`）

模型下拉的 `<option>` 文案加能力后缀（如 `gpt-5 · 思考 · 图片`），让用户选模型时能直接看出能力。

## 保存路径

模型管理页复用 `api.saveProvider({ id, name, protocol, baseUrl, models, modelSettings })`（`apiKey` 缺省 = 沿用旧密钥），不新增 RPC/IPC 方法。

## 错误处理

| 场景 | 行为 |
| --- | --- |
| 拉取失败 / 返回空 | 页内错误条，沿用现有文案 |
| 手动添加空/重复/超长 | 拒绝并提示，不写入 |
| 映射值非法 | 允许输入与保存；发送时 `JSON.parse` 失败按裸字符串处理（可预期、不抛错） |
| 删除模型 | 连带删除该模型的 `modelSettings`（prune） |

## 测试计划

core：

- `reasoningMap.test.ts`：`parseReasoningValue`（数字/布尔/带引号字符串/裸字符串/空/空白）、`setByPath`（单层/多层建对象/覆盖/空段忽略）。
- `modelParams.test.ts`：`reasoningSupport: false` 不发；映射命中 → 只发映射且不附加内置参数；映射缺当前等级 → 回落内置；`off` 有值 → 发；`off` 无值 → 不发；三家协议各一例。
- `modelCatalog.test.ts`：`resolveModelSettings` 用户开关覆盖档案、vision 默认值、映射透传。
- `adapters.test.ts`：映射经适配器落到请求体（OpenAI 兼容 + Gemini 嵌套路径各一例）。
- 持久化：`settingsService.test.ts` / `server.test.ts` 往返包含新字段。

渲染层：

- `modelCapability.test.ts`：搜索过滤、添加/删除去重、勾选应用、映射输入校验。

验证命令：`npm test -- --run`、`npx tsc -b --pretty false`、`npm run build`、`npm run dist:win`、`npm run server:build:all`。打包前需要先关闭正在运行的应用（`release\win-unpacked` 会被占用）。

## 验收标准

1. 供应商小窗里不再有拉取按钮和模型参数表。
2. 模型管理整页能拉取、勾选添加、手动添加、删除、搜索。
3. 每个模型可展开，「支持拓展思考」开关不受档案限制；打开后出现强度下拉与映射编辑器。
4. 填了映射的模型，智能体窗口发请求时请求体按映射出现对应参数（测试 + 手工核对请求体）。
5. 关闭拓展思考 → 请求体不含推理参数（除非映射里显式填了「关」的值）。
6. 既有测试与新增测试全绿，`tsc -b`、`npm run build`、`npm run dist:win`、`npm run server:build:all` 通过。

## 风险与取舍

- 档案里的 `reasoning` / `vision` 只是默认值，可能不准 → 用户可覆盖且不锁定；这是本设计刻意的取舍。
- 映射只支持单一参数路径，覆盖不到需要多字段协同的形式（Anthropic `thinking`）→ 保留内置形式，UI 写明。
- 模型管理页保存时整份覆盖 `models`，多窗口并发编辑会互相覆盖 → 与现有供应商保存行为一致，本次不处理。
- 图片开关在图片输入落地前没有实际拦截作用 → 只做记录与展示，避免误导。
